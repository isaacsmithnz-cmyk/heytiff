import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import type { Sm8Press } from "@/lib/integrations/sm8-press";
import { enqueueAttachments, readJobSends, readSm8WriteState, runSm8Writes } from "@/lib/integrations/sm8-writes";
import { drainSm8WritesAfterResponse, settleWithin } from "@/lib/integrations/sm8-drain";
import { sendHold, sendLine, sendRefusal, type SendLine } from "@/lib/integrations/sm8-write-plan";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { landSlot, openSlot } from "@/lib/documents/upload-slots";
import { isImage } from "@/lib/documents/files";
import type { MobileCtx } from "./auth";

/* PHOTOS FROM THE PHONE, onto the job you're looking at (Isaac, 27 October
   2026: "Ok go" to the mock where they land on the job in HeyTiff and in
   ServiceM8 as the job's photos).

   TWO STEPS, the web's own (lib/documents/upload-slots): a slot first — the
   row, filed on the job from the start as a `job_photo`, and a signed URL
   the phone PUTs the bytes to — then the landing. The bytes never pass
   through here.

   LANDED, IT GOES TO SERVICEM8 as one of the job's photos, through the
   file queue the Documents face sends by (enqueueAttachments), as the app.
   A photo is the work, taken by whoever is on the job, so it goes on the
   `workboard` grant that put it there, not the papers' `workboard_manage`.
   ServiceM8 not taking files keeps it in HeyTiff and says why. The press
   waits on ServiceM8 a few seconds and no longer: the rest goes behind it. */

export const PHOTO_WORDS = {
  noJob: "That job isn't in HeyTiff.",
  noCard: "You need a staff card in HeyTiff to add photos.",
  notPhoto: "That isn't a photo.",
} as const;

/** How long a landing waits on ServiceM8 before saying "Sending". */
const SEND_BUDGET_MS = 8_000;

export type PhotoSlot = { documentId: string; uploadUrl: string };
export type PhotoLanded = { documentId: string; sent: SendLine | null };
type Answer<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

async function jobOf(orgId: string, id: string): Promise<string | null> {
  const j = id.trim().slice(0, 80);
  if (!j) return null;
  const { data } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid")
    .eq("org_id", orgId)
    .in("uuid", [...new Set([j, j.toLowerCase(), j.toUpperCase()])])
    .limit(1);
  return ((data ?? []) as { uuid: string }[])[0]?.uuid ?? null;
}

/** A slot for one photo on this job. */
export async function beginJobPhoto(
  ctx: MobileCtx,
  jobId: string,
  file: { fileName?: unknown; mimeType?: unknown; sizeBytes?: unknown }
): Promise<Answer<PhotoSlot>> {
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  if (!staffId) return { ok: false, error: PHOTO_WORDS.noCard, status: 403 };
  const job = await jobOf(ctx.orgId, jobId);
  if (!job) return { ok: false, error: PHOTO_WORDS.noJob, status: 404 };
  const fileName = typeof file.fileName === "string" ? file.fileName : "";
  const mimeType = typeof file.mimeType === "string" ? file.mimeType : "";
  const sizeBytes = typeof file.sizeBytes === "number" ? file.sizeBytes : 0;
  if (!isImage(mimeType)) return { ok: false, error: PHOTO_WORDS.notPhoto, status: 400 };
  const slot = await openSlot(ctx.orgId, staffId, "job_photo", { fileName, mimeType, sizeBytes }, job);
  if (!slot.ok) return { ok: false, error: slot.error, status: 400 };
  return { ok: true, value: { documentId: slot.documentId, uploadUrl: slot.signedUrl } };
}

/** The photo's bytes are in: it shows on the job, and goes to ServiceM8. */
export async function landJobPhoto(ctx: MobileCtx, press: Sm8Press | null, jobId: string, documentId: string): Promise<Answer<PhotoLanded>> {
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  if (!staffId) return { ok: false, error: PHOTO_WORDS.noCard, status: 403 };
  const job = await jobOf(ctx.orgId, jobId);
  if (!job) return { ok: false, error: PHOTO_WORDS.noJob, status: 404 };

  const { data } = await supabaseAdmin
    .from("documents")
    .select("id, kind, sm8_job_uuid, file_name, mime_type, size_bytes")
    .eq("org_id", ctx.orgId)
    .eq("id", documentId)
    .maybeSingle();
  const doc = data as { id: string; kind: string; sm8_job_uuid: string | null; file_name: string; mime_type: string; size_bytes: number } | null;
  if (!doc || doc.kind !== "job_photo" || doc.sm8_job_uuid !== job) return { ok: false, error: "That upload no longer exists.", status: 404 };
  const landed = await landSlot(ctx.orgId, staffId, doc.id);
  if (!landed.ok) return { ok: false, error: landed.error, status: 409 };

  const startedAt = Date.now();
  const state = await readSm8WriteState(ctx.orgId);
  const refused = sendRefusal(state, "attachment");
  if (!refused && state.tenantId && press && press.orgId === ctx.orgId && press.userId === ctx.userId) {
    try {
      const queued = await enqueueAttachments(press, state, [
        { jobUuid: job.toLowerCase(), documentId: doc.id, name: doc.file_name, mimeType: doc.mime_type, sizeBytes: doc.size_bytes, key: `photo:${doc.id}` },
      ]);
      if (queued && !queued.capped && queued.ids.length > 0) {
        /* as the Documents face's Send: what outlives the budget goes on
           behind the answer, and the drain follows it (sm8-drain) */
        const pressRun = runSm8Writes(ctx.orgId, "send", { ids: queued.ids, budgetMs: SEND_BUDGET_MS });
        const run = await settleWithin(pressRun, SEND_BUDGET_MS);
        if (run === null || run.stopped === null) drainSm8WritesAfterResponse(ctx.orgId, { startedAt, behind: run === null ? pressRun : undefined });
      }
    } catch (err) {
      console.error(`[mobile] photo ${doc.id} on job ${job} for org ${ctx.orgId} couldn't be sent: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const sends = await readJobSends(ctx.orgId, job.toLowerCase());
  const sent = sendLine(sends, [doc.id], state.readable ? sendHold(state, "attachment") : null) ?? (refused ? { word: refused, tone: null } : null);
  return { ok: true, value: { documentId: doc.id, sent } };
}
