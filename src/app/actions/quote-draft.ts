"use server";

import { requireOrg } from "@/lib/permissions-server";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { normaliseDraft } from "@/lib/quotes/proposal";
import {
  readStoredProposal,
  storeProposal,
  type StoredProposal,
} from "@/lib/quotes/proposal-writer";

/* The Quote tab's reads and hand edits. Writing and changing a draft with
   Tiff is the route's (app/api/workboard/quote-draft): a model call wants
   a route's time limit. What is here costs nothing but a query.

   Same discipline as every action: the session's org, the capability
   re-checked here, because a server function is reachable by direct POST. */

export async function readQuoteDraft(job: string): Promise<StoredProposal | null> {
  const { orgId } = await requireOrg("workboard_manage");
  const target = await resolveJobCard(orgId, job);
  return readStoredProposal(orgId, target.parentRemoteId);
}

/** A person's own edit to the draft: the whole draft back, through the
    same gate a model's answer goes through. */
export async function saveQuoteDraft(
  job: string,
  raw: unknown
): Promise<{ ok: true; proposal: StoredProposal } | { ok: false; error: string }> {
  const { orgId, userId } = await requireOrg("workboard_manage");
  const draft = normaliseDraft(raw);
  if (!draft) return { ok: false, error: "A proposal needs at least one option with some scope." };
  const target = await resolveJobCard(orgId, job);
  const current = await readStoredProposal(orgId, target.parentRemoteId);
  if (!current) return { ok: false, error: "There's no proposal on this job to edit." };
  const stored = await storeProposal(orgId, userId, current.cardId, draft, current.brief, current.changes);
  return stored ? { ok: true, proposal: stored } : { ok: false, error: "The edit couldn't be saved. Try again." };
}
