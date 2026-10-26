import { supabaseAdmin } from "@/lib/supabase-server";

/* A JOB'S COMING VISITS, a day each with everyone booked on it, for the
   phone's job page. The job's own `nextBooking` names the first booking's
   one person, so a crewed day read as a job for Alex alone (Isaac, 26
   October 2026, beside the Schedule's four names on the same job and day).

   The same rule the job sheet's booked list uses: the job's active,
   scheduled diary rows from today on. A day runs from the first of the crew
   on to the last off. People are named by ServiceM8's staff row, matched
   whatever case the uuid arrived in. Org-scoped like every read here; the
   caller has already decided the reader may see the job. */

export type ComingVisit = { day: string; start: string; end: string | null; crew: string[] };

type Row = { start_date: string | null; end_date: string | null; staff_uuid: string | null };

/** At most this many days ahead are listed: a page, not a diary. */
const DAYS = 6;

export async function comingVisits(orgId: string, jobUuid: string, today: string): Promise<ComingVisit[]> {
  const { data } = await supabaseAdmin
    .from("sm8_job_activities")
    .select("start_date, end_date, staff_uuid")
    .eq("org_id", orgId)
    .eq("active", 1)
    .eq("job_uuid", jobUuid)
    .eq("activity_was_scheduled", 1)
    .gte("start_date", today)
    .order("start_date", { ascending: true })
    .limit(200);
  const rows = ((data ?? []) as Row[]).filter((r): r is Row & { start_date: string } => !!r.start_date);
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map((r) => r.staff_uuid).filter((u): u is string => !!u))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: staff } = await supabaseAdmin
      .from("sm8_staff")
      .select("uuid, first, last")
      .eq("org_id", orgId)
      .in("uuid", [...new Set(ids.flatMap((u) => [u, u.toLowerCase(), u.toUpperCase()]))]);
    for (const s of (staff ?? []) as { uuid: string; first: string | null; last: string | null }[]) {
      const name = [s.first, s.last].filter(Boolean).join(" ").trim();
      if (name) names.set(s.uuid.toLowerCase(), name);
    }
  }

  const byDay = new Map<string, ComingVisit>();
  for (const r of rows) {
    const day = r.start_date.slice(0, 10);
    const v = byDay.get(day) ?? { day, start: r.start_date, end: r.end_date, crew: [] };
    if (r.start_date < v.start) v.start = r.start_date;
    if (r.end_date && (!v.end || r.end_date > v.end)) v.end = r.end_date;
    const who = r.staff_uuid ? names.get(r.staff_uuid.toLowerCase()) : undefined;
    if (who && !v.crew.includes(who)) v.crew.push(who);
    byDay.set(day, v);
  }
  return [...byDay.values()]
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(0, DAYS)
    .map((v) => ({ ...v, crew: [...v.crew].sort((a, b) => a.localeCompare(b)) }));
}
