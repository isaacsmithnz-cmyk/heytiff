/* What Smart Notes puts back on the screens — server only, org-scoped.

   NO SESSION HERE: callers establish the right to ask and hand in an orgId,
   the same posture as every other read module in this feature. */

import { supabaseAdmin } from "@/lib/supabase-server";

export type ProjectEntry = {
  id: string;
  kind: "progress" | "commissioning";
  body: string;
  entryDate: string;
};

/** The project's dated journal and its commissioning sheet — the same table,
    told apart by `kind`. */
export async function listProjectEntries(
  orgId: string,
  projectId: string
): Promise<ProjectEntry[]> {
  const { data } = await supabaseAdmin
    .from("project_entries")
    .select("id, kind, body, entry_date")
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);

  return ((data ?? []) as {
    id: string;
    kind: "progress" | "commissioning";
    body: string;
    entry_date: string;
  }[]).map((e) => ({ id: e.id, kind: e.kind, body: e.body, entryDate: e.entry_date }));
}

export type IssueRow = {
  id: string;
  summary: string;
  equipmentRef: string | null;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
};

/** The "this keeps happening" log for one target. Repeats bump a row rather
    than adding one, so `occurrences` is the whole point of the list. */
export async function listIssues(
  orgId: string,
  targetKind: string,
  targetId: string
): Promise<IssueRow[]> {
  const { data } = await supabaseAdmin
    .from("workboard_issues")
    .select("id, summary, equipment_ref, occurrences, first_seen, last_seen")
    .eq("org_id", orgId)
    .eq("target_kind", targetKind)
    .eq("target_id", targetId)
    .eq("resolved", false)
    .order("occurrences", { ascending: false })
    .limit(50);

  return ((data ?? []) as {
    id: string;
    summary: string;
    equipment_ref: string | null;
    occurrences: number;
    first_seen: string;
    last_seen: string;
  }[]).map((i) => ({
    id: i.id,
    summary: i.summary,
    equipmentRef: i.equipment_ref,
    occurrences: i.occurrences,
    firstSeen: i.first_seen,
    lastSeen: i.last_seen,
  }));
}
