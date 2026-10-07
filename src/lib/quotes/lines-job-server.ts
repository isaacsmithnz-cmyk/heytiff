import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { unitSpecsOf } from "./fit-server";
import { byHandOf, linesDraft, toggleAccepted, type ByHand } from "./lines-job";
import { readEngine, readLines } from "./lines-server";
import type { QuoteLine } from "./lines";
import { readOrgDay } from "./org-day-server";
import { normaliseDraft, type ProposalDraft } from "./proposal";
import { readStoredProposal } from "./proposal-writer";

/* THE QUOTE, AS THE JOB READS IT, whichever engine prices it (lines-job.ts
   says why): the proposal Tiff's builder wrote, or a switched quote's
   options drawn from its kept lines, with those lines. Service role, by
   org; the callers gate. */

export type JobQuote = { draft: ProposalDraft; lines: QuoteLine[] | null };

export async function readJobQuote(orgId: string, cardId: string): Promise<JobQuote | null> {
  if ((await readEngine(orgId, cardId)) !== "lines") {
    const stored = await readStoredProposal(orgId, cardId);
    return stored ? { draft: stored.draft, lines: null } : null;
  }
  const [lines, row, day] = await Promise.all([
    readLines(orgId, cardId),
    supabaseAdmin.from("quote_drafts").select("draft").eq("org_id", orgId).eq("sm8_job_uuid", cardId).maybeSingle(),
    readOrgDay(orgId),
  ]);
  const raw = (row.data as { draft: unknown } | null)?.draft ?? null;
  /* a quote brought across keeps its old options' names */
  const names = (normaliseDraft(raw)?.options ?? []).map((o) => o.name);
  const draft = linesDraft(lines, names, byHandOf(raw), await unitSpecsOf(lines), day.hours?.hours ?? null);
  return draft ? { draft, lines } : null;
}

/** The accepted mark on a switched quote, read as it's kept. */
export async function readByHand(orgId: string, cardId: string): Promise<ByHand> {
  const { data } = await supabaseAdmin.from("quote_drafts").select("draft").eq("org_id", orgId).eq("sm8_job_uuid", cardId).maybeSingle();
  return byHandOf((data as { draft: unknown } | null)?.draft ?? null);
}

/** Marks option `i` of a switched quote accepted, or takes the mark off.
    Written against the draft as it was read, so a proposal saved meanwhile
    is never overwritten; refused then, to be pressed again. */
export async function markAccepted(orgId: string, cardId: string, i: number, by: string): Promise<{ ok: true; byHand: ByHand } | { ok: false; reason: string }> {
  const { data } = await supabaseAdmin
    .from("quote_drafts")
    .select("draft, updated_at, engine")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", cardId)
    .maybeSingle();
  const row = data as { draft: unknown; updated_at: string; engine: string } | null;
  if (!row || row.engine !== "lines") return { ok: false, reason: "This quote isn't built on its lines." };
  const byHand = toggleAccepted(byHandOf(row.draft), i);
  const draft = { ...(row.draft && typeof row.draft === "object" ? (row.draft as Record<string, unknown>) : {}), byHand };
  const { data: saved, error } = await supabaseAdmin
    .from("quote_drafts")
    .update({ draft, updated_by: by, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", cardId)
    .eq("updated_at", row.updated_at)
    .select("sm8_job_uuid");
  if (error || !saved || saved.length === 0) return { ok: false, reason: "The quote changed as you pressed it. Try again." };
  return { ok: true, byHand };
}
