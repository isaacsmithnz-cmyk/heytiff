"use server";

/* QUEUEING A NOTE FOR SERVICEM8 — the one door (two-way phase 2, PR A).

   The job card's actions (PR B) and the task's (PR C) call these, and
   nothing else queues a note: a test holds that only this file passes
   `kind: "note"` to the queue (sm8-press.test). Each helper takes a PRESS
   (lib/integrations/sm8-press): a browser can POST to a Server Function,
   but a browser's copy of a press is a plain object, and isSm8Press
   refuses it. Nothing the browser sends decides what goes or where: the
   words and the object come from HeyTiff's own row, and from the create
   once there is one.

   THE RULES, whichever door a person pressed:
   - RECORD FIRST. HeyTiff's own row is saved before anything is queued. A
     refusal at queue time is kept on the row (sm8_refusal) only when it is
     the newest word on whether the note goes: no create yet, or one that
     failed, was cancelled or was a trial. A create that is waiting, going
     or gone reports for itself.
   - ONLY WHOEVER PRESSED A NOTE CAN PRESS IT AGAIN OR TAKE IT BACK — every
     helper checks it FIRST, on every path, a removed row's Try again
     included; the queue checks it again (`others`), and so does the sender.
   - A TAKE-BACK IS FINAL. Undo closes the create (taken_back_at) whatever
     state it is in, and removes HeyTiff's row (removed_at, a tombstone)
     before it asks anything of ServiceM8. What may be there is deleted by a
     separate delete row, one per create. The row is never deleted.
   - EVERY RACE BETWEEN A PRESS AND A TAKE-BACK ENDS TAKEN BACK. Each side
     writes first and then reads what the other wrote: a Send queues, then
     reads removed_at; a take-back sets removed_at, then reads the create. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { isSm8Press, type Sm8Press } from "@/lib/integrations/sm8-press";
import { enqueueSm8Writes, readSm8WriteState, type Sm8WriteToQueue } from "@/lib/integrations/sm8-writes";
import { sm8NoteSender, type NoteSender } from "@/lib/integrations/links";
import { noteSourceOf } from "@/lib/integrations/sm8-note-source";
import { familyMediaSources } from "@/lib/workboard/all-jobs-query";
import { offersSend, sendHold, type Sm8WriteState } from "@/lib/integrations/sm8-write-plan";
import {
  createCanStillGo,
  FLAG_UNDO_AFTER_SENT,
  flagHeldByUs,
  isStoredRefusal,
  mayHaveLanded,
  noteLabel,
  noteState,
  noteSubject,
  noteWords,
  NOTE_WORDS,
  planNeedsSm8,
  sameEditDate,
  undoPlan,
  type CreateRow,
  type FlagOp,
  type NoteRefusal,
  type QueueRowIn,
  type StoredRefusal,
} from "@/lib/integrations/sm8-note-plan";

export type QueueResult = { ok: true; rowIds: string[]; already: boolean } | { ok: false; refusal: NoteRefusal };

export type TakeBackResult =
  | { ok: true; plan: "nothing" | "cancelled" | "deleting" | "already"; removed: true }
  /** nothing was changed */
  | { ok: false; refusal: "no_note" | "not_yours"; removed: false }
  /** the row is removed and its create closed; only the delete couldn't queue */
  | { ok: false; refusal: "unreadable" | "not_offered" | "unqueued" | "capped"; removed: true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRITES = "sm8_writes";
const NOTES = "workboard_notes";

type NoteRow = {
  id: string;
  target_kind: string;
  target_id: string | null;
  status: string;
  author_id: string | null;
  applied: unknown;
  removed_at: string | null;
  sm8_refusal: string | null;
  reply_to_sm8_note_uuid: string | null;
  task_id: string | null;
  is_task_done: boolean | null;
};

const NOTE_COLUMNS =
  "id, target_kind, target_id, status, author_id, applied, removed_at, sm8_refusal, reply_to_sm8_note_uuid, task_id, is_task_done";

type Create = CreateRow &
  QueueRowIn & {
    subject: string;
    sm8_job_uuid: string | null;
    tenant_id: string;
    requested_by: string | null;
    taken_back_at: string | null;
  };

const CREATE_COLUMNS =
  "id, subject, sm8_job_uuid, tenant_id, requested_by, status, lease_until, remote_uuid, maybe_landed, verify_uuids, taken_back_at, last_error, attempts";

async function readNote(orgId: string, noteId: string): Promise<NoteRow | null | "failed"> {
  const { data, error } = await supabaseAdmin
    .from(NOTES)
    .select(NOTE_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", noteId)
    .maybeSingle();
  if (error) return "failed";
  return (data as unknown as NoteRow | null) ?? null;
}

async function readCreate(orgId: string, noteId: string): Promise<Create | null | "failed"> {
  const { data, error } = await supabaseAdmin
    .from(WRITES)
    .select(CREATE_COLUMNS)
    .eq("org_id", orgId)
    .eq("kind", "note")
    .eq("op", "create")
    .eq("note_id", noteId)
    .maybeSingle();
  if (error) return "failed";
  return (data as unknown as Create | null) ?? null;
}

async function readCreateById(orgId: string, id: string): Promise<Create | null> {
  const { data } = await supabaseAdmin.from(WRITES).select(CREATE_COLUMNS).eq("org_id", orgId).eq("id", id).maybeSingle();
  return (data as unknown as Create | null) ?? null;
}

async function readTakeBack(orgId: string, createId: string): Promise<QueueRowIn | null> {
  const { data } = await supabaseAdmin
    .from(WRITES)
    .select("id, status, lease_until, remote_uuid, maybe_landed, verify_uuids, last_error, attempts")
    .eq("org_id", orgId)
    .eq("kind", "note")
    .eq("op", "delete")
    .eq("depends_on", createId)
    .limit(1)
    .maybeSingle();
  return (data as unknown as QueueRowIn | null) ?? null;
}

/** Keep (or clear) why a note didn't queue. A database without the column
    only logs. */
async function storeRefusal(orgId: string, noteId: string, code: StoredRefusal | null): Promise<void> {
  const { error } = await supabaseAdmin.from(NOTES).update({ sm8_refusal: code }).eq("org_id", orgId).eq("id", noteId);
  if (error) console.error(`[sm8] couldn't keep why note ${noteId} didn't queue for org ${orgId}:`, error);
}

/** The code a sender that isn't ready answers with. */
function senderRefusal(s: NoteSender): StoredRefusal | null {
  switch (s.state) {
    case "ready":
      return null;
    case "unlinked":
      return s.noCard ? "no_card" : "unlinked";
    case "bad_link":
      return "bad_link";
    default:
      return s.state;
  }
}

/** Whether a job (or claim) is active in the mirror: nothing goes to one
    its own business deleted. */
async function objectIsReal(orgId: string, uuid: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid")
    .eq("org_id", orgId)
    .eq("uuid", uuid)
    .eq("active", 1)
    .maybeSingle();
  return !!data;
}

/** A create could still reach, or be in, ServiceM8. */
const createMayBeThere = (c: Create) => c.status === "sending" || c.status === "sent" || mayHaveLanded(c);

/* ── stopping a create, and taking out what went ── */

/** Close a create and stop it if it could still go. Needs no ServiceM8
    call, and checks nothing but what its caller already checked (who):
    1. taken_back_at = now where null — from here it is never claimed, no
       press can queue it again, and a sender holding it stops at its next
       POST attempt;
    2. read again;
    3. if it could still go (queued, failed, trial, a lapsed send), cancel
       it on the status read, leaving maybe_landed and verify_uuids for the
       delete. A miss reads it again.
    Returns the create as it now stands. */
async function stopCreate(orgId: string, create: Create, now: number): Promise<Create> {
  const iso = new Date(now).toISOString();
  await supabaseAdmin.from(WRITES).update({ taken_back_at: iso }).eq("org_id", orgId).eq("id", create.id).is("taken_back_at", null);
  let current = (await readCreateById(orgId, create.id)) ?? create;
  for (let tries = 0; tries < 3 && createCanStillGo(current, now); tries++) {
    let q = supabaseAdmin
      .from(WRITES)
      .update({
        status: "cancelled",
        last_error: NOTE_WORDS.row.takenBackBeforeSent,
        lease_until: null,
        claim_id: null,
        updated_at: iso,
      })
      .eq("org_id", orgId)
      .eq("id", current.id)
      .eq("status", current.status);
    if (current.status === "sending") q = q.lt("lease_until", iso);
    const { data } = await q.select("id");
    current = (await readCreateById(orgId, current.id)) ?? current;
    if ((data ?? []).length > 0) break;
  }
  return current;
}

type DeleteQueued = { ok: true; ids: string[]; already: boolean } | { ok: false; refusal: NoteRefusal };

/** Queue the take-back of what of `create` may be in ServiceM8, as this
    press. WHO FIRST, whatever the caller checked: only the create's own
    presser. The link is NOT checked here — whether the presser can still
    act in ServiceM8 is checked when the delete goes, and a refusal then
    fails that row, which offers Try again. One delete row per create
    (`undo:<createId>`); a failed, trial or cancelled one is queued again
    under the same subject. */
async function queueDelete(
  press: Sm8Press,
  note: { id: string },
  create: Create,
  state: Sm8WriteState
): Promise<DeleteQueued> {
  if ((create.requested_by ?? null) !== press.staffId) return { ok: false, refusal: "not_yours" };
  if (!state.readable) return { ok: false, refusal: "unreadable" };
  if (!offersSend(state, "note")) return { ok: false, refusal: "not_offered" };
  const write: Sm8WriteToQueue = {
    kind: "note",
    op: "delete",
    jobUuid: create.sm8_job_uuid,
    subject: noteSubject.undo(create.id),
    payload: { name: noteLabel("take_back") },
    ref: create.id,
    noteId: note.id,
    dependsOn: create.id,
  };
  const queued = await enqueueSm8Writes(press, state, [write]);
  if (!queued) return { ok: false, refusal: "unqueued" };
  if (queued.capped) return { ok: false, refusal: "capped" };
  if (queued.others?.includes(create.id)) return { ok: false, refusal: "not_yours" };
  return { ok: true, ids: queued.ids, already: queued.already.includes(create.id) };
}

/* ── a note, sent ── */

/** Queue HeyTiff's note for ServiceM8, as the person pressing — who must be
    its author. Serves Send to ServiceM8, Send again, and the queueing of a
    reply or a Done. */
export async function queueNoteCreate(press: Sm8Press, input: { noteId: string }): Promise<QueueResult> {
  if (!isSm8Press(press)) {
    console.error("[sm8] refused to queue a note that nobody pressed for (no press, or a stale one)");
    return { ok: false, refusal: "unqueued" };
  }
  const orgId = press.orgId;
  const noteId = typeof input?.noteId === "string" ? input.noteId.trim() : "";
  if (!UUID.test(noteId)) return { ok: false, refusal: "no_note" };

  /* 1. the note: this workspace's, on a job, applied, not taken back — and
     only its author sends it */
  const note = await readNote(orgId, noteId);
  if (note === "failed" || !note || note.target_kind !== "job" || note.status !== "applied" || note.removed_at) {
    return { ok: false, refusal: "no_note" };
  }
  if ((note.author_id ?? null) !== press.staffId) return { ok: false, refusal: "not_yours" };

  /* 2. its create, if it has one: taken back is final, a note a person
     removed in ServiceM8 is never posted again, and only its presser */
  const found = await readCreate(orgId, noteId);
  if (found === "failed") return { ok: false, refusal: "unqueued" };
  const create = found;
  if (create) {
    if (create.taken_back_at) return { ok: false, refusal: "no_note" };
    if (create.status === "cancelled" && create.last_error === NOTE_WORDS.row.noteGone) {
      return { ok: false, refusal: "removed_there" };
    }
    if ((create.requested_by ?? null) !== press.staffId) return { ok: false, refusal: "not_yours" };
    if (create.status === "sent" || create.status === "sending") return { ok: true, rowIds: [], already: true };
  }

  /* RECORD FIRST: a stored refusal is the newest word on whether the note
     goes, so it is kept only over no create, or one that failed, was
     cancelled or was a trial — never over one waiting to go */
  const storable = !create || create.status === "failed" || create.status === "cancelled" || create.status === "trial";
  const refuse = async (code: NoteRefusal): Promise<QueueResult> => {
    if (isStoredRefusal(code) && storable) await storeRefusal(orgId, noteId, code);
    return { ok: false, refusal: code };
  };

  /* 3. the settings, before "offered": unreadable settings offer nothing */
  const state = await readSm8WriteState(orgId);
  if (!state.readable) return refuse("unreadable");
  /* 4. not offered: the row is simply HeyTiff's, and its author can send
     it later — nothing stored, and a refusal already kept is cleared */
  if (!offersSend(state, "note")) {
    if (note.sm8_refusal) await storeRefusal(orgId, noteId, null);
    return { ok: false, refusal: "not_offered" };
  }

  /* 5. the words, from HeyTiff's row */
  const words = noteWords(note.applied);
  if (!words) return { ok: false, refusal: "no_note" };

  /* 6. the object: the create's own once there is one (it never changes);
     otherwise the job, or what the note it answers hangs off — this job or
     one of its claims, never anything else */
  let object: string | null = create?.sm8_job_uuid ?? null;
  if (!create) {
    if (!note.target_id) return { ok: false, refusal: "no_note" };
    if (note.reply_to_sm8_note_uuid) {
      const source = await noteSourceOf(orgId, note.reply_to_sm8_note_uuid);
      if (!source) return { ok: false, refusal: "no_note" };
      if (source.relatedUuid === note.target_id) object = note.target_id;
      else {
        const family = await familyMediaSources(orgId, note.target_id);
        if (!family.some((c) => c.remoteId === source.relatedUuid)) return refuse("job_gone");
        object = source.relatedUuid;
      }
    } else {
      object = note.target_id;
    }
  }
  if (!object || !(await objectIsReal(orgId, object))) return refuse("job_gone");

  /* 7. the person it goes as */
  const sender = await sm8NoteSender(orgId, press.staffId, state.tenantId ?? undefined);
  const notReady = senderRefusal(sender);
  if (notReady) return refuse(notReady);

  /* 8. queue it, under the create's own subject once there is one */
  const via = note.is_task_done ? "done" : note.reply_to_sm8_note_uuid ? "reply" : "diary";
  const subject =
    create?.subject ??
    (note.is_task_done ? noteSubject.done(note.task_id ?? null, noteId) : noteSubject.create(noteId));
  const queued = await enqueueSm8Writes(press, state, [
    {
      kind: "note",
      op: "create",
      jobUuid: object,
      subject,
      payload: { name: noteLabel(via) },
      ref: noteId,
      noteId,
      noteText: words,
    },
  ]);
  if (!queued) return refuse("unqueued");
  if (queued.capped) return refuse("capped");
  if (queued.others?.includes(noteId)) return { ok: false, refusal: "not_yours" };
  /* 9. queued: nothing to say any more */
  if (note.sm8_refusal) await storeRefusal(orgId, noteId, null);

  /* 10. READ THE NOTE AND ITS CREATE AGAIN. A take-back that ran while this
     press was queueing may not have seen the create: this press takes it
     back itself — it is this presser's (1 and 2 made sure). Either way a
     press racing an Undo is never told the note is on its way. */
  const after = await readNote(orgId, noteId);
  const nowCreate = await readCreate(orgId, noteId);
  const createAfter = nowCreate === "failed" ? null : nowCreate;
  if (after !== "failed" && (!after || after.removed_at)) {
    if (createAfter) {
      const stopped = await stopCreate(orgId, createAfter, Date.now());
      if (createMayBeThere(stopped)) await queueDelete(press, { id: noteId }, stopped, state);
    }
    return { ok: false, refusal: "no_note" };
  }
  if (createAfter?.taken_back_at) return { ok: false, refusal: "no_note" };
  return { ok: true, rowIds: queued.ids, already: queued.ids.length === 0 && queued.already.includes(noteId) };
}

/* ── a note, taken back ── */

/** Take a note back, whatever state it is in: Undo on a reply, Remove on a
    diary entry, Reopen's Done, and Try again on a line that reads "Still in
    ServiceM8". Rows are never deleted here, and every step is safe to run
    again. */
export async function queueNoteTakeBack(press: Sm8Press, input: { noteId: string }): Promise<TakeBackResult> {
  if (!isSm8Press(press)) {
    console.error("[sm8] refused a take-back that nobody pressed for (no press, or a stale one)");
    return { ok: false, refusal: "no_note", removed: false };
  }
  const orgId = press.orgId;
  const noteId = typeof input?.noteId === "string" ? input.noteId.trim() : "";
  if (!UUID.test(noteId)) return { ok: false, refusal: "no_note", removed: false };

  /* 1. the note */
  const note = await readNote(orgId, noteId);
  if (note === "failed" || !note || note.target_kind !== "job") return { ok: false, refusal: "no_note", removed: false };

  /* 2. WHO, FIRST AND ON EVERY PATH: its create's presser, or with no
     create its author. A removed row's Try again included. */
  const found = await readCreate(orgId, noteId);
  if (found === "failed") return { ok: false, refusal: "no_note", removed: false };
  let create = found;
  const owner = create ? create.requested_by ?? null : note.author_id ?? null;
  if (owner !== press.staffId) return { ok: false, refusal: "not_yours", removed: false };

  const state = await readSm8WriteState(orgId);
  const now = Date.now();

  /* 3. nothing left to do: removed, its create closed, and its line offers
     no door (taking it out, done, or nothing of it can be there) */
  if (note.removed_at && (!create || create.taken_back_at)) {
    const takeBack = create ? await readTakeBack(orgId, create.id) : null;
    const line = noteState({
      row: { removed: true, refusal: isStoredRefusal(note.sm8_refusal) ? note.sm8_refusal : null },
      create,
      takeBack,
      hold: state.readable ? sendHold(state, "note") : null,
      offered: offersSend(state, "note"),
      viewerIsSender: true,
      senderName: null,
      sm8Name: null,
    });
    if (!line.acts.includes("take_out_again")) return { ok: true, plan: "already", removed: true };
  }

  /* 4. stop the create — before any setting or link: it needs no ServiceM8
     call, so a note that could still go is stopped even with Notes Off */
  let plan: "nothing" | "cancelled" | "deleting" = "nothing";
  if (create) {
    const wasGoing = createCanStillGo(create, now);
    create = await stopCreate(orgId, create, now);
    if (wasGoing && create.status === "cancelled") plan = "cancelled";
  }

  /* 5. THE TOMBSTONE, at once, before anything is asked of ServiceM8 */
  const iso = new Date(now).toISOString();
  await supabaseAdmin.from(NOTES).update({ removed_at: iso }).eq("org_id", orgId).eq("id", noteId).is("removed_at", null);
  if (note.sm8_refusal) await storeRefusal(orgId, noteId, null);

  /* 6. the delete, when something of it may be in ServiceM8 */
  const takeOut = async (c: Create): Promise<TakeBackResult | null> => {
    /* sent, a send still holding its claim (it goes once that settles), or
       stopped with something of it that may have landed */
    if (!planNeedsSm8(undoPlan(c, Date.now()))) return null;
    const queued = await queueDelete(press, note, c, state);
    if (!queued.ok) {
      const refusal = queued.refusal;
      if (isStoredRefusal(refusal)) await storeRefusal(orgId, noteId, refusal);
      if (refusal === "unreadable" || refusal === "not_offered" || refusal === "unqueued" || refusal === "capped") {
        return { ok: false, refusal, removed: true };
      }
      /* not_yours can't reach here (2 checked it), but never silently */
      return { ok: false, refusal: "unqueued", removed: true };
    }
    plan = "deleting";
    return null;
  };
  if (create) {
    const refused = await takeOut(create);
    if (refused) return refused;
  } else {
    /* 7. a Send racing this take-back may have queued a create after 2
       read: it is this presser's (only the author queues a first create) */
    const late = await readCreate(orgId, noteId);
    if (late && late !== "failed") {
      const stopped = await stopCreate(orgId, late, Date.now());
      if (stopped.status === "cancelled" && createCanStillGo(late, now)) plan = "cancelled";
      const refused = await takeOut(stopped);
      if (refused) return refused;
    }
  }
  return { ok: true, plan, removed: true };
}

/* ── a ServiceM8 flag, marked done or its mark taken off ── */

async function readFlagOps(orgId: string, noteUuid: string): Promise<(FlagOp & { id: string })[] | null> {
  const { data, error } = await supabaseAdmin
    .from(WRITES)
    .select("id, status, flag_done, seen_edit_date, landed_edit_date, requested_by, last_error, created_at")
    .eq("org_id", orgId)
    .eq("kind", "note")
    .eq("op", "update")
    .eq("target_uuid", noteUuid)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return null;
  return (data ?? []) as unknown as (FlagOp & { id: string })[];
}

/** Mark one of ServiceM8's flagged notes done, as the person pressing,
    checked against the edit time they saw; or take their waiting mark back
    (with nothing checked — it works with Notes Off). */
export async function queueFlagChange(
  press: Sm8Press,
  input:
    | { noteUuid: string; done: true; seenEditDate: string | null; pressId: string }
    | { noteUuid: string; done: false; pressId: string }
): Promise<QueueResult> {
  if (!isSm8Press(press)) {
    console.error("[sm8] refused a flag change that nobody pressed for (no press, or a stale one)");
    return { ok: false, refusal: "unqueued" };
  }
  const orgId = press.orgId;
  const noteUuid = typeof input?.noteUuid === "string" ? input.noteUuid.trim() : "";
  const pressId = typeof input?.pressId === "string" ? input.pressId.trim() : "";
  if (!UUID.test(noteUuid) || !UUID.test(pressId)) return { ok: false, refusal: "no_note" };

  /* 1. one of ServiceM8's own notes */
  const source = await noteSourceOf(orgId, noteUuid);
  if (!source || source.origin !== "sm8") return { ok: false, refusal: "no_note" };
  const ops = await readFlagOps(orgId, noteUuid);
  if (!ops) return { ok: false, refusal: "unqueued" };

  /* the send checks both directions make before queueing a row */
  const sendChecks = async (state: Sm8WriteState): Promise<NoteRefusal | null> => {
    if (!state.readable) return "unreadable";
    if (!offersSend(state, "note")) return "not_offered";
    if (!(await objectIsReal(orgId, source.relatedUuid))) return "job_gone";
    return senderRefusal(await sm8NoteSender(orgId, press.staffId, state.tenantId ?? undefined));
  };
  const queue = async (state: Sm8WriteState, done: boolean, seenEditDate: string | null): Promise<QueueResult> => {
    const queued = await enqueueSm8Writes(press, state, [
      {
        kind: "note",
        op: "update",
        jobUuid: source.relatedUuid,
        subject: noteSubject.flag(noteUuid, pressId),
        payload: { name: noteLabel(done ? "flag_done" : "flag_clear") },
        ref: pressId,
        targetUuid: noteUuid,
        flagDone: done,
        seenEditDate,
        seenEditBy: done ? source.editBy : null,
      },
    ]);
    if (!queued) return { ok: false, refusal: "unqueued" };
    if (queued.capped) return { ok: false, refusal: "capped" };
    if (queued.others?.includes(pressId)) return { ok: false, refusal: "not_yours" };
    return { ok: true, rowIds: queued.ids, already: queued.ids.length === 0 };
  };

  /* 2. MARK DONE */
  if (input.done) {
    if (!sameEditDate(input.seenEditDate, source.editDate)) return { ok: false, refusal: "changed" };
    const state = await readSm8WriteState(orgId);
    const trialNow = state.mode === "trial";
    if (!source.flagged || source.completedBy || flagHeldByUs({ editDate: source.editDate }, ops, trialNow)) {
      return { ok: true, rowIds: [], already: true };
    }
    const refused = await sendChecks(state);
    if (refused) return { ok: false, refusal: refused };
    return queue(state, true, source.editDate);
  }

  /* 3. CLEAR: only the latest mark's own presser */
  for (let tries = 0; tries < 3; tries++) {
    const latest = (tries === 0 ? ops : (await readFlagOps(orgId, noteUuid)) ?? []).find((o) => o.flag_done);
    if (!latest) return { ok: false, refusal: "not_flagged" };
    if ((latest.requested_by ?? null) !== press.staffId) return { ok: false, refusal: "not_yours" };
    if (latest.status === "queued") {
      /* still waiting: cancelled, and nothing else is checked — no
         settings, no sender, no job. It works with Notes Off. */
      const { data } = await supabaseAdmin
        .from(WRITES)
        .update({
          status: "cancelled",
          last_error: NOTE_WORDS.row.takenBackBeforeSent,
          lease_until: null,
          updated_at: new Date().toISOString(),
        })
        .eq("org_id", orgId)
        .eq("id", latest.id)
        .eq("status", "queued")
        .select("id");
      if ((data ?? []).length > 0) return { ok: true, rowIds: [], already: false };
      continue; /* it moved: read it again, and go on from what it is now */
    }
    if (latest.status === "sending") return { ok: false, refusal: "in_flight" };
    if (latest.status === "sent" && FLAG_UNDO_AFTER_SENT) {
      const state = await readSm8WriteState(orgId);
      const refused = await sendChecks(state);
      if (refused) return { ok: false, refusal: refused };
      /* checked by the sender against the edit time our mark LEFT: a mark
         somebody has since changed in ServiceM8 is never cleared */
      return queue(state, false, latest.landed_edit_date ?? null);
    }
    /* a trial (nothing was sent), a mark that went (and can't be taken back
       yet), one that failed or was cancelled */
    return { ok: false, refusal: "not_flagged" };
  }
  return { ok: false, refusal: "unqueued" };
}
