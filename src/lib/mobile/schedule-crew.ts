import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { listSm8StaffLinks } from "@/lib/integrations/links";
import { plusDays } from "@/lib/workboard/dates";
import type { SchedulePayload } from "@/lib/workboard/schedule-query";

/* WHO ISN'T BOOKED, for the phone's Schedule (Isaac, 27 October 2026: "I
   want to see if anyone has been unassigned. Or not booked anywhere").

   THE CREW IS SCHEDULE CAPACITY'S: the people Settings › Schedule capacity
   counts toward a day (schedule_capacity_staff, included), active in
   ServiceM8. Someone on it with no booking that day and no time off is
   free; someone with time off and no booking is off, with what the
   business called it and when it ends. Someone booked for part of it, with
   an hour or more of their day left (Schedule capacity's hours for them),
   is free after their last booking ends (Isaac, 27 October 2026: "free
   after a certain time"). Nobody else is listed: the office, and a
   placeholder like "Pending Jobs", never count. */

export type CrewFree = { uuid: string; name: string; title: string | null };
export type CrewOff = CrewFree & {
  /** What the business typed ("Annual Leave"); null where it typed nothing. */
  word: string | null;
  /** The last day it covers, where it runs past this one. */
  until: string | null;
  /** Its times, where it is part of this day only. */
  from: string | null;
  to: string | null;
};
/** Booked for part of the day, with room after. */
export type CrewLater = CrewFree & {
  /** When their last booking ends: "YYYY-MM-DD HH:MM:SS". */
  after: string;
};

/** The least room after someone's bookings that counts as room. */
export const ROOM_MIN = 60;

const low = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** The day's crew with nothing booked: free, off, and free after a part of
    the day. Empty where the crew isn't set, or couldn't be read. */
export async function crewNotBooked(
  orgId: string,
  day: SchedulePayload,
  tenant: () => Promise<string | null>
): Promise<{ free: CrewFree[]; off: CrewOff[]; later: CrewLater[] }> {
  const none = { free: [], off: [], later: [] };
  const [{ data: crewRows, error: crewError }, { data: staffRows, error: staffError }] = await Promise.all([
    supabaseAdmin.from("schedule_capacity_staff").select("sm8_staff_uuid, daily_minutes").eq("org_id", orgId).eq("included", true),
    supabaseAdmin.from("sm8_staff").select("uuid, first, last, active").eq("org_id", orgId).eq("active", 1),
  ]);
  if (crewError || staffError) return none;
  const dayOf = new Map(((crewRows ?? []) as { sm8_staff_uuid: string; daily_minutes: number | null }[]).map((r) => [low(r.sm8_staff_uuid), r.daily_minutes ?? 0]));
  const people = ((staffRows ?? []) as { uuid: string; first: string | null; last: string | null }[])
    .filter((s) => dayOf.has(low(s.uuid)))
    .map((s) => ({ uuid: s.uuid, name: [s.first, s.last].filter(Boolean).join(" ").trim() }))
    .filter((s) => s.name !== "");
  if (people.length === 0) return none;

  const away = new Map<string, NonNullable<SchedulePayload["away"]>[number]>();
  for (const a of day.away ?? []) if (!away.has(low(a.staffUuid))) away.set(low(a.staffUuid), a);

  /* each person's bookings that day: how long, together, and when the last ends */
  const theirs = new Map<string, { start: string; end: string }[]>();
  for (const a of day.activities) {
    if (!a.staffUuid || !a.end) continue;
    (theirs.get(low(a.staffUuid)) ?? theirs.set(low(a.staffUuid), []).get(low(a.staffUuid))!).push({ start: a.start, end: a.end });
  }
  const unbooked = people.filter((p) => !theirs.has(low(p.uuid)));
  const roomy = people.flatMap((p) => {
    const spans = theirs.get(low(p.uuid));
    if (!spans || away.has(low(p.uuid))) return [];
    const after = spans.map((x) => x.end).sort().at(-1)!;
    return (dayOf.get(low(p.uuid)) ?? 0) - bookedMinutes(spans) >= ROOM_MIN ? [{ ...p, after }] : [];
  });
  if (unbooked.length === 0 && roomy.length === 0) return none;

  const titles = await titlesOf(orgId, await tenant().catch(() => null), [...unbooked, ...roomy].map((p) => p.uuid));
  const later: CrewLater[] = roomy
    .sort((a, b) => a.after.localeCompare(b.after) || a.name.localeCompare(b.name))
    .map((p) => ({ uuid: p.uuid, name: p.name, title: titles.get(low(p.uuid)) ?? null, after: p.after }));

  const free: CrewFree[] = [];
  const off: CrewOff[] = [];
  const next = `${plusDays(day.dayISO, 1)} 00:00:00`;
  for (const p of unbooked.sort((a, b) => a.name.localeCompare(b.name))) {
    const title = titles.get(low(p.uuid)) ?? null;
    const a = away.get(low(p.uuid));
    if (!a) {
      free.push({ uuid: p.uuid, name: p.name, title });
      continue;
    }
    const allDay = a.start <= `${day.dayISO} 00:00:00` && a.end >= next;
    const runsOn = a.end > next;
    /* an end at midnight is the day before's last moment */
    const lastDay = a.end.slice(11) === "00:00:00" ? plusDays(a.end.slice(0, 10), -1) : a.end.slice(0, 10);
    off.push({
      uuid: p.uuid,
      name: p.name,
      title,
      word: a.name,
      until: runsOn && lastDay > day.dayISO ? lastDay : null,
      from: allDay || runsOn ? null : a.start,
      to: allDay || runsOn ? null : a.end,
    });
  }
  return { free, off, later };
}

/** Minutes booked, overlaps counted once. */
function bookedMinutes(spans: { start: string; end: string }[]): number {
  const min = (stamp: string) => Number(stamp.slice(11, 13)) * 60 + Number(stamp.slice(14, 16));
  let total = 0;
  let reach = -1;
  for (const s of [...spans].sort((a, b) => a.start.localeCompare(b.start))) {
    const a = Math.max(min(s.start), reach);
    const b = min(s.end);
    if (b > a) total += b - a;
    reach = Math.max(reach, b);
  }
  return total;
}

/** Each person's job title on their HeyTiff card, by lower-case ServiceM8
    uuid, where they are linked and it says one. */
async function titlesOf(orgId: string, tenantId: string | null, uuids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!tenantId || uuids.length === 0) return out;
  const wanted = new Set(uuids.map(low));
  const links = (await listSm8StaffLinks(orgId, tenantId).catch(() => [])).filter((l) => wanted.has(low(l.remoteId)));
  if (links.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, job_title")
    .eq("org_id", orgId)
    .in("id", links.map((l) => l.staffProfileId));
  if (error) return out;
  const title = new Map(((data ?? []) as { id: string; job_title: string | null }[]).map((r) => [r.id, r.job_title?.trim() || null]));
  for (const l of links) {
    const t = title.get(l.staffProfileId);
    if (t) out.set(low(l.remoteId), t);
  }
  return out;
}
