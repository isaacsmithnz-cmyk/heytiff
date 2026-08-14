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
};

/** Every file ServiceM8 holds against one job, newest first, with a signed
    URL on the ones already cached here. */
export async function readJobMedia(orgId: string, jobUuid: string): Promise<JobMediaRead> {
  const { data } = await supabaseAdmin
    .from("sm8_attachments")
    .select("uuid, attachment_name, file_type, attachment_source, timestamp")
    .eq("org_id", orgId)
    .eq("related_object_uuid", jobUuid)
    /* MUTATION-CHECKED: remove this line and job-media-query.test.ts fails.
       `active = 0` is ServiceM8's delete, and those rows keep arriving — 456
       of them in the live account, 414 photos among them. Without this the
       grid doesn't go stale, it un-deletes. */
    .eq("active", 1)
    .order("timestamp", { ascending: false })
    .limit(JOB_MEDIA_CAP + 1);

  const rows = (data ?? []) as AttachmentRow[];
  const truncated = rows.length > JOB_MEDIA_CAP;
  const kept = truncated ? rows.slice(0, JOB_MEDIA_CAP) : rows;
  if (kept.length === 0) return EMPTY_JOB_MEDIA;

  /* What we already hold. Keyed by the ServiceM8 uuid, which is what
     remote_ref carries — and only rows whose upload was CONFIRMED, so a slot
     handed out and never filled can't render as a broken tile. */
  const { data: cachedData } = await supabaseAdmin
    .from("documents")
    .select("remote_ref, storage_ref")
    .eq("org_id", orgId)
    .eq("source", "servicem8")
    .eq("sm8_job_uuid", jobUuid)
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
    };
  });

  return { items, truncated };
}

export type JobMediaGroupsRead = ReturnType<typeof groupJobMedia> & { truncated: boolean };

/** The sheet's shape — grouped, ready to render. */
export async function readJobMediaGroups(
  orgId: string,
  jobUuid: string
): Promise<JobMediaGroupsRead> {
  const read = await readJobMedia(orgId, jobUuid);
  return { ...groupJobMedia(read.items), truncated: read.truncated };
}
