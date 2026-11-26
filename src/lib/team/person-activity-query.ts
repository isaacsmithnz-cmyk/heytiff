import { supabaseAdmin } from "@/lib/supabase-server";
import {
  buildActivityDays,
  daysBefore,
  hoursStats,
  type ActivityRows,
  type ActivityStats,
  type ClockRow,
  type LeaveRow,
  type NoteRow,
  type PaperRow,
  type PersonActivity,
  type PhotoRow,
  type SiteRow,
  type TickRow,
} from "./person-activity";

/* THE READS BEHIND A PERSON'S ACTIVITY (person-activity.ts), scoped to the
   caller's org on every one. Three keys for one person: the card's own id
   (notes, photos, leave, papers), their sign-in's id (clock, sites, ticks:
   none when the card has never been claimed), and nothing from ServiceM8.

   `hours` says the viewer may read this person's hours: their own, or
   Time & Pay's `timepay_all`. Without it the clock and the leave are not
   read at all, never read and hidden. A read that fails is an empty list:
   the feed says less, the page still opens. */

/** How far back the feed reaches. */
export const FEED_DAYS = 14;

const list = <T,>(r: { data: unknown; error: unknown }): T[] => (r.error ? [] : ((r.data ?? []) as T[]));

export async function readPersonActivity(
  orgId: string,
  {
    staffId,
    userId,
    today,
    hours,
    perDayMinutes,
    leave,
  }: {
    staffId: string;
    userId: string | null;
    today: string;
    hours: boolean;
    /** a normal day, start to finish, with its break */
    perDayMinutes: number | null;
    /** the leave balances the page already read, or null */
    leave: { annualHours: number; personalHours: number; perDay: number | null } | null;
  },
): Promise<PersonActivity> {
  const since = daysBefore(today, FEED_DAYS - 1);
  /* a day's margin on the stamps: the day is decided on the AU clock after */
  const from = `${daysBefore(since, 1)}T00:00:00Z`;
  const none = Promise.resolve({ data: [], error: null });

  const [clock, sites, notes, photos, ticks, leaveRows, papers] = await Promise.all([
    hours && userId
      ? supabaseAdmin
          .from("staff_days")
          .select("work_date, on_at, off_at")
          .eq("org_id", orgId)
          .eq("user_id", userId)
          .gte("work_date", daysBefore(today, 91))
          .order("on_at", { ascending: false })
          .limit(400)
      : none,
    userId
      ? supabaseAdmin
          .from("job_check_ins")
          .select("id, sm8_job_uuid, checked_in_at, checked_out_at")
          .eq("org_id", orgId)
          .eq("user_id", userId)
          .gte("checked_in_at", from)
          .order("checked_in_at", { ascending: false })
          .limit(200)
      : none,
    supabaseAdmin
      .from("workboard_notes")
      .select("id, transcript, target_kind, target_id, created_at")
      .eq("org_id", orgId)
      .eq("author_id", staffId)
      .eq("status", "applied")
      .is("removed_at", null)
      .gte("created_at", from)
      .order("created_at", { ascending: false })
      .limit(100),
    supabaseAdmin
      .from("documents")
      .select("sm8_job_uuid, created_at")
      .eq("org_id", orgId)
      .eq("uploaded_by", staffId)
      .eq("kind", "job_photo")
      .gte("created_at", from)
      .limit(500),
    userId
      ? supabaseAdmin
          .from("job_task_updates")
          .select("id, task_id, sm8_job_uuid, created_at")
          .eq("org_id", orgId)
          .eq("by_user", userId)
          .gte("pct_to", 100)
          .gte("created_at", from)
          .order("created_at", { ascending: false })
          .limit(200)
      : none,
    hours
      ? supabaseAdmin
          .from("leave_requests")
          .select("id, kind, start_date, end_date, hours, status, created_at")
          .eq("org_id", orgId)
          .eq("staff_profile_id", staffId)
          .gte("created_at", from)
          .limit(50)
      : none,
    supabaseAdmin
      .from("staff_licence_records")
      .select("id, licence_id, expires_on, created_at")
      .eq("org_id", orgId)
      .eq("staff_profile_id", staffId)
      .order("created_at", { ascending: true })
      .limit(200),
  ]);

  const clockRows = list<ClockRow>(clock);
  const tickRaw = list<{ id: string; task_id: string | null; sm8_job_uuid: string | null; created_at: string }>(ticks);
  const paperRaw = list<{ id: string; licence_id: string; expires_on: string | null; created_at: string }>(papers);
  const noteRows = list<NoteRow>(notes);
  const siteRows = list<SiteRow>(sites);
  const photoRows = list<PhotoRow>(photos);

  /* the names the rows point at: task names, licence names, job numbers */
  const taskIds = [...new Set(tickRaw.map((t) => t.task_id).filter((x): x is string => !!x))];
  const licenceIds = [...new Set(paperRaw.map((p) => p.licence_id))];
  const jobUuids = [
    ...new Set(
      [
        ...siteRows.map((s) => s.sm8_job_uuid),
        ...photoRows.map((p) => p.sm8_job_uuid),
        ...tickRaw.map((t) => t.sm8_job_uuid),
        ...noteRows.filter((n) => n.target_kind === "job").map((n) => n.target_id),
      ].filter((x): x is string => !!x),
    ),
  ];
  const [tasks, licences, jobs] = await Promise.all([
    taskIds.length ? supabaseAdmin.from("job_tasks").select("id, name").eq("org_id", orgId).in("id", taskIds) : none,
    licenceIds.length ? supabaseAdmin.from("staff_licences").select("id, type_name").eq("org_id", orgId).in("id", licenceIds) : none,
    jobUuids.length ? supabaseAdmin.from("sm8_jobs").select("uuid, generated_job_id").eq("org_id", orgId).in("uuid", jobUuids) : none,
  ]);
  const taskName = new Map(list<{ id: string; name: string | null }>(tasks).map((t) => [t.id, t.name]));
  const licenceName = new Map(list<{ id: string; type_name: string | null }>(licences).map((l) => [l.id, l.type_name]));
  const numbers = new Map(
    list<{ uuid: string; generated_job_id: string | null }>(jobs)
      .filter((j) => j.generated_job_id)
      .map((j) => [j.uuid, String(j.generated_job_id)]),
  );

  /* a licence's first term is it added; any after is it renewed */
  const seen = new Set<string>();
  const paperRows: PaperRow[] = [];
  for (const p of paperRaw) {
    const first = !seen.has(p.licence_id);
    seen.add(p.licence_id);
    if (p.created_at < from) continue;
    paperRows.push({ id: p.id, licence: licenceName.get(p.licence_id) || "a licence", expires_on: p.expires_on, created_at: p.created_at, first });
  }

  const rows: ActivityRows = {
    clock: clockRows,
    sites: siteRows,
    notes: noteRows,
    photos: photoRows,
    ticks: tickRaw.map<TickRow>((t) => ({ id: t.id, sm8_job_uuid: t.sm8_job_uuid, created_at: t.created_at, task: (t.task_id && taskName.get(t.task_id)) || null })),
    leave: list<LeaveRow>(leaveRows).map((l) => ({ ...l, hours: Number(l.hours) })),
    papers: paperRows,
    numbers,
  };

  const stats: ActivityStats = {
    ...(hours
      ? hoursStats(clockRows, { today, perDayMinutes })
      : { week: null, overtimeMinutes: null, averageDay: null }),
    leave: hours ? leave : null,
  };

  return {
    days: buildActivityDays(rows, { today, since, perDayMinutes }),
    stats,
    hours,
    leave: hours && !!leave,
  };
}
