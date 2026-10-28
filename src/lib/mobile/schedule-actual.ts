import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { bookingZone } from "@/lib/integrations/sm8-booking-zone";
import { wallInstant } from "@/lib/integrations/sm8-booking-plan";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { listSm8StaffLinks } from "@/lib/integrations/links";
import { sm8CheckInLeftOpen } from "@/lib/workboard/all-jobs";
import { wallMinute } from "./clock";

/* WHAT WAS ACTUALLY DONE ON A DAY, beside its bookings (Isaac, 28 October
   2026: "can your schedule then show what you actually did. Alongside your
   bookings"). Two kinds of time on a job:

     servicem8  ServiceM8's own check-ins (recorded time), as mirrored
     phone      HeyTiff's own stints from the phone's day (job_check_ins),
                for the person their sign-in is linked to

   Where both cover the same person on the same job at the same time,
   ServiceM8's counts, as at Clock off. A check-in left open (into the next
   day, or past a working day) is shown, but counts no hours: the rule the
   job card already keeps (sm8CheckInLeftOpen).

   Every stamp is the account's own wall clock, "YYYY-MM-DD HH:MM:SS", the
   way the day's bookings come. */

export type ActualSpan = {
  staffUuid: string;
  jobUuid: string;
  start: string;
  /** null while it's still running */
  end: string | null;
  how: "servicem8" | "phone";
  /** left open: shown, no hours */
  leftOn: boolean;
  /** why you were there, on the phone's own time: site_meeting, helping, or plain labour */
  reason: string | null;
};

const low = (s: string) => s.toLowerCase();
const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** The day's actual time: everyone's, or one person's (`only`, their ServiceM8 staff uuid). */
export async function actualOn(orgId: string, dayISO: string, only: string | null): Promise<ActualSpan[]> {
  const floor = `${dayISO} 00:00:00`;
  const ceil = `${nextDay(dayISO)} 00:00:00`;
  let q = supabaseAdmin
    .from("sm8_job_activities")
    .select("job_uuid, staff_uuid, start_date, end_date")
    .eq("org_id", orgId)
    .eq("active", 1)
    .eq("activity_was_scheduled", 0)
    .gte("start_date", floor)
    .lt("start_date", ceil);
  if (only) q = q.in("staff_uuid", [...new Set([only, low(only), only.toUpperCase()])]);
  const [{ data: recorded }, zone, state] = await Promise.all([q, bookingZone(orgId), readSm8WriteState(orgId).catch(() => null)]);

  const theirs: ActualSpan[] = ((recorded ?? []) as { job_uuid: string | null; staff_uuid: string | null; start_date: string | null; end_date: string | null }[])
    .filter((r): r is { job_uuid: string; staff_uuid: string; start_date: string; end_date: string | null } => !!r.job_uuid && !!r.staff_uuid && !!r.start_date)
    .map((r) => ({
      staffUuid: r.staff_uuid,
      jobUuid: r.job_uuid,
      start: r.start_date,
      end: r.end_date && r.end_date > r.start_date ? r.end_date : null,
      how: "servicem8" as const,
      leftOn: !!r.end_date && sm8CheckInLeftOpen(r.start_date, r.end_date),
      reason: null,
    }));

  /* the phone's own stints, for the people whose sign-in is linked to a ServiceM8 staff member */
  const mine: ActualSpan[] = [];
  const z = zone.zone;
  const tenant = state?.tenantId ?? null;
  const from = z ? wallInstant(floor, z, "earliest") : null;
  const to = z ? wallInstant(ceil, z, "earliest") : null;
  if (z && tenant && from !== null && to !== null) {
    const links = await listSm8StaffLinks(orgId, tenant).catch(() => []);
    const staffOfProfile = new Map(links.map((l) => [l.staffProfileId, l.remoteId]));
    const { data: stints } = await supabaseAdmin
      .from("job_check_ins")
      .select("sm8_job_uuid, user_id, checked_in_at, checked_out_at, reason")
      .eq("org_id", orgId)
      .gte("checked_in_at", new Date(from).toISOString())
      .lt("checked_in_at", new Date(to).toISOString());
    const rows = (stints ?? []) as { sm8_job_uuid: string; user_id: string; checked_in_at: string; checked_out_at: string | null; reason: string | null }[];
    const users = [...new Set(rows.map((r) => r.user_id))];
    const { data: profiles } = users.length
      ? await supabaseAdmin.from("staff_profiles").select("id, user_id").eq("org_id", orgId).in("user_id", users)
      : { data: [] };
    const staffOfUser = new Map(((profiles ?? []) as { id: string; user_id: string }[]).map((p) => [p.user_id, staffOfProfile.get(p.id) ?? null]));
    for (const r of rows) {
      const staffUuid = staffOfUser.get(r.user_id);
      if (!staffUuid || (only && low(staffUuid) !== low(only))) continue;
      const start = wallMinute(r.checked_in_at, z);
      const end = r.checked_out_at ? wallMinute(r.checked_out_at, z) : null;
      if (!start) continue;
      mine.push({ staffUuid, jobUuid: r.sm8_job_uuid, start, end, how: "phone", leftOn: !!end && sm8CheckInLeftOpen(start, end), reason: r.reason });
    }
  }

  /* ServiceM8's wins where both cover the same person on the same job at the same time */
  const covers = (a: ActualSpan, b: ActualSpan) =>
    low(a.staffUuid) === low(b.staffUuid) && low(a.jobUuid) === low(b.jobUuid) && a.start < (b.end ?? "9999") && b.start < (a.end ?? "9999");
  const kept = mine.filter((m) => !theirs.some((t) => covers(t, m)));
  return [...theirs, ...kept].sort((a, b) => (a.start < b.start ? -1 : 1));
}
