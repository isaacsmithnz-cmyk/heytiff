"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";
import { DOCUMENTS_BUCKET, SIGNED_URL_SECONDS } from "@/lib/documents/query";
import { jobMediaKind } from "@/lib/workboard/job-media";
import { cacheJobFiles } from "./workboard-media";
import { readJobPhotos } from "./photo-readings";

/* Starring a job photo — the showcase's write side.
   See docs/migrations/job_photo_favourites.sql for why this is its own table
   and not a column on the mirror.

   THE STAR IS OURS, THE PHOTO IS THEIRS. Everything identifying here is a
   SNAPSHOT taken at starring time — the attachment uuid is the key, but the
   job number, client and name are copied, because `disconnectSm8` deletes
   every mirror row and the next walk rebuilds them. A collection that can
   only say "attachment 8f3c…" once the mirror is gone is not a collection.

   NOTHING IS TAKEN FROM THE CLIENT BUT THE TWO IDS. The browser sends the
   job and the attachment; every word written to the row is read back out of
   the mirror here. A caption is the one thing the curator types, and it is
   typed in the collection, not on the job card.

   Same discipline as every other action here: authenticate the session, then
   read and write through the service role with an explicit org scope. Server
   Functions are reachable by direct POST, so this re-checks the capability
   for itself. */

/** One starred photo, as the job card needs to see it. The card only ever
    asks "which of these are starred", so this is deliberately thin — the
    collection screen will want the snapshot columns too. */
export type JobPhotoFavourite = {
  /** The ServiceM8 attachment uuid — the same id the mosaic tiles carry. */
  remoteId: string;
  addedAt: string;
};

export type StarPhotoResult = {
  ok: boolean;
  /** What the star IS now — not what was asked for. A refused write leaves
      this at the truth, so the tile can settle back rather than lie. */
  starred: boolean;
  /** Said out loud when the bytes couldn't be brought across. The star still
      stands; it is the picture that is missing. */
  note: string | null;
};

/** The starred photos on one job. Ids only — the tiles are already on screen
    and their names came from the same read. */
export async function listJobPhotoFavourites(jobUuid: string): Promise<JobPhotoFavourite[]> {
  const { orgId } = await requireOrg("workboard");
  const job = (jobUuid ?? "").trim().slice(0, 80);
  if (!job) return [];
  const { data, error } = await supabaseAdmin
    .from("job_photo_favourites")
    .select("sm8_attachment_uuid, added_at")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", job);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { sm8_attachment_uuid: string; added_at: string }[]).map((r) => ({
    remoteId: r.sm8_attachment_uuid,
    addedAt: r.added_at,
  }));
}

/** Star or unstar one photo on a job.

    STARRING TRIGGERS THE FETCH. The bucket is a lazy cache — 249 of 39,767
    attachments have bytes here — so a star on an uncached photo would put a
    grey `pending` plate in the showcase and leave it there forever, because
    nothing else would ever ask for that job's files again. `cacheJobFiles`
    already takes a bounded bite of exactly this job; the star is the reason
    to spend it. The star is written FIRST and the fetch is best-effort: a
    full bucket must not refuse the curation. */
export async function setJobPhotoFavourite(
  jobUuid: string,
  attachmentUuid: string,
  starred: boolean
): Promise<StarPhotoResult> {
  const { orgId, userId } = await requireOrg("workboard");
  const job = (jobUuid ?? "").trim().slice(0, 80);
  const photo = (attachmentUuid ?? "").trim().slice(0, 80);
  if (!job || !photo) return { ok: false, starred: false, note: null };

  if (!starred) {
    const { error } = await supabaseAdmin
      .from("job_photo_favourites")
      .delete()
      .eq("org_id", orgId)
      .eq("sm8_attachment_uuid", photo);
    if (error) return { ok: false, starred: true, note: null };
    revalidatePath("/dashboard/workboard");
    return { ok: true, starred: false, note: null };
  }

  /* THE PHOTO IS PROVEN BEFORE IT IS STARRED. The client sends two ids; this
     is where they are checked to be a real, live, showable photo in THIS
     workspace — `active = 1` for the same reason the grid filters it, and
     the kind test so a PDF can't be starred into a photo collection. */
  const { data: attachment } = await supabaseAdmin
    .from("sm8_attachments")
    .select("uuid, attachment_name, file_type, timestamp, related_object_uuid")
    .eq("org_id", orgId)
    .eq("uuid", photo)
    .eq("active", 1)
    .maybeSingle();

  const row = attachment as {
    uuid: string;
    attachment_name: string | null;
    file_type: string | null;
    timestamp: string | null;
    related_object_uuid: string;
  } | null;
  if (!row || jobMediaKind(row.file_type) !== "photo")
    return { ok: false, starred: false, note: null };

  /* The snapshot. Read off the mirror, never off the request — and off the
     CARD's job, not `related_object_uuid`: a photo lifted from a progress
     clone belongs to the job in every screen that shows it, and a showcase
     labelled with the clone's number names a card on its way to not
     existing. */
  const { data: jobRow } = await supabaseAdmin
    .from("sm8_jobs")
    .select("generated_job_id, company_uuid")
    .eq("org_id", orgId)
    .eq("uuid", job)
    .maybeSingle();
  const mirror = jobRow as { generated_job_id: string | null; company_uuid: string | null } | null;

  const { data: companyRow } = mirror?.company_uuid
    ? await supabaseAdmin
        .from("sm8_companies")
        .select("name")
        .eq("org_id", orgId)
        .eq("uuid", mirror.company_uuid)
        .maybeSingle()
    : { data: null };

  /* Whatever we already hold of this photo's bytes. Null is ordinary — the
     fetch below is what usually fills it, on the NEXT star's read. */
  const { data: docRow } = await supabaseAdmin
    .from("documents")
    .select("id")
    .eq("org_id", orgId)
    .eq("source", "servicem8")
    .eq("remote_ref", photo)
    .not("uploaded_at", "is", null)
    .maybeSingle();

  const { error } = await supabaseAdmin.from("job_photo_favourites").upsert(
    {
      org_id: orgId,
      sm8_attachment_uuid: photo,
      sm8_job_uuid: job,
      job_number: mirror?.generated_job_id ?? null,
      client_name: (companyRow as { name: string | null } | null)?.name ?? null,
      photo_name: row.attachment_name?.trim() || "Untitled photo",
      photo_taken_at: row.timestamp,
      document_id: (docRow as { id: string } | null)?.id ?? null,
      added_by: userId,
    },
    /* The unique index IS the toggle: starring twice is one star. */
    { onConflict: "org_id,sm8_attachment_uuid" }
  );
  if (error) return { ok: false, starred: false, note: null };

  /* Best-effort, and deliberately after the write. cacheJobFiles takes six
     files at a time and never throws — it returns its own note when storage
     refuses — so the worst case here is a starred photo whose picture arrives
     on a later open, which is exactly what the pending plate already says. */
  let note: string | null = null;
  if (!docRow) {
    const cached = await cacheJobFiles(job);
    note = cached.note;
  }

  /* A STAR EARNS THE BETTER READING. The bank is read by Haiku, which gets
     every model number and serial anybody will type but garbles dense small
     print into confident inventions — `AS/NZS 4755` came back as `ASICS
     4793`. That is an acceptable trade across thousands of photographs
     nobody will ever look at twice. It is not the trade for THIS one: a
     starred photo is the one somebody chose to show a client, and it is
     worth the exact plate.

     Best-effort and last, like the caching above. `readJobPhotos` reads only
     what is unread, so a photo Haiku already did keeps its reading unless the
     re-read below replaces it — and `read_model` on the row records which
     model produced which, so the two can always be told apart. */
  void readJobPhotos(job, "showcase").catch((e) => {
    console.error(`[showcase] re-read failed for ${job}:`, e);
  });

  revalidatePath("/dashboard/workboard");
  return { ok: true, starred: true, note };
}

/* ── the showcase itself ──────────────────────────────────────────────────
   THE GALLERY READS ONLY THE FAVOURITES (Isaac's constraint, and the right
   one). It is not a browser over 32,000 photographs with a star filter bolted
   on; it is the starred set and nothing else, so its cost and its size are
   the curator's choice rather than the account's. */

/** One photo in the showcase. Everything here is either snapshotted on the
    row or signed for this request — nothing joins back to the mirror, so the
    gallery keeps working after a disconnect wipes it. */
export type ShowcasePhoto = {
  remoteId: string;
  jobUuid: string;
  jobNumber: string | null;
  clientName: string | null;
  name: string;
  takenAt: string | null;
  /** Signed URL, or null while the bytes are still on their way. */
  url: string | null;
  /** What the picture is of; null until it has been read, and null after a
      read that could not place it. */
  subject: string | null;
  tags: string[];
  caption: string;
  /** Every word visible in the frame. Model numbers and serials live here. */
  ocrText: string;
  /** Whether this photo has been looked at. A reading exists or it doesn't —
      `subject` alone cannot say, because null is also a valid reading. */
  read: boolean;
  addedAt: string;
};

type ShowcaseRow = {
  sm8_attachment_uuid: string;
  sm8_job_uuid: string;
  job_number: string | null;
  client_name: string | null;
  photo_name: string;
  photo_taken_at: string | null;
  document_id: string | null;
  added_at: string;
};

/* ONE LITERAL, NOT A CONCATENATION. supabase-js parses the select string at
   the TYPE level; two literals joined with `+` widen to `string` and the
   whole row type collapses to its error branch. */
/* ONE LITERAL, NOT A CONCATENATION. supabase-js parses the select string at
   the TYPE level; two literals joined with `+` widen to `string` and the whole
   row type collapses to its error branch.

   NO subject/tags/caption HERE ANY MORE — the star says a photo is worth
   showing someone, and `job_photo_readings` says what it is. Two questions,
   two tables; the showcase joins them. */
const SHOWCASE_SELECT =
  "sm8_attachment_uuid, sm8_job_uuid, job_number, client_name, photo_name, photo_taken_at, document_id, added_at";

/** The whole showcase, newest star first.

    ONE SIGNING CALL FOR THE WHOLE SET, not one per photo — the same rule the
    job card's media read follows, and the reason the bytes live in this
    bucket at all. */
export async function listShowcase(): Promise<ShowcasePhoto[]> {
  const { orgId } = await requireOrg("workboard");
  const { data, error } = await supabaseAdmin
    .from("job_photo_favourites")
    .select(SHOWCASE_SELECT)
    .eq("org_id", orgId)
    .order("added_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ShowcaseRow[];
  if (rows.length === 0) return [];

  /* What each of these photographs IS — read once when its job was opened,
     not when it was starred. A starred photo whose job has not finished
     reading yet simply has no subject here, which is the same "absent, not
     wrong" the rest of this card follows. */
  const { data: readingRows } = await supabaseAdmin
    .from("job_photo_readings")
    .select("sm8_attachment_uuid, subject, tags, caption, ocr_text")
    .eq("org_id", orgId)
    .in(
      "sm8_attachment_uuid",
      rows.map((r) => r.sm8_attachment_uuid)
    );
  const readings = new Map(
    ((readingRows ?? []) as {
      sm8_attachment_uuid: string;
      subject: string | null;
      tags: string[] | null;
      caption: string | null;
      ocr_text: string | null;
    }[]).map((r) => [r.sm8_attachment_uuid, r])
  );

  const docIds = [...new Set(rows.map((r) => r.document_id).filter(Boolean))] as string[];
  const refs = new Map<string, string>();
  if (docIds.length > 0) {
    const { data: docs } = await supabaseAdmin
      .from("documents")
      .select("id, storage_ref")
      .eq("org_id", orgId)
      .in("id", docIds)
      .not("uploaded_at", "is", null);
    for (const d of (docs ?? []) as { id: string; storage_ref: string }[])
      refs.set(d.id, d.storage_ref);
  }

  const urls = new Map<string, string>();
  if (refs.size > 0) {
    const { data: signed } = await supabaseAdmin.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrls([...new Set(refs.values())], SIGNED_URL_SECONDS);
    for (const row of signed ?? []) {
      if (row.path && row.signedUrl) urls.set(row.path, row.signedUrl);
    }
  }

  return rows.map((r) => {
    const ref = r.document_id ? refs.get(r.document_id) : undefined;
    const read = readings.get(r.sm8_attachment_uuid);
    return {
      remoteId: r.sm8_attachment_uuid,
      jobUuid: r.sm8_job_uuid,
      jobNumber: r.job_number,
      clientName: r.client_name,
      name: r.photo_name,
      takenAt: r.photo_taken_at,
      url: ref ? urls.get(ref) ?? null : null,
      subject: read?.subject ?? null,
      tags: read?.tags ?? [],
      caption: read?.caption ?? "",
      ocrText: read?.ocr_text ?? "",
      /* The READING's existence is what says it was looked at — there is no
         separate flag, and cannot be one out of step with the row. */
      read: !!read,
      addedAt: r.added_at,
    };
  });
}
