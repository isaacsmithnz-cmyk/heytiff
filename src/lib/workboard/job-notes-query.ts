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
import { sm8StaffLinkMap, type NoteSender } from "@/lib/integrations/links";
import { sm8Ours } from "@/lib/integrations/sm8-echo";
import { sm8NotesAllowed } from "@/lib/integrations/sm8-kinds";
import { offersSend, sendHold, type Sm8WriteState } from "@/lib/integrations/sm8-write-plan";
import {
  flagHeldByUs,
  flagState,
  isStoredRefusal,
  noteState,
  type FlagOp,
  type FlagState,
  type NoteState,
  type QueueRowIn,
} from "@/lib/integrations/sm8-note-plan";
import { mentionedHandles, sm8Handle } from "./sm8-mentions";
import {
  buildJobAttention,
  type AttentionFlag,
  type AttentionOurNote,
  type AttentionTask,
  type JobAttention,
} from "./job-attention";
import type { Severity } from "./note-brain";
import type { JobNoteEntry } from "./all-jobs-query";

/** A note somebody wrote on this job, ours. */
export type OurJobNote = {
  id: string;
  text: string;
  /** The account-local naive stamp, so it sorts beside ServiceM8's. */
  at: string;
  author: string | null;
  /* ── notes to ServiceM8 (two-way phase 2, PR B) ──
     Set only where the deployment sends notes; optional so every reader
     that predates them types unchanged. */
  /** Who wrote it: their staff card. */
  authorId?: string | null;
  /** The ServiceM8 note this answers, when it is a reply. */
  replyTo?: string | null;
  /** Taken back (a tombstone), drawn only while something of it may still
      be in ServiceM8. */
  removed?: boolean;
  /** What it says about ServiceM8, and the doors it offers the viewer —
      null for a HeyTiff-only entry. */
  state?: NoteState | null;
  /** The uuid ServiceM8's copy carries, once it went: a reply to that copy
      finds this row by it. */
  sm8Uuid?: string | null;
  /** It has been queued for ServiceM8 at least once. */
  hasCreate?: boolean;
  /** The viewer wrote it. */
  mine?: boolean;
  /* ── a task's Done (two-way phase 2, PR C) ── */
  /** The task it stands for: a Done, or a reply that closed its task. Null
      once the task is deleted (the key sets it null; the Done stays). */
  taskId?: string | null;
  /** A Done — made only by a tick, so it is never a mention, and Reopen
      never takes a reply back. */
  isTaskDone?: boolean;
};

/** Who is looking, where the deployment sends notes: their staff card, the
    workspace's sending state and who they are in ServiceM8. One read of
    each per card open, shared by every reader that needs them. */
export type NotesViewer = {
  staffId: string | null;
  state: Sm8WriteState;
  sender: NoteSender | null;
};

const SEVERITY: ReadonlySet<string> = new Set(["info", "warn", "urgent"]);

type DbError = { code?: string } | null;
const missingColumn = (e: DbError) => e?.code === "42703" || e?.code === "PGRST204";

type OurRow = {
  id: string;
  transcript: string | null;
  applied: Record<string, unknown> | null;
  applied_at: string | null;
  created_at: string;
  author_id: string | null;
  reply_to_sm8_note_uuid?: string | null;
  removed_at?: string | null;
  sm8_refusal?: string | null;
  task_id?: string | null;
  is_task_done?: boolean | null;
};

const OUR_COLUMNS = "id, transcript, applied, applied_at, created_at, author_id";
const OUR_SM8_COLUMNS = `${OUR_COLUMNS}, reply_to_sm8_note_uuid, removed_at, sm8_refusal, task_id, is_task_done`;

/** A note's queue rows, as its line reads them: its create and the
    take-back of that create. */
type QueueRow = QueueRowIn & {
  note_id: string | null;
  op: string;
  depends_on: string | null;
  requested_by: string | null;
};

const QUEUE_COLUMNS =
  "id, note_id, op, depends_on, status, lease_until, remote_uuid, maybe_landed, verify_uuids, taken_back_at, requested_by, last_error, attempts";

/** Every note HeyTiff holds against this job, newest first.

    Capped like the mirror's own read: a diary is read from the top, and a
    job with two hundred notes on it is telling us something other than that
    the reader wants all two hundred at once.

    WHERE THE DEPLOYMENT SENDS NOTES, each one also says where it stands
    with ServiceM8 (`state`), read from its queue rows in one query, and a
    note somebody took back is still drawn while something of it may be in
    ServiceM8 — "Still in ServiceM8", with Try again — and not once nothing
    of it can be. `viewer` says who is looking, so the doors are theirs; the
    stored summary reads without one and gets the same set of notes (the
    story's stamp needs both readers handed the same set). Without notes
    this is exactly the read it always was. */
export async function readOurJobNotes(
  orgId: string,
  jobUuid: string,
  limit = 60,
  viewer?: NotesViewer | Promise<NotesViewer | null> | null
): Promise<OurJobNote[]> {
  if (sm8NotesAllowed()) return readOurJobNotesWithSm8(orgId, jobUuid, limit, viewer ?? null);
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

/** The words a row's diary entry shows: what was kept, not what was said
    first. Also the task line's quote of a Done (PR C). */
export function keptWords(applied: Record<string, unknown> | null): string | null {
  const kept = applied?.jobNotes;
  if (!Array.isArray(kept)) return null;
  const words = kept.filter((k): k is string => typeof k === "string" && !!k.trim());
  return words.length ? words.join("\n\n") : null;
}

/* ── our notes, where the deployment sends notes ── */

/** Our rows on this job: filed on it, or taken back. A database without the
    phase 2 columns reads as it always did. A take-back keeps its row
    (`removed_at`), and the rollback may have set it `dismissed`: new code
    reads a removed row whatever its status. */
async function readOurRows(orgId: string, jobUuid: string, limit: number): Promise<OurRow[]> {
  const base = () =>
    supabaseAdmin.from("workboard_notes").select(OUR_SM8_COLUMNS).eq("org_id", orgId).eq("target_kind", "job").eq("target_id", jobUuid);
  const { data, error } = await base()
    .or("status.eq.applied,removed_at.not.is.null")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!missingColumn(error)) return (data ?? []) as unknown as OurRow[];
  const old = await supabaseAdmin
    .from("workboard_notes")
    .select(OUR_COLUMNS)
    .eq("org_id", orgId)
    .eq("target_kind", "job")
    .eq("target_id", jobUuid)
    .eq("status", "applied")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (old.data ?? []) as unknown as OurRow[];
}

/** A diary row carries words the diary can show. */
const drawable = (r: OurRow) => {
  const kept = r.applied?.jobNotes;
  return Array.isArray(kept) && kept.length > 0 && !!r.transcript?.trim();
};

/** The queue rows of these notes: each one's create and its take-back, in
    one read. Null when it can't be read — the notes then say nothing about
    ServiceM8, rather than something wrong. */
async function readQueueRows(orgId: string, noteIds: readonly string[]): Promise<QueueRow[] | null> {
  if (noteIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("sm8_writes")
    .select(QUEUE_COLUMNS)
    .eq("org_id", orgId)
    .eq("kind", "note")
    .in("op", ["create", "delete"])
    .in("note_id", [...noteIds]);
  if (error) {
    console.error(`[sm8] couldn't read where org ${orgId}'s notes stand with ServiceM8:`, error);
    return null;
  }
  return (data ?? []) as unknown as QueueRow[];
}

/** Who is looking, when the caller didn't say: nobody's doors, the
    workspace's own state. The sender's module is reached lazily: it imports
    this one (for names), and every reader of staffDisplayNames — the files,
    the papers — would otherwise load the whole sender with it. */
async function viewerOr(orgId: string, viewer: NotesViewer | Promise<NotesViewer | null> | null): Promise<NotesViewer> {
  const v = await viewer;
  if (v) return v;
  const { readSm8WriteState } = await import("@/lib/integrations/sm8-writes");
  return { staffId: null, state: await readSm8WriteState(orgId), sender: null };
}

/** A row's line, as far as it is read: who wrote it, whether it was taken
    back, and why a press didn't queue it. */
type LineRow = Pick<OurRow, "id" | "author_id" | "removed_at" | "sm8_refusal">;

/** Everything one read of the queue says about a set of rows, and who is
    looking: what each row's line is worked out from. */
type LineCtx = {
  viewer: NotesViewer;
  names: Map<string, string>;
  createOf: Map<string, QueueRow>;
  takeBackOf: Map<string, QueueRow>;
};

function lineCtx(viewer: NotesViewer, names: Map<string, string>, queue: readonly QueueRow[]): LineCtx {
  const createOf = new Map<string, QueueRow>();
  const takeBackOf = new Map<string, QueueRow>();
  for (const q of queue) {
    if (q.op === "create" && q.note_id) createOf.set(q.note_id, q);
    else if (q.op === "delete" && q.depends_on) takeBackOf.set(q.depends_on, q);
  }
  return { viewer, names, createOf, takeBackOf };
}

/** One row's line (noteState) as the viewer reads it: the doors are theirs
    only if they sent it, and the words name whoever did. */
function rowLine(r: LineRow, ctx: LineCtx): { line: NoteState; create: QueueRow | null } {
  const { viewer, names } = ctx;
  const { state, sender } = viewer;
  const create = ctx.createOf.get(r.id) ?? null;
  const takeBack = create ? (ctx.takeBackOf.get(create.id) ?? null) : null;
  const sentBy = create ? (create.requested_by ?? null) : (r.author_id ?? null);
  const viewerIsSender = !!viewer.staffId && sentBy === viewer.staffId;
  const senderName = sentBy ? (names.get(sentBy) ?? null) : null;
  const line = noteState({
    row: { removed: !!r.removed_at, refusal: isStoredRefusal(r.sm8_refusal) ? r.sm8_refusal : null },
    create,
    takeBack,
    hold: state.readable ? sendHold(state, "note") : null,
    offered: offersSend(state, "note"),
    viewerIsSender,
    senderName,
    sm8Name: viewerIsSender ? (sender && "sm8Name" in sender ? sender.sm8Name : null) : senderName,
  });
  return { line, create };
}

/** Where each of these rows stands with ServiceM8, as `viewer` reads it —
    the very line the diary draws, for a surface that isn't the diary: a
    task's Done and the reply that closed it (PR C). Two reads, the queue
    and the names. Null when the queue can't be read: then nothing is said
    about ServiceM8, rather than something wrong. A row whose line is empty
    maps to an empty state (`key` null). */
export async function noteLinesOf(
  orgId: string,
  rows: readonly LineRow[],
  viewer: NotesViewer
): Promise<Map<string, NoteState> | null> {
  const out = new Map<string, NoteState>();
  if (rows.length === 0) return out;
  const [names, queue] = await Promise.all([
    staffDisplayNames(
      orgId,
      rows.map((r) => r.author_id)
    ),
    readQueueRows(
      orgId,
      rows.map((r) => r.id)
    ),
  ]);
  if (queue === null) return null;
  const ctx = lineCtx(viewer, names, queue);
  for (const r of rows) out.set(r.id, rowLine(r, ctx).line);
  return out;
}

/** Shape our rows, each with where it stands with ServiceM8. A removed row
    is left out once its line is empty: nothing of it can be in ServiceM8. */
async function shapeOurNotes(orgId: string, rows: readonly OurRow[], viewerIn: NotesViewer | Promise<NotesViewer | null> | null): Promise<OurJobNote[]> {
  const [names, queue, viewer] = await Promise.all([
    staffDisplayNames(
      orgId,
      rows.map((r) => r.author_id)
    ),
    readQueueRows(
      orgId,
      rows.map((r) => r.id)
    ),
    viewerOr(orgId, viewerIn),
  ]);
  const ctx = lineCtx(viewer, names, queue ?? []);

  const out: OurJobNote[] = [];
  for (const r of rows) {
    const { line: read, create } = rowLine(r, ctx);
    const removed = !!r.removed_at;
    const line = queue === null ? null : read;
    const drawn = line && line.key ? line : null;
    /* A TAKE-BACK THAT SETTLED LEAVES NOTHING, as today's Remove did: the
       tombstone is drawn only while something of it may be in ServiceM8 */
    if (removed && !drawn) continue;
    out.push({
      id: r.id,
      text: keptWords(r.applied) ?? r.transcript!.trim(),
      at: r.applied_at ?? r.created_at,
      author: r.author_id ? (names.get(r.author_id) ?? null) : null,
      authorId: r.author_id ?? null,
      replyTo: r.reply_to_sm8_note_uuid ?? null,
      removed,
      state: drawn,
      sm8Uuid: create?.status === "sent" ? create.remote_uuid : null,
      hasCreate: !!create,
      mine: !!viewer.staffId && r.author_id === viewer.staffId,
      taskId: r.task_id ?? null,
      isTaskDone: r.is_task_done === true,
    });
  }
  return out;
}

async function readOurJobNotesWithSm8(
  orgId: string,
  jobUuid: string,
  limit: number,
  viewer: NotesViewer | Promise<NotesViewer | null> | null
): Promise<OurJobNote[]> {
  const rows = (await readOurRows(orgId, jobUuid, limit)).filter(drawable);
  if (rows.length === 0) return [];
  return shapeOurNotes(orgId, rows, viewer);
}

/** One of our notes, shaped as the diary draws it — the answer to a press,
    read after it. Null when it isn't this workspace's note on a job, or
    it's a removed one that draws nothing now. */
export async function readOurJobNote(
  orgId: string,
  noteId: string,
  viewer: NotesViewer | Promise<NotesViewer | null> | null
): Promise<OurJobNote | null> {
  const { data, error } = await supabaseAdmin
    .from("workboard_notes")
    .select(OUR_SM8_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", noteId)
    .eq("target_kind", "job")
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as OurRow & { status?: string };
  if (!drawable(row)) return null;
  const [shaped] = await shapeOurNotes(orgId, [row], viewer);
  return shaped ?? null;
}

/* ── ServiceM8's flags, with our marks on them ── */

type FlagOpRow = FlagOp & { target_uuid: string | null };

/** Our marks on these of ServiceM8's notes, newest first, in one read. */
export async function readFlagOps(orgId: string, noteUuids: readonly string[]): Promise<Map<string, FlagOpRow[]>> {
  const out = new Map<string, FlagOpRow[]>();
  const uuids = [...new Set(noteUuids)].slice(0, 100);
  if (uuids.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from("sm8_writes")
    .select("id, target_uuid, status, flag_done, seen_edit_date, landed_edit_date, requested_by, last_error, created_at")
    .eq("org_id", orgId)
    .eq("kind", "note")
    .eq("op", "update")
    .in("target_uuid", uuids)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error(`[sm8] couldn't read org ${orgId}'s marks on ServiceM8's flags:`, error);
    return out;
  }
  for (const op of (data ?? []) as unknown as FlagOpRow[]) {
    if (!op.target_uuid) continue;
    const list = out.get(op.target_uuid) ?? [];
    list.push(op);
    out.set(op.target_uuid, list);
  }
  return out;
}

/** Every flagged note's line, with our marks on it — and the ones our own
    mark still holds, which the strip leaves off (a flag we marked done is
    dealt with, until somebody changes it in ServiceM8). */
export async function readFlagStates(
  orgId: string,
  notes: readonly Pick<JobNoteEntry, "remoteId" | "flagged" | "actionRequired" | "doneBy" | "editedAt">[],
  viewer: Pick<NotesViewer, "staffId" | "state">
): Promise<{ flags: Record<string, FlagState>; held: Set<string> }> {
  const flagged = notes.filter((n) => n.flagged ?? n.actionRequired);
  const flags: Record<string, FlagState> = {};
  const held = new Set<string>();
  if (flagged.length === 0) return { flags, held };
  const ops = await readFlagOps(
    orgId,
    flagged.map((n) => n.remoteId)
  );
  const hold = viewer.state.readable ? sendHold(viewer.state, "note") : null;
  const trialNow = viewer.state.mode === "trial";
  for (const n of flagged) {
    const mine = ops.get(n.remoteId) ?? [];
    const completed = !n.actionRequired;
    const line = flagState({
      mirror: {
        flagged: true,
        completedByName: completed ? (n.doneBy ?? null) : null,
        /* read as a yes or no: somebody has marked it done, named or not */
        completedBy: completed ? "marked" : null,
        editDate: n.editedAt ?? null,
      },
      ops: mine,
      hold,
      trialNow,
      viewerStaffId: viewer.staffId,
    });
    if (line.key) flags[n.remoteId] = line;
    if (flagHeldByUs({ editDate: n.editedAt ?? null }, mine, trialNow)) held.add(n.remoteId);
  }
  return { flags, held };
}

/** One read for every name on the strip, the diary and the Documents face.
    Tolerant: a note by somebody with no staff card is unattributed, never
    dropped. */
export async function staffDisplayNames(
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
    /** The notes were already read without our own echoes (readJobNotes
        does that where the deployment sends notes), so this read would ask
        the same question twice: a card open makes exactly ONE echo read. */
    echoFiltered?: boolean;
    /* ── where the deployment sends notes (two-way phase 2, PR B) ── */
    /** The viewer's own @handle, from who they are in ServiceM8: a mention
        of them says so (`you`), and offers them a Reply. */
    viewerHandle?: string | null;
    /** HeyTiff's own notes on this job (readOurJobNotes). One that went, or
        is on its way, and names somebody is a mention for them — ServiceM8
        alerts them, and the twin it mirrors back is hidden, so HeyTiff's
        row is where the mention lives. */
    ourNotes?: readonly OurJobNote[];
    /** ServiceM8's flags our own Mark done still holds: dealt with, so off
        the strip, until somebody changes them in ServiceM8. */
    heldFlags?: ReadonlySet<string>;
  }
): Promise<JobAttentionRead> {
  const notesOn = sm8NotesAllowed();
  /* our notes that may carry a mention: queued once, not taken back — and
     never a Done. "@lukeingold Done." names Luke to address him, not to ask
     him anything: the task it closes was made from HIS note, so it answers
     a mention and is none (PR C). Still none after its task is deleted: the
     mark stays when the link goes. A reply that closed its task is a reply,
     and a mention like any other. */
  const ourMentions = notesOn ? (input.ourNotes ?? []).filter((n) => n.hasCreate && !n.removed && !n.isTaskDone) : [];
  /* ONE read of the asks Tiff made tasks of on this job serves both: their
     tasks are this job's tasks, and their notes are answered. */
  const asks = askedOnJob(orgId, jobUuid);
  const [flags, taskIds, answered, people, assignable, ours, repliedTo] = await Promise.all([
    readJobFlags(orgId, jobUuid),
    noteBornTaskIds(orgId, jobUuid, asks),
    answeredNotes(orgId, jobUuid, asks),
    readMentionPeople(orgId),
    mentionableStaff(orgId),
    /* notes HeyTiff wrote itself, mirrored back (lib/integrations/sm8-echo) */
    input.echoFiltered
      ? Promise.resolve(new Set<string>())
      : sm8Ours(
          orgId,
          input.notes.map((n) => n.remoteId)
        ),
    /* ANSWERED BY A REPLY: worked out from the replies themselves, never a
       job_note_actions row (a reply is not a decision about the note, and
       one note can have many). Only where the deployment sends notes. */
    notesOn
      ? answeredByReply(orgId, [
          ...input.notes.map((n) => n.remoteId),
          ...ourMentions.map((n) => n.sm8Uuid).filter((u): u is string => !!u),
        ])
      : Promise.resolve(new Set<string>()),
  ]);
  const tasks = await openTasks(orgId, taskIds);

  const handles = [...people.keys()];
  const held = input.heldFlags ?? new Set<string>();
  const attention = buildJobAttention({
    flags,
    tasks,
    /* a flag our own mark holds is dealt with: off the strip altogether,
       mention and all, as a flag somebody answered is */
    notes: input.notes.filter((n) => !(n.actionRequired && held.has(n.remoteId))).map((n) => ({
      remoteId: n.remoteId,
      text: n.text,
      author: n.writtenBy,
      at: n.writtenAt,
      actionRequired: n.actionRequired,
      /* who a note mentions is read from its words, ours or not */
      handles: mentionedHandles(n.text, handles),
      ours: ours.has(n.remoteId),
    })),
    ours: ourMentions.map(
      (n): AttentionOurNote => ({
        rowId: n.id,
        noteUuid: n.sm8Uuid ?? null,
        text: n.text,
        author: n.author,
        at: n.at,
        handles: mentionedHandles(n.text, handles),
      })
    ),
    /* undefined without notes: the items are exactly today's */
    viewerHandle: notesOn ? (input.viewerHandle ?? null) : undefined,
    jobOpen: input.jobOpen,
    answered: repliedTo.size > 0 ? new Set([...answered, ...repliedTo]) : answered,
    people,
    today: input.today,
  });

  return { attention, assignable };
}

/** Which of these notes somebody has replied to from HeyTiff, with a reply
    that hasn't been taken back. The uuids ride in the URL, so they go fifty
    at a time (sm8-echo's measure). */
async function answeredByReply(orgId: string, uuids: readonly string[]): Promise<Set<string>> {
  const wanted = [...new Set(uuids.filter(Boolean))];
  const out = new Set<string>();
  for (let i = 0; i < wanted.length; i += 50) {
    const { data, error } = await supabaseAdmin
      .from("workboard_notes")
      .select("reply_to_sm8_note_uuid")
      .eq("org_id", orgId)
      .in("reply_to_sm8_note_uuid", wanted.slice(i, i + 50))
      .is("removed_at", null);
    if (error) return out;
    for (const r of (data ?? []) as { reply_to_sm8_note_uuid: string | null }[]) {
      if (r.reply_to_sm8_note_uuid) out.add(r.reply_to_sm8_note_uuid);
    }
  }
  return out;
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

    Three sources, because a task about this job can be born three ways:
    through the review card (`workboard_notes.applied.taskIds`), straight
    off one of ServiceM8's own notes on the strip (`job_note_actions.task_id`),
    or by Tiff, from a note on it that asked somebody something
    (`mention_asks.task_id`, the new Home's one task per ask). */
async function noteBornTaskIds(orgId: string, jobUuid: string, asks: Promise<JobAsk[]>): Promise<string[]> {
  const [{ data: notes }, { data: acts }, asked] = await Promise.all([
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
    asks,
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
  for (const a of asked) if (a.taskId) ids.add(a.taskId);
  return [...ids];
}

/** An ask on this job that Tiff made a task of. */
type JobAsk = { noteUuid: string; taskId: string | null };

/** THE ASKS ON THIS JOB THAT BECAME TASKS (docs/migrations/mention_asks.sql).
    Read whatever became of the task since: one deleted is still an ask
    somebody dealt with, and the strip doesn't offer it again, as a deleted
    task's job_note_actions row doesn't. An ask read as asking nothing is
    not here, and the strip may still offer it to whoever it names. Before
    the table exists, or when the read fails, there are none: the strip is
    what it was. */
async function askedOnJob(orgId: string, jobUuid: string): Promise<JobAsk[]> {
  const { data, error } = await supabaseAdmin
    .from("mention_asks")
    .select("sm8_note_uuid, task_id")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .eq("status", "read")
    .in("kind", ["do", "question"])
    .limit(500);
  if (error) return [];
  return ((data ?? []) as { sm8_note_uuid: string; task_id: string | null }[]).map((r) => ({
    noteUuid: r.sm8_note_uuid,
    taskId: r.task_id,
  }));
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

/** ServiceM8 notes on this job that somebody has already dealt with — on
    the strip, or by Tiff, who made the ask a task (its task shows as a
    task row instead). */
async function answeredNotes(orgId: string, jobUuid: string, asks: Promise<JobAsk[]>): Promise<Set<string>> {
  const [{ data }, asked] = await Promise.all([
    supabaseAdmin
      .from("job_note_actions")
      .select("sm8_note_uuid")
      .eq("org_id", orgId)
      .eq("sm8_job_uuid", jobUuid)
      .limit(500),
    asks,
  ]);
  return new Set([
    ...((data ?? []) as { sm8_note_uuid: string }[]).map((r) => r.sm8_note_uuid),
    ...asked.map((a) => a.noteUuid),
  ]);
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
export async function readMentionPeople(
  orgId: string
): Promise<Map<string, { name: string; staffId: string | null }>> {
  const [roster, linked] = await Promise.all([sm8Roster(orgId), sm8StaffLinkMap(orgId)]);

  const map = new Map<string, { name: string; staffId: string | null }>();
  for (const s of roster) map.set(s.handle, { name: s.name, staffId: linked.get(s.uuid) ?? null });
  return map;
}

/** A ServiceM8 staff member as a note can name them. */
export type Sm8Person = {
  uuid: string;
  /** What a note writes after the "@" — see sm8Handle. */
  handle: string;
  /** "Luke Ingold", as ServiceM8 spells it. */
  name: string;
  /** "Luke", for a line that says "You to Luke". */
  first: string;
};

/** EVERY HANDLE IN THE ACCOUNT, and whose it is — the one read both the
    job card's strip (through readMentionPeople) and the Home diary name
    people from, so the two can never spell a person differently.

    A row with no name to build a handle from is left out: it can never be
    mentioned, and an empty handle would match every bare "@". */
export async function sm8Roster(orgId: string): Promise<Sm8Person[]> {
  const { data } = await supabaseAdmin
    .from("sm8_staff")
    .select("uuid, first, last")
    .eq("org_id", orgId)
    .limit(500);

  const out: Sm8Person[] = [];
  for (const s of (data ?? []) as { uuid: string; first: string | null; last: string | null }[]) {
    const handle = sm8Handle(s.first, s.last);
    if (!handle) continue;
    const first = (s.first ?? "").trim();
    const name = `${first} ${(s.last ?? "").trim()}`.trim();
    if (!name) continue;
    out.push({ uuid: s.uuid, handle, name, first: first || name });
  }
  return out;
}
