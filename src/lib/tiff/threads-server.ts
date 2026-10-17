import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { threadOf, type TiffThread } from "./threads";

/* A person's threads with Tiff, on the server (docs/migrations/tiff_threads.sql,
   NOT YET APPLIED). Service role, by org and sign-in: a thread is only ever
   its writer's. The route gates.

   THE TABLE MAY NOT BE THERE. Until the migration runs, every read answers
   `kept: false` and the page keeps its threads in the browser, so nothing
   breaks on either side of applying it. */

export type ThreadOwner = { orgId: string; userSub: string };

/** The most a person's list holds when it is read. */
export const THREADS_READ_MAX = 200;

type Row = { id: string; title: string; messages: unknown; updated_at: string };

/* Postgres's "no such table", and PostgREST's "not in the schema cache",
   which is what a table that was never created looks like through the API. */
const missingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|could not find the table/i.test(e.message ?? ""));

export type ReadResult = { kept: true; threads: TiffThread[] } | { kept: false; missing: boolean };

export async function readThreads(k: ThreadOwner): Promise<ReadResult> {
  const { data, error } = await supabaseAdmin
    .from("tiff_threads")
    .select("id, title, messages, updated_at")
    .eq("org_id", k.orgId)
    .eq("user_sub", k.userSub)
    .order("updated_at", { ascending: false })
    .limit(THREADS_READ_MAX);
  if (error) return { kept: false, missing: missingTable(error) };
  const threads = ((data ?? []) as Row[])
    .map((r) => threadOf({ id: r.id, title: r.title, updatedAt: Date.parse(r.updated_at), messages: r.messages }))
    .filter((t): t is TiffThread => t !== null);
  return { kept: true, threads };
}

/** Keep these threads, and remove those. False when either didn't take. */
export async function writeThreads(k: ThreadOwner, upsert: TiffThread[], remove: string[]): Promise<boolean> {
  if (upsert.length > 0) {
    const rows = upsert.map((t) => ({
      org_id: k.orgId,
      user_sub: k.userSub,
      id: t.id,
      title: t.title,
      messages: t.messages,
      updated_at: new Date(t.updatedAt).toISOString(),
    }));
    const { error } = await supabaseAdmin.from("tiff_threads").upsert(rows, { onConflict: "org_id,user_sub,id" });
    if (error) return false;
  }
  if (remove.length > 0) {
    const { error } = await supabaseAdmin.from("tiff_threads").delete().eq("org_id", k.orgId).eq("user_sub", k.userSub).in("id", remove);
    if (error) return false;
  }
  return true;
}
