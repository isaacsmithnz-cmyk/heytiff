import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { bookingZone } from "@/lib/integrations/sm8-booking-zone";
import { sm8StaffLinkMap } from "@/lib/integrations/links";
import { streetLine } from "@/lib/studio/job-link";
import { wallMinute } from "./clock";
import { pushToStaff } from "./push";

/* YOUR SCHEDULE CHANGED, ON YOUR PHONE (Isaac, 29 October 2026: "start
   doing all of that", the overnight list: "when one of your bookings is
   added, moved or taken off, in ServiceM8 or HeyTiff, your phone says so").

   Read where ServiceM8's bookings land in HeyTiff (the live updates and the
   catch-up sync): each booking as it was and as it is now. A person hears
   about their own bookings from today to a fortnight out, changed in the
   last day, never one they changed themselves in HeyTiff, and once per
   landing however many changed. A first sync, landing hundreds of rows with
   nothing before them, tells nobody anything. */

export type Booking = {
  uuid: string;
  job_uuid: string | null;
  staff_uuid: string | null;
  start_date: string | null;
  end_date: string | null;
  activity_was_scheduled: number | string | null;
  active: number | string | null;
  edit_date?: string | null;
};

export type BookingChange = { uuid: string; staffUuid: string; jobUuid: string; kind: "new" | "moved" | "gone"; start: string };

const on = (v: unknown) => v === 1 || v === "1";
const low = (s: string | null | undefined) => (s ?? "").toLowerCase();

/** Each person's changed bookings, from how they were to how they are. Wall
    times ("YYYY-MM-DD HH:MM:SS") throughout, as ServiceM8 keeps them. Pure. */
export function bookingChanges(
  before: ReadonlyMap<string, Booking>,
  after: readonly Booking[],
  window: { from: string; until: string; editedSince: string },
): BookingChange[] {
  const out: BookingChange[] = [];
  const inWindow = (s: string | null) => !!s && s >= window.from && s <= window.until;
  for (const a of after) {
    const b = before.get(low(a.uuid));
    const was = !!b && on(b.active) && on(b.activity_was_scheduled);
    const is = on(a.active) && on(a.activity_was_scheduled);
    if (!was && !is) continue;
    if ((a.edit_date ?? "") < window.editedSince) continue;
    const add = (staffUuid: string | null, kind: BookingChange["kind"], start: string | null, jobUuid: string | null) => {
      if (staffUuid && jobUuid && start && inWindow(start)) out.push({ uuid: low(a.uuid), staffUuid: low(staffUuid), jobUuid: low(jobUuid), kind, start });
    };
    if (!was) add(a.staff_uuid, "new", a.start_date, a.job_uuid);
    else if (!is) add(b!.staff_uuid, "gone", b!.start_date, b!.job_uuid);
    else if (low(b!.staff_uuid) !== low(a.staff_uuid)) {
      add(b!.staff_uuid, "gone", b!.start_date, b!.job_uuid);
      add(a.staff_uuid, "new", a.start_date, a.job_uuid);
    } else if (b!.start_date !== a.start_date || b!.end_date !== a.end_date) {
      if (inWindow(a.start_date)) add(a.staff_uuid, "moved", a.start_date, a.job_uuid);
      else add(b!.staff_uuid, "gone", b!.start_date, b!.job_uuid);
    }
  }
  return out;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon 2 Nov, 9:00 am" from a wall time. */
export function whenWords(wall: string): string {
  const [d, t] = wall.split(" ");
  const [y, m, day] = (d ?? "").split("-").map(Number);
  const [h, min] = (t ?? "").split(":").map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, day!)).getUTCDay();
  const hour = h! % 12 || 12;
  return `${DAYS[dow]} ${day} ${MONTHS[m! - 1]}, ${hour}:${String(min).padStart(2, "0")} ${h! < 12 ? "am" : "pm"}`;
}

/** What one person is told: one change said whole, several counted. Pure. */
export function changeMessage(changes: readonly BookingChange[], jobName: (jobUuid: string) => string): { title: string; body: string } {
  const line = (c: BookingChange) =>
    c.kind === "new" ? `${jobName(c.jobUuid)}, ${whenWords(c.start)}` : c.kind === "moved" ? `${jobName(c.jobUuid)} moved to ${whenWords(c.start)}` : `${jobName(c.jobUuid)}, ${whenWords(c.start)}, taken off`;
  if (changes.length === 1) {
    const c = changes[0]!;
    return { title: c.kind === "new" ? "New booking" : c.kind === "moved" ? "Booking moved" : "Booking taken off", body: line(c) };
  }
  const shown = changes.slice(0, 2).map(line);
  const more = changes.length - shown.length;
  return { title: `Your schedule changed: ${changes.length} bookings`, body: `${shown.join(". ")}${more > 0 ? ` (and ${more} more)` : ""}` };
}

/** How they were, before a landing: read just ahead of the write. */
export async function bookingsBefore(orgId: string, uuids: readonly string[]): Promise<Map<string, Booking>> {
  const out = new Map<string, Booking>();
  const want = [...new Set(uuids.filter(Boolean))];
  for (let i = 0; i < want.length; i += 200) {
    const { data } = await supabaseAdmin
      .from("sm8_job_activities")
      .select("uuid, job_uuid, staff_uuid, start_date, end_date, activity_was_scheduled, active, edit_date")
      .eq("org_id", orgId)
      .in("uuid", want.slice(i, i + 200));
    for (const r of (data ?? []) as Booking[]) out.set(low(r.uuid), r);
  }
  return out;
}

/** After a landing: tell each person what changed of theirs. Never throws. */
export async function tellBookingChanges(orgId: string, before: ReadonlyMap<string, Booking>, after: readonly Booking[], now: number = Date.now()): Promise<number> {
  try {
    /* a first sync lands everything with nothing before it: no one is told */
    if (before.size === 0 && after.length > 20) return 0;
    const zone = (await bookingZone(orgId)).zone;
    if (!zone) return 0;
    const from = `${wallMinute(new Date(now).toISOString(), zone)?.slice(0, 10)} 00:00:00`;
    const until = `${wallMinute(new Date(now + 14 * 86_400_000).toISOString(), zone)?.slice(0, 10)} 23:59:59`;
    const editedSince = wallMinute(new Date(now - 86_400_000).toISOString(), zone) ?? "";
    const changes = bookingChanges(before, after, { from, until, editedSince });
    if (!changes.length) return 0;

    const links = await sm8StaffLinkMap(orgId);
    const cardOf = new Map([...links].map(([remote, card]) => [low(remote), card]));
    /* a change a person made themselves in HeyTiff isn't news to them */
    const { data: writes } = await supabaseAdmin
      .from("sm8_writes")
      .select("remote_uuid, target_uuid, requested_by")
      .eq("org_id", orgId)
      .eq("kind", "booking")
      .gte("created_at", new Date(now - 2 * 3_600_000).toISOString());
    const theirOwn = new Set(
      ((writes ?? []) as { remote_uuid: string | null; target_uuid: string | null; requested_by: string | null }[]).flatMap((w) =>
        [w.remote_uuid, w.target_uuid].filter((u): u is string => !!u).map((u) => `${low(u)}|${w.requested_by ?? ""}`),
      ),
    );
    const byCard = new Map<string, BookingChange[]>();
    for (const c of changes) {
      const card = cardOf.get(c.staffUuid);
      if (!card || theirOwn.has(`${c.uuid}|${card}`)) continue;
      byCard.set(card, [...(byCard.get(card) ?? []), c]);
    }
    if (!byCard.size) return 0;

    const jobs = [...new Set([...byCard.values()].flat().map((c) => c.jobUuid))];
    const { data: rows } = await supabaseAdmin.from("sm8_jobs").select("uuid, generated_job_id, job_address").eq("org_id", orgId).in("uuid", jobs);
    const names = new Map(
      ((rows ?? []) as { uuid: string; generated_job_id: string | null; job_address: string | null }[]).map((j) => [
        low(j.uuid),
        [j.generated_job_id, streetLine(j.job_address)].filter(Boolean).join(", "),
      ]),
    );
    let told = 0;
    for (const [card, theirs] of byCard) {
      const sorted = [...theirs].sort((a, b) => (a.start < b.start ? -1 : 1));
      const m = changeMessage(sorted, (u) => names.get(u) || "A job");
      told += await pushToStaff(orgId, [card], { title: m.title, body: m.body, path: "/schedule" });
    }
    return told;
  } catch (err) {
    console.error(`[mobile] couldn't tell schedule changes for org ${orgId}: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}
