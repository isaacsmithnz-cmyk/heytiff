/* HEYTIFF'S OWN WRITING ON A SERVICEM8 JOB, and what the card still wants.

   NO SESSION HERE: callers establish the right to ask and hand in an orgId,
   the same posture as every other read module in this feature.

   THE ONE THING TO UNDERSTAND: a ServiceM8 job has no `notes` column we may
   write. Every other note target — a project, a visit, an agreement — is a
   HeyTiff row with a text column that "keep it on the job" appends to. The
   mirror is read-only by charter, so for a job the note row IS the record:
   a `workboard_notes` row aimed at the job, filed applied, read back here
   and merged into the diary beside ServiceM8's own notes.

   Which is why `applied ? 'jobNotes'` is the test for "this belongs on the
   job's diary" rather than the row's mere existence. A note dictated on this
   card and then kept in somebody's own notes went somewhere else; a note
   still mid-review hasn't landed anywhere yet. Both would be a lie in a
   feed that says what happened. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { displayNameOf } from "@/lib/staff/name";
import { NAME_COLUMNS, mentionableStaff } from "@/lib/dashboard/tasks-query";
import { sm8StaffLinkMap } from "@/lib/integrations/links";
import { mentionedHandles, sm8Handle } from "./sm8-mentions";
import { buildJobAttention, type AttentionFlag, type AttentionTask, type JobAttention } from "./job-attention";
import type { Severity } from "./note-brain";

/** A note somebody wrote on this job, ours. */
export type OurJobNote = {
  id: string;
  text: string;
  /** The account-local naive stamp, so it sorts beside ServiceM8's. */
  at: string;
  author: string | null;
};

const SEVERITY: ReadonlySet<string> = new Set(["info", "warn", "urgent"]);

/** Every note HeyTiff holds against this job, newest first.

    Capped like the mirror's own read: a diary is read from the top, and a
    job with two hundred notes on it is telling us something other than that
    the reader wants all two hundred at once. */
export async function readOurJobNotes(
  orgId: string,
  jobUuid: string,
  limit = 60
): Promise<OurJobNote[]> {
  const { data } = await supabaseAdmin
    .from("workboard_notes")
    .select("id, transcript, applied, applied_at, created_at, author_id")
    .eq("org_id", orgId)
    .eq("target_kind", "job")
    .eq("target_id", jobUuid)
    .eq("status", "applied")
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = ((data ?? []) as {
    id: string;
    transcript: string | null;
    applied: Record<string, unknown> | null;
    applied_at: string | null;
    created_at: string;
    author_id: string | null;
  }[]).filter((r) => {
    const kept = r.applied?.jobNotes;
    return Array.isArray(kept) && kept.length > 0 && !!r.transcript?.trim();
  });
  if (rows.length === 0) return [];

  const names = await staffDisplayNames(orgId, rows.map((r) => r.author_id));
  return rows.map((r) => ({
    id: r.id,
    /* The WORDS THAT WERE KEPT, not the transcript, when they differ: a note
       routed through the review card can be edited before it saves, and the
       diary must show what was filed rather than what was said first. */
    text: keptWords(r.applied) ?? r.transcript!.trim(),
    at: r.applied_at ?? r.created_at,
    author: r.author_id ? names.get(r.author_id) ?? null : null,
  }));
}

function keptWords(applied: Record<string, unknown> | null): string | null {
  const kept = applied?.jobNotes;
  if (!Array.isArray(kept)) return null;
  const words = kept.filter((k): k is string => typeof k === "string" && !!k.trim());
  return words.length ? words.join("\n\n") : null;
}

/** One read for every name on the strip and the diary. Tolerant: a note by
    somebody with no staff card is unattributed, never dropped. */
async function staffDisplayNames(
  orgId: string,
  ids: readonly (string | null)[]
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((i): i is string => !!i))];
  const map = new Map<string, string>();
  if (wanted.length === 0) return map;
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select(NAME_COLUMNS)
    .eq("org_id", orgId)
    .in("id", wanted);
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const name = displayNameOf(r as Parameters<typeof displayNameOf>[0], "");
    if (name) map.set(String(r.id), name);
  }
  return map;
}

/* ── what the attention strip is built from ── */

export type JobAttentionRead = {
  /** What the strip draws, already decided. */
  attention: JobAttention;
  /** Who a task made from the strip can be given to — the org's active staff.
      Sent with the strip rather than fetched when the form opens, because the
      form is one tap away from a suggestion and a picker that has to load is
      a picker people abandon. */
  assignable: { id: string; name: string }[];
};

export const EMPTY_ATTENTION: JobAttentionRead = {
  attention: { items: [], total: 0 },
  assignable: [],
};

/** Everything still open on this job.

    THE DECIDING HAPPENS ON THE SERVER, which is why this hands back finished
    items rather than four lists and a roster. The strip's rules are about
    facts the browser doesn't hold — who a handle is, whether a note has been
    answered, what today is in the account's own zone — and shipping the raw
    material across so a component could re-derive it would be four chances
    for the card and the server to disagree.

    Five cheap queries against our own tables, run together; the only mirror
    read is the staff roster, which is twenty-one rows. */
export async function readJobAttention(
  orgId: string,
  jobUuid: string,
  input: {
    /** ServiceM8's own notes for this card, already read by the caller. */
    notes: readonly { remoteId: string; text: string; writtenBy: string | null; writtenAt: string | null; actionRequired: boolean }[];
    /** False on a Completed or Unsuccessful job — its flagged and mentioning
        notes are history, and the diary keeps them. */
    jobOpen: boolean;
    /** The account's today, for the overdue reading. */
    today: string;
  }
): Promise<JobAttentionRead> {
  const [flags, taskIds, answered, people, assignable] = await Promise.all([
    readJobFlags(orgId, jobUuid),
    noteBornTaskIds(orgId, jobUuid),
    answeredNotes(orgId, jobUuid),
    readMentionPeople(orgId),
    mentionableStaff(orgId),
  ]);
  const tasks = await openTasks(orgId, taskIds);

  const handles = [...people.keys()];
  const attention = buildJobAttention({
    flags,
    tasks,
    notes: input.notes.map((n) => ({
      remoteId: n.remoteId,
      text: n.text,
      author: n.writtenBy,
      at: n.writtenAt,
      actionRequired: n.actionRequired,
      handles: mentionedHandles(n.text, handles),
    })),
    jobOpen: input.jobOpen,
    answered,
    people,
    today: input.today,
  });

  return { attention, assignable };
}

/** Live HeyTiff flags against this job. */
async function readJobFlags(orgId: string, jobUuid: string): Promise<AttentionFlag[]> {
  const { data } = await supabaseAdmin
    .from("workboard_flags")
    .select("id, message, severity, created_at, note_id")
    .eq("org_id", orgId)
    .eq("target_kind", "job")
    .eq("target_id", jobUuid)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(20);

  return ((data ?? []) as {
    id: string;
    message: string;
    severity: string;
    created_at: string;
  }[]).map((f) => ({
    id: f.id,
    message: f.message,
    /* The column is checked in the database, so an unreadable value here is
       impossible — but the type isn't, and defaulting to "warn" is the same
       shrug `applyNote` makes on the way in. */
    severity: (SEVERITY.has(f.severity) ? f.severity : "warn") as Severity,
    raised: f.created_at,
  }));
}

/** THE JOIN THE TASKS TABLE DELIBERATELY DOESN'T CARRY.

    `tasks` has no job column, on purpose — "a task from a note stands
    alone", and a task assigned to somebody lands on their dashboard whether
    or not it is about a job. What DOES know both ends is the note: it was
    aimed at this job and it recorded the ids it created. The journal already
    resolves outcomes this way; this is the same trick on a card.

    Two sources, because a task about this job can be born two ways: through
    the review card (`workboard_notes.applied.taskIds`) or straight off one
    of ServiceM8's own notes on the strip (`job_note_actions.task_id`). */
async function noteBornTaskIds(orgId: string, jobUuid: string): Promise<string[]> {
  const [{ data: notes }, { data: acts }] = await Promise.all([
    supabaseAdmin
      .from("workboard_notes")
      .select("applied")
      .eq("org_id", orgId)
      .eq("target_kind", "job")
      .eq("target_id", jobUuid)
      .eq("status", "applied")
      .limit(200),
    supabaseAdmin
      .from("job_note_actions")
      .select("task_id")
      .eq("org_id", orgId)
      .eq("sm8_job_uuid", jobUuid)
      .eq("action", "task")
      .limit(200),
  ]);

  const ids = new Set<string>();
  for (const n of (notes ?? []) as { applied: Record<string, unknown> | null }[]) {
    const list = n.applied?.taskIds;
    if (!Array.isArray(list)) continue;
    for (const id of list) if (typeof id === "string") ids.add(id);
  }
  for (const a of (acts ?? []) as { task_id: string | null }[]) {
    if (a.task_id) ids.add(a.task_id);
  }
  return [...ids];
}

/** The ones still open, with who they're on. */
async function openTasks(orgId: string, ids: readonly string[]): Promise<AttentionTask[]> {
  if (ids.length === 0) return [];
  const { data } = await supabaseAdmin
    .from("tasks")
    .select("id, title, due_date, assigned_to")
    .eq("org_id", orgId)
    .eq("status", "open")
    .in("id", ids.slice(0, 100))
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(20);

  const rows = (data ?? []) as {
    id: string;
    title: string;
    due_date: string | null;
    assigned_to: string | null;
  }[];
  const names = await staffDisplayNames(orgId, rows.map((r) => r.assigned_to));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    dueDate: r.due_date,
    assignee: r.assigned_to ? names.get(r.assigned_to) ?? null : null,
  }));
}

/** ServiceM8 notes on this job that somebody has already dealt with. */
async function answeredNotes(orgId: string, jobUuid: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("job_note_actions")
    .select("sm8_note_uuid")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .limit(500);
  return new Set(((data ?? []) as { sm8_note_uuid: string }[]).map((r) => r.sm8_note_uuid));
}

/** WHO EACH SERVICEM8 HANDLE IS — the first read-time consumer
    `integration_links` has ever had.

    The links table exists precisely so that "which HeyTiff person is this
    ServiceM8 staff member" is a recorded fact rather than a name comparison
    somebody's code invented ([[one truth per staff member]]). So this
    resolves through it and NOWHERE ELSE: an unlinked person arrives with
    their ServiceM8 name and `staffId: null`, and the task they'd be given
    opens with the assignee unset. Guessing from a name match is exactly the
    behaviour that table was built to end, and a task on the wrong person is
    worse than a task on nobody.

    Measured before this shipped: the live account has 21 ServiceM8 staff and
    ZERO links, so today every mention arrives named and unassigned. That is
    the honest reading, and it will start filling itself the day someone
    links the accounts. */
async function readMentionPeople(
  orgId: string
): Promise<Map<string, { name: string; staffId: string | null }>> {
  const [{ data: staff }, linked] = await Promise.all([
    supabaseAdmin
      .from("sm8_staff")
      .select("uuid, first, last")
      .eq("org_id", orgId)
      .limit(500),
    sm8StaffLinkMap(orgId),
  ]);

  const map = new Map<string, { name: string; staffId: string | null }>();
  for (const s of (staff ?? []) as { uuid: string; first: string | null; last: string | null }[]) {
    const handle = sm8Handle(s.first, s.last);
    if (!handle) continue;
    const name = `${(s.first ?? "").trim()} ${(s.last ?? "").trim()}`.trim();
    if (!name) continue;
    map.set(handle, { name, staffId: linked.get(s.uuid) ?? null });
  }
  return map;
}
