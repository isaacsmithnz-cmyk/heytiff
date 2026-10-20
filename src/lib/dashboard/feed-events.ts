/* WHAT CAME IN FROM SERVICEM8, FOR YOUR FEED — the pure half: the events
   grouped and said. The reads are ./feed-events-query. */

export const FEED_EVENT_DAYS = 2;

export type FeedEvent = {
  key: string;
  kind: "new-job" | "work-order" | "check-in" | "photos";
  jobUuid: string;
  job: string;
  /** who did it, by name, when it was a person */
  by: string | null;
  /** the job's own words, for a new job */
  said: string | null;
  /** how many, for photos */
  count: number;
  /** "YYYY-MM-DD HH:MM:SS" on the account's clock, as ServiceM8 keeps it */
  at: string;
};

export type JobRow = { uuid: string; generated_job_id: string | null; geo_city: string | null; job_description: string | null; date: string | null; work_order_date: string | null; quote_date: string | null; status: string | null };
export type ActRow = { uuid: string; job_uuid: string; staff_uuid: string | null; start_date: string | null };
export type AttRow = { uuid: string; related_object_uuid: string; created_by_staff_uuid: string | null; timestamp: string | null; file_type: string | null };

const firstLine = (s: string | null) => (s ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
const isPhoto = (t: string | null) => /jpe?g|png|heic|webp|image/i.test(t ?? "");

/** The events, grouped and said; pure, so a test can hold it. */
export function feedEventsOf(input: {
  jobs: readonly JobRow[];
  acts: readonly ActRow[];
  atts: readonly AttRow[];
  label: (jobUuid: string) => string;
  nameOf: ReadonlyMap<string, string>;
  since: string;
}): FeedEvent[] {
  const { jobs, acts, atts, label, nameOf, since } = input;
  const out: FeedEvent[] = [];
  for (const j of jobs) {
    if (j.date && j.date >= since)
      out.push({ key: `new:${j.uuid}`, kind: "new-job", jobUuid: j.uuid, job: label(j.uuid), by: null, said: firstLine(j.job_description) || null, count: 1, at: j.date });
    if (j.work_order_date && j.work_order_date >= since && j.work_order_date.slice(0, 10) !== (j.date ?? "").slice(0, 10))
      out.push({ key: `wo:${j.uuid}`, kind: "work-order", jobUuid: j.uuid, job: label(j.uuid), by: null, said: null, count: 1, at: j.work_order_date });
  }
  /* one check-in per job, person and day: the first of them */
  const checks = new Map<string, FeedEvent>();
  for (const a of acts) {
    if (!a.start_date || a.start_date < since) continue;
    const k = `check:${a.job_uuid}:${a.staff_uuid ?? ""}:${a.start_date.slice(0, 10)}`;
    const had = checks.get(k);
    if (!had || a.start_date < had.at)
      checks.set(k, { key: k, kind: "check-in", jobUuid: a.job_uuid, job: label(a.job_uuid), by: (a.staff_uuid && nameOf.get(a.staff_uuid)) || null, said: null, count: 1, at: a.start_date });
  }
  out.push(...checks.values());
  /* photos, counted per job, person and day, at the newest */
  const photos = new Map<string, FeedEvent>();
  for (const a of atts) {
    if (!a.timestamp || a.timestamp < since || !isPhoto(a.file_type)) continue;
    const k = `photos:${a.related_object_uuid}:${a.created_by_staff_uuid ?? ""}:${a.timestamp.slice(0, 10)}`;
    const had = photos.get(k);
    if (had) {
      had.count += 1;
      if (a.timestamp > had.at) had.at = a.timestamp;
    } else
      photos.set(k, { key: k, kind: "photos", jobUuid: a.related_object_uuid, job: label(a.related_object_uuid), by: (a.created_by_staff_uuid && nameOf.get(a.created_by_staff_uuid)) || null, said: null, count: 1, at: a.timestamp });
  }
  out.push(...photos.values());
  return out;
}
