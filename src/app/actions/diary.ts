"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { isConversationKey } from "@/lib/dashboard/diary-hidden";
import { removeJobNote } from "./job-notes";

/* YOUR DIARY, KEPT TIDY — the new Home's Diary tab. Isaac, walking it on
   2026-09-26: "there's no way to delete or remove things from the diary or
   archive them", then, on what that should mean: "you should only be able
   to delete your own entries or edit. with the option to hide/archive
   other peoples".

   YOUR OWN ENTRY is yours alone to change: its author's, whoever else can
   see the Workboard.

     EDIT puts the words right. It changes the words the diary shows and
     nothing they made: a task Tiff filed from them stays as it was filed,
     and her conversation stays as it was said. A note that has left
     HeyTiff — queued for ServiceM8, sent there, a reply or a Done posted
     there — is ServiceM8's copy too, and one set of words would stop
     matching the other: that one is changed in ServiceM8, and is not
     offered here (the diary's read says which, `inSm8`).

     DELETE takes it off by the job card's own rule (job-notes'
     `removeJobNote`): a note that never left HeyTiff is deleted outright,
     one that went to ServiceM8 is taken back from there. What it made
     stays — a task is a task of its own — and the rows that pointed back
     at it (a flag, a kept line, a project entry) keep themselves and lose
     only the pointer: the database's own ON DELETE SET NULL. It asks twice
     on the page, since nothing brings it back.

   SOMEONE ELSE'S CONVERSATION is theirs, in ServiceM8; what you may do is
   put it out of your sight. HIDE keeps one row per person per conversation
   (diary_hidden), and the conversation comes back when its asker writes
   after you hid it, or you reply in it from HeyTiff, your replies in it
   going and coming back with it (lib/dashboard/diary-hidden, read in
   lib/dashboard/diary-query). Its Undo, `showConversation`,
   takes the row away. Neither revalidates: the conversation on screen
   stands as "Hidden." with Undo until the page next comes round, and the
   read then leaves it out. */

export type DiaryResult = { ok: true } | { ok: false; error: string };

const NOT_SIGNED_IN = "Not signed in.";
const NO_CARD = "Your staff profile isn't set up yet.";
const GONE = "That entry is no longer here.";
const NOT_YOURS = "Only whoever wrote an entry can change it.";
const IN_SM8 = "That one is in ServiceM8 now, so change it there.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The same ceiling the diary's box saves under (keepWords). */
const WORDS_MAX = 8000;
/** What the diary shows: what was filed, and what Undo has taken back since. */
const ON_THE_DIARY = ["applied", "undone"];

type Ctx = { orgId: string; staffId: string };

async function context(): Promise<Ctx | { error: string }> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return { error: NOT_SIGNED_IN };
  const staffId = await staffIdFor(orgId, userId);
  if (!staffId) return { error: NO_CARD };
  return { orgId, staffId };
}

type EntryRow = {
  id: string;
  author_id: string | null;
  status: string | null;
  target_kind: string | null;
  target_id: string | null;
  reply_to_sm8_note_uuid: string | null;
  is_task_done: boolean | null;
  removed_at: string | null;
};

/** The entry as the diary reads it — or why it can't be changed. */
async function yourEntry(ctx: Ctx, noteId: unknown): Promise<EntryRow | { error: string }> {
  const id = typeof noteId === "string" ? noteId.trim() : "";
  if (!UUID.test(id)) return { error: GONE };
  const { data, error } = await supabaseAdmin
    .from("workboard_notes")
    .select("id, author_id, status, target_kind, target_id, reply_to_sm8_note_uuid, is_task_done, removed_at")
    .eq("org_id", ctx.orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: "Couldn't reach your diary." };
  const row = data as EntryRow | null;
  if (!row || row.removed_at || !ON_THE_DIARY.includes(row.status ?? "")) return { error: GONE };
  if (row.author_id !== ctx.staffId) return { error: NOT_YOURS };
  return row;
}

/** Whether anything of the note has left HeyTiff: a reply or a Done posted
    to ServiceM8, or a send queued or made. A read that fails says it has:
    an edit is refused rather than risk two sets of words. */
async function leftHeyTiff(ctx: Ctx, row: EntryRow): Promise<boolean> {
  if (row.reply_to_sm8_note_uuid || row.is_task_done) return true;
  if (row.target_kind !== "job") return false;
  const { data, error } = await supabaseAdmin
    .from("sm8_writes")
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("kind", "note")
    .eq("note_id", row.id)
    .limit(1);
  if (error) return true;
  return (data ?? []).length > 0;
}

function refresh(row: EntryRow) {
  revalidatePath("/dashboard");
  if (row.target_kind === "job") revalidatePath("/dashboard/workboard");
}

/** Your own entry's words, put right. */
export async function editDiaryEntry(noteId: string, text: string): Promise<DiaryResult> {
  const ctx = await context();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const words = typeof text === "string" ? text.trim().slice(0, WORDS_MAX).trim() : "";
  if (!words) return { ok: false, error: "There's nothing in it. Delete it instead." };

  const row = await yourEntry(ctx, noteId);
  if ("error" in row) return { ok: false, error: row.error };
  if (await leftHeyTiff(ctx, row)) return { ok: false, error: IN_SM8 };

  const { data, error } = await supabaseAdmin
    .from("workboard_notes")
    .update({ transcript: words })
    .eq("org_id", ctx.orgId)
    .eq("id", row.id)
    .eq("author_id", ctx.staffId)
    .is("removed_at", null)
    .select("id");
  if (error) return { ok: false, error: "Couldn't save that." };
  if ((data ?? []).length === 0) return { ok: false, error: GONE };
  refresh(row);
  return { ok: true };
}

/** Your own entry, off the diary for good: deleted, or — where it went to
    ServiceM8 — taken back from there, as the job card takes a note back. */
export async function deleteDiaryEntry(noteId: string): Promise<DiaryResult> {
  const ctx = await context();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const row = await yourEntry(ctx, noteId);
  if ("error" in row) return { ok: false, error: row.error };

  if (row.target_kind === "job") {
    const r = await removeJobNote(row.id);
    if (!r.ok) return { ok: false, error: r.error };
    refresh(row);
    return { ok: true };
  }

  const { data, error } = await supabaseAdmin
    .from("workboard_notes")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", row.id)
    .eq("author_id", ctx.staffId)
    .in("status", ON_THE_DIARY)
    .select("id");
  if (error) return { ok: false, error: "Couldn't delete that." };
  if ((data ?? []).length === 0) return { ok: false, error: GONE };
  refresh(row);
  return { ok: true };
}

/** Someone else's conversation, out of your diary until they write again. */
export async function hideConversation(key: string): Promise<DiaryResult> {
  const ctx = await context();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!isConversationKey(key)) return { ok: false, error: "That conversation is no longer here." };
  const { error } = await supabaseAdmin.from("diary_hidden").upsert(
    { org_id: ctx.orgId, staff_id: ctx.staffId, conversation_key: key, hidden_at: new Date().toISOString() },
    { onConflict: "org_id,staff_id,conversation_key" },
  );
  if (error) return { ok: false, error: "Couldn't hide that." };
  return { ok: true };
}

/** Hide's Undo: the conversation stays in your diary. */
export async function showConversation(key: string): Promise<DiaryResult> {
  const ctx = await context();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!isConversationKey(key)) return { ok: false, error: "That conversation is no longer here." };
  const { error } = await supabaseAdmin
    .from("diary_hidden")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("staff_id", ctx.staffId)
    .eq("conversation_key", key);
  if (error) return { ok: false, error: "Couldn't bring that back." };
  return { ok: true };
}
