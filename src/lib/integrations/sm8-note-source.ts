/* What a reply, a Done or a flag change answers, and where a note goes —
   server only (two-way phase 2, PR A).

   A reply answers a ServiceM8 note, or one of OUR notes that went (a reply
   to a reply: its ServiceM8 copy is hidden by the echo, so HeyTiff's own
   row stands for it). A note goes on the object the note it answers hangs
   off — the job, or one of the job's progress claims — never on an object a
   browser names: the object is worked out here, from HeyTiff's own rows
   and the mirror, on every press. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { familyMediaSources } from "@/lib/workboard/all-jobs-query";
import { sm8Handle } from "@/lib/workboard/sm8-mentions";
import { noteWords } from "./sm8-note-plan";

const UUID = /^[0-9a-f-]{36}$/i;

export type NoteSource = {
  /** The object the note hangs off: a job, or one of its claims. */
  relatedUuid: string;
  text: string;
  /** Who wrote it in ServiceM8: its last editor (the only author column
      ServiceM8 has), or for one of ours, whoever it went as. */
  authorSm8Uuid: string | null;
  editDate: string | null;
  editBy: string | null;
  /** ServiceM8's "action required", and who marked it done. */
  flagged: boolean;
  completedBy: string | null;
  origin: "sm8" | "heytiff";
};

/** A mirror note by its uuid, on any object — or, when the mirror doesn't
    hold it, one of OUR sent notes by the uuid it went under, with its words
    from HeyTiff's own row. Null when it is neither. */
export async function noteSourceOf(orgId: string, noteUuid: string): Promise<NoteSource | null> {
  if (typeof noteUuid !== "string" || !UUID.test(noteUuid)) return null;
  const { data: mirror } = await supabaseAdmin
    .from("sm8_job_notes")
    .select("uuid, related_object_uuid, note, edit_by_staff_uuid, edit_date, action_required, action_completed_by_staff_uuid")
    .eq("org_id", orgId)
    .eq("uuid", noteUuid)
    .maybeSingle();
  const m = mirror as {
    related_object_uuid: string | null;
    note: string | null;
    edit_by_staff_uuid: string | null;
    edit_date: string | null;
    action_required: string | null;
    action_completed_by_staff_uuid: string | null;
  } | null;
  if (m && m.related_object_uuid) {
    return {
      relatedUuid: m.related_object_uuid,
      text: (m.note ?? "").trim(),
      authorSm8Uuid: m.edit_by_staff_uuid ?? null,
      editDate: m.edit_date ?? null,
      editBy: m.edit_by_staff_uuid ?? null,
      flagged: m.action_required === "1",
      completedBy: m.action_completed_by_staff_uuid ?? null,
      origin: "sm8",
    };
  }

  const { data: ours } = await supabaseAdmin
    .from("sm8_writes")
    .select("sm8_job_uuid, note_id, as_staff_uuid")
    .eq("org_id", orgId)
    .eq("kind", "note")
    .eq("op", "create")
    .eq("status", "sent")
    .eq("remote_uuid", noteUuid)
    .limit(1)
    .maybeSingle();
  const o = ours as { sm8_job_uuid: string | null; note_id: string | null; as_staff_uuid: string | null } | null;
  if (!o || !o.sm8_job_uuid || !o.note_id) return null;
  const { data: row } = await supabaseAdmin
    .from("workboard_notes")
    .select("applied")
    .eq("org_id", orgId)
    .eq("id", o.note_id)
    .maybeSingle();
  return {
    relatedUuid: o.sm8_job_uuid,
    text: noteWords((row as { applied: unknown } | null)?.applied) ?? "",
    authorSm8Uuid: o.as_staff_uuid ?? null,
    editDate: null,
    editBy: null,
    flagged: false,
    completedBy: null,
    origin: "heytiff",
  };
}

/** WHETHER THE NOTE A REPLY OR A DONE ANSWERS STILL STANDS: false once its
    author took it back or somebody removed it in ServiceM8, null when that
    can't be read (nothing is saved on a guess). A reply (job-note-sm8) and a
    Done (task-sm8) both ask it here before HeyTiff saves a row, so nobody
    answers a withdrawn note by either door.

    noteSourceOf finds a note however it stands, so this asks the two things
    it doesn't: whether ServiceM8's copy is still active in the mirror, and
    whether it is one of OURS whose create was taken back or whose row was
    removed. The second is asked of a mirror note too: until the sync has
    caught up with the delete, the mirror still holds our withdrawn copy as
    active. */
export async function sourceStands(
  orgId: string,
  sourceUuid: string,
  origin: "sm8" | "heytiff"
): Promise<boolean | null> {
  const [mirror, creates] = await Promise.all([
    origin === "sm8"
      ? supabaseAdmin.from("sm8_job_notes").select("active").eq("org_id", orgId).eq("uuid", sourceUuid).maybeSingle()
      : null,
    supabaseAdmin
      .from("sm8_writes")
      .select("note_id, taken_back_at")
      .eq("org_id", orgId)
      .eq("kind", "note")
      .eq("op", "create")
      .eq("remote_uuid", sourceUuid)
      .limit(5),
  ]);
  if (mirror?.error || creates.error) return null;
  if (mirror && Number((mirror.data as { active: unknown } | null)?.active) !== 1) return false;
  const ours = (creates.data ?? []) as { note_id: string | null; taken_back_at: string | null }[];
  if (ours.some((c) => !!c.taken_back_at)) return false;
  const noteIds = ours.map((c) => c.note_id).filter((id): id is string => !!id);
  if (noteIds.length === 0) return true;
  const { data, error } = await supabaseAdmin
    .from("workboard_notes")
    .select("id, removed_at")
    .eq("org_id", orgId)
    .in("id", noteIds);
  if (error) return null;
  return !((data ?? []) as { removed_at: string | null }[]).some((r) => !!r.removed_at);
}

/** Where a HeyTiff row's note goes in ServiceM8:
    - a diary entry (it answers nothing): the job it is written on;
    - a reply or a Done: the object its source hangs off, ONLY when that is
      this job or one of the job's claims (familyMediaSources);
    - otherwise null — nothing goes. */
export async function noteObjectOf(
  orgId: string,
  row: { target_id: string | null; reply_to_sm8_note_uuid?: string | null }
): Promise<string | null> {
  if (!row.target_id) return null;
  if (!row.reply_to_sm8_note_uuid) return row.target_id;
  const source = await noteSourceOf(orgId, row.reply_to_sm8_note_uuid);
  if (!source) return null;
  if (source.relatedUuid === row.target_id) return row.target_id;
  const family = await familyMediaSources(orgId, row.target_id);
  return family.some((c) => c.remoteId === source.relatedUuid) ? source.relatedUuid : null;
}

/** A ServiceM8 staff member's @handle, by their uuid. An inactive person
    keeps theirs: ServiceM8 still knows who they were. */
export async function sm8HandleOf(orgId: string, sm8Uuid: string | null): Promise<string | null> {
  if (!sm8Uuid) return null;
  const { data } = await supabaseAdmin
    .from("sm8_staff")
    .select("first, last")
    .eq("org_id", orgId)
    .eq("uuid", sm8Uuid)
    .maybeSingle();
  const s = data as { first: string | null; last: string | null } | null;
  return s ? sm8Handle(s.first, s.last) : null;
}

/** WHO ASKED a note, for the @handle a reply or a Done addresses: its
    ServiceM8 uuid and handle. ServiceM8 names only a note's last editor, and
    our own Mark done may have made the presser that editor: then the asker
    is who it was when we marked it (readJobNotes reads the author the same
    way). One of OUR notes that went asked as whoever it went as. Null when
    nobody can be named. The reply (job-note-sm8) and the Done (task-sm8)
    both read it here, so the two never address different people. */
export async function noteAskerOf(
  orgId: string,
  noteUuid: string,
  source: Pick<NoteSource, "authorSm8Uuid" | "origin">
): Promise<{ sm8Uuid: string; handle: string | null } | null> {
  let asker = source.authorSm8Uuid;
  if (source.origin === "sm8") {
    const { data } = await supabaseAdmin
      .from("sm8_writes")
      .select("seen_edit_by, as_staff_uuid, created_at")
      .eq("org_id", orgId)
      .eq("kind", "note")
      .eq("op", "update")
      .eq("flag_done", true)
      .eq("target_uuid", noteUuid)
      .in("status", ["sending", "sent"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const op = data as { seen_edit_by: string | null; as_staff_uuid: string | null } | null;
    if (op?.seen_edit_by && asker !== op.seen_edit_by && (!op.as_staff_uuid || asker === op.as_staff_uuid)) {
      asker = op.seen_edit_by;
    }
  }
  if (!asker) return null;
  return { sm8Uuid: asker, handle: await sm8HandleOf(orgId, asker) };
}
