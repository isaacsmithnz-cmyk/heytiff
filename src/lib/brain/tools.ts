/* THE BRAIN'S READERS — server only, org-scoped, read only.

   The design lesson this module is built on: Claude Code doesn't memorise a
   repository, it has grep and read and a loop that uses them on demand. The
   app's equivalent of the repo is the database, and the database is already
   the memory — what's been missing is hands. Each reader here is a thin,
   compact reader over a query module that already exists; nothing in this
   file invents a new question to ask the data.

   TWO CALLERS. The note router pre-fetches `jobHistory` to ground a routing
   call (lib/workboard/note-brain), and Tiff's registry (lib/tiff/registry)
   wraps these readers as the tools the ask loop holds. The registry imports
   from here and never the other way round, so there is no cycle: the note
   router loads this module without loading the registry.

   Writes are not this module's business. Tiff's writes, when they come, are
   registry tools that call the action a screen would call, each with its own
   checks and its undo (docs/universal-tiff-phase-1-spec.md).

   NO SESSION HERE: callers establish the right to ask and hand in an orgId,
   the same posture as every read module this wraps.

   EVERYTHING RETURNED IS CAPPED AND COMPACT. Tool output lands in a prompt;
   an unbounded list is a cost and a distraction. The caps are the contract. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { listIssues, type IssueRow } from "@/lib/workboard/notes-query";
import { NAME_COLUMNS } from "@/lib/dashboard/tasks-query";
import { displayNameOf } from "@/lib/staff/name";
import type { NoteTarget } from "@/app/actions/workboard-notes";

/* ── job_history — what the org already knows about one job ────────────── */

export type JobHistory = {
  /** Open issues, most-repeated first. `occurrences` is the whole point:
      "again" in a note only means something against this list. */
  issues: { summary: string; equipmentRef: string | null; occurrences: number; lastSeen: string }[];
  /** Active flags still pulsing on the board for this job. */
  flags: { message: string; severity: string }[];
  /** The last few notes anyone captured against it, newest first. */
  recentNotes: string[];
  /** Equipment on site (projects carry a register; visits/agreements don't). */
  equipment: string[];
  /** The target's own free text, when it has words — a notes column for the
      three HeyTiff kinds, and a ServiceM8 job's DESCRIPTION for the fourth,
      which has no column of ours to hold notes. */
  jobNotes: string | null;
};

const EMPTY_HISTORY: JobHistory = {
  issues: [],
  flags: [],
  recentNotes: [],
  equipment: [],
  jobNotes: null,
};

/* The row whose free text grounds the router, and the column it lives in.

   A SERVICEM8 JOB IS THE ODD ONE OUT, again: it has no `notes` column of
   ours to read — the mirror is read-only — and the nearest thing it holds is
   the job's own DESCRIPTION, which is what the work was sold as. That is
   better grounding than nothing and honest about what it is: the router is
   being told what this job is FOR, not what somebody wrote on it (our own
   writing already reaches it through `recentNotes`, which reads
   `workboard_notes` for every target kind). */
const TARGET_TABLE = {
  project: { table: "projects", id: "id", text: "notes" },
  visit: { table: "maintenance_visits", id: "id", text: "notes" },
  agreement: { table: "maintenance_agreements", id: "id", text: "notes" },
  job: { table: "sm8_jobs", id: "uuid", text: "job_description" },
} as const;

/** Every kind job_history can read, in one list: its own schema enum and the
    ask route's target check are both this, so a job the Tiff modal is aimed
    at is always one the loop can be told to read. Three hand-kept copies of
    it drifted once — `job` reached this table and neither of the others,
    and a question asked from a job sheet went out with no target. */
export const TARGET_KINDS = Object.keys(TARGET_TABLE) as (keyof typeof TARGET_TABLE)[];

/** The last five things written on a target, whatever their status (a
    dismissed note still grounds the router, as it always has) — but never
    one somebody TOOK BACK (removed_at, the tombstone a take-back leaves:
    two-way phase 2). A database without that column reads as before. */
async function recentNotesOn(orgId: string, kind: string, id: string) {
  const read = (tombstones: boolean) => {
    let q = supabaseAdmin
      .from("workboard_notes")
      .select("transcript")
      .eq("org_id", orgId)
      .eq("target_kind", kind)
      .eq("target_id", id);
    if (tombstones) q = q.is("removed_at", null);
    return q.order("created_at", { ascending: false }).limit(5);
  };
  const first = await read(true);
  if (first.error?.code === "42703" || first.error?.code === "PGRST204") return read(false);
  return first;
}

/** Everything already on record for a job, in one parallel read. This is the
    router's grounding call, so it sits on the measured ~7s routing path —
    four cheap indexed reads together, not one expensive one. */
export async function jobHistory(orgId: string, target: NoteTarget): Promise<JobHistory> {
  if (target.kind === "none" || !target.id) return EMPTY_HISTORY;
  const source = TARGET_TABLE[target.kind];

  const [issues, flagsRes, notesRes, equipRes, rowRes] = await Promise.all([
    listIssues(orgId, target.kind, target.id),
    supabaseAdmin
      .from("workboard_flags")
      .select("message, severity")
      .eq("org_id", orgId)
      .eq("target_kind", target.kind)
      .eq("target_id", target.id)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(8),
    recentNotesOn(orgId, target.kind, target.id),
    target.kind === "project"
      ? supabaseAdmin
          .from("project_equipment")
          .select("description, model")
          .eq("org_id", orgId)
          .eq("project_id", target.id)
          .limit(20)
      : Promise.resolve({ data: null }),
    supabaseAdmin
      .from(source.table)
      .select(source.text)
      .eq("org_id", orgId)
      .eq(source.id, target.id)
      .maybeSingle(),
  ]);

  return {
    issues: issues.slice(0, 10).map((i: IssueRow) => ({
      summary: i.summary,
      equipmentRef: i.equipmentRef,
      occurrences: i.occurrences,
      lastSeen: i.lastSeen,
    })),
    flags: ((flagsRes.data ?? []) as { message: string; severity: string }[]).map((f) => ({
      message: f.message,
      severity: f.severity,
    })),
    recentNotes: ((notesRes.data ?? []) as { transcript: string }[]).map((n) =>
      n.transcript.slice(0, 300)
    ),
    equipment: ((equipRes.data ?? []) as { description: string; model: string | null }[]).map((e) =>
      [e.description, e.model].filter(Boolean).join(" ")
    ),
    jobNotes:
      ((rowRes.data as Record<string, string | null> | null)?.[source.text] ?? "")
        .trim()
        .slice(0, 600) || null,
  };
}

/* ── open_task_load — who is already carrying what ─────────────────────── */

export type TaskLoad = { staffId: string; name: string; open: number; overdue: number };

/** Open tasks per person, heaviest first. One read for the whole org — the
    grouping happens here, not in N queries. `today` comes from the caller,
    who knows the org's timezone; this module never guesses a clock. */
export async function openTaskLoad(orgId: string, today: string): Promise<TaskLoad[]> {
  const [{ data: tasks }, { data: people }] = await Promise.all([
    supabaseAdmin
      .from("tasks")
      .select("assigned_to, due_date")
      .eq("org_id", orgId)
      .eq("status", "open")
      .limit(1000),
    supabaseAdmin.from("staff_profiles").select(NAME_COLUMNS).eq("org_id", orgId).limit(200),
  ]);

  const names = new Map<string, string>();
  for (const p of (people ?? []) as Record<string, unknown>[]) {
    names.set(String(p.id), displayNameOf(p));
  }

  const load = new Map<string, TaskLoad>();
  for (const t of (tasks ?? []) as { assigned_to: string; due_date: string | null }[]) {
    const id = String(t.assigned_to);
    const row = load.get(id) ?? {
      staffId: id,
      name: names.get(id) ?? "Unnamed",
      open: 0,
      overdue: 0,
    };
    row.open += 1;
    if (t.due_date && t.due_date < today) row.overdue += 1;
    load.set(id, row);
  }
  return [...load.values()].sort((a, b) => b.open - a.open);
}

/* ── issue_log — the cross-job pattern read ────────────────────────────── */

export type OrgIssue = {
  summary: string;
  equipmentRef: string | null;
  occurrences: number;
  lastSeen: string;
  targetKind: string;
  targetId: string | null;
};

/** Open issues across the WHOLE org, most-repeated first — the read that
    makes "three sites reported the same fault this month" visible, which no
    screen currently shows anyone. */
export async function issueLog(orgId: string, limit = 25): Promise<OrgIssue[]> {
  const { data } = await supabaseAdmin
    .from("workboard_issues")
    .select("summary, equipment_ref, occurrences, last_seen, target_kind, target_id")
    .eq("org_id", orgId)
    .eq("resolved", false)
    .order("occurrences", { ascending: false })
    .order("last_seen", { ascending: false })
    .limit(limit);

  return ((data ?? []) as Record<string, unknown>[]).map((i) => ({
    summary: String(i.summary),
    equipmentRef: (i.equipment_ref as string) ?? null,
    occurrences: Number(i.occurrences),
    lastSeen: String(i.last_seen),
    targetKind: String(i.target_kind),
    targetId: (i.target_id as string) ?? null,
  }));
}
