"use server";

/* A TASK'S DONE, TO SERVICEM8 AND BACK (two-way phase 2, PR C).

   Luke writes "@isaacsmith can you order the grilles" in ServiceM8, and a
   task is made from it on the job card's strip (job_note_actions records
   which note it came from). When Isaac ticks that task by hand, HeyTiff:
   - files a Done in the job's diary, "@lukeingold Done.", threaded under
     Luke's note — one of HeyTiff's own rows (workboard_notes), marked
     is_task_done and linked to the task;
   - sends the same words to ServiceM8 as Isaac, through the one door a note
     is queued by (sm8-note-queue).
   Reopen takes it back: if it hadn't gone, it never goes; if it went, it is
   taken out of ServiceM8. The task's page and the bell say what happened
   (lib/dashboard/task-done-query).

   THE RULES:
   - PRODUCTION SENDS FILES ONLY (SM8_WRITES=1), and nothing about notes may
     change there until Isaac's phase-1 live walk: every action here answers
     before its first read unless the deployment sends notes.
   - CODE NEVER POSTS A DONE. Only a person's tick does, and only for their
     own tick (the task's done_by), only when notes are offered, and only
     with Workboard access. A retry re-presses only the row its line shows,
     and never makes one. Deleting a task never touches its Done.
   - ONE DONE PER TASK. Two ticks, two tabs or a retry racing a tick make one
     Done: the database's one-Done index (task_done_sm8.sql) refuses a
     second live one.
   - ONLY WHOEVER SENT A DONE TAKES IT BACK — except in the one race where
     it doesn't matter who reopened: a Reopen that lands while the tick is
     still filing its Done. Then the TICKER'S OWN PRESS takes its Done back
     (sendTaskDone, step 9), so a Done is posted only for a tick that still
     stands once it is queued.
   - A REPLY THAT CLOSED ITS TASK IS NEVER TAKEN BACK BY REOPEN: it is a real
     reply, with its own words. It stands for the task while the task is
     done, so the task line shows it, and its failure can be retried here.

   Surface-neutral: ids in, states out. The Home redesign calls these as
   they are. */

import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { sm8PressFromSession, type Sm8Press } from "@/lib/integrations/sm8-press";
import { sm8NotesAllowed } from "@/lib/integrations/sm8-kinds";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { DONE_TTL_MS, offersSend, sendRefusal, type Sm8WriteState } from "@/lib/integrations/sm8-write-plan";
import { sm8NoteSender, type NoteSender } from "@/lib/integrations/links";
import { noteAskerOf, noteSourceOf } from "@/lib/integrations/sm8-note-source";
import { DONE_PRESS_BUDGET_MS, settlePressedWrites } from "@/lib/integrations/sm8-drain";
import {
  doneText,
  NOTE_WORDS,
  pressRefusalWords,
  type NoteRefusal,
  type NoteState,
} from "@/lib/integrations/sm8-note-plan";
import { readOurJobNote, staffDisplayNames, type NotesViewer } from "@/lib/workboard/job-notes-query";
import { queueNoteCreate, queueNoteTakeBack } from "./sm8-note-queue";

export type TaskDoneResult =
  /** `state`: the Done's line (or the reply's) as the presser now reads it,
      null when it says nothing. `note`: said to the presser although the
      press stood — a Reopen that couldn't take back somebody else's Done. */
  | { ok: true; state: NoteState | null; note?: string }
  | { ok: false; error: string };

/** Nothing to do, and nothing to say: notes aren't sent here, the viewer
    can't open the Workboard, or the task isn't one a Done belongs to. */
const QUIET: TaskDoneResult = { ok: true, state: null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (v: unknown) => (typeof v === "string" && UUID.test(v.trim()) ? v.trim() : null);

/* ── the gates ── */

type Gated = { ok: true; orgId: string; press: Sm8Press } | { ok: false; result: TaskDoneResult };

/** After the deployment's own switch (every action checks that first, with
    no read): the session, the Workboard, and a press minted from the
    session. Without the Workboard nothing is said — a tick by somebody who
    can't open the board simply posts nothing. */
async function gate(): Promise<Gated> {
  const press = await sm8PressFromSession();
  if (!press) return { ok: false, result: { ok: false, error: "Not signed in." } };
  if (!(await can("workboard"))) return { ok: false, result: QUIET };
  return { ok: true, orgId: press.orgId, press };
}

/* ── the rows ── */

type TaskRow = { id: string; status: string; done_by: string | null; done_at: string | null };

async function readTask(orgId: string, taskId: string): Promise<TaskRow | null> {
  const { data } = await supabaseAdmin
    .from("tasks")
    .select("id, status, done_by, done_at")
    .eq("org_id", orgId)
    .eq("id", taskId)
    .maybeSingle();
  return (data as TaskRow | null) ?? null;
}

/** The ServiceM8 note a task was made from, and the job the card was for. */
async function mentionOf(orgId: string, taskId: string): Promise<{ sm8_note_uuid: string; sm8_job_uuid: string } | null> {
  const { data } = await supabaseAdmin
    .from("job_note_actions")
    .select("sm8_note_uuid, sm8_job_uuid")
    .eq("org_id", orgId)
    .eq("task_id", taskId)
    .eq("action", "task")
    .limit(1)
    .maybeSingle();
  const a = data as { sm8_note_uuid: string | null; sm8_job_uuid: string | null } | null;
  return a?.sm8_note_uuid && a.sm8_job_uuid ? { sm8_note_uuid: a.sm8_note_uuid, sm8_job_uuid: a.sm8_job_uuid } : null;
}

/** THE TASK'S DONE: its one row marked is_task_done that hasn't been taken
    back — the one-Done index allows only one. A reply that closed the task
    (linked, not marked) is never it. */
async function liveDoneOf(orgId: string, taskId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("workboard_notes")
    .select("id")
    .eq("org_id", orgId)
    .eq("task_id", taskId)
    .eq("is_task_done", true)
    .is("removed_at", null)
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** The presser, as a line reads them — read only when a line is asked for. */
function viewerFor(orgId: string, press: Sm8Press, state?: Sm8WriteState): () => Promise<NotesViewer> {
  let v: Promise<NotesViewer> | null = null;
  return () =>
    (v ??= (async () => {
      const s = state ?? (await readSm8WriteState(orgId));
      const sender: NoteSender = await sm8NoteSender(orgId, press.staffId, s.tenantId ?? undefined);
      return { staffId: press.staffId, state: s, sender };
    })());
}

/** One row's line, as the presser now reads it: the diary's own reader. */
async function lineOf(orgId: string, noteId: string, viewer: () => Promise<NotesViewer>): Promise<NoteState | null> {
  const note = await readOurJobNote(orgId, noteId, viewer());
  return note?.state ?? null;
}

/** Who a row's create was pressed by, or with no create its author: the one
    person who may take it back. */
async function senderNameOf(orgId: string, noteId: string): Promise<string | null> {
  const [{ data: create }, { data: row }] = await Promise.all([
    supabaseAdmin
      .from("sm8_writes")
      .select("requested_by")
      .eq("org_id", orgId)
      .eq("kind", "note")
      .eq("op", "create")
      .eq("note_id", noteId)
      .maybeSingle(),
    supabaseAdmin.from("workboard_notes").select("author_id").eq("org_id", orgId).eq("id", noteId).maybeSingle(),
  ]);
  const who =
    (create as { requested_by: string | null } | null)?.requested_by ?? (row as { author_id: string | null } | null)?.author_id ?? null;
  if (!who) return null;
  return (await staffDisplayNames(orgId, [who])).get(who) ?? null;
}

/** A queue helper's refusal, in the words the job card says it in. */
async function refusalWords(
  orgId: string,
  press: Sm8Press,
  code: NoteRefusal,
  doing: "send" | "take_back",
  noteId: string,
  state?: Sm8WriteState | null
): Promise<string> {
  /* the name the question and the refusal carry is the presser's own */
  const sm8Name =
    code === "confirm" || code === "denied" || code === "inactive" ? await sm8NameOfPresser(orgId, press) : null;
  const owner = code === "not_yours" && doing === "take_back" ? await senderNameOf(orgId, noteId) : null;
  const notOffered = code === "not_offered" && doing === "send" && state ? sendRefusal(state, "note") : null;
  return pressRefusalWords(code, { doing, sm8Name, owner, notOffered });
}

async function sm8NameOfPresser(orgId: string, press: Sm8Press): Promise<string | null> {
  const s = await sm8NoteSender(orgId, press.staffId);
  return "sm8Name" in s ? s.sm8Name : null;
}

/** The take-back rows a press just queued for this note, to send them in
    the foreground for a moment. */
async function takeBackRowIds(orgId: string, noteId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("sm8_writes")
    .select("id")
    .eq("org_id", orgId)
    .eq("kind", "note")
    .eq("op", "delete")
    .eq("note_id", noteId)
    .eq("status", "queued");
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

/** The press's rows, sent in the foreground for up to the tick's budget,
    then the drain. A tick waits at most DONE_PRESS_BUDGET_MS; the rest goes
    behind the answer. */
async function settle(orgId: string, ids: readonly string[], startedAt: number): Promise<void> {
  await settlePressedWrites(orgId, ids, { startedAt, budgetMs: DONE_PRESS_BUDGET_MS }).catch((err: unknown) => {
    console.error(`[sm8] a Done for org ${orgId} couldn't settle: ${err instanceof Error ? err.message : String(err)}`);
  });
}

/* ── ticking ── */

/** POST THE DONE FOR A TICK: the person who just ticked a task made from a
    ServiceM8 mention files "@<asker> Done." in the job's diary, and it goes
    to ServiceM8 as them. completeTask calls this after it won the tick, and
    only for a hand tick (`postDone`) where the deployment sends notes.

    Quiet — nothing made, nothing said — unless the task is done, by this
    person, just now; it was made from a mention; and notes are offered (or
    the settings can't be read, when the Done is saved and says why). */
export async function sendTaskDone(input: { taskId: string }): Promise<TaskDoneResult> {
  if (!sm8NotesAllowed()) return QUIET;
  const startedAt = Date.now();
  const g = await gate();
  if (!g.ok) return g.result;
  const { orgId, press } = g;
  const taskId = idOf(input?.taskId);
  if (!taskId || !press.staffId) return QUIET;

  /* 1. the task is done, and this person ticked it: only whoever ticked
     sends their own Done. And it was a tick just now — a Done is a tick's
     answer, never a note posted a day later by a direct call. */
  const task = await readTask(orgId, taskId);
  if (!task || task.status !== "done" || task.done_by !== press.staffId) return QUIET;
  const doneAt = task.done_at ? Date.parse(task.done_at) : NaN;
  if (Number.isNaN(doneAt) || Date.now() - doneAt > DONE_TTL_MS) return QUIET;

  /* 2. it was made from a mention: the note it answers, and the job */
  const mention = await mentionOf(orgId, taskId);
  if (!mention) return QUIET;

  /* 3. the settings. Notes switched off is the owner's choice, not a
     failure: no row. Settings that can't be read go on — the Done is
     saved, and says why (record first). */
  const state = await readSm8WriteState(orgId);
  if (state.readable && !offersSend(state, "note")) return QUIET;
  const viewer = viewerFor(orgId, press, state);

  /* 4. the task already has a Done that hasn't been taken back, whatever
     its state: that one stands (a failed one is re-pressed only through its
     own line). A Done taken back doesn't count — this tick makes a new one,
     and the old one keeps its own line while it may still be there. */
  const existing = await liveDoneOf(orgId, taskId);
  if (existing) return { ok: true, state: await lineOf(orgId, existing, viewer) };

  /* 5. who asked, and 6. who it goes as: "@lukeingold Done.", or plain
     "Done." when nobody can be named or the asker is the sender */
  const source = await noteSourceOf(orgId, mention.sm8_note_uuid);
  const asker = source ? await noteAskerOf(orgId, mention.sm8_note_uuid, source) : null;
  const { sender } = await viewer();
  const text = doneText(asker, sender && "remoteId" in sender ? sender.remoteId : null);

  /* 7. RECORD FIRST: the Done, in the job's diary, under Luke's note */
  const noteId = randomUUID();
  const { error } = await supabaseAdmin.from("workboard_notes").insert({
    id: noteId,
    org_id: orgId,
    author_id: press.staffId,
    target_kind: "job",
    target_id: mention.sm8_job_uuid,
    transcript: text,
    source: "text",
    status: "applied",
    applied: { jobNotes: [text], sm8Text: text },
    applied_at: new Date().toISOString(),
    reply_to_sm8_note_uuid: mention.sm8_note_uuid,
    task_id: taskId,
    is_task_done: true,
  });
  if (error) {
    /* another tick, tab or retry made the Done first (the one-Done index):
       that one stands */
    if (error.code === "23505") {
      const first = await liveDoneOf(orgId, taskId);
      return { ok: true, state: first ? await lineOf(orgId, first, viewer) : null };
    }
    /* the task was deleted in between (its key): nothing to answer */
    if (error.code === "23503") return QUIET;
    console.error(`[sm8] couldn't file the Done of task ${taskId} for org ${orgId}:`, error);
    return { ok: false, error: NOTE_WORDS.press.unqueued };
  }

  /* 8. queue it. A refusal stays on the row (record first), so the line
     and the bell say why; a Reopen that took this Done back while it was
     queueing is settled inside the helper. */
  const queued = await queueNoteCreate(press, { noteId });

  /* 9. READ THE TASK AGAIN (decision 11). Reopened while this ran — by
     anyone: their take-back found no Done yet, or found it and wasn't its
     sender — so this press takes its own Done back, by id. A task that is
     done again, by anyone, keeps it: the tick it stands for is done. */
  const again = await readTask(orgId, taskId);
  if (again?.status === "open") {
    const back = await queueNoteTakeBack(press, { noteId });
    const ids = back.ok && back.plan === "deleting" ? await takeBackRowIds(orgId, noteId) : [];
    await settle(orgId, ids, startedAt);
    return { ok: true, state: await lineOf(orgId, noteId, viewer) };
  }

  /* 10. send it now, for a moment; the rest goes behind the answer */
  if (queued.ok) await settle(orgId, queued.rowIds, startedAt);
  return { ok: true, state: await lineOf(orgId, noteId, viewer) };
}

/* ── reopening ── */

/** TAKE THE TASK'S DONE BACK, for a Reopen: if it hadn't gone, it never
    goes; if it went, it is taken out of ServiceM8. Only whoever sent it —
    anyone else's Reopen still reopens the task, and is told whose Done it
    is (`note`). A reply that closed the task is never taken back here. A
    Done this misses, because the tick filed it after this read, is taken
    back by the tick itself (sendTaskDone, step 9) or by the queue helper. */
export async function takeBackTaskDone(input: { taskId: string }): Promise<TaskDoneResult> {
  if (!sm8NotesAllowed()) return QUIET;
  const startedAt = Date.now();
  const g = await gate();
  if (!g.ok) return g.result;
  const { orgId, press } = g;
  const taskId = idOf(input?.taskId);
  if (!taskId) return QUIET;

  const noteId = await liveDoneOf(orgId, taskId);
  if (!noteId) return QUIET;
  const viewer = viewerFor(orgId, press);

  const r = await queueNoteTakeBack(press, { noteId });
  if (!r.ok && r.refusal === "not_yours") {
    return {
      ok: true,
      state: await lineOf(orgId, noteId, viewer),
      note: await refusalWords(orgId, press, "not_yours", "take_back", noteId),
    };
  }
  if (!r.ok) {
    /* nothing changed (it went since), or it was taken back and only its
       delete couldn't queue: the line now says "Still in ServiceM8", with
       Try again */
    return { ok: false, error: await refusalWords(orgId, press, r.refusal, "take_back", noteId) };
  }
  const ids = r.plan === "deleting" ? await takeBackRowIds(orgId, noteId) : [];
  await settle(orgId, ids, startedAt);
  return { ok: true, state: await lineOf(orgId, noteId, viewer) };
}

/* ── the task line's doors ── */

/** TRY AGAIN, FROM THE TASK'S LINE, on the row that line shows (`noteId`):
    - `send_again`: Send again or Try again on a Done (or a closing reply)
      that failed, was refused or may not have gone; the retry after Yes.
      That row goes again under its own subject and in its own words — a
      failed reply is sent again as the reply, and no Done is made. Only its
      author.
    - `take_out_again`: Try again on a line that reads "Still in
      ServiceM8". Only whoever sent it.
    It never makes a row and never posts a Done a tick didn't make. A row
    that isn't one of this task's lines is quiet. */
export async function retryTaskDone(input: {
  taskId: string;
  noteId: string;
  act: "send_again" | "take_out_again";
}): Promise<TaskDoneResult> {
  if (!sm8NotesAllowed()) return QUIET;
  const startedAt = Date.now();
  const g = await gate();
  if (!g.ok) return g.result;
  const { orgId, press } = g;
  const taskId = idOf(input?.taskId);
  const noteId = idOf(input?.noteId);
  const act = input?.act;
  if (!taskId || !noteId || (act !== "send_again" && act !== "take_out_again")) return QUIET;

  /* the row must be one of this task's lines: its Done, a Done taken back,
     or the reply that closed it */
  const { data } = await supabaseAdmin
    .from("workboard_notes")
    .select("id, task_id")
    .eq("org_id", orgId)
    .eq("id", noteId)
    .maybeSingle();
  if ((data as { task_id: string | null } | null)?.task_id !== taskId) return QUIET;
  const viewer = viewerFor(orgId, press);

  if (act === "send_again") {
    const q = await queueNoteCreate(press, { noteId });
    if (!q.ok) {
      const { state } = await viewer();
      return { ok: false, error: await refusalWords(orgId, press, q.refusal, "send", noteId, state) };
    }
    await settle(orgId, q.rowIds, startedAt);
    return { ok: true, state: await lineOf(orgId, noteId, viewer) };
  }

  const r = await queueNoteTakeBack(press, { noteId });
  if (!r.ok) return { ok: false, error: await refusalWords(orgId, press, r.refusal, "take_back", noteId) };
  const ids = r.plan === "deleting" ? await takeBackRowIds(orgId, noteId) : [];
  await settle(orgId, ids, startedAt);
  return { ok: true, state: await lineOf(orgId, noteId, viewer) };
}
