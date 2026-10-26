import { supabaseAdmin } from "@/lib/supabase-server";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { displayNameOf } from "@/lib/staff/name";
import { NAME_COLUMNS } from "@/lib/dashboard/tasks-query";
import type { OurJobNote } from "@/lib/workboard/job-notes-query";
import { sm8NotesAllowed } from "@/lib/integrations/sm8-kinds";

/* WRITING A NOTE ON A SERVICEM8 JOB, with no session: the row IS the note, a
   `workboard_notes` entry filed applied with `jobNotes` (see actions/
   job-notes for why the pen is not a route). The caller has already decided
   who is writing and that they may; this decides whether the job is real in
   that workspace's mirror, and makes one entry per pen, however often the
   press arrives. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Type a note straight onto the job's diary, for someone already known to be
    a member who may write on the board: the job sheet's pen (actions/job-notes
    addJobNote, with the session) and the phone (api/mobile/jobs/[id]/notes,
    with its token) both land here, so a note is one shape wherever it's typed.

    RETURNS THE SAVED ROW, not void, and the reason is a defect slice 3 shipped
    and had to fix: the browser knows its own auth id but not the display name
    behind it, so a client painting its own entry optimistically stamped the
    time and left the name blank until the card was reopened. The server knows
    both. */
export async function writeJobNote(input: { orgId: string; userId: string; jobUuid: string; body: string; composeId?: string }): Promise<OurJobNote> {
  const { orgId, userId, jobUuid, body } = input;
  const job = jobUuid.trim();
  if (!job) throw new Error("No job to write on");
  const text = body.trim().slice(0, 4000);
  if (!text) throw new Error("Nothing to write");
  /* THE PEN'S OWN ID (two-way phase 2): minted when the pen opens, so a
     double submit — or a retry after a lost answer — is ONE entry, and so
     one note if it goes to ServiceM8. It came from a browser: a uuid, or
     nothing is saved. */
  const composeId = input.composeId;
  if (composeId !== undefined && (typeof composeId !== "string" || !UUID.test(composeId))) {
    throw new Error("Couldn't save that note");
  }

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
  const entry = {
    org_id: orgId,
    author_id: staffId,
    target_kind: "job",
    target_id: job,
    transcript: text,
    source: "text",
    status: "applied",
    applied: { jobNotes: [text] },
    applied_at: now,
  };

  const saved = async (row: { id: string; applied_at: string | null; created_at: string }): Promise<OurJobNote> => {
    return {
      id: row.id,
      text,
      at: row.applied_at ?? row.created_at,
      author: staffId ? await displayName(orgId, staffId) : null,
      /* what the diary's doors read, where the deployment sends notes: a
         fresh entry is yours, and HeyTiff's only */
      ...(sm8NotesAllowed()
        ? { authorId: staffId, mine: !!staffId, removed: false, state: null, sm8Uuid: null, hasCreate: false, replyTo: null }
        : {}),
    };
  };
  const insertFresh = async () => {
    const { data, error } = await supabaseAdmin
      .from("workboard_notes")
      .insert(entry)
      .select("id, applied_at, created_at")
      .single();
    if (error || !data) throw new Error("Couldn't save that note");
    return saved(data as { id: string; applied_at: string | null; created_at: string });
  };

  if (!composeId) return insertFresh();

  /* ONE WRITE, as ever: the same insert, under the pen's id, and a second
     submit of that id is left alone. Only then is anything read. */
  const { data, error } = await supabaseAdmin
    .from("workboard_notes")
    .upsert({ id: composeId, ...entry }, { onConflict: "id", ignoreDuplicates: true })
    .select("id, applied_at, created_at");
  if (error) throw new Error("Couldn't save that note");
  const made = ((data ?? []) as { id: string; applied_at: string | null; created_at: string }[])[0];
  if (made) return saved(made);

  /* ALREADY SAVED under this id: the same press twice, or a retry after a
     lost answer. It must be this person's note on this job; one taken back
     since is gone for good; and different words under the same id are a
     different note (the first answer was lost and the box was edited), so
     they get a row of their own. */
  const again = await readSavedEntry(orgId, composeId);
  if (!again || again.target_kind !== "job" || again.target_id !== job || (again.author_id ?? null) !== staffId) {
    throw new Error("Couldn't save that note");
  }
  if (again.removed_at) throw new Error("That note is no longer here.");
  if ((again.transcript ?? "").trim() !== text) return insertFresh();
  return saved(again);
}

type SavedEntry = {
  id: string;
  target_kind: string;
  target_id: string | null;
  author_id: string | null;
  transcript: string | null;
  applied_at: string | null;
  created_at: string;
  removed_at?: string | null;
};

/** A pen entry already saved under its id — with the tombstone where the
    database has the column. */
async function readSavedEntry(orgId: string, id: string): Promise<SavedEntry | null> {
  const cols = "id, target_kind, target_id, author_id, transcript, applied_at, created_at";
  const read = (c: string) => supabaseAdmin.from("workboard_notes").select(c).eq("org_id", orgId).eq("id", id).maybeSingle();
  let { data, error } = await read(`${cols}, removed_at`);
  if (error?.code === "42703" || error?.code === "PGRST204") ({ data, error } = await read(cols));
  if (error) return null;
  return (data as unknown as SavedEntry | null) ?? null;
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
