/* Our own writes, coming back — server only.

   A file HeyTiff sends to ServiceM8 is mirrored back by the next sync as one
   of ServiceM8's own attachments. Left alone it shows twice on the job card
   (ours, and theirs), is downloaded back into HeyTiff's own bucket, and is
   read and searched as though somebody had taken a new photo. The ECHO is
   every ServiceM8 record HeyTiff made itself: its uuid is one HeyTiff minted
   when the write was queued (sm8-writes), or one it replaced with a fresh
   one (replaced_uuids), so it is ours by construction.

   ANY STATUS COUNTS. A send marked failed, or cancelled after an upload that
   got no answer, may still have landed; its uuid is ours whether or not it
   did.

   WHERE IT IS LEFT OUT: the job card's files and the job story
   (job-media-query), the download that brings a job's files across
   (workboard-media), the photo bank's search and its reader
   (photo-search, photo-readings), and — for notes (two-way phase 2) — the
   job's notes (all-jobs-query's readJobNotes, which feeds the diary, the
   strip, the stored summary and the claim modal) and a task made from a
   note (job-notes' taskFromJobNote). Both of those ask only where the
   deployment sends notes; readJobAttention asks only when readJobNotes
   hasn't (`echoFiltered`), so a card open makes one echo read. The echo
   hides OUR COPY from OUR lists; who a note mentions is still read from its
   words. HeyTiff's OWN rows — sm8_writes, the document it sent, a paper, a
   note's workboard_notes row — are never touched: the file or the note
   stays one row, ours.

   DOUBT SHOWS IT TWICE. A read that fails returns nothing as ours, logged: a
   duplicate on screen is better than a card that won't open. */

import { supabaseAdmin } from "@/lib/supabase-server";

const UUID = /^[0-9a-f-]{36}$/i;

/** Uuids per query. Two lists of them ride in the URL (remote_uuid and
    replaced_uuids), each uuid about 39 characters once its comma is
    encoded, so fifty make a request line of about 4 KB — half of the 8 KB
    a common proxy buffers for one. A hundred came to 7.9 KB, right at that
    edge; a URL too long for a proxy would fail, and fall through to the
    empty set, silently showing every twin. */
export const ECHO_CHUNK = 50;

type DbError = { code?: string; message?: string } | null;
const missingColumn = (e: DbError) => e?.code === "PGRST204" || e?.code === "42703";

type EchoRow = { remote_uuid: string | null; replaced_uuids?: string[] | null };

async function readEchoes(orgId: string, part: readonly string[]): Promise<{ data: EchoRow[] | null; error: DbError }> {
  const list = part.join(",");
  const both = await supabaseAdmin
    .from("sm8_writes")
    .select("remote_uuid, replaced_uuids")
    .eq("org_id", orgId)
    .or(`remote_uuid.in.(${list}),replaced_uuids.ov.{${list}}`);
  if (!missingColumn(both.error)) return { data: (both.data ?? null) as EchoRow[] | null, error: both.error };
  /* a database without replaced_uuids yet: the uuids each row holds now */
  const now = await supabaseAdmin.from("sm8_writes").select("remote_uuid").eq("org_id", orgId).in("remote_uuid", [...part]);
  return { data: (now.data ?? null) as EchoRow[] | null, error: now.error };
}

/** Which of these ServiceM8 uuids HeyTiff minted for its own writes — any
    status, any kind. Only well-formed uuids are ever put in a filter.

    WHATEVER THE CASE. HeyTiff mints its uuids lower case, and ServiceM8
    has mirrored the one sent so far back unchanged (checked read-only on
    2026-09-25); but a copy that came back in capitals would otherwise show
    twice and be downloaded back. So the ask and the match are lower case,
    and what comes back is each uuid as the caller gave it. */
export async function sm8Ours(orgId: string, uuids: readonly string[]): Promise<Set<string>> {
  /* each uuid, lower case, and every spelling the caller gave it */
  const given = new Map<string, string[]>();
  for (const u of uuids) {
    if (typeof u !== "string" || !UUID.test(u)) continue;
    const key = u.toLowerCase();
    const seen = given.get(key);
    if (!seen) given.set(key, [u]);
    else if (!seen.includes(u)) seen.push(u);
  }
  const asked = [...given.keys()];
  const ours = new Set<string>();
  if (asked.length === 0) return ours;
  const mark = (u: string | null | undefined) => {
    for (const as of (u && given.get(u.toLowerCase())) || []) ours.add(as);
  };

  try {
    for (let i = 0; i < asked.length; i += ECHO_CHUNK) {
      const part = asked.slice(i, i + ECHO_CHUNK);
      const { data, error } = await readEchoes(orgId, part);
      if (error) {
        console.error(`[sm8] couldn't read which ServiceM8 files org ${orgId} sent itself:`, error);
        return new Set();
      }
      const wanted = new Set(part);
      for (const r of (data ?? []) as EchoRow[]) {
        if (r.remote_uuid && wanted.has(r.remote_uuid.toLowerCase())) mark(r.remote_uuid);
        for (const u of r.replaced_uuids ?? []) if (wanted.has(u.toLowerCase())) mark(u);
      }
    }
  } catch (err) {
    console.error(
      `[sm8] couldn't read which ServiceM8 files org ${orgId} sent itself: ${err instanceof Error ? err.message : String(err)}`
    );
    return new Set();
  }
  return ours;
}

/** `rows` without the ones whose uuid is ours. */
export function withoutOurs<T>(rows: readonly T[], uuidOf: (r: T) => string, ours: ReadonlySet<string>): T[] {
  if (ours.size === 0) return [...rows];
  return rows.filter((r) => !ours.has(uuidOf(r)));
}
