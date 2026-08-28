"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { displayNameOf } from "@/lib/staff/name";
import { NAME_COLUMNS } from "@/lib/dashboard/tasks-query";
import type { OurJobNote } from "@/lib/workboard/job-notes-query";

/* WRITING ON A SERVICEM8 JOB — the pen at the diary's head, and the two
   answers a suggestion can be given.

   THE PEN IS NOT A ROUTE. `routeNote` exists for words that might mean
   something — it stores them, asks the brain, and opens the review card. A
   line typed at the diary's head means exactly what it says, so it lands as
   a diary entry the moment you press it, and Tiff only gets involved if the
   sniff decides the words smell like work (the token's own behaviour, same
   as My notes). A note that has to wait for a model round trip before it
   appears is not a diary.

   THE ROW IS THE RECORD. A job is somebody else's system and we only read
   it, so there is no `notes` column to append to. The `workboard_notes` row
   IS the note, filed applied with `jobNotes` — the same group
   `keepNoteOnJob` writes — and the card's diary reads it back.

   ONE TIER: `workboard`. Writing on the job you are standing on is the whole
   feature, exactly like ticking a checklist row. */

const WB = "/dashboard/workboard";

/** Type a note straight onto the job's diary.

    RETURNS THE SAVED ROW, not void, and the reason is a defect slice 3 shipped
    and had to fix: the browser knows its own auth id but not the display name
    behind it, so a client painting its own entry optimistically stamped the
    time and left the name blank until the card was reopened. The server knows
    both. */
export async function addJobNote(jobUuid: string, body: string): Promise<OurJobNote> {
  const { orgId, userId } = await requireOrg("workboard");
  const job = jobUuid.trim();
  if (!job) throw new Error("No job to write on");
  const text = body.trim().slice(0, 4000);
  if (!text) throw new Error("Nothing to write");

  /* The id came from a browser, so it names a CHOICE — this decides whether
     it is a real job in this workspace's mirror. */
  const { data: real } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid")
    .eq("org_id", orgId)
    .eq("uuid", job)
    .maybeSingle();
  if (!real) throw new Error("That job isn't on this workspace's board");

  const staffId = await staffIdFor(orgId, userId);
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("workboard_notes")
    .insert({
      org_id: orgId,
      author_id: staffId,
      target_kind: "job",
      target_id: job,
      transcript: text,
      source: "text",
      status: "applied",
      applied: { jobNotes: [text] },
      applied_at: now,
    })
    .select("id, applied_at, created_at")
    .single();
  if (error || !data) throw new Error("Couldn't save that note");

  const row = data as { id: string; applied_at: string | null; created_at: string };
  revalidatePath(WB);
  return {
    id: row.id,
    text,
    at: row.applied_at ?? row.created_at,
    author: staffId ? await displayName(orgId, staffId) : null,
  };
}

/** Take one note back off the job's diary.

    Only OUR notes — a ServiceM8 note is in a mirror we may not write, and the
    card says so. Kept deliberately narrow: this deletes the row rather than
    flagging it, because a note somebody typed and immediately regretted
    should leave no trace in a feed people read as the job's history. */
export async function removeJobNote(noteId: string): Promise<void> {
  const { orgId } = await requireOrg("workboard");
  await supabaseAdmin
    .from("workboard_notes")
    .delete()
    .eq("org_id", orgId)
    .eq("id", noteId)
    .eq("target_kind", "job");
  revalidatePath(WB);
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
    it is for, and this function is what they press. Which is also why the
    assignee is required — `applyNote` learned the hard way that a task with
    nobody on it is a task nobody does, and it refuses rather than filtering.

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

async function displayName(orgId: string, staffId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select(NAME_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", staffId)
    .maybeSingle();
  if (!data) return null;
  return displayNameOf(data as Parameters<typeof displayNameOf>[0], "") || null;
}
