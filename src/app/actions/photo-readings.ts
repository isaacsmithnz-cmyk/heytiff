"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";
import { familyMediaSources } from "@/lib/workboard/all-jobs-query";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { mimeForExt, normaliseFileType } from "@/lib/workboard/job-media";
import {
  READING_SCHEMA,
  READ_PROMPT,
  isBankablePhoto,
  isSendableImage,
  parseReading,
} from "@/lib/workboard/photo-reading";

/* Reading the photos we already hold — the bank behind photo search.

   THE TRIGGER IS THE BYTES, NOT THE STAR. Opening a job card runs
   `cacheJobFiles`, and whatever that brings across gets read once, here. The
   star used to be doing two jobs at once — "worth showing someone" and "worth
   indexing" — and they are different questions with different lifetimes.
   Curation stays in `job_photo_favourites`; what a photo IS lives in
   `job_photo_readings`.

   THAT MAKES THE BANK GROW ALONG THE PATHS PEOPLE WALK, which is the same
   rule that has kept storage at 432MB against an account holding ~28GB of
   originals. No 32,443-photo backfill, and nothing spent on the four in five
   nobody will ever search.

   PAID FOR ONCE, WHOEVER OPENS IT. The unique index on
   (org_id, sm8_attachment_uuid) is the dedupe: a photo already read is never
   read again, however many people open its job. That is why this needs no
   capability of its own beyond the one that let them open the card — the cost
   is a function of the photo, not of the audience.

   NOTHING HERE MAY THROW. An action that throws returns a bare 503, and the
   caller then has no result to read and no way to stop its own loop — it just
   retries into the same wall. */

export type ReadPhotosResult = {
  ok: boolean;
  /** How many this call actually read. */
  read: number;
  /** Cached photos on this job still unread. The caller loops while this
      FALLS and stops the moment it doesn't — a server that keeps saying "6
      left" while reading none is a bug, not a backlog, and going round again
      would only spend money. */
  remaining: number;
  note: string | null;
};

const NOTHING: ReadPhotosResult = { ok: false, read: 0, remaining: 0, note: null };

/* TWO TIERS, AND THE SPLIT IS MEASURED (Isaac's call, 2026-08-30).

   Both models were run on the same real dataplate with this exact prompt:

     Haiku 4.5   0.47c   subject right, PUZ-M125VKA2-A right, serial right,
                         230V / R32 3.6kg right
     Opus 5      3.53c   the same, plus the dense small print

   Haiku gets everything anybody will type. Where it degrades is compliance
   boilerplate and factory part codes, and it degrades CONFIDENTLY —
   `AS/NZS 4755 SELV DC Power DRM1` came back as `ASICS 4793 BBV L2 DUNet 90`,
   and `BT79B598H02` as `BT778598M-H02`. Invented strings, not omissions.

   That is the whole reason for the split. Nobody searches a factory address,
   so the bank can afford a small amount of garbled boilerplate at a seventh
   of the price. A STARRED photo is different: it is the one somebody chose to
   show a client, and it is worth the exact plate. So the bank is read by
   Haiku and a star re-reads with Opus.

   `read_model` on the row is what makes that possible — it records which
   model produced a reading, so an upgrade is a re-read of the rows that name
   the cheaper one rather than a guess about which are trustworthy. */
const BANK_MODEL = "claude-haiku-4-5";
const SHOWCASE_MODEL = "claude-opus-5";

/** Which reading is being asked for.

      bank      everything, cheaply — Haiku, on every photo a job holds
      showcase  one named photo, because somebody starred it
      upgrade   THE DATAPLATES, because that is where Haiku's one real
                weakness lands

    WHY DATAPLATES GET A SECOND LOOK. Measured on two photographs of the same
    outdoor unit, read minutes apart:

        PUZ-M125VKA2-A     correct
        PUZ-M125VKA-A      the `2` dropped

    Haiku gets the subject right every time and gets everything a person is
    likely to type — brand, capacity, refrigerant — but it garbles dense small
    print CONFIDENTLY, inventing plausible strings rather than omitting them.
    On a photograph of ductwork that costs nothing: nobody searches the exact
    wording of a compliance label. On a DATAPLATE it costs the one thing the
    picture exists for, because a wrong serial in an index is worse than a
    missing one — the search finds nothing while the row insists otherwise.

    A prefix search survives it (`PUZ-M125` matches both spellings) but an
    exact one does not, and an exact model number is precisely what somebody
    types when they have the part in their hand.

    It is affordable because it is rare: 14 of the first 244 photographs read,
    5.7%. Reading the whole bank with Opus would be seven times the price for
    a gain confined to this slice. */
export type PhotoReadTier = "bank" | "showcase" | "upgrade";

/** How many photos one call reads. Small enough that a serverless invocation
    finishes comfortably — a vision call is a few seconds — and big enough
    that a 90-photo job is a manageable number of rounds. */
const BATCH = 4;

/** The longest edge we send — the API's OWN ceiling, not a number we picked.
    Anything larger is downscaled server-side before the model sees it, so
    resizing to 1568 costs nothing in quality while cutting the bytes on the
    wire and the tokens billed (full-size measured 5,497 input tokens for one
    2016x1512 photo).

    1024 WAS TEMPTING AND IS THE WRONG CALL. It measured 1,624 tokens on the
    same photograph and still read the model number — but that was a rating
    plate FILLING the frame. Small text in a wide shot is precisely what a
    self-inflicted downscale destroys, and transcribing small text is now the
    whole point of this. Never shrink past what the reader needs to read. */
const MAX_EDGE = 1568;

export async function readJobPhotos(
  jobUuid: string,
  /** Which tier reads. The bank gets Haiku; a star re-reads with Opus. */
  tier: PhotoReadTier = "bank",
  /** ONE PHOTO, NAMED. Without this the showcase tier was unusable: its queue
      is photos that are UNREAD, and a starred photo has by definition already
      been read by the bank — so the star skipped its own photograph and spent
      Opus money on up to four arbitrary others instead. The advertised
      feature did not exist and the bill was real. Naming the attachment
      bypasses the unread filter; the unique index makes the write an
      overwrite, which is exactly what a re-read should be. */
  attachmentUuid?: string
): Promise<ReadPhotosResult> {
  try {
    return await readJobPhotosInner(jobUuid, tier, attachmentUuid);
  } catch (e) {
    console.error(`[photo-readings] reading failed for ${jobUuid}:`, e);
    return { ...NOTHING, note: "Those photos couldn't be read just now." };
  }
}

async function readJobPhotosInner(
  jobUuid: string,
  tier: PhotoReadTier,
  attachmentUuid?: string
): Promise<ReadPhotosResult> {
  const model = tier === "bank" ? BANK_MODEL : SHOWCASE_MODEL;
  const { orgId } = await requireOrg("workboard");
  const job = (jobUuid ?? "").trim().slice(0, 80);
  if (!job) return NOTHING;
  /* Silent, not an error: a workspace with no key still caches its photos and
     still shows them. It simply has no bank. */
  if (!process.env.ANTHROPIC_API_KEY) return { ok: true, read: 0, remaining: 0, note: null };

  /* WHAT WE HOLD THE BYTES OF, on this job. `documents` is the source of
     truth for that — a photo whose cache hasn't landed yet is not unread, it
     is not yet readable, and `cacheJobFiles` is still working on it. */
  /* THE CLAIMS' PHOTOS ARE THE JOB'S PHOTOS, and this read used to miss every
     one of them. ServiceM8 bills a progress job by cloning it, and
     `cacheJobFiles` deliberately files a clone's photo under THE CLAIM's uuid
     (workboard-media.ts) — so a query scoped to the parent alone found none
     of them. They were cached, shown in the mosaic, starrable, and
     permanently outside the bank: the job reported `remaining: 0` while
     dozens of its photographs had never been looked at. 626 live photos sit
     on claim rows.

     Same two lines the cacher already uses. */
  const claims = await familyMediaSources(orgId, job);
  const sourceIds = [job, ...claims.map((c) => c.remoteId).filter((r) => r !== job)];

  const { data: docRows } = await supabaseAdmin
    .from("documents")
    .select("id, remote_ref, storage_ref, file_name, mime_type")
    .eq("org_id", orgId)
    .eq("source", "servicem8")
    .in("sm8_job_uuid", sourceIds)
    .not("uploaded_at", "is", null)
    .limit(400);

  const held = ((docRows ?? []) as {
    id: string;
    remote_ref: string | null;
    storage_ref: string;
    file_name: string;
    mime_type: string | null;
  }[]).filter((d) => {
    if (!d.remote_ref) return false;
    /* PHOTOS ONLY, and decided by the MIME TYPE — see isBankablePhoto for
       why the file name cannot be trusted here. `cacheJobFiles` also brings
       PDFs across; an invoice is not a photograph. */
    return isBankablePhoto(d, mimeForExt, normaliseFileType);
  });

  if (held.length === 0) return { ok: true, read: 0, remaining: 0, note: null };

  const { data: doneRows } = await supabaseAdmin
    .from("job_photo_readings")
    .select("sm8_attachment_uuid")
    .eq("org_id", orgId)
    .in(
      "sm8_attachment_uuid",
      held.map((d) => d.remote_ref as string)
    );
  const done = new Set(
    ((doneRows ?? []) as { sm8_attachment_uuid: string }[]).map((r) => r.sm8_attachment_uuid)
  );

  /* THE UPGRADE TIER READS WHAT IS ALREADY READ — the only queue here that
     does. Its members are the dataplates the cheap model has looked at, and
     the unique index makes each re-read an overwrite of the row it improves.
     Nothing else is touched: a photograph of ductwork read by Haiku stays
     read by Haiku forever, which is the whole reason this is affordable. */
  let upgradeIds = new Set<string>();
  if (tier === "upgrade") {
    const { data: plates } = await supabaseAdmin
      .from("job_photo_readings")
      .select("sm8_attachment_uuid")
      .eq("org_id", orgId)
      .eq("subject", "dataplate")
      .eq("read_model", BANK_MODEL)
      .in(
        "sm8_attachment_uuid",
        held.map((d) => d.remote_ref as string)
      );
    upgradeIds = new Set(
      ((plates ?? []) as { sm8_attachment_uuid: string }[]).map((r) => r.sm8_attachment_uuid)
    );
  }

  /* A NAMED PHOTO BYPASSES THE UNREAD FILTER — that is the whole point of
     naming it. Everything else takes the queue of what has never been read. */
  const queue = attachmentUuid
    ? held.filter((d) => d.remote_ref === attachmentUuid)
    : tier === "upgrade"
      ? held.filter((d) => upgradeIds.has(d.remote_ref as string))
      : held.filter((d) => !done.has(d.remote_ref as string));
  if (queue.length === 0) return { ok: true, read: 0, remaining: 0, note: null };

  /* The job's own facts, snapshotted onto every reading — so a result can
     name where it came from after a disconnect wipes the mirror. Read once
     for the batch, not once per photo. */
  const snapshot = await jobSnapshot(orgId, job);

  const client = new Anthropic();
  let read = 0;
  /* Stored-nothing failures. A batch that reads and cannot write must SAY so
     rather than looking like a batch with nothing to do. */
  let failed = 0;
  let note: string | null = null;

  for (const doc of queue.slice(0, BATCH)) {
    const { data: blob } = await supabaseAdmin.storage
      .from(DOCUMENTS_BUCKET)
      .download(doc.storage_ref);
    if (!blob) continue;

    const original = Buffer.from(await blob.arrayBuffer());
    const prepared = await prepare(original, doc.mime_type);
    if (!prepared) {
      /* Genuinely not a decodable image. Recorded as looked-at with no
         subject so it leaves the queue instead of being retried on every
         open forever. */
      /* Counted only if it was actually STORED — see below. */
      if (
        await writeReading(model, orgId, doc.remote_ref as string, job, snapshot, doc.file_name, {
          subject: null,
          tags: [],
          caption: "",
          ocrText: "",
        })
      )
        read += 1;
      continue;
    }

    let answer: string | null = null;
    try {
      const response = await client.messages.create({
        model,
        /* 4,000 was too tight and the failure was silent. `ocr_text` is
           capped at 4,000 CHARACTERS and the prompt asks it to transcribe
           generously; on the Opus path adaptive thinking bills against this
           ceiling too. A truncated response is not valid JSON, so it parsed
           to null and was written as a blank reading the unique index then
           made permanent. The SDK's own guidance for a non-streaming call is
           ~16k. */
        max_tokens: 16000,
        /* `effort` is an Opus-family parameter — Haiku 4.5 rejects it
           outright ("This model does not support the effort parameter"), so
           it is set only where it exists. */
        output_config:
          model === SHOWCASE_MODEL
            ? { effort: "low", format: { type: "json_schema", schema: READING_SCHEMA } }
            : { format: { type: "json_schema", schema: READING_SCHEMA } },
        messages: [
          {
            role: "user",
            content: [
              /* The picture first, the question second — an image block is
                 read as context for the text that follows it. */
              {
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: prepared.mime,
                  data: prepared.bytes.toString("base64"),
                },
              },
              { type: "text", text: READ_PROMPT },
            ],
          },
        ],
      });
      /* WHY THE ANSWER STOPPED, BEFORE READING IT. Two endings must never be
         written down as "looked at, nothing on it", because the unique index
         means the photo is then NEVER looked at again:
           max_tokens — the transcription was cut mid-JSON
           refusal    — the model declined; on this family `stop_reason` is
                        the documented thing to check before touching content
         Both are left in the queue instead, which is the honest state: this
         photograph has not been read yet. */
      if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") {
        console.error(
          `[photo-readings] ${doc.remote_ref} stopped on ${response.stop_reason}; left unread`
        );
        continue;
      }
      const block = response.content.find((b) => b.type === "text");
      answer = block && block.type === "text" ? block.text : null;
    } catch (err) {
      /* A DEAD KEY OR A RATE LIMIT ENDS THE BATCH — every other photo would
         fail the same way, and hammering a 429 is how a browser loop turns
         into an incident. Anything else is this one photo's problem. */
      if (
        err instanceof Anthropic.AuthenticationError ||
        err instanceof Anthropic.RateLimitError
      ) {
        note =
          err instanceof Anthropic.RateLimitError
            ? "Tiff is busy — the rest will be read next time."
            : "Tiff is offline — API key rejected.";
        break;
      }
      console.error(`[photo-readings] ${doc.remote_ref} refused:`, err);
      continue;
    }

    const reading = answer ? parseReading(answer) : null;
    /* `read` COUNTS WHAT WAS STORED, not what was asked for. Counting the
       call meant a failing upsert reported `{ok:true, read:4}` with nothing
       written — and the next round recomputed the queue from an empty table
       and billed the same four photographs again. Two rounds, eight paid
       calls, zero rows, and "it worked" printed twice. If the migration were
       ever missing in a target database, that was every photo on every open,
       forever, with nothing on screen saying so. */
    const stored = await writeReading(
      model,
      orgId,
      doc.remote_ref as string,
      job,
      snapshot,
      doc.file_name,
      reading ?? { subject: null, tags: [], caption: "", ocrText: "" }
    );
    if (stored) read += 1;
    else failed += 1;
  }

  revalidatePath("/dashboard/workboard");
  /* `ok: false` on a total write failure stops the caller's loop dead. The
     brake in job-sheet.tsx is a FALLING count, and a run that stores nothing
     leaves the count unchanged — which would stop it too, but only after a
     second paid round. This stops it after the first. */
  if (failed > 0 && read === 0)
    return {
      ok: false,
      read: 0,
      remaining: queue.length,
      note: "Those readings couldn't be saved — nothing has been recorded.",
    };
  return { ok: true, read, remaining: Math.max(0, queue.length - read), note };
}

/* ── helpers ── */

type JobSnapshot = { jobNumber: string | null; clientName: string | null };

async function jobSnapshot(orgId: string, job: string): Promise<JobSnapshot> {
  const { data: jobRow } = await supabaseAdmin
    .from("sm8_jobs")
    .select("generated_job_id, company_uuid")
    .eq("org_id", orgId)
    .eq("uuid", job)
    .maybeSingle();
  const mirror = jobRow as { generated_job_id: string | null; company_uuid: string | null } | null;
  if (!mirror) return { jobNumber: null, clientName: null };
  const { data: companyRow } = mirror.company_uuid
    ? await supabaseAdmin
        .from("sm8_companies")
        .select("name")
        .eq("org_id", orgId)
        .eq("uuid", mirror.company_uuid)
        .maybeSingle()
    : { data: null };
  return {
    jobNumber: mirror.generated_job_id,
    clientName: (companyRow as { name: string | null } | null)?.name ?? null,
  };
}

/** Get the bytes into something the image block will take.

    RE-ENCODING TO JPEG IS WHAT MAKES AVIF READABLE. Claude's image block
    accepts four types and AVIF is not one of them, but 399 of the account's
    photos are AVIF — before this they would have been recorded as unreadable.
    sharp decodes them and hands over a JPEG.

    THE FALLBACK IS THE ORIGINAL, NEVER A FAILED READING. sharp is a native
    binary and it arrived here as a transitive dependency of Next — it is a
    direct one now, but if it ever fails to load, the honest move is to send
    the bytes we have and pay a few tokens more, not to quietly mark every
    photograph in the workspace as unreadable. That failure would have looked
    exactly like "the reader doesn't work" with nothing in any log. */
async function prepare(
  bytes: Buffer,
  /** The row's stored mime — NOT derived from the name, which in this mirror
      is the extensionless string `Photo` for every photograph there is. */
  storedMime: string | null
): Promise<{ bytes: Buffer; mime: "image/jpeg" | "image/png" | "image/webp" | "image/gif" } | null> {
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(bytes)
      .rotate() // honour EXIF orientation, or a portrait plate arrives sideways
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { bytes: out, mime: "image/jpeg" };
  } catch (e) {
    console.error("[photo-readings] could not re-encode, sending as-is:", e);
    /* Only the four the block actually accepts. An AVIF with no sharp to
       decode it has nowhere to go, and says so by being unreadable. */
    if (isSendableImage(storedMime)) return { bytes, mime: storedMime };
    return null;
  }
}

async function writeReading(
  model: string,
  orgId: string,
  attachmentUuid: string,
  job: string,
  snap: JobSnapshot,
  fileName: string,
  reading: { subject: string | null; tags: string[]; caption: string; ocrText: string }
): Promise<boolean> {
  const { error } = await supabaseAdmin.from("job_photo_readings").upsert(
    {
      org_id: orgId,
      sm8_attachment_uuid: attachmentUuid,
      sm8_job_uuid: job,
      job_number: snap.jobNumber,
      client_name: snap.clientName,
      photo_name: fileName,
      subject: reading.subject,
      tags: reading.tags,
      caption: reading.caption,
      ocr_text: reading.ocrText,
      read_at: new Date().toISOString(),
      read_model: model,
    },
    { onConflict: "org_id,sm8_attachment_uuid" }
  );
  if (error) {
    console.error(`[photo-readings] could not record ${attachmentUuid}:`, error);
    return false;
  }
  return true;
}
