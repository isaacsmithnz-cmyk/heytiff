"use server";

import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { getSm8Timezone } from "@/lib/workboard/query";
import {
  addSiteNoteFor,
  changeSiteNoteFor,
  fileOldCodeNotesFor,
  readOldCodeNotesFor,
  readSiteNotesFor,
  removeSiteNoteFor,
  siteNoteCountFor,
  type FileOldResult,
  type SiteWrite,
} from "@/lib/sites/site-notes-server";
import { isSiteNoteKind, type OldCodeNote, type SiteNotesRead } from "@/lib/sites/site-notes";

/* SITE NOTES FROM A JOB'S PAGE (docs/migrations/site_notes.sql).

   The job card's gate is these actions' gate, `workboard`: everyone on staff
   who can open the job reads and keeps its site's notes, codes included
   (Isaac, 14 November 2026, call 14: "everyone on staff who can open the job
   sees its site's codes"). The job id came from a browser, so each read and
   write starts from a job this workspace's mirror holds, and reaches only the
   building that job is at (site-notes-server.ts).

   The list of old ServiceM8 notes with codes is for whoever runs the board,
   `workboard_manage`: it files notes for every site at once. */

async function who(): Promise<{ orgId: string; userId: string } | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  return { orgId, userId };
}

const NOT_YOURS: SiteWrite = { ok: false, error: "You can't change site notes here." };

/** How many notes the job's site has for it, for the mark on its button;
    null when the reader may not ask. */
export async function readSiteNoteCount(jobUuid: string): Promise<number | null> {
  const me = await who();
  if (!me || !(await can("workboard")) || typeof jobUuid !== "string") return null;
  return siteNoteCountFor(me.orgId, jobUuid);
}

export async function readSiteNotes(jobUuid: string): Promise<SiteNotesRead | null> {
  const me = await who();
  if (!me || !(await can("workboard")) || typeof jobUuid !== "string") return null;
  return readSiteNotesFor({ orgId: me.orgId, jobUuid, tz: await getSm8Timezone(me.orgId) });
}

type NoteInput = { jobUuid: string; kind: unknown; words: unknown; whole: unknown; video?: unknown };

export async function addSiteNote(input: NoteInput): Promise<SiteWrite> {
  const me = await who();
  if (!me || !(await can("workboard"))) return NOT_YOURS;
  if (typeof input?.jobUuid !== "string" || !isSiteNoteKind(input.kind)) return { ok: false, error: "Choose what kind of note it is." };
  return addSiteNoteFor(
    { ...me, staffId: await staffIdFor(me.orgId, me.userId) },
    { jobUuid: input.jobUuid, kind: input.kind, words: input.words, whole: input.whole !== false, video: input.video },
  );
}

export async function changeSiteNote(input: NoteInput & { id: unknown }): Promise<SiteWrite> {
  const me = await who();
  if (!me || !(await can("workboard"))) return NOT_YOURS;
  if (typeof input?.jobUuid !== "string" || typeof input.id !== "string" || !isSiteNoteKind(input.kind))
    return { ok: false, error: "Choose what kind of note it is." };
  return changeSiteNoteFor(
    { ...me, staffId: await staffIdFor(me.orgId, me.userId) },
    { jobUuid: input.jobUuid, id: input.id, kind: input.kind, words: input.words, whole: input.whole !== false, video: input.video },
  );
}

export async function removeSiteNote(input: { jobUuid: unknown; id: unknown }): Promise<SiteWrite> {
  const me = await who();
  if (!me || !(await can("workboard"))) return NOT_YOURS;
  if (typeof input?.jobUuid !== "string" || typeof input.id !== "string") return NOT_YOURS;
  return removeSiteNoteFor({ ...me, staffId: null }, { jobUuid: input.jobUuid, id: input.id });
}

/** The old notes likely to hold a code, not yet filed. Null for a reader
    who doesn't run the board. */
export async function readOldCodeNotes(): Promise<OldCodeNote[] | null> {
  const me = await who();
  if (!me || !(await can("workboard_manage"))) return null;
  return readOldCodeNotesFor(me.orgId, await getSm8Timezone(me.orgId));
}

export async function fileOldCodeNotes(picks: { uuid: string; words: string; whole: boolean }[]): Promise<FileOldResult> {
  const me = await who();
  if (!me || !(await can("workboard_manage"))) return { filed: 0, error: "Only someone who runs the board can file these." };
  if (!Array.isArray(picks)) return { filed: 0, error: null };
  return fileOldCodeNotesFor({ ...me, staffId: await staffIdFor(me.orgId, me.userId) }, picks);
}
