/* THE BRAIN'S HANDS — server only, org-scoped, read only.

   The design lesson this module is built on: Claude Code doesn't memorise a
   repository, it has grep and read and a loop that uses them on demand. The
   app's equivalent of the repo is the database, and the database is already
   the memory — what's been missing is hands. Each tool here is a thin,
   compact reader over a query module that already exists; nothing in this
   file invents a new question to ask the data.

   TWO CALLERS, ONE SHAPE. Today the note router pre-fetches `jobHistory` to
   ground a routing call (lib/workboard/note-brain). Next, the ask-mode loop
   hands `toolDefs()` to the API and dispatches through `runTool` — which is
   why every tool carries a JSON-schema definition it doesn't strictly need
   yet. Building the registry now and the loop later is the point: the loop
   is an afternoon once the hands exist.

   READ ONLY IS A HARD RULE, not a phase. The house safety model is that a
   model's understanding is probabilistic and effect is deterministic —
   writes happen through the review card, where a human confirms every row.
   A write tool here would hand the model the review card's job. Don't add
   one.

   NO SESSION HERE: callers establish the right to ask and hand in an orgId,
   the same posture as every read module this wraps. Person-scoped data (My
   notes) is deliberately ABSENT until the ask loop can carry a viewer
   identity — an org-keyed tool must never read one person's private notes.

   EVERYTHING RETURNED IS CAPPED AND COMPACT. Tool output lands in a prompt;
   an unbounded list is a cost and a distraction. The caps are the contract. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { listIssues, type IssueRow } from "@/lib/workboard/notes-query";
import { searchMirrorJobs, type JobSearchHit } from "@/lib/workboard/projects-query";
import { retrieveForQuestion } from "@/lib/tiff/retrieve";
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
  /** The job's own free-text notes column, when it has words. */
  jobNotes: string | null;
};

const EMPTY_HISTORY: JobHistory = {
  issues: [],
  flags: [],
  recentNotes: [],
  equipment: [],
  jobNotes: null,
};

const TARGET_TABLE = {
  project: "projects",
  visit: "maintenance_visits",
  agreement: "maintenance_agreements",
} as const;

/** Everything already on record for a job, in one parallel read. This is the
    router's grounding call, so it sits on the measured ~7s routing path —
    four cheap indexed reads together, not one expensive one. */
export async function jobHistory(orgId: string, target: NoteTarget): Promise<JobHistory> {
  if (target.kind === "none" || !target.id) return EMPTY_HISTORY;
  const table = TARGET_TABLE[target.kind];

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
    supabaseAdmin
      .from("workboard_notes")
      .select("transcript")
      .eq("org_id", orgId)
      .eq("target_kind", target.kind)
      .eq("target_id", target.id)
      .order("created_at", { ascending: false })
      .limit(5),
    target.kind === "project"
      ? supabaseAdmin
          .from("project_equipment")
          .select("description, model")
          .eq("org_id", orgId)
          .eq("project_id", target.id)
          .limit(20)
      : Promise.resolve({ data: null }),
    supabaseAdmin.from(table).select("notes").eq("org_id", orgId).eq("id", target.id).maybeSingle(),
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
    jobNotes: ((rowRes.data as { notes: string | null } | null)?.notes ?? "").trim().slice(0, 600) || null,
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

/* ── the registry — what the future ask-loop hands to the API ──────────── */

/** One tool the brain can call. `input` is already validated against the
    schema by the API before `run` sees it; `run` still treats it as data. */
export type BrainTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (orgId: string, input: Record<string, unknown>) => Promise<unknown>;
};

const str = { type: "string" } as const;

export const BRAIN_TOOLS: readonly BrainTool[] = [
  {
    name: "job_history",
    description:
      "Everything already on record for one job: open issues with how often each has recurred, " +
      "active flags, the last few notes, equipment on site, and the job's own notes. Call this " +
      "before answering anything about a specific job.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["project", "visit", "agreement"] },
        id: str,
      },
      required: ["kind", "id"],
      additionalProperties: false,
    },
    run: (orgId, input) =>
      jobHistory(orgId, {
        kind: input.kind as NoteTarget["kind"],
        id: String(input.id ?? ""),
      }),
  },
  {
    name: "search_jobs",
    description:
      "Find jobs by client, site, service or job number. Returns candidates with their ids — " +
      "use job_history on a result to read one in depth.",
    inputSchema: {
      type: "object",
      properties: { query: str },
      required: ["query"],
      additionalProperties: false,
    },
    run: async (orgId, input): Promise<JobSearchHit[]> =>
      searchMirrorJobs(orgId, String(input.query ?? "")),
  },
  {
    name: "open_task_load",
    description:
      "Open tasks per person, heaviest first, with overdue counts — who is already carrying " +
      "what. `today` must be the org's own date (YYYY-MM-DD).",
    inputSchema: {
      type: "object",
      properties: { today: str },
      required: ["today"],
      additionalProperties: false,
    },
    run: (orgId, input) => openTaskLoad(orgId, String(input.today ?? "")),
  },
  {
    name: "issue_log",
    description:
      "Open recurring issues across every job, most-repeated first — the cross-job pattern " +
      "view. Use it for 'what keeps breaking' questions.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: (orgId) => issueLog(orgId),
  },
  {
    name: "kb_search",
    description:
      "Search the knowledge base — manuals AND field notes the crew has taught. Returns " +
      "excerpts with their sources; field notes carry who learned them and where.",
    inputSchema: {
      type: "object",
      properties: { query: str },
      required: ["query"],
      additionalProperties: false,
    },
    run: async (orgId, input) => {
      const found = await retrieveForQuestion(orgId, String(input.query ?? ""));
      /* The loop wants excerpts, not the full retrieval trace. */
      return found.chunks.slice(0, 8).map((c) => ({
        title: c.title,
        category: c.category,
        heading: c.heading,
        pages: c.pageFrom === c.pageTo ? `${c.pageFrom}` : `${c.pageFrom}–${c.pageTo}`,
        content: c.content.slice(0, 1200),
      }));
    },
  },
];

/** Anthropic-shaped tool definitions, for the ask-loop's API call. */
export const toolDefs = () =>
  BRAIN_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));

/** Dispatch one call. Unknown names are an error VALUE, not a throw — inside
    an agentic loop a throw kills the answer, and the honest failure is to
    tell the model it asked for a tool that doesn't exist. */
export async function runTool(
  orgId: string,
  name: string,
  input: Record<string, unknown>
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const tool = BRAIN_TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `No such tool: ${name}` };
  try {
    return { ok: true, result: await tool.run(orgId, input) };
  } catch {
    return { ok: false, error: `${name} failed — answer without it.` };
  }
}
