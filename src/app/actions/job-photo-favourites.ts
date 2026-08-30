"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";
import { DOCUMENTS_BUCKET, SIGNED_URL_SECONDS } from "@/lib/documents/query";
import { jobMediaKind, mimeForExt, normaliseFileType } from "@/lib/workboard/job-media";
import {
  PHOTO_SUBJECTS,
  SUBJECT_MEANING,
  isPhotoSubject,
} from "@/lib/workboard/photo-subjects";
import { cacheJobFiles } from "./workboard-media";

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
  /** What the picture is of; null until it has been read. */
  subject: string | null;
  tags: string[];
  caption: string;
  /** When it was read. Null means it is still in the reader's queue; non-null
      with a null subject means it was read and could not be placed. */
  readAt: string | null;
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
  subject: string | null;
  tags: string[] | null;
  caption: string | null;
  read_at: string | null;
  added_at: string;
};

/* ONE LITERAL, NOT A CONCATENATION. supabase-js parses the select string at
   the TYPE level; two literals joined with `+` widen to `string` and the
   whole row type collapses to its error branch. */
const SHOWCASE_SELECT =
  "sm8_attachment_uuid, sm8_job_uuid, job_number, client_name, photo_name, photo_taken_at, document_id, subject, tags, caption, read_at, added_at";

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
    return {
      remoteId: r.sm8_attachment_uuid,
      jobUuid: r.sm8_job_uuid,
      jobNumber: r.job_number,
      clientName: r.client_name,
      name: r.photo_name,
      takenAt: r.photo_taken_at,
      url: ref ? urls.get(ref) ?? null : null,
      subject: r.subject,
      tags: r.tags ?? [],
      caption: r.caption ?? "",
      readAt: r.read_at,
      addedAt: r.added_at,
    };
  });
}

/* ── reading the picture ── */

const MODEL = "claude-opus-5";

/** The shape Claude must answer in. `subject` is an enum of the closed set
    plus null: a photo it genuinely cannot place must be able to say so, and a
    schema without the null forces it to pick the least-wrong one — which is
    how a filter fills up with confident nonsense. */
const SUBJECT_SCHEMA = {
  type: "object",
  properties: {
    subject: { anyOf: [{ type: "string", enum: [...PHOTO_SUBJECTS] }, { type: "null" }] },
    /* NO `maxItems` — the structured-output validator rejects it outright
       ("For 'array' type, property 'maxItems' is not supported"), and every
       call 400s. The prompt asks for at most six and the TypeScript re-check
       below enforces it, which is where a limit belongs anyway: a schema
       constrains shape, not sense. */
    tags: { type: "array", items: { type: "string" } },
    caption: { type: "string" },
  },
  required: ["subject", "tags", "caption"],
  additionalProperties: false,
};

export type ReadPhotoResult = {
  ok: boolean;
  /** How many starred photos are still unread after this call. The gallery
      loops while this falls and stops the moment it doesn't — a reader that
      keeps saying "6 left" while reading none is a bug, not a backlog. */
  remaining: number;
  read: number;
  note: string | null;
};

const NOT_READ: ReadPhotoResult = { ok: false, read: 0, remaining: 0, note: null };

/** How many photos one call reads. One at a time on purpose: a vision call is
    a few seconds and a few cents, and the gallery paints each result as it
    lands rather than freezing until a batch finishes. */
const READ_BATCH = 3;

/** Read the next few unread starred photos.

    THE BROWSER IS THE LOOP, the same shape `cacheJobFiles` uses — there is no
    server-side queue, so the gallery calls again while the remaining count
    falls. Nothing here throws: an action that throws returns a bare 503, and
    the caller then has no result to read and no way to stop its own loop.

    WHAT IT COSTS. One image and a short prompt at `effort: "low"` — cents per
    photo, spent once per star, and never spent on a photo already read. The
    starred set is the curator's choice, which is exactly why this is affordable
    on it and would not be on the account's 32,000. */
export async function readShowcasePhotos(): Promise<ReadPhotoResult> {
  try {
    return await readShowcasePhotosInner();
  } catch (e) {
    console.error("[showcase] reading failed:", e);
    return { ...NOT_READ, note: "Those photos couldn't be read just now." };
  }
}

async function readShowcasePhotosInner(): Promise<ReadPhotoResult> {
  const { orgId } = await requireOrg("workboard");
  if (!process.env.ANTHROPIC_API_KEY)
    return { ...NOT_READ, note: "Tiff is offline — no key." };

  /* Only photos we HOLD THE BYTES OF are readable. A starred photo whose
     cache hasn't landed is not a failure and must not be marked read — it
     simply isn't its turn yet, and `cacheJobFiles` is still working on it. */
  const { data } = await supabaseAdmin
    .from("job_photo_favourites")
    .select("sm8_attachment_uuid, document_id, photo_name")
    .eq("org_id", orgId)
    .is("read_at", null)
    .not("document_id", "is", null)
    .order("added_at", { ascending: true })
    .limit(READ_BATCH);

  const queue = (data ?? []) as {
    sm8_attachment_uuid: string;
    document_id: string;
    photo_name: string;
  }[];

  const { count } = await supabaseAdmin
    .from("job_photo_favourites")
    .select("sm8_attachment_uuid", { count: "exact", head: true })
    .eq("org_id", orgId)
    .is("read_at", null)
    .not("document_id", "is", null);
  const outstanding = count ?? queue.length;

  if (queue.length === 0) return { ok: true, read: 0, remaining: 0, note: null };

  const client = new Anthropic();
  let read = 0;

  for (const row of queue) {
    const { data: doc } = await supabaseAdmin
      .from("documents")
      .select("storage_ref, file_name, mime_type")
      .eq("org_id", orgId)
      .eq("id", row.document_id)
      .maybeSingle();
    const file = doc as { storage_ref: string; file_name: string; mime_type: string | null } | null;
    if (!file) continue;

    const { data: blob } = await supabaseAdmin.storage
      .from(DOCUMENTS_BUCKET)
      .download(file.storage_ref);
    if (!blob) continue;

    const bytes = Buffer.from(await blob.arrayBuffer());
    /* THE EXTENSION NAMES THE TYPE, not the stored mime — the same rule the
       uploader learned when a CDN's missing header became "storage is full".
       Claude's image block takes four types; anything else is left unread
       rather than sent under a lie. */
    const ext = normaliseFileType(file.file_name.split(".").pop() ?? "");
    const mime = (ext && mimeForExt(ext)) || file.mime_type || "";
    if (!SENDABLE_IMAGE.has(mime)) {
      await markRead(orgId, row.sm8_attachment_uuid, null, [], "");
      continue;
    }

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SUBJECT_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            /* The picture first, the question second — an image block is read
               as context for the text that follows it. */
            {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: mime as SendableImage,
                data: bytes.toString("base64"),
              },
            },
            { type: "text", text: READ_PROMPT },
          ],
        },
      ],
    });

    const parsed = parseReading(response);
    if (!parsed) {
      /* Marked read with no subject: it was looked at and could not be
         placed. Leaving read_at null would queue it forever. */
      await markRead(orgId, row.sm8_attachment_uuid, null, [], "");
      read += 1;
      continue;
    }
    await markRead(orgId, row.sm8_attachment_uuid, parsed.subject, parsed.tags, parsed.caption);
    read += 1;
  }

  revalidatePath("/dashboard/workboard");
  return { ok: true, read, remaining: Math.max(0, outstanding - read), note: null };
}

type SendableImage = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
/* The four the image block accepts. AVIF is a photo we hold and can show in a
   browser, but it is not one of these — those are marked read and left
   unplaced rather than sent under a mime type they aren't. */
const SENDABLE_IMAGE = new Set<string>(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const READ_PROMPT =
  "This is one photograph from an Australian air-conditioning job — taken on " +
  "site by the tradesperson, and kept as an example to show a client or brief " +
  "another tech.\n\n" +
  "Say what the photo is OF, choosing exactly one subject from this list:\n" +
  PHOTO_SUBJECTS.map((s) => `- ${s}: ${SUBJECT_MEANING[s]}`).join("\n") +
  "\n\nRules:\n" +
  "- subject: the MAIN thing in the frame. If a dataplate fills the picture " +
  "it is dataplate, even though the plate is on an outdoor unit. If you " +
  "genuinely cannot tell, return null — a wrong subject is worse than none, " +
  "because it hides the photo under a filter nobody will look in.\n" +
  "- tags: up to six short lowercase terms for anything else worth searching " +
  "— equipment type, mounting, setting, condition (e.g. \"bulkhead\", " +
  "\"roof mounted\", \"mitsubishi\", \"before\"). Only what you can SEE. Never " +
  "guess a brand or a model from context.\n" +
  "- caption: one plain sentence under 90 characters describing the picture, " +
  "in English. No preamble, no \"this image shows\".\n" +
  "- Never describe a person, a face, a number plate, or anything written on " +
  "paperwork that identifies a customer. This collection gets shown to OTHER " +
  "clients.";

function parseReading(
  response: Anthropic.Message
): { subject: string | null; tags: string[]; caption: string } | null {
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { subject?: unknown; tags?: unknown; caption?: unknown };
  /* A SCHEMA CONSTRAINS SHAPE, NOT SENSE — every field is re-checked here,
     the same rule fleet-ai and expense-ai follow. */
  const subject = isPhotoSubject(o.subject) ? o.subject : null;
  const tags = Array.isArray(o.tags)
    ? o.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toLowerCase().slice(0, 40))
        .filter(Boolean)
        .slice(0, 6)
    : [];
  const caption = typeof o.caption === "string" ? o.caption.trim().slice(0, 140) : "";
  return { subject, tags, caption };
}

async function markRead(
  orgId: string,
  attachmentUuid: string,
  subject: string | null,
  tags: string[],
  caption: string
): Promise<void> {
  await supabaseAdmin
    .from("job_photo_favourites")
    .update({
      subject,
      tags,
      caption,
      read_at: new Date().toISOString(),
      read_model: MODEL,
    })
    .eq("org_id", orgId)
    .eq("sm8_attachment_uuid", attachmentUuid);
}
