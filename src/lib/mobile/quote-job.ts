import "server-only";

import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { Sm8Press } from "@/lib/integrations/sm8-press";
import { queueNewJob } from "@/app/actions/sm8-job-queue";
import { jobSubject, validNewJob } from "@/lib/integrations/sm8-job-plan";
import { sendNoteOnToSm8 } from "@/lib/integrations/sm8-note-send-on";
import { writeJobNote } from "@/lib/workboard/job-note-write";

/* SOMETHING TO QUOTE HERE: A QUOTE JOB OF ITS OWN (Isaac, 11 November 2026,
   board 3 of https://claude.ai/artifact/ESTib5qakLMfgTXmUW9vCy: 1725
   Finished, and a quote to build, "A new quote job for Michiel Kuppens at 40
   Stanley St ... with these words"; "Build from mocks approved").

   A visit that ends Finished with a quote to build opens a new job in
   ServiceM8 for the same client at the same site, its description the words
   said and where they came from, by the New job form's own door
   (actions/sm8-job-queue), so it goes only where new jobs are switched on.
   The press id is made from the job and the day, so saying the answer again,
   or changing its words, is the same job, never a second. The new job's uuid
   is kept on the answer (detail.quoteJob), for Quotes waiting to follow it. */

/** A uuid-shaped id that's always the same for this job on this day. */
export function quotePressId(orgId: string, job: string, day: string): string {
  const h = createHash("sha256").update(`quote-job:${orgId}:${job.toLowerCase()}:${day}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const describe = (words: string | undefined, from: string | null, day: string) =>
  [words?.trim() || "A quote to build", from ? `From job ${from}, ${day}.` : null].filter(Boolean).join("\n\n");

export type QuoteJobOpened = { ok: true; jobUuid: string | null } | { ok: false; error: string };

export async function openQuoteJob(press: Sm8Press | null, orgId: string, job: string, day: string, words: string | undefined): Promise<QuoteJobOpened> {
  if (!press || press.orgId !== orgId) return { ok: false, error: "No press" };
  const { data: j } = await supabaseAdmin
    .from("sm8_jobs")
    .select("generated_job_id, company_uuid, job_address")
    .eq("org_id", orgId)
    .in("uuid", [...new Set([job, job.toLowerCase()])])
    .limit(1)
    .maybeSingle();
  const was = j as { generated_job_id: string | null; company_uuid: string | null; job_address: string | null } | null;
  if (!was?.company_uuid || !was.job_address) return { ok: false, error: "That job has no client or address to quote for." };
  const { data: c } = await supabaseAdmin.from("sm8_companies").select("name").eq("org_id", orgId).eq("uuid", was.company_uuid).maybeSingle();
  const clientName = (c as { name: string | null } | null)?.name?.trim() ?? "";

  const description = describe(words, was.generated_job_id, day);
  const valid = validNewJob({ client: { kind: "existing", uuid: was.company_uuid }, jobAddress: was.job_address, description, categoryUuid: null, contact: null });
  if (!valid.ok) return { ok: false, error: valid.error };
  const queued = await queueNewJob(press, quotePressId(orgId, job, day), valid.job, clientName);
  if (!queued.ok) return queued;

  const { data: row } = await supabaseAdmin.from("sm8_writes").select("remote_uuid").eq("org_id", orgId).eq("id", queued.rowId).maybeSingle();
  const jobUuid = (row as { remote_uuid: string | null } | null)?.remote_uuid ?? null;
  if (jobUuid) {
    const { data: e } = await supabaseAdmin.from("visit_endings").select("id, detail").eq("org_id", orgId).eq("sm8_job_uuid", job).eq("day", day).maybeSingle();
    const ending = e as { id: string; detail: Record<string, unknown> | null } | null;
    if (ending && ending.detail?.quoteJob !== jobUuid)
      await supabaseAdmin.from("visit_endings").update({ detail: { ...(ending.detail ?? {}), quoteJob: jobUuid } }).eq("org_id", orgId).eq("id", ending.id);
  }
  return { ok: true, jobUuid };
}

/* TAKEN OFF, OR NEW WORDS (found in review, 12 November 2026: unticking the
   quote left its job queued, and words changed later never reached it).
   Still waiting to go, the row is stopped, or its words changed in place.
   Gone, ServiceM8 is told in a note on the quote job, as whoever said it:
   HeyTiff never takes a job out of ServiceM8 (Unsuccessful is an owner's
   Mark Unsuccessful), so the office closes it. */

type QuoteRow = { id: string; status: string; remote_uuid: string | null; job_draft: Record<string, unknown> | null };

async function quoteRow(orgId: string, job: string, day: string): Promise<QuoteRow | null> {
  const { data } = await supabaseAdmin
    .from("sm8_writes")
    .select("id, status, remote_uuid, job_draft")
    .eq("org_id", orgId)
    .eq("kind", "job")
    .eq("subject", jobSubject(quotePressId(orgId, job, day)))
    .maybeSingle();
  return (data as QuoteRow | null) ?? null;
}

/** Stopped, where it's still waiting: the row only while it is. */
async function stopWaiting(orgId: string, id: string, reason: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("sm8_writes")
    .update({ status: "cancelled", last_error: reason, lease_until: null, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", id)
    .eq("status", "queued")
    .select("id");
  return (data ?? []).length > 0;
}

/** A note on the quote job, sent on to ServiceM8 as whoever said it. False
    when the quote job isn't on the board yet (the mirror reads it after it
    goes), so nothing could be written. */
async function noteOnQuoteJob(press: () => Promise<Sm8Press | null>, orgId: string, userId: string, quoteJob: string, body: string): Promise<boolean> {
  try {
    const note = await writeJobNote({ orgId, userId, jobUuid: quoteJob, body });
    await sendNoteOnToSm8(press, orgId, note.id, quoteJob);
    return true;
  } catch (err) {
    console.warn(`[mobile] no note on quote job ${quoteJob}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function markOnEnding(orgId: string, job: string, day: string, patch: (d: Record<string, unknown>) => Record<string, unknown>) {
  const { data: e } = await supabaseAdmin.from("visit_endings").select("id, detail").eq("org_id", orgId).eq("sm8_job_uuid", job).eq("day", day).maybeSingle();
  const ending = e as { id: string; detail: Record<string, unknown> | null } | null;
  if (ending) await supabaseAdmin.from("visit_endings").update({ detail: patch(ending.detail ?? {}) }).eq("org_id", orgId).eq("id", ending.id);
}

export type QuoteJobDropped = "stopped" | "noted" | "none";

/** The quote taken off: stopped if it hasn't gone, else ServiceM8 told it isn't needed. */
export async function dropQuoteJob(press: () => Promise<Sm8Press | null>, orgId: string, userId: string, job: string, day: string): Promise<QuoteJobDropped> {
  const row = await quoteRow(orgId, job, day);
  if (!row) return "none";
  if (row.status === "queued" && (await stopWaiting(orgId, row.id, "No quote needed after all."))) return "stopped";
  const again = await quoteRow(orgId, job, day);
  if (!again?.remote_uuid || (again.status !== "sent" && again.status !== "sending")) return "none";
  const { data: j } = await supabaseAdmin.from("sm8_jobs").select("generated_job_id").eq("org_id", orgId).in("uuid", [...new Set([job, job.toLowerCase()])]).limit(1).maybeSingle();
  const from = (j as { generated_job_id: string | null } | null)?.generated_job_id;
  const noted = await noteOnQuoteJob(press, orgId, userId, again.remote_uuid, `No quote needed after all${from ? `, from job ${from}` : ""}.`);
  if (!noted) return "none";
  await markOnEnding(orgId, job, day, (d) => (d.quoteToo === true ? d : { ...d, quoteDropped: "noted" }));
  return "noted";
}

/** Said again after ServiceM8 was told it isn't needed: told it is, with the words. */
export async function reviveQuoteJob(press: () => Promise<Sm8Press | null>, orgId: string, userId: string, quoteJob: string, words: string | undefined): Promise<void> {
  await noteOnQuoteJob(press, orgId, userId, quoteJob, `A quote is wanted after all: ${words?.trim() || "a quote to build"}`);
}

/** New words for the quote job: in its description while it waits, else a note. */
export async function sayQuoteWords(press: () => Promise<Sm8Press | null>, orgId: string, userId: string, job: string, day: string, quoteJob: string, words: string): Promise<void> {
  const row = await quoteRow(orgId, job, day);
  if (row?.status === "queued" && row.job_draft) {
    const { data: j } = await supabaseAdmin.from("sm8_jobs").select("generated_job_id").eq("org_id", orgId).in("uuid", [...new Set([job, job.toLowerCase()])]).limit(1).maybeSingle();
    const draft = { ...row.job_draft, description: describe(words, (j as { generated_job_id: string | null } | null)?.generated_job_id ?? null, day) };
    const { data } = await supabaseAdmin.from("sm8_writes").update({ job_draft: draft }).eq("org_id", orgId).eq("id", row.id).eq("status", "queued").select("id");
    if ((data ?? []).length > 0) return;
  }
  await noteOnQuoteJob(press, orgId, userId, quoteJob, `The quote to build, now: ${words || "a quote to build"}`);
}
