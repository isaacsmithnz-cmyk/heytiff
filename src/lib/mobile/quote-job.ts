import "server-only";

import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { Sm8Press } from "@/lib/integrations/sm8-press";
import { queueNewJob } from "@/app/actions/sm8-job-queue";
import { validNewJob } from "@/lib/integrations/sm8-job-plan";

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

  const description = [words?.trim() || "A quote to build", was.generated_job_id ? `From job ${was.generated_job_id}, ${day}.` : null].filter(Boolean).join("\n\n");
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
