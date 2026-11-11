import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { writeJobNote } from "@/lib/workboard/job-note-write";
import type { MobileCtx } from "@/lib/mobile/auth";
import { headOfNote } from "./day-writeup";
import { replaceWrapupNote, stretchNote } from "./wrapup-replace";
import { endingWords, withEnding, type Ending } from "./visit-ending-plan";

/* HOW A VISIT ENDED, READ AND SAID (visit-ending-plan says the words). One
   answer a job a day: the first wrap-up's stands, and the others see it and
   may change it. Said, it goes into the first line of that stretch's note,
   so the office and ServiceM8 see it first; with no note yet, the line is the
   note. What the phone shows with the question comes from what's known: the
   next visit already booked, and the job's charge. */

const money = (v: number) => `$${v.toLocaleString("en-AU", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

type Said = Ending & { by: string | null; at: string };
export type EndingRead = {
  /** the answer already given for this job today, by whoever gave it */
  said: Said | null;
  /** the next visit booked after this day: when, and who's on it */
  booked: { at: string; who: string[] } | null;
  /** how the job is charged, as the Charge row says it */
  charge: string;
};

async function nameOf(orgId: string, staffId: string | null): Promise<string | null> {
  if (!staffId) return null;
  const { data } = await supabaseAdmin.from("staff_profiles").select("first_name, full_name").eq("org_id", orgId).eq("id", staffId).maybeSingle();
  const r = data as { first_name: string | null; full_name: string | null } | null;
  return r?.first_name?.trim() || r?.full_name?.trim().split(/\s+/)[0] || null;
}

export async function readEnding(orgId: string, job: string, day: string): Promise<EndingRead> {
  const either = [...new Set([job, job.toLowerCase()])];
  const [{ data: row }, { data: acts }, { data: facts }] = await Promise.all([
    supabaseAdmin.from("visit_endings").select("answer, detail, charge, said_by_staff, updated_at").eq("org_id", orgId).eq("sm8_job_uuid", job).eq("day", day).maybeSingle(),
    supabaseAdmin
      .from("sm8_job_activities")
      .select("start_date, staff_uuid")
      .eq("org_id", orgId)
      .in("job_uuid", either)
      .eq("active", 1)
      .eq("activity_was_scheduled", 1)
      .gt("start_date", `${day} 23:59:59`)
      .order("start_date", { ascending: true })
      .limit(20),
    supabaseAdmin.from("sm8_jobs").select("status, quote_sent_stamp, total_invoice_amount").eq("org_id", orgId).in("uuid", either).limit(1),
  ]);
  const r = row as { answer: Ending["answer"]; detail: Ending["detail"]; charge: Ending["charge"]; said_by_staff: string | null; updated_at: string } | null;
  const said = r ? { answer: r.answer, detail: r.detail ?? {}, charge: r.charge ?? { kind: "job" }, by: await nameOf(orgId, r.said_by_staff), at: r.updated_at } : null;

  const list = (acts ?? []) as { start_date: string; staff_uuid: string | null }[];
  let booked: EndingRead["booked"] = null;
  if (list.length) {
    const at = list[0]!.start_date;
    const uuids = [...new Set(list.filter((a) => a.start_date === at).map((a) => a.staff_uuid).filter((u): u is string => !!u))];
    const { data: staff } = uuids.length ? await supabaseAdmin.from("sm8_staff").select("uuid, first").eq("org_id", orgId).in("uuid", uuids) : { data: [] };
    booked = { at, who: ((staff ?? []) as { uuid: string; first: string | null }[]).map((s) => s.first?.trim() ?? "").filter(Boolean) };
  }

  const f = ((facts ?? []) as { status: string | null; quote_sent_stamp: string | null; total_invoice_amount: string | number | null }[])[0];
  const total = Number(f?.total_invoice_amount ?? 0);
  const quoted = !!f?.quote_sent_stamp && f.status !== "Quote" && total > 0;
  return { said, booked, charge: quoted ? `As quoted, ${money(total)}` : "With the job" };
}

/** The answer kept, and put into the first line of the stretch's note (`line`, the wrap-up's own first line).
    `written`: the note written with it, for the route to send on to ServiceM8 (only a route mints a press). */
export async function sayEnding(
  ctx: MobileCtx,
  job: string,
  day: string,
  line: string,
  ending: Ending
): Promise<{ read: EndingRead; written: string | null; first: boolean; by: { staff: string | null; name: string | null } }> {
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  const now = new Date().toISOString();
  const { data: was } = await supabaseAdmin.from("visit_endings").select("id, answer, detail, charge, said_by, said_by_staff, updated_at, history").eq("org_id", ctx.orgId).eq("sm8_job_uuid", job).eq("day", day).maybeSingle();
  const w = was as { id: string; answer: string; detail: unknown; charge: unknown; said_by: string; said_by_staff: string | null; updated_at: string; history: unknown[] } | null;
  const row = { answer: ending.answer, detail: ending.detail, charge: ending.charge, said_by: ctx.userId, said_by_staff: staffId, updated_at: now };
  const first = !w;
  if (w) {
    const history = [...(Array.isArray(w.history) ? w.history : []), { at: w.updated_at, by: w.said_by, staff: w.said_by_staff, answer: w.answer, detail: w.detail, charge: w.charge }];
    const { error } = await supabaseAdmin.from("visit_endings").update({ ...row, history }).eq("org_id", ctx.orgId).eq("id", w.id);
    if (error) throw new Error("Couldn’t keep that. Try again.");
  } else {
    const { error } = await supabaseAdmin.from("visit_endings").insert({ org_id: ctx.orgId, sm8_job_uuid: job, day, ...row });
    if (error) throw new Error("Couldn’t keep that. Try again.");
  }

  /* the note's first line: the one in for this stretch, rewritten; or the line, with the ending, as the note */
  const words = endingWords(ending);
  const head = headOfNote(line);
  const note = head.includes(" to ") ? await stretchNote(ctx, job, head, day) : null;
  const body = withEnding(note?.text ?? line, words);
  let written: string | null = null;
  if (!note || note.text !== body) {
    if (note) await replaceWrapupNote(ctx, job, body, day);
    written = (await writeJobNote({ orgId: ctx.orgId, userId: ctx.userId, jobUuid: job, body })).id;
  }
  return { read: await readEnding(ctx.orgId, job, day), written, first, by: { staff: staffId, name: await nameOf(ctx.orgId, staffId) } };
}
