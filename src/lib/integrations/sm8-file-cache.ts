/* The 30-day cap on HeyTiff's copies of ServiceM8's job files — server only.

   WHY. The bucket is a lazy cache (app/actions/workboard-media.ts): a job's
   files are copied across the first time somebody opens it, and every copy
   still lives in ServiceM8. On 2026-09-28 those copies were 889 MB of the
   free plan's 1 GB. A copy nobody has looked at in 30 days is evicted, and
   the next open brings it back exactly as a first open does.

   WHAT "CACHED" MEANS TO A READER: a `documents` row of source 'servicem8'
   whose `uploaded_at` is set (job-media-query, the showcase, photo search,
   the photo reader, the compliance send, and the cacher's own "have" list).
   So an eviction takes that mark off FIRST, then the object, then the row:
     - stop after the first step, and the row is an unconfirmed slot — every
       reader passes it by, and the next open re-takes it (the upload is an
       upsert on the same path);
     - stop after the second, and the same;
     - never is there a confirmed row whose object has gone, which is the one
       state that would draw a broken tile and never fetch it again.

   WHAT IS NEVER TOUCHED. Only kind 'job_file' AND source 'servicem8' — the
   one kind nobody here uploaded. Every other kind is somebody's upload:
   licences, staff photos, the business's papers, notice attachments, and
   `job_document` (a file somebody put on a job — the only thing HeyTiff
   ever SENDS to ServiceM8, app/actions/job-sm8.ts). Every query below
   carries both filters, and the object path must sit in the org's own
   `job_file` folder too.

   A STARRED PHOTO IS KEPT. The showcase signs the cached copy and draws a
   plate when there is none — it never fetches one back — so a star keeps
   its picture however long nobody opens the job (1 of 956 on 2026-09-28).

   SEARCH NEEDS NONE OF THIS. `search_job_photos` reads job_photo_readings'
   text and never the bytes; a hit whose copy has gone draws as a plate and
   is still a real result. The readings stay. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";

/** The kind and source every read and write here is pinned to. */
export const CACHED_SM8_FILE = { kind: "job_file", source: "servicem8" } as const;

/** A copy not shown to anybody for this long goes. */
export const FILE_CACHE_DAYS = 30;

/** One night's bounds: objects evicted, and wall time spent. */
export const EVICT_MAX = 200;
export const EVICT_BUDGET_MS = 20_000;

const DAY_MS = 86_400_000;

/** Rows per filter: a uuid is ~39 characters once its comma is encoded, so
    fifty keep a request line near 2 KB (the same bound sm8-echo keeps). */
const PART = 50;

/** Candidate rows read per page, and pages per night. */
const PAGE = 500;
const MAX_PAGES = 4;

type DbError = { code?: string; message?: string } | null;

/** The column isn't there yet: the migration hasn't been applied. */
const missingColumn = (e: DbError) => e?.code === "42703" || e?.code === "PGRST204";

function parts<T>(rows: readonly T[], size = PART): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Rows not shown since `sinceMs` — last_opened_at older, or (a row from
    before the column) never stamped and created before it. */
const notOpenedSince = (sinceMs: number) =>
  `last_opened_at.lt.${iso(sinceMs)},and(last_opened_at.is.null,created_at.lt.${iso(sinceMs)})`;

/* ── the stamp ─────────────────────────────────────────────────────────── */

/** Mark these cached ServiceM8 files as shown to somebody, now.

    AT MOST ONCE A DAY PER ROW: the update only matches a row not stamped in
    the last day, so re-opening a job all afternoon writes nothing after the
    first time. One request per fifty files, on the (org_id, source,
    remote_ref) index.

    NEVER THROWS, and never holds up a page: a failed stamp costs at most an
    early re-download, logged. A database without the column is silent. */
export async function touchSm8Files(
  orgId: string,
  remoteRefs: readonly string[],
  now: number = Date.now()
): Promise<void> {
  const refs = [...new Set(remoteRefs.filter((r) => typeof r === "string" && r.length > 0))];
  if (!orgId || refs.length === 0) return;
  try {
    for (const part of parts(refs)) {
      const { error } = await supabaseAdmin
        .from("documents")
        .update({ last_opened_at: iso(now) })
        .eq("org_id", orgId)
        .eq("kind", CACHED_SM8_FILE.kind)
        .eq("source", CACHED_SM8_FILE.source)
        .in("remote_ref", part)
        .or(notOpenedSince(now - DAY_MS));
      if (error) {
        if (!missingColumn(error)) console.error(`[sm8-cache] couldn't stamp ${part.length} files for org ${orgId}:`, error);
        return;
      }
    }
  } catch (e) {
    console.error(`[sm8-cache] couldn't stamp files for org ${orgId}:`, e);
  }
}

/* ── the eviction ──────────────────────────────────────────────────────── */

type Candidate = {
  id: string;
  org_id: string;
  remote_ref: string | null;
  storage_ref: string;
  size_bytes: number | null;
};

export type EvictResult = {
  /** Objects and rows removed. */
  evicted: number;
  /** Their size, as the rows recorded it. */
  bytes: number;
  /** Past the cap but starred, so kept. */
  starred: number;
  /** Taken off the readers' list but not finished; the next night retries. */
  failed: number;
  /** Stopped by EVICT_MAX or the time budget with more to do. */
  capped: boolean;
  /** The column isn't there yet, or the read failed: nothing was touched. */
  skipped: boolean;
};

const NONE: EvictResult = { evicted: 0, bytes: 0, starred: 0, failed: 0, capped: false, skipped: false };

/** Whether this object path is one the cacher writes for this org: the
    org's own `job_file` folder, and nothing else in the bucket. */
export const isCachedSm8Path = (ref: string, orgId: string) =>
  typeof ref === "string" && ref.startsWith(`org/${orgId}/${CACHED_SM8_FILE.kind}/`) && !ref.includes("..");

/** Evict the cached ServiceM8 files nobody has been shown in
    FILE_CACHE_DAYS, oldest first, across every workspace — at most `max`
    of them and `budgetMs` of wall time. Never throws. */
export async function evictStaleSm8Files(
  now: number = Date.now(),
  opts: { max?: number; budgetMs?: number } = {}
): Promise<EvictResult> {
  const max = opts.max ?? EVICT_MAX;
  const budgetMs = opts.budgetMs ?? EVICT_BUDGET_MS;
  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > budgetMs;
  const cutoff = now - FILE_CACHE_DAYS * DAY_MS;

  try {
    /* 1. The candidates, oldest first, less the starred. Read in pages so a
       run of starred photos at the head of the queue can't stall the night. */
    const picked: Candidate[] = [];
    let starred = 0;
    let more = false;
    for (let page = 0; page < MAX_PAGES && picked.length < max && !outOfTime(); page++) {
      const { data, error } = await supabaseAdmin
        .from("documents")
        .select("id, org_id, remote_ref, storage_ref, size_bytes")
        .eq("kind", CACHED_SM8_FILE.kind)
        .eq("source", CACHED_SM8_FILE.source)
        .or(notOpenedSince(cutoff))
        .order("last_opened_at", { ascending: true, nullsFirst: true })
        .order("id", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) {
        if (!missingColumn(error)) console.error("[sm8-cache] couldn't read the stale cached files:", error);
        return { ...NONE, skipped: true };
      }
      const rows = ((data ?? []) as Candidate[]).filter((r) => isCachedSm8Path(r.storage_ref, r.org_id));
      const kept = await starredOf(rows);
      if (kept === null) {
        /* can't tell which are starred: touch none of them */
        return { ...NONE, skipped: true };
      }
      for (const r of rows) {
        if (r.remote_ref && kept.has(`${r.org_id}|${r.remote_ref}`)) {
          starred += 1;
          continue;
        }
        if (picked.length >= max) {
          more = true;
          break;
        }
        picked.push(r);
      }
      if ((data ?? []).length < PAGE) break;
      if (page === MAX_PAGES - 1 || picked.length >= max) more = true;
    }
    if (picked.length === 0) return { ...NONE, starred, capped: more };

    let evicted = 0;
    let bytes = 0;
    let failed = 0;
    let capped = more;

    for (const part of parts(picked)) {
      if (outOfTime()) {
        capped = true;
        break;
      }

      /* 2. Off the readers' list. Conditional on still being stale, so a row
         somebody opened since step 1 is left alone. */
      const { data: taken, error: takeErr } = await supabaseAdmin
        .from("documents")
        .update({ uploaded_at: null })
        .eq("kind", CACHED_SM8_FILE.kind)
        .eq("source", CACHED_SM8_FILE.source)
        .in(
          "id",
          part.map((r) => r.id)
        )
        .or(notOpenedSince(cutoff))
        .select("id, org_id, storage_ref, size_bytes");
      if (takeErr) {
        console.error(`[sm8-cache] couldn't take ${part.length} cached files off the list:`, takeErr);
        failed += part.length;
        continue;
      }
      const rows = ((taken ?? []) as Candidate[]).filter((r) => isCachedSm8Path(r.storage_ref, r.org_id));
      if (rows.length === 0) continue;

      /* 3. The objects. A refusal leaves the rows unconfirmed — invisible,
         re-fetched on the next open, and retried here tomorrow. */
      const { error: rmErr } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove(rows.map((r) => r.storage_ref));
      if (rmErr) {
        console.error(`[sm8-cache] storage refused to remove ${rows.length} cached files:`, rmErr);
        failed += rows.length;
        continue;
      }

      /* 4. The rows — only while still unconfirmed. One a job's open
         re-cached between steps 2 and 4 is confirmed again, and its object
         may be the one step 3 just removed: it goes back to unconfirmed, so
         its next open fetches it rather than drawing a broken tile. */
      const ids = rows.map((r) => r.id);
      const { data: gone, error: delErr } = await supabaseAdmin
        .from("documents")
        .delete()
        .eq("kind", CACHED_SM8_FILE.kind)
        .eq("source", CACHED_SM8_FILE.source)
        .in("id", ids)
        .is("uploaded_at", null)
        .select("id");
      if (delErr) {
        console.error(`[sm8-cache] couldn't delete ${ids.length} evicted rows:`, delErr);
        failed += ids.length;
        continue;
      }
      const deleted = new Set(((gone ?? []) as { id: string }[]).map((r) => r.id));
      const raced = ids.filter((id) => !deleted.has(id));
      if (raced.length > 0) {
        await supabaseAdmin
          .from("documents")
          .update({ uploaded_at: null })
          .eq("kind", CACHED_SM8_FILE.kind)
          .eq("source", CACHED_SM8_FILE.source)
          .in("id", raced);
      }
      for (const r of rows) {
        if (!deleted.has(r.id)) continue;
        evicted += 1;
        bytes += r.size_bytes ?? 0;
      }
    }

    return { evicted, bytes, starred, failed, capped, skipped: false };
  } catch (e) {
    console.error("[sm8-cache] eviction failed:", e);
    return { ...NONE, skipped: true };
  }
}

/** Which of these rows are starred photos, as `org|attachment uuid`. Null
    when it can't be told — the caller then evicts none of them. */
async function starredOf(rows: readonly Candidate[]): Promise<Set<string> | null> {
  const byOrg = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.remote_ref) continue;
    const list = byOrg.get(r.org_id) ?? [];
    list.push(r.remote_ref);
    byOrg.set(r.org_id, list);
  }
  const out = new Set<string>();
  for (const [orgId, refs] of byOrg) {
    for (const part of parts(refs)) {
      const { data, error } = await supabaseAdmin
        .from("job_photo_favourites")
        .select("sm8_attachment_uuid")
        .eq("org_id", orgId)
        .in("sm8_attachment_uuid", part);
      if (error) {
        console.error(`[sm8-cache] couldn't read the stars for org ${orgId}:`, error);
        return null;
      }
      for (const f of (data ?? []) as { sm8_attachment_uuid: string }[]) out.add(`${orgId}|${f.sm8_attachment_uuid}`);
    }
  }
  return out;
}
