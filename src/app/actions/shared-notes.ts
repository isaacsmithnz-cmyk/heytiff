"use server";

import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { listFleetStaff, staffProfileIdFor } from "@/lib/fleet/query";
import { revalidateHome } from "@/lib/shell/revalidate-home";
import { NOTE_MAX } from "@/lib/dashboard/shared-notes";
import { addJobNote } from "./job-notes";

/* NEW › NOTE, and a note's Reply and Done in Your feed (Isaac, 24 October
   2026; lib/dashboard/shared-notes says what a note is).

   Anyone signed in may write a note, to anyone in their workspace: a tech
   telling the office the ute's camera is out is the point. Everything a
   browser hands in is a CHOICE, re-decided here: the people are checked
   against this workspace's staff, the job against its mirror (addJobNote),
   and a reply or a Done only by someone in the thread. Nothing here goes to
   ServiceM8: a note kept on a job is HeyTiff's until it is sent from the
   job. */

type Ctx = { orgId: string; staffId: string };

async function context(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  const staffId = await staffProfileIdFor(orgId, userId);
  return staffId ? { orgId, staffId } : null;
}

export type NoteResult = { ok: true } | { ok: false; error: string };

export type NotePeople = { me: string | null; people: { id: string; name: string }[] };

/** Who a note can go to: everyone on the team but you. */
export async function notePeople(): Promise<NotePeople> {
  const ctx = await context();
  if (!ctx) return { me: null, people: [] };
  const staff = await listFleetStaff(ctx.orgId);
  return {
    me: ctx.staffId,
    people: staff.filter((s) => s.id !== ctx.staffId && s.status !== "Inactive").map((s) => ({ id: s.id, name: s.name })),
  };
}

/** The office: the workspace's owners and admins, by their staff cards. */
async function officeOf(orgId: string): Promise<string[]> {
  const { data: members } = await supabaseAdmin
    .from("memberships")
    .select("user_id, role")
    .eq("org_id", orgId)
    .in("role", ["owner", "admin"]);
  const users = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id);
  if (users.length === 0) return [];
  const { data: cards } = await supabaseAdmin.from("staff_profiles").select("id").eq("org_id", orgId).in("user_id", users);
  return ((cards ?? []) as { id: string }[]).map((c) => c.id);
}

/** Send a note: its words, the job it is about (or none), and who it is to.
    With a job it is kept on the job's conversation as well; with nobody
    named and no job it goes to the office. */
export async function sendNote(input: { text: string; jobUuid: string | null; to: string[]; toOffice: boolean }): Promise<NoteResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  const body = (input.text ?? "").trim().slice(0, NOTE_MAX);
  if (!body) return { ok: false, error: "Write the note first." };
  const job = typeof input.jobUuid === "string" && input.jobUuid.trim() ? input.jobUuid.trim() : null;

  /* the people named, checked against this workspace; never yourself */
  const named = [...new Set((input.to ?? []).filter((id) => typeof id === "string" && id !== ctx.staffId))].slice(0, 50);
  let people: string[] = [];
  if (named.length) {
    const { data } = await supabaseAdmin.from("staff_profiles").select("id").eq("org_id", ctx.orgId).in("id", named);
    people = ((data ?? []) as { id: string }[]).map((r) => r.id);
    if (people.length !== named.length) return { ok: false, error: "Someone you named isn't on the team any more." };
  }
  /* nobody named and no job: the office */
  const toOffice = !!input.toOffice || (!job && people.length === 0);
  const office = toOffice ? (await officeOf(ctx.orgId)).filter((id) => id !== ctx.staffId && !people.includes(id)) : [];
  if (!job && people.length === 0 && office.length === 0) {
    return { ok: false, error: "There's nobody in the office to send it to. Name someone." };
  }

  /* with a job, kept on the job's conversation, as the job's own box keeps it */
  let jobNoteId: string | null = null;
  if (job) {
    try {
      jobNoteId = (await addJobNote(job, body)).id;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Couldn't keep that on the job." };
    }
    /* a job note with nobody to tell is the job's alone */
    if (people.length === 0 && office.length === 0) {
      revalidateHome();
      return { ok: true };
    }
  }

  const { data: root, error } = await supabaseAdmin
    .from("shared_notes")
    .insert({ org_id: ctx.orgId, author_id: ctx.staffId, body, job_uuid: job, job_note_id: jobNoteId, to_office: toOffice })
    .select("id")
    .single();
  if (error || !root) return { ok: false, error: "Couldn't send that note." };
  const threadId = (root as { id: string }).id;
  const now = new Date().toISOString();
  const rows = [
    /* the writer is in it, with nothing waiting: the last word is theirs */
    { thread_id: threadId, staff_id: ctx.staffId, org_id: ctx.orgId, via_office: false, done_at: now },
    ...people.map((id) => ({ thread_id: threadId, staff_id: id, org_id: ctx.orgId, via_office: false, done_at: null })),
    ...office.map((id) => ({ thread_id: threadId, staff_id: id, org_id: ctx.orgId, via_office: true, done_at: null })),
  ];
  const { error: who } = await supabaseAdmin.from("shared_note_people").insert(rows);
  if (who) {
    await supabaseAdmin.from("shared_notes").delete().eq("id", threadId).eq("org_id", ctx.orgId);
    return { ok: false, error: "Couldn't send that note." };
  }
  revalidateHome();
  return { ok: true };
}

/** Is the viewer in this thread, and as one of the office? */
async function inThread(ctx: Ctx, threadId: string): Promise<{ viaOffice: boolean } | null> {
  if (typeof threadId !== "string" || !threadId) return null;
  const { data } = await supabaseAdmin
    .from("shared_note_people")
    .select("via_office")
    .eq("org_id", ctx.orgId)
    .eq("thread_id", threadId)
    .eq("staff_id", ctx.staffId)
    .maybeSingle();
  return data ? { viaOffice: !!(data as { via_office: boolean }).via_office } : null;
}

/** Reply in a note's thread: everyone else in it has it waiting again, and
    yours is the last word, so it waits on nobody for you. */
export async function replyNote(threadId: string, text: string): Promise<NoteResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  const body = (text ?? "").trim().slice(0, NOTE_MAX);
  if (!body) return { ok: false, error: "Write the reply first." };
  if (!(await inThread(ctx, threadId))) return { ok: false, error: "That note isn't yours to answer." };
  const { error } = await supabaseAdmin
    .from("shared_notes")
    .insert({ org_id: ctx.orgId, thread_id: threadId, author_id: ctx.staffId, body });
  if (error) return { ok: false, error: "That didn't send. Try again." };
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("shared_note_people")
    .update({ done_at: null })
    .eq("org_id", ctx.orgId)
    .eq("thread_id", threadId)
    .neq("staff_id", ctx.staffId);
  await supabaseAdmin
    .from("shared_note_people")
    .update({ done_at: now })
    .eq("org_id", ctx.orgId)
    .eq("thread_id", threadId)
    .eq("staff_id", ctx.staffId);
  revalidateHome();
  return { ok: true };
}

/** Done: the note leaves your feed, and the office's, for one to the office
    that came to you as one of them. A reply brings it back. */
export async function doneNote(threadId: string): Promise<NoteResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  const me = await inThread(ctx, threadId);
  if (!me) return { ok: false, error: "That note isn't yours." };
  const now = new Date().toISOString();
  let q = supabaseAdmin.from("shared_note_people").update({ done_at: now }).eq("org_id", ctx.orgId).eq("thread_id", threadId);
  q = me.viaOffice ? q.eq("via_office", true) : q.eq("staff_id", ctx.staffId);
  const { error } = await q;
  if (error) return { ok: false, error: "Couldn't put that away." };
  revalidateHome();
  return { ok: true };
}
