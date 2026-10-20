import { supabaseAdmin } from "@/lib/supabase-server";
import { plusDays } from "@/lib/workboard/dates";
import { jobDoorLabel } from "./diary-feed";
import { FEED_EVENT_DAYS, feedEventsOf, type ActRow, type AttRow, type FeedEvent, type JobRow } from "./feed-events";

export type { FeedEvent } from "./feed-events";
const LIMIT = 200;

/* WHAT CAME IN FROM SERVICEM8, FOR YOUR FEED (Isaac, 20 October 2026: Home's
   Activity becomes "Your feed"; the board https://claude.ai/artifact/
   NzYjAQqzJJsgSgPPGCSJVq). Read off the ServiceM8 copy, over the last two
   days on the account's clock: new jobs, jobs that became work orders,
   check-ins and photos. A check-in or a run of photos is one item per job,
   person and day, not one per row.

   NO SESSION HERE: the caller (lib/dashboard/page-data) has established the
   right to ask (`workboard`) and hands in the org and the day. Every read is
   small and bounded; one that fails leaves its kind out, never the feed. */

export async function readFeedEvents(orgId: string, today: string): Promise<FeedEvent[]> {
  const since = plusDays(today, -(FEED_EVENT_DAYS - 1));
  const [jobs, acts, atts] = await Promise.all([
    supabaseAdmin
      .from("sm8_jobs")
      .select("uuid, generated_job_id, geo_city, job_description, date, work_order_date, quote_date, status")
      .eq("org_id", orgId)
      .eq("active", 1)
      .or(`date.gte.${since},work_order_date.gte.${since}`)
      .limit(LIMIT)
      .then((r) => (r.error ? [] : ((r.data ?? []) as JobRow[]))),
    supabaseAdmin
      .from("sm8_job_activities")
      .select("uuid, job_uuid, staff_uuid, start_date")
      .eq("org_id", orgId)
      .eq("active", 1)
      .eq("activity_was_scheduled", 0)
      .gte("start_date", since)
      .limit(LIMIT)
      .then((r) => (r.error ? [] : ((r.data ?? []) as ActRow[]))),
    supabaseAdmin
      .from("sm8_attachments")
      .select("uuid, related_object_uuid, created_by_staff_uuid, timestamp, file_type")
      .eq("org_id", orgId)
      .eq("active", 1)
      .eq("related_object", "job")
      .gte("timestamp", since)
      .limit(LIMIT)
      .then((r) => (r.error ? [] : ((r.data ?? []) as AttRow[]))),
  ]);

  /* the jobs every event names, and the people */
  const jobIds = [...new Set([...acts.map((a) => a.job_uuid), ...atts.map((a) => a.related_object_uuid)])].filter((id) => !jobs.some((j) => j.uuid === id));
  const staffIds = [...new Set([...acts.map((a) => a.staff_uuid), ...atts.map((a) => a.created_by_staff_uuid)].filter((s): s is string => !!s))];
  const [moreJobs, staff] = await Promise.all([
    jobIds.length
      ? supabaseAdmin
          .from("sm8_jobs")
          .select("uuid, generated_job_id, geo_city, job_description, date, work_order_date, quote_date, status")
          .eq("org_id", orgId)
          .in("uuid", jobIds.slice(0, LIMIT))
          .then((r) => (r.error ? [] : ((r.data ?? []) as JobRow[])))
      : Promise.resolve([] as JobRow[]),
    staffIds.length
      ? supabaseAdmin
          .from("sm8_staff")
          .select("uuid, first, last")
          .eq("org_id", orgId)
          .in("uuid", staffIds.slice(0, LIMIT))
          .then((r) => (r.error ? [] : ((r.data ?? []) as { uuid: string; first: string | null; last: string | null }[])))
      : Promise.resolve([]),
  ]);
  const jobOf = new Map([...jobs, ...moreJobs].map((j) => [j.uuid, j]));
  const nameOf = new Map(staff.map((s) => [s.uuid, [s.first, s.last].map((p) => (p ?? "").trim()).filter(Boolean).join(" ")]));
  const label = (id: string) => {
    const j = jobOf.get(id);
    return (j && jobDoorLabel(j.generated_job_id, j.geo_city)) || "A job";
  };
  return feedEventsOf({ jobs, acts, atts, label, nameOf, since });
}

