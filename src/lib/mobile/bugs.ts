import { supabaseAdmin } from "@/lib/supabase-server";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import type { MobileCtx } from "./auth";

/* A BUG, SHOWN FROM THE PHONE (Isaac, 11 November 2026: "a little bug symbol
   that you can tap and it will screenshot current screen and save in a
   folder ... Give each screenshot a number for reference", then "A" to
   https://claude.ai/artifact/SgZPF6jPxc7JLbTUk4ShGX).

   The phone's bug takes a picture of the screen you're on. Each one gets the
   workspace's next number and is kept in the private documents bucket under
   bugs/<workspace>/, as 0012.png beside 0012.txt (when, which page, the
   app's version, and the note you add, if you add one). Nothing else reads
   that folder: scripts/pull-bugs.mjs copies it to a folder on the Mac, so
   "bug 12" is a file to open.

   The number is taken by writing its .txt first, never overwriting: a second
   tap in the same instant finds 0012.txt there and takes 0013. The picture
   then goes straight to storage by a signed upload, as every phone upload
   does (lib/documents/upload-slots).

   The owner's alone: it's for whoever is building the app, not the team. */

const MAX_NOTE = 1000;
const MAX_FIELD = 200;

export const bugFolder = (orgId: string) => `bugs/${orgId}/`;
export const bugName = (n: number) => String(n).padStart(4, "0");

type Done<T> = { ok: true; value: T } | { ok: false; error: string; status: number };
const bad = (error: string, status = 500): Done<never> => ({ ok: false, error, status });
const one = (v: unknown, max = MAX_FIELD) => (typeof v === "string" ? v.replace(/[\r\n]+/g, " ").trim().slice(0, max) : "");

export function mayFileBugs(ctx: Pick<MobileCtx, "role">): boolean {
  return ctx.role === "owner";
}

/** The highest number already in the folder, from its file names. */
export function highestBug(names: readonly string[]): number {
  let top = 0;
  for (const name of names) {
    const m = /^(\d{4,})\.(png|txt)$/.exec(name);
    if (m) top = Math.max(top, Number(m[1]));
  }
  return top;
}

/** What the .txt says, one fact a line. */
export function bugText(f: { n: number; at: string; page: string; app: string; note?: string }): string {
  return [`Bug ${f.n}`, `When: ${f.at}`, `Page: ${f.page || "(not said)"}`, `App: ${f.app || "(not said)"}`, ...(f.note ? [`Note: ${f.note}`] : [])].join("\n") + "\n";
}

const bucket = () => supabaseAdmin.storage.from(DOCUMENTS_BUCKET);
const text = (s: string) => new Blob([s], { type: "text/plain" });

/** The next number, held, and a slot for its picture. */
export async function openBug(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<{ number: number; uploadUrl: string }>> {
  if (!mayFileBugs(ctx)) return bad("Only the workspace's owner can save a bug.", 403);
  const folder = bugFolder(ctx.orgId);
  const { data: files, error: listErr } = await bucket().list(folder.slice(0, -1), { limit: 1000, sortBy: { column: "name", order: "desc" } });
  if (listErr) {
    console.error("[bugs] list", listErr.message);
    return bad("Couldn't read the bugs folder.");
  }
  let n = highestBug((files ?? []).map((f) => f.name)) + 1;
  const facts = { at: new Date().toISOString(), page: one(body.page), app: one(body.app) };
  for (let tries = 0; ; tries++) {
    const { error } = await bucket().upload(`${folder}${bugName(n)}.txt`, text(bugText({ n, ...facts })), { contentType: "text/plain", upsert: false });
    if (!error) break;
    if (tries >= 4 || !/exist|duplicate/i.test(error.message)) {
      // the real refusal, always: a bucket that won't take text/plain read as this once (docs/migrations/documents_bucket_text.sql)
      console.error("[bugs] hold", bugName(n), error.message);
      return bad("Couldn't save the bug.");
    }
    n += 1;
  }
  const { data: slot, error: slotErr } = await bucket().createSignedUploadUrl(`${folder}${bugName(n)}.png`);
  if (slotErr || !slot) {
    console.error("[bugs] slot", bugName(n), slotErr?.message);
    return bad("Couldn't save the bug.");
  }
  return { ok: true, value: { number: n, uploadUrl: slot.signedUrl } };
}

const number = (raw: string) => (/^\d{1,6}$/.test(raw) ? Number(raw) : null);

/** Your line about what's wrong, kept with the bug (a second note replaces the first). */
export async function noteBug(ctx: MobileCtx, raw: string, body: Record<string, unknown>): Promise<Done<{ number: number }>> {
  if (!mayFileBugs(ctx)) return bad("Only the workspace's owner can save a bug.", 403);
  const n = number(raw);
  if (!n) return bad("No such bug.", 404);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE) : "";
  const path = `${bugFolder(ctx.orgId)}${bugName(n)}.txt`;
  const { data, error } = await bucket().download(path);
  if (error || !data) return bad("No such bug.", 404);
  const kept = (await data.text()).split("\n").filter((l) => l && !l.startsWith("Note: "));
  const next = [...kept, ...(note ? [`Note: ${note.replace(/[\r\n]+/g, " ")}`] : [])].join("\n") + "\n";
  const { error: upErr } = await bucket().upload(path, text(next), { contentType: "text/plain", upsert: true });
  if (upErr) return bad("Couldn't save the note.");
  return { ok: true, value: { number: n } };
}

/** Undo: the picture and its facts go. */
export async function dropBug(ctx: MobileCtx, raw: string): Promise<Done<{ number: number }>> {
  if (!mayFileBugs(ctx)) return bad("Only the workspace's owner can save a bug.", 403);
  const n = number(raw);
  if (!n) return bad("No such bug.", 404);
  const folder = bugFolder(ctx.orgId);
  const { error } = await bucket().remove([`${folder}${bugName(n)}.png`, `${folder}${bugName(n)}.txt`]);
  if (error) return bad("Couldn't take the bug back.");
  return { ok: true, value: { number: n } };
}
