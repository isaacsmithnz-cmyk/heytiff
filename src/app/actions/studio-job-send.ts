"use server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { complianceContext, trimId } from "@/lib/compliance/send";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { offersSend } from "@/lib/integrations/sm8-write-plan";
import { pdfFileName } from "@/lib/studio/pdf-request";

/* What the Share dialog's ServiceM8 choice needs to know before anything is
   pressed: whether this person can put a file on the job at all, whether it
   will go on to ServiceM8 (and on which setting), and when this design's PDF
   last went there — a second attach is a second file, so the button says
   "Send a new copy" and the line says when the last one went. */

export type DesignJobRead = {
  /** can put a file on the job card (`workboard`) */
  canAttach: boolean;
  /** where the file goes after the card: ServiceM8 live, a trial run that
      sends nothing, ServiceM8 switched off, or not this person's to send */
  sm8: "live" | "trial" | "off" | "not-yours";
  /** when a file of this name last went on the job, or null */
  lastAt: string | null;
};

export async function readDesignJob(jobUuid: string, name: string): Promise<DesignJobRead> {
  const ctx = await complianceContext();
  if (!ctx) return { canAttach: false, sm8: "not-yours", lastAt: null };
  const job = trimId(jobUuid);
  const [state, last] = await Promise.all([
    readSm8WriteState(ctx.orgId),
    supabaseAdmin
      .from("documents")
      .select("uploaded_at")
      .eq("org_id", ctx.orgId)
      .eq("kind", "job_document")
      .eq("sm8_job_uuid", job)
      .eq("file_name", pdfFileName(name))
      .not("uploaded_at", "is", null)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const sm8 = !ctx.company
    ? "not-yours"
    : !offersSend(state, "attachment")
      ? "off"
      : state.mode === "trial"
        ? "trial"
        : "live";
  return { canAttach: true, sm8, lastAt: (last.data?.uploaded_at as string | undefined) ?? null };
}
