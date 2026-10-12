import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { normaliseDraft, type ProposalDraft } from "./proposal";

/* A QUOTE DRAFTED IN THE OLD BUILDER, as it was kept (Isaac, 2026-10-12:
   "retire"): the builder is gone, its drafts stay. Tiff reads what one said
   when its quote is opened on lines (session/job-sources-server.ts), the
   job card says one was drafted, and a job's labour reads its brief. A row
   with no option of the old kind — a quote built on its lines — is none.
   Service role, by org; the callers gate. */

export type StoredProposal = {
  cardId: string;
  draft: ProposalDraft;
  brief: string;
  /** The changes asked for since the first draft, oldest first. */
  changes: string[];
  updatedAt: string;
};

type Row = { sm8_job_uuid: string; draft: unknown; brief: string; changes: unknown; updated_at: string };

function storedOf(row: Row | null): StoredProposal | null {
  if (!row) return null;
  const draft = normaliseDraft(row.draft);
  if (!draft) return null;
  return {
    cardId: row.sm8_job_uuid,
    draft,
    brief: row.brief,
    changes: Array.isArray(row.changes) ? row.changes.filter((c): c is string => typeof c === "string") : [],
    updatedAt: row.updated_at,
  };
}

export async function readStoredProposal(orgId: string, cardId: string): Promise<StoredProposal | null> {
  const { data } = await supabaseAdmin
    .from("quote_drafts")
    .select("sm8_job_uuid, draft, brief, changes, updated_at")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", cardId)
    .maybeSingle();
  return storedOf(data as Row | null);
}
