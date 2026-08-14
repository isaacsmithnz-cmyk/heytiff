"use server";

/* Bringing a job's files across, a few at a time.

   LAZY, NOT EAGER, AND THAT IS THE WHOLE STORAGE PLAN. The live account holds
   ~35,000 files on jobs; copying them all would be tens of gigabytes against
   a bucket sized in single ones. Bytes are fetched only for a job somebody
   actually opened, so a job nobody looks at costs nothing forever.

   THE BROWSER IS THE LOOP, because there is no server-side queue — the same
   shape the knowledge-base backfill uses. Each call takes a bounded bite and
   reports how many remain; the sheet calls again while that number falls and
   stops the moment it doesn't. A server that keeps saying "6 left" while
   caching none is a bug, not a backlog.

   NOTHING IS STORED UNTIL THE BYTES AGREE THEY ARE A FILE. The download
   redirects to a CDN, where an expired link or an error page arrives as a
   cheerful 200 — so fetchSm8AttachmentFile sniffs the magic number and this
   never writes a row for something that failed that test.

   ROW FIRST, THEN BYTES, THEN THE CONFIRMATION — the documents convention.
   A row without `uploaded_at` is a slot nobody reads, so a crash between the
   upload and the confirmation leaves something invisible rather than a broken
   tile, and the next call retakes it. */

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { sm8Access } from "@/lib/integrations/sm8-store";
import { fetchSm8AttachmentFile } from "@/lib/integrations/sm8-attachment-file";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { storageRef } from "@/lib/documents/files";
import { isCacheableMedia, normaliseFileType } from "@/lib/workboard/job-media";
import { readJobMediaGroups, type JobMediaGroupsRead } from "@/lib/workboard/job-media-query";

/** How many files one call brings across. Small enough that a serverless
    invocation finishes comfortably (a photo is well under a megabyte), big
    enough that a 26-photo job is a handful of rounds. */
const BATCH = 6;

export type CacheJobFilesResult = {
  ok: boolean;
  /** How many this call actually stored. Zero with `remaining > 0` means
      stop — retrying would spin. */
  cached: number;
  /** Cacheable files still without bytes. */
  remaining: number;
  media: JobMediaGroupsRead | null;
  /** Said out loud when the bucket is full, rather than failing silently. */
  note: string | null;
};

const NOTHING: CacheJobFilesResult = { ok: false, cached: 0, remaining: 0, media: null, note: null };

/** The org comes off the session, exactly as workboard.ts's own context()
    reads it — never looked up from an email, and never taken from the client. */
async function orgOf(): Promise<string | null> {
  const session = await auth0.getSession();
  return (session?.orgId as string | undefined) ?? null;
}

export async function cacheJobFiles(jobUuid: string): Promise<CacheJobFilesResult> {
  if (!(await can("workboard"))) return NOTHING;
  const orgId = await orgOf();
  const id = (jobUuid ?? "").trim().slice(0, 80);
  if (!orgId || !id) return NOTHING;

  const access = await sm8Access(orgId);
  if (!access) return { ...NOTHING, note: "ServiceM8 isn't connected." };

  /* Live files on this job, and what we already hold. `active = 1` for the
     same reason the grid filters it: a deleted file must not be fetched back
     into existence. */
  const [{ data: attachRows }, { data: haveRows }] = await Promise.all([
    supabaseAdmin
      .from("sm8_attachments")
      .select("uuid, attachment_name, file_type")
      .eq("org_id", orgId)
      .eq("related_object_uuid", id)
      .eq("active", 1)
      .order("timestamp", { ascending: false })
      .limit(200),
    supabaseAdmin
      .from("documents")
      .select("remote_ref")
      .eq("org_id", orgId)
      .eq("source", "servicem8")
      .eq("sm8_job_uuid", id)
      .not("uploaded_at", "is", null),
  ]);

  const have = new Set(
    ((haveRows ?? []) as { remote_ref: string | null }[]).map((r) => r.remote_ref).filter(Boolean)
  );

  const wanted = ((attachRows ?? []) as {
    uuid: string;
    attachment_name: string | null;
    file_type: string | null;
  }[]).filter((r) => isCacheableMedia(r.file_type) && !have.has(r.uuid));

  if (wanted.length === 0) {
    return { ok: true, cached: 0, remaining: 0, media: await readJobMediaGroups(orgId, id), note: null };
  }

  let cached = 0;
  let note: string | null = null;

  for (const row of wanted.slice(0, BATCH)) {
    const file = await fetchSm8AttachmentFile(access.accessToken, row.uuid);
    if (!file.ok) {
      /* A dead grant ends the batch — every other file would fail the same
         way. Anything else is this one file's problem: skip it and carry on,
         so one bad attachment can't hide the other twenty. */
      if (file.reason === "unauthorized") {
        note = "ServiceM8 refused the download — reconnect it.";
        break;
      }
      continue;
    }

    const ext = (normaliseFileType(row.file_type) ?? ".bin").slice(1);

    // Row first: an unconfirmed slot is invisible to every reader.
    const { data: slot, error: slotError } = await supabaseAdmin
      .from("documents")
      .upsert(
        {
          org_id: orgId,
          kind: "job_file",
          source: "servicem8",
          remote_ref: row.uuid,
          sm8_job_uuid: id,
          file_name: row.attachment_name?.trim() || `file.${ext}`,
          mime_type: file.contentType,
          size_bytes: file.bytes.byteLength,
          storage_ref: "",
        },
        { onConflict: "org_id,source,remote_ref" }
      )
      .select("id")
      .maybeSingle();

    const documentId = (slot as { id: string } | null)?.id;
    if (slotError || !documentId) continue;

    const ref = storageRef(orgId, "job_file", documentId, ext);
    const { error: upErr } = await supabaseAdmin.storage
      .from(DOCUMENTS_BUCKET)
      .upload(ref, file.bytes, { contentType: file.contentType, upsert: true });

    if (upErr) {
      /* The one failure worth naming out loud. Storage refusing a write is
         almost always the plan's ceiling, and a silent stall here would look
         exactly like "the photos just don't load". */
      note = "Storage is full — photos can't be brought across until there's room.";
      break;
    }

    await supabaseAdmin
      .from("documents")
      .update({ storage_ref: ref, uploaded_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("id", documentId);

    cached += 1;
  }

  revalidatePath("/dashboard/workboard");
  return {
    ok: true,
    cached,
    remaining: Math.max(0, wanted.length - cached),
    media: await readJobMediaGroups(orgId, id),
    note,
  };
}
