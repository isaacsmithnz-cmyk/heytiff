/* Workboard reads — mirror queries only, org-scoped, server-only.

   Everything here reads the sm8_* mirrors, never ServiceM8 itself: the board
   renders from local rows whatever the upstream is doing, and freshness is
   the sync engine's job. Mirror datetime columns are naive local STRINGS, so
   every range predicate here is a string comparison against wall-clock
   bounds built by the caller — correct because the format is fixed-width
   big-endian, and tested where the bounds are built.

   NO SESSION HERE — callers establish the right to ask and hand in orgId. */

import { supabaseAdmin } from "@/lib/supabase-server";

export type WorkboardCounts = {
  quotes: number;
  workOrders: number;
  /** Jobs whose status turned Completed inside the trailing fortnight. */
  completedFortnight: number;
};

async function countJobs(orgId: string, apply: (q: Query) => Query): Promise<number> {
  const base = supabaseAdmin
    .from("sm8_jobs")
    .select("uuid", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("active", 1);
  const { count } = await apply(base as unknown as Query);
  return count ?? 0;
}

// The supabase builder's generics add nothing over this surface, and typing
// the three call sites against it keeps countJobs readable.
type Query = {
  eq: (col: string, v: unknown) => Query;
  gt: (col: string, v: string) => Query;
} & PromiseLike<{ count: number | null }>;

export async function countJobsByStatus(
  orgId: string,
  completedFloor: string
): Promise<WorkboardCounts> {
  const [quotes, workOrders, completedFortnight] = await Promise.all([
    countJobs(orgId, (q) => q.eq("status", "Quote")),
    countJobs(orgId, (q) => q.eq("status", "Work Order")),
    countJobs(orgId, (q) => q.eq("status", "Completed").gt("completion_date", completedFloor)),
  ]);
  return { quotes, workOrders, completedFortnight };
}

export type UpcomingBooking = {
  id: string;
  /** Naive local strings, verbatim from the mirror. */
  start: string;
  end: string | null;
  staffName: string | null;
  jobNumber: string | null;
  jobStatus: string | null;
  clientName: string | null;
  suburb: string | null;
};

/** Scheduled blocks inside [fromDay, toDay) on the account's wall clock,
    dressed with the names a human needs: job number, client, suburb, tech. */
export async function listUpcomingBookings(
  orgId: string,
  fromDay: string,
  toDay: string,
  limit = 14
): Promise<UpcomingBooking[]> {
  const { data } = await supabaseAdmin
    .from("sm8_job_activities")
    .select("uuid, job_uuid, staff_uuid, start_date, end_date")
    .eq("org_id", orgId)
    .eq("active", 1)
    .gte("start_date", `${fromDay} 00:00:00`)
    .lt("start_date", `${toDay} 00:00:00`)
    .order("start_date", { ascending: true })
    .limit(limit);

  type ActivityRow = {
    uuid: string;
    job_uuid: string | null;
    staff_uuid: string | null;
    start_date: string;
    end_date: string | null;
  };
  const activities = (data ?? []) as ActivityRow[];
  if (activities.length === 0) return [];

  const jobUuids = [...new Set(activities.map((a) => a.job_uuid).filter(Boolean))] as string[];
  const staffUuids = [...new Set(activities.map((a) => a.staff_uuid).filter(Boolean))] as string[];

  const { data: jobRows } = jobUuids.length
    ? await supabaseAdmin
        .from("sm8_jobs")
        .select("uuid, generated_job_id, status, company_uuid, geo_city")
        .eq("org_id", orgId)
        .in("uuid", jobUuids)
    : { data: [] };

  type JobRow = {
    uuid: string;
    generated_job_id: string | null;
    status: string | null;
    company_uuid: string | null;
    geo_city: string | null;
  };
  const jobs = new Map(((jobRows ?? []) as JobRow[]).map((j) => [j.uuid, j]));

  const companyUuids = [
    ...new Set([...jobs.values()].map((j) => j.company_uuid).filter(Boolean)),
  ] as string[];
  const { data: companyRows } = companyUuids.length
    ? await supabaseAdmin
        .from("sm8_companies")
        .select("uuid, name")
        .eq("org_id", orgId)
        .in("uuid", companyUuids)
    : { data: [] };
  const companies = new Map(
    ((companyRows ?? []) as { uuid: string; name: string | null }[]).map((c) => [c.uuid, c.name])
  );

  const { data: staffRows } = staffUuids.length
    ? await supabaseAdmin
        .from("sm8_staff")
        .select("uuid, first, last")
        .eq("org_id", orgId)
        .in("uuid", staffUuids)
    : { data: [] };
  const staff = new Map(
    ((staffRows ?? []) as { uuid: string; first: string | null; last: string | null }[]).map(
      (s) => [s.uuid, [s.first, s.last].filter(Boolean).join(" ") || null]
    )
  );

  return activities.map((a) => {
    const job = a.job_uuid ? jobs.get(a.job_uuid) : undefined;
    return {
      id: a.uuid,
      start: a.start_date,
      end: a.end_date,
      staffName: a.staff_uuid ? staff.get(a.staff_uuid) ?? null : null,
      jobNumber: job?.generated_job_id ?? null,
      jobStatus: job?.status ?? null,
      clientName: job?.company_uuid ? companies.get(job.company_uuid) ?? null : null,
      suburb: job?.geo_city ?? null,
    };
  });
}

export async function getSm8Timezone(orgId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("sm8_vendor")
    .select("timezone_name")
    .eq("org_id", orgId)
    .maybeSingle();
  return (data as { timezone_name: string | null } | null)?.timezone_name ?? null;
}
