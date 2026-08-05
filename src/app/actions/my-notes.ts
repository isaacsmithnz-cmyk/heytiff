"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { staffIdFor } from "@/lib/workboard/projects-query";

/* My notes — the write side.

   THE CASCADE'S FLOOR, and the reason it's a real table with a real screen
   rather than a status on `workboard_notes`: nothing reads that table, so
   "just keep the note" filed words in a drawer nobody opens. This is the
   same idea with the missing half attached.

   NO CAPABILITY GATE, deliberately. Writing yourself a note is not a
   permission — it's the least privileged thing anyone can do in the app, and
   gating it behind `workboard` would mean an office admin who can't see the
   board also can't jot down a phone number. What IS enforced, on every call,
   is that you can only touch your OWN rows: every statement below carries
   both `org_id` and `staff_id`, so the row a browser names is only ever
   reachable if it was already yours. */

export type NoteResult = { ok: true; id?: string } | { ok: false; error: string };

const NOT_SIGNED_IN = "Not signed in.";
const NO_PROFILE = "Your staff profile isn't set up yet.";
const GONE = "That note is no longer here.";

const MAX_BODY = 4000;

type Ctx = { orgId: string; staffId: string };

/** Both facts or nothing: a note needs an owner, so a session without a
    staff profile can't write one.

    The two failures are told apart because they need different words. "Not
    signed in" sends you to sign in; a missing staff profile is an admin
    setting-up problem and no amount of signing in again fixes it. */
async function context(): Promise<Ctx | { error: string }> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return { error: NOT_SIGNED_IN };
  const staffId = await staffIdFor(orgId, userId);
  return staffId ? { orgId, staffId } : { error: NO_PROFILE };
}

const failed = (c: Ctx | { error: string }): c is { error: string } => "error" in c;

const refresh = () => {
  revalidatePath("/dashboard/my-notes");
  revalidatePath("/dashboard");
};

/** Keep a note for yourself. `sourceNoteId` links it back to the routed note
    it fell out of, when it came down the cascade rather than being typed. */
export async function addMyNote(input: {
  body: string;
  source?: "text" | "voice" | "routed";
  sourceNoteId?: string | null;
}): Promise<NoteResult> {
  const ctx = await context();
  if (failed(ctx)) return { ok: false, error: ctx.error };

  const body = input.body.trim().slice(0, MAX_BODY);
  if (!body) return { ok: false, error: "Write something first." };

  /* The link is validated inside the org before it is stored. An id from a
     browser names a CHOICE; this decides whether it's a real one — the same
     rule `resolveTarget` follows for note targets. A bad id becomes null
     rather than an error, because the note itself is still worth keeping. */
  let sourceNoteId: string | null = null;
  if (input.sourceNoteId) {
    const { data } = await supabaseAdmin
      .from("workboard_notes")
      .select("id")
      .eq("org_id", ctx.orgId)
      .eq("id", input.sourceNoteId)
      .maybeSingle();
    sourceNoteId = data ? input.sourceNoteId : null;
  }

  const { data, error } = await supabaseAdmin
    .from("staff_notes")
    .insert({
      org_id: ctx.orgId,
      staff_id: ctx.staffId,
      body,
      source: input.source ?? "text",
      source_note_id: sourceNoteId,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) return { ok: false, error: "Couldn't keep that note." };
  refresh();
  return { ok: true, id: String(data.id) };
}

/** Change the words. Scoped to your own row by the same two-key filter every
    statement here uses. */
export async function editMyNote(noteId: string, body: string): Promise<NoteResult> {
  const ctx = await context();
  if (failed(ctx)) return { ok: false, error: ctx.error };

  const next = body.trim().slice(0, MAX_BODY);
  if (!next) return { ok: false, error: "A note can't be empty — delete it instead." };

  const { data, error } = await supabaseAdmin
    .from("staff_notes")
    .update({ body: next, updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("staff_id", ctx.staffId)
    .eq("id", noteId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: "Couldn't save that change." };
  if (!data) return { ok: false, error: GONE };
  refresh();
  return { ok: true };
}

/** Put it away, or bring it back. Archiving is not deleting: having dealt
    with a note shouldn't destroy the record of having thought it. */
export async function archiveMyNote(noteId: string, archived = true): Promise<NoteResult> {
  const ctx = await context();
  if (failed(ctx)) return { ok: false, error: ctx.error };

  const { data, error } = await supabaseAdmin
    .from("staff_notes")
    .update({
      archived_at: archived ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", ctx.orgId)
    .eq("staff_id", ctx.staffId)
    .eq("id", noteId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: "Couldn't file that away." };
  if (!data) return { ok: false, error: GONE };
  refresh();
  return { ok: true };
}

/** Gone for good — offered only from the archive, so nothing is destroyed in
    one click from the list you read every day. */
export async function deleteMyNote(noteId: string): Promise<NoteResult> {
  const ctx = await context();
  if (failed(ctx)) return { ok: false, error: ctx.error };

  const { data, error } = await supabaseAdmin
    .from("staff_notes")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("staff_id", ctx.staffId)
    .eq("id", noteId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: "Couldn't delete that note." };
  if (!data) return { ok: false, error: GONE };
  refresh();
  return { ok: true };
}
