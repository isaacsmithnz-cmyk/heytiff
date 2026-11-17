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

   Anyone in the workspace may save one (Isaac, 18 November 2026: "I need
   everyone to be able to report bugs", after one of the team couldn't show
   a PDF that wouldn't open). The .txt says who: By, their name, and User,
   their sign-in, so a note or an Undo is theirs alone, or the owner's.

   The website files its bugs here too (Isaac, 17 November 2026: "Yes, build
   it" to https://claude.ai/artifact/V6XVjpPn7qFmdt3JVxELhL): Your name,
   Report bug, through /api/bugs, into the same folder and the same numbers,
   its App line "Web". So these take only the workspace, the role and who. */

const MAX_NOTE = 1000;
const MAX_FIELD = 200;

export const bugFolder = (orgId: string) => `bugs/${orgId}/`;
export const bugName = (n: number) => String(n).padStart(4, "0");

type Done<T> = { ok: true; value: T } | { ok: false; error: string; status: number };
/** Who's filing: the phone's context, or the website's session, alike. */
export type BugCtx = Pick<MobileCtx, "orgId" | "role" | "userId">;
const bad = (error: string, status = 500): Done<never> => ({ ok: false, error, status });
const one = (v: unknown, max = MAX_FIELD) => (typeof v === "string" ? v.replace(/[\r\n]+/g, " ").trim().slice(0, max) : "");

/** Anyone with a role in the workspace. */
export function mayFileBugs(ctx: Pick<BugCtx, "role">): boolean {
  return ctx.role != null;
}

/** A bug's note or Undo: whoever filed it, or the owner. A bug from before the User line is the owner's. */
export function mayChangeBug(ctx: Pick<BugCtx, "role" | "userId">, txt: string): boolean {
  if (ctx.role === "owner") return true;
  const m = /^User: (.+)$/m.exec(txt);
  return !!m && m[1] === ctx.userId;
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
export function bugText(f: { n: number; at: string; page: string; app: string; by?: string; user?: string; note?: string }): string {
  return [
    `Bug ${f.n}`,
    `When: ${f.at}`,
    ...(f.by !== undefined ? [`By: ${f.by || "(not known)"}`] : []),
    ...(f.user ? [`User: ${f.user}`] : []),
    `Page: ${f.page || "(not said)"}`,
    `App: ${f.app || "(not said)"}`,
    ...(f.note ? [`Note: ${f.note}`] : []),
  ].join("\n") + "\n";
}

/** The name of whoever's filing, from their staff card; blank when there's none. */
async function nameOf(ctx: BugCtx): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("staff_profiles")
      .select("first_name, preferred_name, full_name")
      .eq("org_id", ctx.orgId)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    const r = data as { first_name: string | null; preferred_name: string | null; full_name: string | null } | null;
    return one(r?.full_name || r?.preferred_name || r?.first_name || "");
  } catch {
    return "";
  }
}

const bucket = () => supabaseAdmin.storage.from(DOCUMENTS_BUCKET);
const text = (s: string) => new Blob([s], { type: "text/plain" });

/** The next number, held, and a slot for its picture. */
export async function openBug(ctx: BugCtx, body: Record<string, unknown>): Promise<Done<{ number: number; uploadUrl: string; path: string; token: string }>> {
  if (!mayFileBugs(ctx)) return bad("Only someone in the workspace can save a bug.", 403);
  const folder = bugFolder(ctx.orgId);
  const { data: files, error: listErr } = await bucket().list(folder.slice(0, -1), { limit: 1000, sortBy: { column: "name", order: "desc" } });
  if (listErr) {
    console.error("[bugs] list", listErr.message);
    return bad("Couldn't read the bugs folder.");
  }
  let n = highestBug((files ?? []).map((f) => f.name)) + 1;
  const facts = { at: new Date().toISOString(), by: await nameOf(ctx), user: ctx.userId, page: one(body.page), app: one(body.app) };
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
  /* the phone PUTs to the signed URL; the website's storage client takes its path and token */
  return { ok: true, value: { number: n, uploadUrl: slot.signedUrl, path: slot.path, token: slot.token } };
}

const number = (raw: string) => (/^\d{1,6}$/.test(raw) ? Number(raw) : null);

/** Your line about what's wrong, kept with the bug (a second note replaces the first). */
export async function noteBug(ctx: BugCtx, raw: string, body: Record<string, unknown>): Promise<Done<{ number: number }>> {
  if (!mayFileBugs(ctx)) return bad("Only someone in the workspace can save a bug.", 403);
  const n = number(raw);
  if (!n) return bad("No such bug.", 404);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE) : "";
  const path = `${bugFolder(ctx.orgId)}${bugName(n)}.txt`;
  const { data, error } = await bucket().download(path);
  if (error || !data) return bad("No such bug.", 404);
  const was = await data.text();
  if (!mayChangeBug(ctx, was)) return bad("That bug isn't yours.", 403);
  const kept = was.split("\n").filter((l) => l && !l.startsWith("Note: "));
  const next = [...kept, ...(note ? [`Note: ${note.replace(/[\r\n]+/g, " ")}`] : [])].join("\n") + "\n";
  const { error: upErr } = await bucket().upload(path, text(next), { contentType: "text/plain", upsert: true });
  if (upErr) return bad("Couldn't save the note.");
  return { ok: true, value: { number: n } };
}

/** Undo: the picture and its facts go. */
export async function dropBug(ctx: BugCtx, raw: string): Promise<Done<{ number: number }>> {
  if (!mayFileBugs(ctx)) return bad("Only someone in the workspace can save a bug.", 403);
  const n = number(raw);
  if (!n) return bad("No such bug.", 404);
  const folder = bugFolder(ctx.orgId);
  const { data: txt, error: readErr } = await bucket().download(`${folder}${bugName(n)}.txt`);
  if (readErr || !txt) return bad("No such bug.", 404);
  if (!mayChangeBug(ctx, await txt.text())) return bad("That bug isn't yours.", 403);
  const { error } = await bucket().remove([`${folder}${bugName(n)}.png`, `${folder}${bugName(n)}.txt`]);
  if (error) return bad("Couldn't take the bug back.");
  return { ok: true, value: { number: n } };
}
