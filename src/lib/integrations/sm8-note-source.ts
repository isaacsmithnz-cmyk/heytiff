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
