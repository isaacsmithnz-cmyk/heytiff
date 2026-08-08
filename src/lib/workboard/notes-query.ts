/* What Smart Notes puts back on the screens — server only, org-scoped.

   NO SESSION HERE: callers establish the right to ask and hand in an orgId,
   the same posture as every other read module in this feature. */

import { supabaseAdmin } from "@/lib/supabase-server";
import type { Severity } from "./note-brain";
import type { JobCandidate } from "./note-match";

export type BoardFlag = {
  id: string;
  message: string;
  severity: Severity;
  targetKind: string;
  targetId: string | null;
  createdAt: string;
};

/** Live flags, worst first — an urgent one raised this morning should not sit
    below a week-old info note. */
export async function listFlags(orgId: string, limit = 20): Promise<BoardFlag[]> {
  const { data } = await supabaseAdmin
    .from("workboard_flags")
    .select("id, message, severity, target_kind, target_id, created_at")
    .eq("org_id", orgId)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  const rank: Record<string, number> = { urgent: 0, warn: 1, info: 2 };
  return ((data ?? []) as {
    id: string;
    message: string;
    severity: Severity;
    target_kind: string;
    target_id: string | null;
    created_at: string;
  }[])
    .map((f) => ({
      id: f.id,
      message: f.message,
      severity: f.severity,
      targetKind: f.target_kind,
      targetId: f.target_id,
      createdAt: f.created_at,
    }))
    .sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));
}

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

/* THE JOBS A NOTE COULD BE PINNED TO — the picker's roster, served with the
   routed note rather than pushed up by whichever screen happens to have a
   board loaded.

   It used to be the workboard's job to report this list into scope, which
   made the picker a board-screens-only feature: a fault note dictated from
   the Tiff AI page came back as flags and readings with NO way to say which
   job they belonged to, and the review card's "say which one" was advice the
   screen couldn't take (Isaac, 2026-08-08). The words name a job wherever
   they are spoken, so the roster has to come from somewhere every screen
   reaches — the route itself.

   SAME SET AS THE BOARD OFFERS, deliberately: open visits and trips first
   (they carry the job number, which is what makes confirming a glance),
   agreements for work with no visit raised, projects last. Visits of PAUSED
   agreements are left out exactly as the board leaves them out; the paused
   agreement itself still stands. */
export async function jobCandidates(orgId: string): Promise<JobCandidate[]> {
  const [{ data: agreementRows }, { data: projectRows }, { data: visitRows }] = await Promise.all([
    supabaseAdmin
      .from("maintenance_agreements")
      .select("id, label, client_name, site_label, status")
      .eq("org_id", orgId)
      .in("status", ["active", "paused"]),
    supabaseAdmin
      .from("projects")
      .select("id, name, client_name, site_label")
      .eq("org_id", orgId)
      .neq("status", "archived")
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("maintenance_visits")
      .select("id, agreement_id, project_id, label, job_number, status")
      .eq("org_id", orgId)
      .in("status", ["upcoming", "booked"])
      .order("due_date", { ascending: true }),
  ]);

  const agreements = (agreementRows ?? []) as {
    id: string;
    label: string;
    client_name: string;
    site_label: string | null;
    status: string;
  }[];
  const projects = (projectRows ?? []) as {
    id: string;
    name: string;
    client_name: string | null;
    site_label: string | null;
  }[];
  const visits = (visitRows ?? []) as {
    id: string;
    agreement_id: string | null;
    project_id: string | null;
    label: string | null;
    job_number: string | null;
    status: string;
  }[];

  const activeAgreement = new Map(agreements.filter((a) => a.status === "active").map((a) => [a.id, a]));
  const projectBy = new Map(projects.map((p) => [p.id, p]));

  return [
    // maintenance visits wear their agreement's identity — a visit row has no
    // client of its own
    ...visits.flatMap((v) => {
      const a = v.agreement_id ? activeAgreement.get(v.agreement_id) : undefined;
      if (!a) return [];
      return [{
        kind: "visit" as const,
        id: v.id,
        clientName: a.client_name,
        label: a.label,
        siteLabel: a.site_label,
        jobNumber: v.job_number,
      }];
    }),
    ...visits.flatMap((v) => {
      const p = v.project_id ? projectBy.get(v.project_id) : undefined;
      if (!p) return [];
      return [{
        kind: "visit" as const,
        id: v.id,
        clientName: p.client_name ?? p.name,
        label: v.label ? `${p.name} · ${v.label}` : p.name,
        siteLabel: p.site_label,
        jobNumber: v.job_number,
      }];
    }),
    ...agreements.map((a) => ({
      kind: "agreement" as const,
      id: a.id,
      clientName: a.client_name,
      label: a.label,
      siteLabel: a.site_label,
      jobNumber: null,
    })),
    ...projects.map((p) => ({
      kind: "project" as const,
      id: p.id,
      clientName: p.client_name ?? p.name,
      label: p.name,
      siteLabel: p.site_label,
      jobNumber: null,
    })),
  ];
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
