import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { staffDisplayNames } from "@/lib/workboard/job-notes-query";
import { todayOf } from "./used";
import { suburbOf } from "./wrapped-others";
import { latestPerJob, officeLists, placeEnding, type EndingRow, type JobFacts, type OfficeLists } from "./office-lists-plan";

/* THE OFFICE'S LISTS, READ (office-lists-plan decides): every job's latest
   answer of the last four months, what ServiceM8's mirror says of the job
   now, and whether a visit's been booked since. */

const LOOK_BACK_DAYS = 120;
const shift = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);

export async function readOfficeLists(orgId: string, now: number = Date.now()): Promise<OfficeLists> {
  const today = await todayOf(orgId, now);
  const { data, error } = await supabaseAdmin
    .from("visit_endings")
    .select("sm8_job_uuid, day, answer, detail, charge, said_by_staff")
    .eq("org_id", orgId)
    .gte("day", shift(today, -LOOK_BACK_DAYS))
    .order("day", { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  const raw = (data ?? []) as { sm8_job_uuid: string; day: string; answer: EndingRow["ending"]["answer"]; detail: EndingRow["ending"]["detail"] | null; charge: EndingRow["ending"]["charge"] | null; said_by_staff: string | null }[];
  if (raw.length === 0) return [];

  const names = await staffDisplayNames(orgId, raw.map((r) => r.said_by_staff));
  const endings = latestPerJob(
    raw.map((r) => ({
      jobUuid: r.sm8_job_uuid,
      day: r.day,
      ending: { answer: r.answer, detail: r.detail ?? {}, charge: r.charge ?? { kind: "job" } },
      by: r.said_by_staff ? (names.get(r.said_by_staff)?.split(/\s+/)[0] ?? null) : null,
    }))
  );
  const uuids = [...new Set(endings.flatMap((e) => [e.jobUuid, e.jobUuid.toLowerCase()]))];
  const earliest = endings.reduce((m, e) => (e.day < m ? e.day : m), today);

  const [{ data: jobs }, { data: acts }] = await Promise.all([
    supabaseAdmin
      .from("sm8_jobs")
      .select("uuid, generated_job_id, job_address, status, active, invoice_sent, quote_sent_stamp, work_order_date, total_invoice_amount")
      .eq("org_id", orgId)
      .in("uuid", uuids),
    supabaseAdmin
      .from("sm8_job_activities")
      .select("job_uuid, start_date")
      .eq("org_id", orgId)
      .in("job_uuid", uuids)
      .eq("active", 1)
      .eq("activity_was_scheduled", 1)
      .gt("start_date", `${earliest} 23:59:59`)
      .limit(5000),
  ]);

  const facts = new Map<string, JobFacts>();
  for (const j of (jobs ?? []) as {
    uuid: string;
    generated_job_id: string | null;
    job_address: string | null;
    status: string | null;
    active: number | null;
    invoice_sent: number | string | boolean | null;
    quote_sent_stamp: string | null;
    work_order_date: string | null;
    total_invoice_amount: number | string | null;
  }[]) {
    const day = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) && !s.startsWith("0000") ? s.slice(0, 10) : null);
    const total = j.total_invoice_amount === null ? null : Number(j.total_invoice_amount);
    facts.set(j.uuid.toLowerCase(), {
      number: j.generated_job_id,
      suburb: suburbOf(j.job_address),
      status: j.status,
      active: j.active === 1,
      invoiced: j.invoice_sent === 1 || j.invoice_sent === "1" || j.invoice_sent === true,
      quoteSentOn: day(j.quote_sent_stamp),
      workOrderOn: day(j.work_order_date),
      quoted: total !== null && Number.isFinite(total) ? total : null,
    });
  }
  const bookings = new Map<string, string[]>();
  for (const a of (acts ?? []) as { job_uuid: string; start_date: string }[]) {
    const k = a.job_uuid.toLowerCase();
    bookings.set(k, [...(bookings.get(k) ?? []), a.start_date]);
  }

  const rows = endings.flatMap((e) => {
    const k = e.jobUuid.toLowerCase();
    const booked = (bookings.get(k) ?? []).some((s) => s > `${e.day} 23:59:59`);
    const placed = placeEnding(e, facts.get(k), booked, today);
    return placed ? [placed] : [];
  });
  return officeLists(rows);
}

/** Parts on order, in: the job moves to To book from today. Kept on the answer, with who said so in its history. */
export async function partsAreIn(orgId: string, userId: string, staffId: string | null, job: string, day: string, now: number = Date.now()): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("visit_endings")
    .select("id, answer, detail, history")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", job)
    .eq("day", day)
    .maybeSingle();
  const r = data as { id: string; answer: string; detail: Record<string, unknown> | null; history: unknown[] | null } | null;
  if (!r || r.answer !== "coming_back" || r.detail?.waiting !== "parts") return false;
  const today = await todayOf(orgId, now);
  const history = [...(Array.isArray(r.history) ? r.history : []), { at: new Date(now).toISOString(), by: userId, staff: staffId, partsIn: today }];
  const { error } = await supabaseAdmin
    .from("visit_endings")
    .update({ detail: { ...(r.detail ?? {}), partsIn: today }, history, updated_at: new Date(now).toISOString() })
    .eq("org_id", orgId)
    .eq("id", r.id);
  return !error;
}
