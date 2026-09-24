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
  fileTypeForMime,
  groupJobMedia,
  JOB_MEDIA_CAP,
  jobMediaKind,
  originLabel,
  type JobMediaItem,
} from "./job-media";
import { staffDisplayNames } from "./job-notes-query";
import { sm8Ours, withoutOurs } from "@/lib/integrations/sm8-echo";
import { naiveInZone } from "./job-story";
import { getSm8Timezone } from "./query";

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
     out of the photo lens.

     OUR OWN FILES COME OFF FIRST OF ALL. A file HeyTiff sent is mirrored back
     by the next sync as one of ServiceM8's; its uuid is one HeyTiff minted
     (lib/integrations/sm8-echo), so it is left off here — every face, and
     the story — whether or not HeyTiff's own row for it still shows. */
  const fetched = (data ?? []) as AttachmentRow[];
  const ours = await sm8Ours(
    orgId,
    fetched.map((r) => r.uuid)
  );
  const all = withoutOurs(fetched, (r) => r.uuid, ours);

  /* THE NAME DEDUPE IS ACROSS SOURCES ONLY — and the version that wasn't hid
     72% of the account's files.

     It exists for one thing: ServiceM8 CLONES a job to bill it in stages, and
     470 of the 758 liftable files are copies it made in the process, so a
     naive merge shows half the gallery twice. The parent's copy wins because
     it is the one whose cached bytes the job already points at.

     The version this replaces keyed one flat Set on `name|file_type` over
     EVERY row, parent's own included, under the comment "two different photos
     are never called the same thing by the same camera". That is simply false
     of ServiceM8: its own app names every phone upload literally `Photo`.
     Job #907 holds 91 live attachments — 75 `.jpg` and 9 `.avif` all called
     `Photo` — which collapsed to SIX, so the card offered two pictures of a
     job that has eighty-four. Across the account: 39,952 attachments, 11,124
     surviving, **28,828 photographs of real work dropped across 1,815 jobs**.

     So the parent's own files are never deduped against each other — a job
     may hold two hundred files called `Photo` and every one of them is a
     different photograph. Only a CLAIM's file is checked, and only against
     names the parent already has. `sources` puts the job first, so by the
     time a claim's rows are read the parent's names are all in the set. */
  /* THE NAME IS OUT OF THE KEY ENTIRELY — the last place it survived, and it
     was still wrong.

     The parent-vs-parent half went first: ServiceM8 names every upload
     `Photo`, so a flat name key collapsed 28,828 photographs. This is the
     other half. A claim's row was still dropped when the parent held ANY row
     with the same name and type — which, since every name is `Photo`, means
     a claim's genuinely different photograph was dropped whenever the parent
     had any photograph at all. Measured against the live mirror, scoped the
     way this function scopes it: 626 photos on claim rows, 78 of them dropped
     across 16 jobs, and NOT ONE of those 78 had a parent twin sharing its
     timestamp. They were not copies. They were photographs of real work.

     WHAT A CLONE COPY ACTUALLY IS: ServiceM8 preserves the timestamp when it
     clones, so a copy matches on EVERYTHING — name, second, type and both
     dimensions. The name is still in the key, and that is not a relapse: the
     bug was ever using the name ALONE, where `Photo` matches `Photo` and
     decides nothing. As one conjunct among five it can only narrow the key,
     so this drops strictly fewer files than before and never more.

     The timestamp is what does the real work. A photograph taken while a
     clone was open has its own second on the clock and survives. */
  const parentCopies = new Set<string>();
  const surviving: AttachmentRow[] = [];
  const copyKey = (r: AttachmentRow) =>
    [
      (r.attachment_name?.trim() || "Untitled file").toLowerCase(),
      r.timestamp ?? "",
      (r.file_type ?? "").toLowerCase(),
      r.photo_width ?? "",
      r.photo_height ?? "",
    ].join("|");
  for (const r of all) {
    const claim = claimOf.get(r.related_object_uuid) ?? null;
    const name = r.attachment_name?.trim() || "Untitled file";
    if (claim === null) {
      /* The job's own. Kept unconditionally; it is what a claim's copy is
         later measured against. */
      parentCopies.add(copyKey(r));
      surviving.push(r);
      continue;
    }
    /* "Partial Invoice #2380A" is about the billing, not the work — it stays
       on the claim (426 live). This one IS a name test, and rightly: it is
       ServiceM8's own generated paperwork title, not a camera's filename. */
    if (isPartialInvoicePaper(name)) continue;
    if (parentCopies.has(copyKey(r))) continue;
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

/** The id a file of OURS goes by on the card — never a ServiceM8 uuid, so
    the viewer's lookup by id can't land on one of theirs. */
export const ourDocumentRemoteId = (documentId: string) => `doc:${documentId}`;

/** The files somebody put on this job from its Documents face — ours, in
    `documents` as `job_document`, newest first. ServiceM8 never had them, so
    they are read here beside its list rather than out of the mirror.

    ALWAYS PAPER. A photograph uploaded to the Documents face is a document —
    somebody filed it there, as a certificate or a plan — so it is `document`
    whatever its bytes are. Called `photo` it would join the diary's photo
    clusters, whose "+N" leads to a Photos face that never shows it. */
export async function readOurJobDocuments(orgId: string, jobUuid: string): Promise<JobMediaItem[]> {
  const { data } = await supabaseAdmin
    .from("documents")
    .select("id, file_name, mime_type, storage_ref, uploaded_at, uploaded_by")
    .eq("org_id", orgId)
    .eq("kind", "job_document")
    .eq("sm8_job_uuid", jobUuid)
    /* a slot handed out and never filled is nobody's file */
    .not("uploaded_at", "is", null)
    .order("uploaded_at", { ascending: false })
    .limit(JOB_MEDIA_CAP);
  const rows = (data ?? []) as {
    id: string;
    file_name: string;
    mime_type: string;
    storage_ref: string;
    uploaded_at: string;
    uploaded_by: string | null;
  }[];
  if (rows.length === 0) return [];

  const [signed, names, timezone] = await Promise.all([
    supabaseAdmin.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrls(
        rows.map((r) => r.storage_ref),
        SIGNED_URL_SECONDS
      ),
    staffDisplayNames(
      orgId,
      rows.map((r) => r.uploaded_by)
    ),
    getSm8Timezone(orgId),
  ]);
  const urls = new Map<string, string>();
  for (const s of signed.data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);

  return rows.map((r) => ({
    remoteId: ourDocumentRemoteId(r.id),
    name: r.file_name,
    fileType: fileTypeForMime(r.mime_type),
    kind: "document" as const,
    origin: null,
    /* the account's own clock, the same naive shape ServiceM8's stamps
       arrive in, so the face's day reads the same for both */
    takenAt: naiveInZone(r.uploaded_at, timezone),
    url: urls.get(r.storage_ref) ?? null,
    width: null,
    height: null,
    fromClaim: null,
    documentId: r.id,
    addedBy: r.uploaded_by ? names.get(r.uploaded_by) ?? null : null,
  }));
}

/** Two newest-first lists as one. Stable: each list keeps its own order, and
    a stamp we can't read sinks rather than jumping the queue. */
function byNewest(a: readonly JobMediaItem[], b: readonly JobMediaItem[]): JobMediaItem[] {
  const out: JobMediaItem[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const x = a[i];
    const y = b[j];
    if (!y || (x && (x.takenAt ?? "") >= (y.takenAt ?? ""))) {
      out.push(x);
      i += 1;
    } else {
      out.push(y);
      j += 1;
    }
  }
  return out;
}

export type JobMediaGroupsRead = ReturnType<typeof groupJobMedia> & { truncated: boolean };

/** The sheet's shape — grouped, then capped PER LENS. `truncated` is true
    when anything anywhere was left off: the DB window, or either lens.

    OUR FILES RIDE IN HERE, not beside the call. Every reader that hands the
    card its media goes through this — the first read, the caching loop's
    refreshes, a star — and a list that only the first read carried would
    lose them the moment the caching loop reported back. */
export async function readJobMediaGroups(
  orgId: string,
  jobUuid: string,
  claims: readonly MediaSource[] = []
): Promise<JobMediaGroupsRead> {
  const [read, ours] = await Promise.all([
    readJobMedia(orgId, jobUuid, claims),
    readOurJobDocuments(orgId, jobUuid),
  ]);
  const groups = groupJobMedia(read.items);
  const clipped =
    groups.photos.length > JOB_MEDIA_CAP ||
    groups.documents.length > JOB_MEDIA_CAP ||
    groups.elsewhere.length > JOB_MEDIA_CAP;
  return {
    photos: groups.photos.slice(0, JOB_MEDIA_CAP),
    documents: byNewest(ours, groups.documents.slice(0, JOB_MEDIA_CAP)),
    elsewhere: groups.elsewhere.slice(0, JOB_MEDIA_CAP),
    truncated: read.truncated || clipped,
  };
}
