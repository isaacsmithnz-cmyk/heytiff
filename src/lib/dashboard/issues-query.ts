import { supabaseAdmin } from "@/lib/supabase-server";
import type { HomeIssue } from "./issues";
import { asTargetKind, targetWords } from "./target-words";

/* ISSUES ON HOME — the read.

   Org-wide, open only, the most recently seen first and the most repeated
   first within a day. Server only; the caller establishes the right to ask
   (the loader gates it on `workboard`, the same gate the note router applies
   under) and hands in an orgId.

   WHERE EACH ONE IS, IN WORDS. An issue's target is a kind and an id, which
   is nothing a person can read. Four narrow reads name them — a visit through
   its agreement, an agreement, a project, a ServiceM8 job through its company
   — batched by kind so a page of fifty issues is at most five round trips,
   never one per row. A target that has gone (a deleted project) simply has
   no words, and the row says so rather than inventing a place. Those reads
   are ./target-words, which the Tasks face names a note's target with too. */

type IssueRow = {
  id: string;
  summary: string;
  equipment_ref: string | null;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  target_kind: string;
  target_id: string | null;
};

/** Every open issue in the workspace, newest sighting first. */
export async function listOpenIssues(orgId: string, limit = 50): Promise<HomeIssue[]> {
  const { data } = await supabaseAdmin
    .from("workboard_issues")
    .select("id, summary, equipment_ref, occurrences, first_seen, last_seen, target_kind, target_id")
    .eq("org_id", orgId)
    .eq("resolved", false)
    .order("last_seen", { ascending: false })
    .order("occurrences", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as IssueRow[];
  if (rows.length === 0) return [];

  const where = await targetWords(
    orgId,
    rows.map((r) => ({ key: r.id, target_kind: r.target_kind, target_id: r.target_id })),
  );
  return rows.map((r) => ({
    id: String(r.id),
    summary: String(r.summary),
    equipmentRef: r.equipment_ref || null,
    occurrences: Math.max(1, Number(r.occurrences) || 1),
    firstSeen: String(r.first_seen).slice(0, 10),
    lastSeen: String(r.last_seen).slice(0, 10),
    targetKind: asTargetKind(r.target_kind),
    targetId: r.target_id ?? null,
    where: where.get(r.id) ?? null,
  }));
}
