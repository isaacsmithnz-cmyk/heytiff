/* One job's files: what ServiceM8 says it has, and which of them we hold a
   copy of.

   THE MIRROR IS THE LIST, THE BUCKET IS THE CACHE. sm8_attachments says what
   exists — that read is always complete and always cheap. `documents` rows
   with source='servicem8' say which of those we have bytes for, and they are
   the only thing that costs storage. A file with no cached copy is still
   listed; it simply has no URL yet.

   SOFT DELETES ARE REAL DELETES HERE. ServiceM8 flips active to 0 rather than
   removing a row, and those rows keep arriving from the API — 456 of them in
   the live account, 414 of which are photos. Somebody deleted those on
   purpose (wrong job, wrong client, a face in shot), so `active = 1` is not
   an optimisation, it is the difference between a grid and a resurrection.
   The test pins it.

   NO SESSION HERE — the caller establishes the right to ask, exactly as
   readMirrorJobDetail's caller does. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { DOCUMENTS_BUCKET, SIGNED_URL_SECONDS } from "@/lib/documents/query";
import { isPartialInvoicePaper } from "./job-family";
import {
  groupJobMedia,
  JOB_MEDIA_CAP,
  jobMediaKind,
  originLabel,
  type JobMediaItem,
} from "./job-media";

export type JobMediaRead = {
  items: JobMediaItem[];
  /** True when the cap bound: the job has more files than this list shows. */
  truncated: boolean;
};

export const EMPTY_JOB_MEDIA: JobMediaRead = { items: [], truncated: false };

type AttachmentRow = {
  uuid: string;
  attachment_name: string | null;
  file_type: string | null;
  attachment_source: string | null;
  timestamp: string | null;
  related_object_uuid: string;
  photo_width: number | null;
  photo_height: number | null;
};

/* The DB read's own bound — wide enough that BOTH lenses can fill to their
   JOB_MEDIA_CAP after the sweep and the dedupe. The biggest live job holds
   223 photos, so three lenses' worth of headroom covers the account. */
const FETCH_CAP = JOB_MEDIA_CAP * 3;

/** ServiceM8 sends 0 for a dimension it doesn't know — 4,213 live rows do.
    Zero is a sentinel, not a size. */
const px = (v: number | null): number | null => (typeof v === "number" && v > 0 ? v : null);

/** One member of the job's family, as the media read needs to see it. */
export type MediaSource = {
  remoteId: string;
  /** Null for the job itself; the claim's number for a progress clone. */
  claimNumber: string | null;
};

/** Every file ServiceM8 holds against one job — and, when the job was billed
    in stages, against its claims too.

    WHY THE CLAIMS ARE READ HERE. ServiceM8 bills a progress job by cloning
    it, and a photo taken on site lands on whichever clone happened to be
    open: 1,432 files sit on clones live, 622 of them photos. They are about
    the WORK, so they belong to the job's gallery — the alternative is 622
    photographs of real work reachable only through a card that is on its way
    to not existing.

    TWO THINGS DO NOT RISE. The claim's own "Partial Invoice #2380A" PDF stays
    with the claim (426 live) — it is about the billing, not the work. And a
    file already on the parent under the same name is NOT added again: 470 of
    the 758 liftable files are copies ServiceM8 made when it cloned, so a
    naive merge shows half the gallery twice. The parent's copy wins, because
    it is the one whose cached bytes the job already points at. */
export async function readJobMedia(
  orgId: string,
  jobUuid: string,
  claims: readonly MediaSource[] = []
): Promise<JobMediaRead> {
  /* The job first, so its own copy is the one that survives the dedupe. */
  const sources: MediaSource[] = [
    { remoteId: jobUuid, claimNumber: null },
    ...claims.filter((c) => c.remoteId !== jobUuid),
  ];
  const claimOf = new Map(sources.map((c) => [c.remoteId, c.claimNumber]));

  const { data } = await supabaseAdmin
    .from("sm8_attachments")
    .select(
      "uuid, attachment_name, file_type, attachment_source, timestamp, related_object_uuid, photo_width, photo_height"
    )
    .eq("org_id", orgId)
    .in("related_object_uuid", sources.map((c) => c.remoteId))
    /* MUTATION-CHECKED: remove this line and job-media-query.test.ts fails.
       `active = 0` is ServiceM8's delete, and those rows keep arriving — 456
       of them in the live account, 414 photos among them. Without this the
       grid doesn't go stale, it un-deletes. */
    .eq("active", 1)
    .order("timestamp", { ascending: false })
    .limit(FETCH_CAP + 1);

  /* Swept and deduped FIRST; the per-lens cap is groupJobMedia's — capping
     this flat list was the defect that let paperwork crowd a job's photos
     out of the photo lens. */
  const all = (data ?? []) as AttachmentRow[];
  const seen = new Set<string>();
  const surviving: AttachmentRow[] = [];
  for (const r of all) {
    const claim = claimOf.get(r.related_object_uuid) ?? null;
    const name = r.attachment_name?.trim() || "Untitled file";
    if (claim !== null && isPartialInvoicePaper(name)) continue;
    /* Name AND type together: two different photos are never called the same
       thing by the same camera, and a PDF sharing a photo's name is not the
       same file. */
    const key = `${name.toLowerCase()}|${(r.file_type ?? "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    surviving.push(r);
  }

  const truncated = surviving.length > FETCH_CAP;
  const kept = truncated ? surviving.slice(0, FETCH_CAP) : surviving;
  if (kept.length === 0) return EMPTY_JOB_MEDIA;

  /* What we already hold. Keyed by the ServiceM8 uuid, which is what
     remote_ref carries — and only rows whose upload was CONFIRMED, so a slot
     handed out and never filled can't render as a broken tile. */
  const { data: cachedData } = await supabaseAdmin
    .from("documents")
    .select("remote_ref, storage_ref")
    .eq("org_id", orgId)
    .eq("source", "servicem8")
    .in("sm8_job_uuid", sources.map((c) => c.remoteId))
    .not("uploaded_at", "is", null);

  const cached = new Map(
    ((cachedData ?? []) as { remote_ref: string | null; storage_ref: string }[])
      .filter((r) => r.remote_ref)
      .map((r) => [r.remote_ref as string, r.storage_ref])
  );

  /* One signing call for the whole job, not one per photo — the reason the
     bytes live in this bucket at all. */
  const urls = new Map<string, string>();
  if (cached.size > 0) {
    const { data: signed } = await supabaseAdmin.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrls([...new Set(cached.values())], SIGNED_URL_SECONDS);
    for (const row of signed ?? []) {
      if (row.path && row.signedUrl) urls.set(row.path, row.signedUrl);
    }
  }

  const items: JobMediaItem[] = kept.map((r) => {
    const ref = cached.get(r.uuid);
    return {
      remoteId: r.uuid,
      name: r.attachment_name?.trim() || "Untitled file",
      fileType: r.file_type,
      kind: jobMediaKind(r.file_type),
      origin: originLabel(r.attachment_source),
      takenAt: r.timestamp,
      url: ref ? urls.get(ref) ?? null : null,
      width: px(r.photo_width),
      height: px(r.photo_height),
      fromClaim: claimOf.get(r.related_object_uuid) ?? null,
    };
  });

  return { items, truncated };
}

export type JobMediaGroupsRead = ReturnType<typeof groupJobMedia> & { truncated: boolean };

/** The sheet's shape — grouped, then capped PER LENS. `truncated` is true
    when anything anywhere was left off: the DB window, or either lens. */
export async function readJobMediaGroups(
  orgId: string,
  jobUuid: string,
  claims: readonly MediaSource[] = []
): Promise<JobMediaGroupsRead> {
  const read = await readJobMedia(orgId, jobUuid, claims);
  const groups = groupJobMedia(read.items);
  const clipped =
    groups.photos.length > JOB_MEDIA_CAP ||
    groups.documents.length > JOB_MEDIA_CAP ||
    groups.elsewhere.length > JOB_MEDIA_CAP;
  return {
    photos: groups.photos.slice(0, JOB_MEDIA_CAP),
    documents: groups.documents.slice(0, JOB_MEDIA_CAP),
    elsewhere: groups.elsewhere.slice(0, JOB_MEDIA_CAP),
    truncated: read.truncated || clipped,
  };
}
