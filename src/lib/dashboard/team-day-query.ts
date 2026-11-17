import "server-only";

import { sm8StaffLinkMap } from "@/lib/integrations/links";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { supabaseAdmin } from "@/lib/supabase-server";
import { crewNotBooked } from "@/lib/mobile/schedule-crew";
import { layoutScheduleDay } from "@/lib/workboard/schedule";
import type { SchedulePayload } from "@/lib/workboard/schedule-query";
import { teamDayOf, type LivePerson, type TeamDay } from "./team-day";

/** A place a phone said is shown this long, and no longer. */
export const LIVE_MINUTES = 20;

/* WHERE THE TEAM IS NOW (lib/mobile/where): the last place each phone said,
   in the last LIVE_MINUTES, only where the business has its team's location
   on. Named by their staff card (preferred name first), and matched to their
   ServiceM8 person, so the map draws them once. */
export async function liveTeam(orgId: string, viewer: string | null, now: number = Date.now()): Promise<(LivePerson & { sm8: string | null })[]> {
  const { data: org } = await supabaseAdmin.from("organizations").select("live_location").eq("id", orgId).maybeSingle();
  if (!(org as { live_location?: boolean } | null)?.live_location) return [];
  const since = new Date(now - LIVE_MINUTES * 60_000).toISOString();
  const { data: rows } = await supabaseAdmin.from("staff_positions").select("user_id, lat, lng, at").eq("org_id", orgId).gte("at", since);
  const said = (rows ?? []) as { user_id: string; lat: number; lng: number; at: string }[];
  if (said.length === 0) return [];
  const [{ data: cards }, links] = await Promise.all([
    supabaseAdmin.from("staff_profiles").select("id, user_id, preferred_name, first_name").eq("org_id", orgId).in("user_id", said.map((r) => r.user_id)),
    sm8StaffLinkMap(orgId).catch(() => new Map<string, string>()),
  ]);
  const card = new Map(((cards ?? []) as { id: string; user_id: string; preferred_name: string | null; first_name: string | null }[]).map((c) => [c.user_id, c]));
  const sm8Of = new Map([...links.entries()].map(([remote, staff]) => [staff, remote]));
  return said.flatMap((r) => {
    const c = card.get(r.user_id);
    const name = r.user_id === viewer ? "you" : c?.preferred_name?.trim() || c?.first_name?.trim() || "";
    if (!name) return [];
    return [{ name, at: { lat: Number(r.lat), lng: Number(r.lng) }, mins: Math.max(0, Math.round((now - Date.parse(r.at)) / 60_000)), sm8: c ? (sm8Of.get(c.id) ?? null) : null }];
  });
}

/* HOME'S SCHEDULE, the read (./team-day is the pure half). A day as the
   Schedule tab lays it out, and Schedule capacity's people with nothing
   booked and no time off, as the phone's Schedule says who's free
   (lib/mobile/schedule-crew). The day must have been read with its time
   off (`loadScheduleDay(…, { away: true })`), or someone away would read
   as free. */
export async function teamDayFor(
  orgId: string,
  payload: SchedulePayload,
  opts: { dayISO: string; today: boolean; nowMin: number | null; mine: string | null; userId?: string | null },
): Promise<TeamDay> {
  const day = layoutScheduleDay({
    activities: payload.activities,
    staff: payload.staff,
    jobs: payload.jobs,
    onSite: new Set(payload.onSite),
  });
  const low = (u: string | null | undefined) => (u ?? "").toLowerCase();
  const [crew, live] = await Promise.all([
    crewNotBooked(orgId, payload, async () => (await readSm8WriteState(orgId)).tenantId).catch(() => ({ free: [] })),
    opts.today ? liveTeam(orgId, opts.userId ?? null).catch(() => []) : Promise.resolve([]),
  ]);
  /* you first, where you're free too */
  const free = crew.free
    .map((p) => (opts.mine && low(p.uuid) === low(opts.mine) ? "you" : p.name))
    .sort((a, b) => (a === "you" ? -1 : b === "you" ? 1 : 0));
  return teamDayOf(day, { ...opts, places: payload.places, free, live });
}
