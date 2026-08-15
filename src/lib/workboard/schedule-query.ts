/* One day of the diary, loaded on demand — the Schedule tab's read.

   THE DECISIONS LIVE IN schedule.ts (pure, tested); this file only fetches,
   joins the names, and hands over rows — the loadAllJobs contract, repeated.
   Names are joined in app code, not SQL: the mirror has no foreign keys by
   doctrine, so staff, clients and categories are looked up through their own
   tables and matched here.

   DATES ARE STRINGS. The day's bounds are naive local text compared
   lexicographically — `[day 00:00:00, day+1 00:00:00)` — never Dates, for
   the reason stamped on every file that touches this mirror.

   JOBS COME BACK IN THE AllJobsMirrorJob SHAPE, deliberately: the component
   feeds one through allJobsRows to build the exact row the JobSheet already
   opens on. One law shapes a job's row everywhere; the schedule doesn't get
   its own slightly-different copy to drift.

   NO SESSION HERE — callers establish the right to ask, exactly as
   all-jobs-query.ts says. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { plusDays } from "./dates";
import { mondayOf } from "./board-status";
import { sm8CategoryColour, type AllJobsMirrorJob } from "./all-jobs";
import type { ScheduleActivity, ScheduleStaff } from "./schedule";

export type SchedulePayload = {
  dayISO: string;
  activities: ScheduleActivity[];
  staff: ScheduleStaff[];
  jobs: AllJobsMirrorJob[];
  /** Booking count per day for the Mon–Sun week around dayISO — the strip's
      numbers, one grouped read instead of seven day loads. */
  weekCounts: Record<string, number>;
};

export const EMPTY_SCHEDULE: SchedulePayload = {
  dayISO: "",
  activities: [],
  staff: [],
  jobs: [],
  weekCounts: {},
};

/** One line of a description, capped — the block's hover carries a glance,
    the sheet shows the whole thing. Same shape as all-jobs-query's. */
function oneLine(text: string | null, max = 160): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export async function loadScheduleDay(orgId: string, dayISO: string): Promise<SchedulePayload> {
  const dayFloor = `${dayISO} 00:00:00`;
  const dayCeil = `${plusDays(dayISO, 1)} 00:00:00`;
  const monday = mondayOf(dayISO);
  const weekFloor = `${monday} 00:00:00`;
  const weekCeil = `${plusDays(monday, 7)} 00:00:00`;

  const [{ data: actRows }, { data: weekRows }] = await Promise.all([
    supabaseAdmin
      .from("sm8_job_activities")
      .select("uuid, job_uuid, staff_uuid, start_date, end_date, activity_was_scheduled")
      .eq("org_id", orgId)
      .eq("active", 1)
      .eq("activity_was_scheduled", 1)
      .gte("start_date", dayFloor)
      .lt("start_date", dayCeil)
      .order("start_date", { ascending: true }),
    supabaseAdmin
      .from("sm8_job_activities")
      .select("start_date")
      .eq("org_id", orgId)
      .eq("active", 1)
      .eq("activity_was_scheduled", 1)
      .gte("start_date", weekFloor)
      .lt("start_date", weekCeil),
  ]);

  const acts = (actRows ?? []) as {
    uuid: string;
    job_uuid: string | null;
    staff_uuid: string | null;
    start_date: string | null;
    end_date: string | null;
    activity_was_scheduled: number | null;
  }[];

  const weekCounts: Record<string, number> = {};
  for (const r of (weekRows ?? []) as { start_date: string | null }[]) {
    const d = r.start_date?.slice(0, 10);
    if (d) weekCounts[d] = (weekCounts[d] ?? 0) + 1;
  }

  const activities: ScheduleActivity[] = acts
    .filter((a): a is typeof a & { start_date: string } => !!a.start_date)
    .map((a) => ({
      uuid: a.uuid,
      jobUuid: a.job_uuid,
      staffUuid: a.staff_uuid,
      start: a.start_date,
      end: a.end_date,
      wasScheduled: a.activity_was_scheduled,
    }));

  if (activities.length === 0) {
    return { ...EMPTY_SCHEDULE, dayISO, weekCounts };
  }

  const staffIds = [...new Set(activities.map((a) => a.staffUuid).filter(Boolean) as string[])];
  const jobIds = [...new Set(activities.map((a) => a.jobUuid).filter(Boolean) as string[])];

  const [{ data: staffRows }, { data: jobRows }] = await Promise.all([
    staffIds.length
      ? supabaseAdmin
          .from("sm8_staff")
          .select("uuid, first, last")
          .eq("org_id", orgId)
          .in("uuid", staffIds)
      : Promise.resolve({ data: [] }),
    jobIds.length
      ? supabaseAdmin
          .from("sm8_jobs")
          .select(
            "uuid, generated_job_id, status, company_uuid, geo_city, category_uuid, " +
              "job_description, date, quote_date, completion_date"
          )
          .eq("org_id", orgId)
          .eq("active", 1)
          .in("uuid", jobIds)
      : Promise.resolve({ data: [] }),
  ]);

  const jobs = (jobRows ?? []) as unknown as {
    uuid: string;
    generated_job_id: string | null;
    status: string | null;
    company_uuid: string | null;
    geo_city: string | null;
    category_uuid: string | null;
    job_description: string | null;
    date: string | null;
    quote_date: string | null;
    completion_date: string | null;
  }[];

  const companyIds = [...new Set(jobs.map((j) => j.company_uuid).filter(Boolean) as string[])];
  const categoryIds = [...new Set(jobs.map((j) => j.category_uuid).filter(Boolean) as string[])];

  const [{ data: companyRows }, { data: categoryRows }] = await Promise.all([
    companyIds.length
      ? supabaseAdmin
          .from("sm8_companies")
          .select("uuid, name")
          .eq("org_id", orgId)
          .in("uuid", companyIds)
      : Promise.resolve({ data: [] }),
    categoryIds.length
      ? supabaseAdmin
          .from("sm8_categories")
          .select("uuid, name, colour")
          .eq("org_id", orgId)
          .in("uuid", categoryIds)
      : Promise.resolve({ data: [] }),
  ]);

  const companyName = new Map(
    ((companyRows ?? []) as { uuid: string; name: string | null }[]).map((c) => [c.uuid, c.name])
  );
  /* Live category names carry trailing spaces; colours arrive as bare hex.
     Both sanitised at the boundary, as loadAllJobs does. */
  const categoryInfo = new Map(
    ((categoryRows ?? []) as { uuid: string; name: string | null; colour: string | null }[]).map(
      (c) => [c.uuid, { name: c.name?.trim() || null, colour: sm8CategoryColour(c.colour) }]
    )
  );

  const staff: ScheduleStaff[] = ((staffRows ?? []) as {
    uuid: string;
    first: string | null;
    last: string | null;
  }[])
    .map((s) => ({ uuid: s.uuid, name: [s.first, s.last].filter(Boolean).join(" ").trim() }))
    .filter((s) => s.name !== "");

  return {
    dayISO,
    activities,
    staff,
    weekCounts,
    jobs: jobs.map((j) => ({
      remoteId: j.uuid,
      jobNumber: j.generated_job_id,
      status: j.status,
      clientName: j.company_uuid ? companyName.get(j.company_uuid) ?? null : null,
      description: oneLine(j.job_description),
      suburb: j.geo_city,
      categoryName: j.category_uuid ? categoryInfo.get(j.category_uuid)?.name ?? null : null,
      categoryColour: j.category_uuid ? categoryInfo.get(j.category_uuid)?.colour ?? null : null,
      date: j.date,
      quoteDate: j.quote_date,
      completionDate: j.completion_date,
      /* The booking being drawn IS this job's diary presence — the sheet
         re-reads the full picture on open, so nothing is guessed here. The
         diary carries no money either: `money: null` already says the reader
         gets none, and nothing on this surface shows a figure. */
      nextBooking: null,
      money: null,
      paidCents: 0,
    })),
  };
}
