"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";
import { staffIdFor } from "@/lib/workboard/projects-query";
import type { OurJobNote } from "@/lib/workboard/job-notes-query";
import { sm8NotesAllowed } from "@/lib/integrations/sm8-kinds";
import { sm8Ours } from "@/lib/integrations/sm8-echo";
import { NOTE_WORDS } from "@/lib/integrations/sm8-note-words";
import { takeBackJobNote } from "./job-note-sm8";
import { writeJobNote } from "@/lib/workboard/job-note-write";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* WRITING ON A SERVICEM8 JOB — the pen at the diary's head, and the two
   answers a suggestion can be given.

   THE PEN IS NOT A ROUTE. `routeNote` exists for words that might mean
   something — it stores them, asks the brain, and Tiff answers in her modal. A
   line typed at the diary's head means exactly what it says, so it lands as
   a diary entry the moment you press it, and Tiff only gets involved if the
   sniff decides the words smell like work (the token's own behaviour, same
   as My notes). A note that has to wait for a model round trip before it
   appears is not a diary.

   THE ROW IS THE RECORD. A job is somebody else's system and we only read
   it, so there is no `notes` column to append to. The `workboard_notes` row
   IS the note, filed applied with `jobNotes` — the same group a note filed
   on a job records — and the card's diary reads it back.

   ONE TIER: `workboard`. Writing on the job you are standing on is the whole
   feature, exactly like ticking a checklist row. */

const WB = "/dashboard/workboard";

/** Type a note straight onto the job's diary.

    RETURNS THE SAVED ROW, not void, and the reason is a defect slice 3 shipped
    and had to fix: the browser knows its own auth id but not the display name
    behind it, so a client painting its own entry optimistically stamped the
    time and left the name blank until the card was reopened. The server knows
    both. The write itself is lib/workboard/job-note-write's, which the phone
    shares. */
export async function addJobNote(jobUuid: string, body: string, opts: { id?: string } = {}): Promise<OurJobNote> {
  const { orgId, userId } = await requireOrg("workboard");
  const note = await writeJobNote({ orgId, userId, jobUuid, body, composeId: opts?.id });
  revalidatePath(WB);
  return note;
}

export type RemoveNoteResult = { ok: true; gone: boolean } | { ok: false; error: string };

/** Take one note back off the job's diary.

    Only OUR notes — a ServiceM8 note is in a mirror we may not write, and the
    card says so. A note that never left HeyTiff is deleted outright, by
    anyone who can open the job, because a note somebody typed and
    immediately regretted should leave no trace in a feed people read as the
    job's history.

    ONE THAT WENT TO SERVICEM8, OR WAS QUEUED FOR IT (two-way phase 2), is
    taken back instead (job-note-sm8's takeBackJobNote): its row is kept
    while something of it may be in ServiceM8, and only whoever sent it can
    take it out. The database refuses to delete a row any queue row names
    (the note_id key), so where this deployment doesn't send notes — the
    rollback window — such a note stays, and the person is told why, rather
    than HeyTiff losing its record of something that may be in ServiceM8. */
export async function removeJobNote(noteId: string): Promise<RemoveNoteResult> {
  const { orgId } = await requireOrg("workboard");
  const id = typeof noteId === "string" ? noteId.trim() : "";

  const deleteIt = () =>
    supabaseAdmin.from("workboard_notes").delete().eq("org_id", orgId).eq("id", id).eq("target_kind", "job");

  /* WITHOUT NOTES, exactly today's one delete, and no read */
  if (!sm8NotesAllowed()) {
    const { error } = await deleteIt();
    revalidatePath(WB);
    if (error?.code === "23503") return { ok: false, error: NOTE_WORDS.press.removeHeld };
    if (error) return { ok: false, error: "Couldn't remove that note." };
    return { ok: true, gone: true };
  }

  const row = await readRemovable(orgId, id);
  if (!row) return { ok: false, error: NOTE_WORDS.press.noNote };
  /* a plain entry that never left HeyTiff: deleted, as ever */
  if (!row.hasCreate && !row.reply_to_sm8_note_uuid && !row.is_task_done && !row.removed_at) {
    const { error } = await deleteIt();
    if (!error) {
      revalidatePath(WB);
      return { ok: true, gone: true };
    }
    /* its author's Send queued it in between: the note_id key refused the
       delete, and it is taken back instead (as the author, or not at all) */
    if (error.code !== "23503") return { ok: false, error: "Couldn't remove that note." };
  }
  if (!row.target_id) return { ok: false, error: NOTE_WORDS.press.noNote };
  const r = await takeBackJobNote({ jobUuid: row.target_id, noteId: id });
  return r.ok ? { ok: true, gone: r.gone } : { ok: false, error: r.error };
}

/** The row a Remove is about, and whether anything was ever queued of it. */
async function readRemovable(
  orgId: string,
  id: string
): Promise<{
  target_id: string | null;
  reply_to_sm8_note_uuid: string | null;
  is_task_done: boolean | null;
  removed_at: string | null;
  hasCreate: boolean;
} | null> {
  if (!UUID.test(id)) return null;
  const [{ data: note }, { data: create }] = await Promise.all([
    supabaseAdmin
      .from("workboard_notes")
      .select("id, target_id, reply_to_sm8_note_uuid, is_task_done, removed_at")
      .eq("org_id", orgId)
      .eq("id", id)
      .eq("target_kind", "job")
      .maybeSingle(),
    supabaseAdmin
      .from("sm8_writes")
      .select("id")
      .eq("org_id", orgId)
      .eq("kind", "note")
      .eq("op", "create")
      .eq("note_id", id)
      .maybeSingle(),
  ]);
  if (!note) return null;
  const n = note as { target_id: string | null; reply_to_sm8_note_uuid: string | null; is_task_done: boolean | null; removed_at: string | null };
  return { ...n, hasCreate: !!create };
}

export type NoteTaskInput = {
  jobUuid: string;
  /** The ServiceM8 note this answers — the strip's key, and what stops it
      suggesting the same thing again. */
  noteUuid: string;
  title: string;
  assigneeId: string;
  /** ISO day, or nothing. A task with no date is an ordinary task. */
  dueDate?: string | null;
};

export type NoteTaskResult = { ok: true; taskId: string } | { ok: false; error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Turn one of ServiceM8's own notes into a real task.

    REVIEW BEFORE SAVE IS THE LAW HERE TOO. Nothing on this path runs on its
    own: the strip only ever SUGGESTS, a person edits the title and names who
    it is for, and this function is what they press. (The new Home's one
    task per ask is the named exception, and is not this path: Tiff files
    an ask as one task for the person it asks, theirs to tick off or delete
    — dashboard/mention-settle, docs/voice-capture.md §8.) Which is also why the
    assignee is required — the note writer (`applyConfirmed`) learned the hard
    way that a task with nobody on it is a task nobody does, and it refuses
    rather than filtering.

    The `job_note_actions` row is two facts at once: this note has been
    answered (so the strip goes quiet about it for good) and this task came
    off this job (the join `tasks` deliberately doesn't carry). */
export async function taskFromJobNote(input: NoteTaskInput): Promise<NoteTaskResult> {
  const { orgId, userId } = await requireOrg("workboard");
  const job = input.jobUuid?.trim() ?? "";
  const noteUuid = input.noteUuid?.trim() ?? "";
  const title = input.title?.trim().slice(0, 200) ?? "";
  if (!job || !noteUuid) return { ok: false, error: "That note is no longer here." };
  if (!title) return { ok: false, error: "Give the task a name before it saves." };
  if (!input.assigneeId) {
    return { ok: false, error: "A task needs a person on it. Say who, or dismiss it." };
  }

  /* The note must actually be one of this job's — an id in a POST body names
     a choice, and this is where it stops being one. Notes hang off
     `related_object_uuid`, which is the job or one of its progress claims;
     the claim case is covered because the card only ever offers notes it
     read for this card. */
  const { data: note } = await supabaseAdmin
    .from("sm8_job_notes")
    .select("uuid")
    .eq("org_id", orgId)
    .eq("uuid", noteUuid)
    .maybeSingle();
  if (!note) return { ok: false, error: "That note is no longer here." };
  /* OUR OWN NOTE, MIRRORED BACK, isn't a note to make a task from: HeyTiff's
     row stands for it (sm8-echo). Only where the deployment sends notes —
     before that there is none of ours, and no read is added. */
  if (sm8NotesAllowed() && (await sm8Ours(orgId, [noteUuid])).has(noteUuid)) {
    return { ok: false, error: "That note is no longer here." };
  }

  /* ONE TASK PER ASK. Tiff may have made this note somebody's task since
     the card was drawn (the new Home's settle, dashboard/mention-settle), and
     a press on the suggestion the card still shows must not make a second.
     A read that fails, or a table not there yet, stops nothing. */
  const { data: asked } = await supabaseAdmin
    .from("mention_asks")
    .select("id")
    .eq("org_id", orgId)
    .eq("sm8_note_uuid", noteUuid)
    .eq("status", "read")
    .in("kind", ["do", "question"])
    .limit(1)
    .maybeSingle();
  if (asked) return { ok: false, error: "That note is already a task." };

  const { data: person } = await supabaseAdmin
    .from("staff_profiles")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", input.assigneeId)
    .maybeSingle();
  if (!person) return { ok: false, error: "That person isn't on this workspace any more." };

  const staffId = await staffIdFor(orgId, userId);
  const due = typeof input.dueDate === "string" && ISO_DATE.test(input.dueDate)
    ? input.dueDate
    : null;

  const { data: task, error } = await supabaseAdmin
    .from("tasks")
    .insert({
      org_id: orgId,
      title,
      assigned_to: input.assigneeId,
      created_by: staffId,
      due_date: due,
      status: "open",
    })
    .select("id")
    .single();
  if (error || !task) return { ok: false, error: "Couldn't save that task." };

  const taskId = (task as { id: string }).id;
  const { error: actErr } = await supabaseAdmin.from("job_note_actions").upsert(
    {
      org_id: orgId,
      sm8_note_uuid: noteUuid,
      sm8_job_uuid: job,
      action: "task",
      task_id: taskId,
      acted_by: staffId,
    },
    { onConflict: "org_id,sm8_note_uuid" }
  );
  /* The task is saved either way — losing the bookkeeping row must not lose
     somebody's work. What it costs is the strip suggesting this note again,
     which is annoying and honest, rather than a task that silently vanished. */
  if (actErr) return { ok: true, taskId };

  revalidatePath(WB);
  return { ok: true, taskId };
}

/** "That isn't work." Dismissed stays dismissed — the unique index on
    (org, note) is what makes that a fact about the data rather than a rule
    the strip has to remember. */
export async function dismissJobNote(jobUuid: string, noteUuid: string): Promise<void> {
  const { orgId, userId } = await requireOrg("workboard");
  const job = jobUuid.trim();
  const note = noteUuid.trim();
  if (!job || !note) return;
  await supabaseAdmin.from("job_note_actions").upsert(
    {
      org_id: orgId,
      sm8_note_uuid: note,
      sm8_job_uuid: job,
      action: "dismissed",
      task_id: null,
      acted_by: await staffIdFor(orgId, userId),
    },
    { onConflict: "org_id,sm8_note_uuid" }
  );
  revalidatePath(WB);
}
