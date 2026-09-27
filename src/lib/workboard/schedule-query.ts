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
import { sm8CategoryColour, type AllJobsMirrorJob } from "./all-jobs";
import { onSiteKey, type ScheduleActivity, type ScheduleStaff } from "./schedule";
import { lowUuid, readBookingsOver } from "./all-jobs-query";
import { isLeftover } from "@/lib/integrations/sm8-booking-plan";
import { streetLine } from "@/lib/studio/job-link";

export type SchedulePayload = {
  dayISO: string;
  activities: ScheduleActivity[];
  staff: ScheduleStaff[];
  jobs: AllJobsMirrorJob[];
  /** `onSiteKey` values for the job+person pairs that recorded time on this
      day. An ARRAY, not a Set: this payload crosses a server action's
      serialisation boundary, and the component rebuilds the Set on arrival. */
  onSite: string[];
  /** job uuid → the first line of its site address ("2 Spring St"), for the
      day's jobs that have one. A record beside the rows, not a field on
      them: `AllJobsMirrorJob` is the one row shape every sheet opens on, and
      a street line is only what Home's day panel says under Where. */
  addresses: Record<string, string>;
  /** The viewer may Clear a leftover booking here: bookings are offered and
      they may press (two-way phase 3). Set by `scheduleDay` for its viewer,
      and only when true; absent everywhere else. */
  canClear?: true;
};

export const EMPTY_SCHEDULE: SchedulePayload = {
  dayISO: "",
  activities: [],
  staff: [],
  jobs: [],
  onSite: [],
  addresses: {},
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

  /* The week's per-day booking count was a third read here, for the numbers
     on the strip's day chips; the chips are the day's name alone now. */
  const [{ data: actRows }, { data: onSiteRows }] = await Promise.all([
    supabaseAdmin
      .from("sm8_job_activities")
      .select("uuid, job_uuid, staff_uuid, start_date, end_date, activity_was_scheduled")
      .eq("org_id", orgId)
      .eq("active", 1)
      .eq("activity_was_scheduled", 1)
      .gte("start_date", dayFloor)
      .lt("start_date", dayCeil)
      .order("start_date", { ascending: true }),
    /* THE OTHER HALF OF THE SAME TABLE — the rows the read above excludes.
       `= 0` is time recorded on site, and it is asked for here ONLY to answer
       "did anyone start this booking", never to be laid out. Two columns come
       back, not the stamps: with no duration in the payload there is nothing
       for a later change to be tempted into drawing, which is what keeps the
       one-person-one-place rule in schedule.ts true. */
    supabaseAdmin
      .from("sm8_job_activities")
      .select("job_uuid, staff_uuid")
      .eq("org_id", orgId)
      .eq("active", 1)
      .eq("activity_was_scheduled", 0)
      .gte("start_date", dayFloor)
      .lt("start_date", dayCeil),
  ]);

  const acts = (actRows ?? []) as {
    uuid: string;
    job_uuid: string | null;
    staff_uuid: string | null;
    start_date: string | null;
    end_date: string | null;
    activity_was_scheduled: number | null;
  }[];

  /* One key per job+person pair. A tech clocking on and off a job four times
     is four rows and one key — the set says "started", and how many times is
     not a question this rail asks. */
  const onSite = [
    ...new Set(
      ((onSiteRows ?? []) as { job_uuid: string | null; staff_uuid: string | null }[])
        .filter((r): r is { job_uuid: string; staff_uuid: string | null } => !!r.job_uuid)
        .map((r) => onSiteKey(r.job_uuid, r.staff_uuid))
    ),
  ];

  /* OUR BOOKINGS OVER THE MIRROR (two-way phase 3), only where the
     deployment books: the day's bookings we took out are dropped, and the
     ones we sent that the mirror doesn't hold yet join the day as the
     ServiceM8 bookings they are. Anywhere else nothing more is read and the
     payload is exactly what it was. */
  const now = Date.now();
  const over = await readBookingsOver(
    orgId,
    { uuids: acts.map((a) => a.uuid), from: dayISO, to: plusDays(dayISO, 1), rows: false },
    now
  );
  const mirrored = over ? acts.filter((a) => !over.gone.has(lowUuid(a.uuid))) : acts;
  const activities: ScheduleActivity[] = mirrored
    .filter((a): a is typeof a & { start_date: string } => !!a.start_date)
    .map((a) => ({
      uuid: a.uuid,
      jobUuid: a.job_uuid,
      staffUuid: a.staff_uuid,
      start: a.start_date,
      end: a.end_date,
      wasScheduled: a.activity_was_scheduled,
    }));
  if (over) {
    const drawn = new Set(activities.map((a) => lowUuid(a.uuid)));
    for (const s of over.sentNotMirrored) {
      if (s.start < dayFloor || s.start >= dayCeil || drawn.has(lowUuid(s.uuid)) || over.gone.has(lowUuid(s.uuid))) continue;
      activities.push({ uuid: s.uuid, jobUuid: s.jobUuid, staffUuid: s.staffUuid, start: s.start, end: s.end, wasScheduled: 1 });
    }
    activities.sort((x, y) => x.start.localeCompare(y.start));
  }

  if (activities.length === 0) {
    return { ...EMPTY_SCHEDULE, dayISO };
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
            "uuid, generated_job_id, status, company_uuid, geo_city, job_address, category_uuid, " +
              "job_description, date, quote_date, completion_date"
          )
          .eq("org_id", orgId)
          .eq("active", 1)
          /* a booking of ours names its job as it was pressed: every
             spelling is asked for where the deployment books */
          .in("uuid", over ? [...new Set(jobIds.flatMap((u) => [u, u.toLowerCase(), u.toUpperCase()]))] : jobIds)
      : Promise.resolve({ data: [] }),
  ]);

  /* ...and each of ours then names its job as the mirror spells it, so the
     layout's join finds it */
  if (over) {
    const spelled = new Map(((jobRows ?? []) as unknown as { uuid: string }[]).map((j) => [lowUuid(j.uuid), j.uuid]));
    for (const a of activities) if (a.jobUuid) a.jobUuid = spelled.get(lowUuid(a.jobUuid)) ?? a.jobUuid;
  }

  const jobs = (jobRows ?? []) as unknown as {
    uuid: string;
    generated_job_id: string | null;
    status: string | null;
    company_uuid: string | null;
    geo_city: string | null;
    job_address: string | null;
    category_uuid: string | null;
    job_description: string | null;
    date: string | null;
    quote_date: string | null;
    completion_date: string | null;
  }[];

  /* A LEFTOVER IS DECIDED HERE, on the server's clock and the account's
     zone (isLeftover, the one definition): the blocks are laid out in the
     browser, which copies it and never reads a clock for it. Absent where
     the deployment books nothing, or the zone isn't known. */
  if (over?.zone) {
    const statusOf = new Map(jobs.map((j) => [lowUuid(j.uuid), j.status]));
    for (const a of activities) {
      a.leftover = isLeftover(
        { scheduled: a.wasScheduled, active: 1, start: a.start, end: a.end, staffUuid: a.staffUuid },
        statusOf.get(lowUuid(a.jobUuid)) ?? null,
        over.zone,
        now
      );
    }
  }

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

  /* THE BOOKING BEING DRAWN IS A BOOKING. The row builder dates a work order
     by its next diary block ("Booked Tue 15 Sept" / "Raised Thu 10 Apr"), and
     this payload used to leave that blank on the theory that the sheet
     re-reads the full picture on open — which it does, but the first paint
     of the card off a schedule block or Home's band then said "Raised" and
     corrected itself to "Booked" a beat later, which is the picture being
     WRONG rather than absent. The earliest block on this day is this job's
     booking on this day, read from the same rows; on a day that has gone it
     dates nothing (the builder wants a block on or after today), exactly as
     a blank did. */
  const firstStart = new Map<string, string>();
  for (const a of activities) {
    if (!a.jobUuid) continue;
    const seen = firstStart.get(a.jobUuid);
    if (seen === undefined || a.start < seen) firstStart.set(a.jobUuid, a.start);
  }

  const staff: ScheduleStaff[] = ((staffRows ?? []) as {
    uuid: string;
    first: string | null;
    last: string | null;
  }[])
    .map((s) => ({ uuid: s.uuid, name: [s.first, s.last].filter(Boolean).join(" ").trim() }))
    .filter((s) => s.name !== "");

  /* The street by the one law for it (studio/job-link's `streetLine`): the
     first line that says anything, less ServiceM8's trailing comma. ServiceM8
     writes the address as a driver's label — two lines and a postcode — and
     the street is the line a person looks for. A job with no address is
     absent rather than "", so nothing ever draws an empty Where. */
  const addresses: Record<string, string> = {};
  for (const j of jobs) {
    const line = streetLine(j.job_address);
    if (line) addresses[j.uuid] = line;
  }

  return {
    dayISO,
    activities,
    staff,
    onSite,
    addresses,
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
      nextBooking: firstStart.get(j.uuid) ?? null,
      /* The diary carries no money: `money: null` already says the reader
         gets none, and nothing on this surface shows a figure. */
      money: null,
      paidCents: 0,
    })),
  };
}
