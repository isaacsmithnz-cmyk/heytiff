import "server-only";

import { addPurchase, getPurchase, placePurchaseLines, pricePurchaseLine, recentJobsForPurchase, type PlaceTo, type PurchaseResult } from "@/app/actions/purchases";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { landSlot, openSlot } from "@/lib/documents/upload-slots";
import { actAsPhoneUser, type MobileCtx } from "@/lib/mobile/auth";
import type { Purchase } from "@/lib/purchases/purchase";

/* PURCHASES ON THE PHONE (Isaac, 29 October 2026, "Build" on the mock
   DMsn3JEQ…): New › Purchase, and a job's Add › Purchase. The photo goes up
   first, as a `purchase_docket` (a slot the phone PUTs the bytes to, then
   land), then Tiff reads it from the bucket and it's kept: the web's own
   actions (actions/purchases), run as the phone's person, so the gate, the
   price book and Undo are the web's. `workboard`, as on the web. */

type Done<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const bad = (error: string, status = 400): Done<never> => ({ ok: false, status, error });
const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

const done = (r: PurchaseResult): Done<{ purchase: Purchase }> => (r.ok ? { ok: true, value: { purchase: r.purchase } } : bad(r.error));

/** A slot for the docket's bytes. */
export async function docketSlot(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<{ documentId: string; uploadUrl: string }>> {
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId);
  if (!staffId) return bad("Your account isn't linked to a staff record.", 403);
  const size = typeof body.sizeBytes === "number" && body.sizeBytes > 0 ? Math.round(body.sizeBytes) : 0;
  const slot = await openSlot(ctx.orgId, staffId, "purchase_docket", {
    fileName: str(body.fileName, 120) || "docket.jpg",
    mimeType: str(body.mimeType, 60) || "image/jpeg",
    sizeBytes: size,
  });
  if (!slot.ok) return bad(slot.error);
  return { ok: true, value: { documentId: slot.documentId, uploadUrl: slot.signedUrl } };
}

/** The bytes landed. */
export async function landDocket(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<null>> {
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId);
  if (!staffId) return bad("Your account isn't linked to a staff record.", 403);
  const id = str(body.documentId, 60);
  if (!id) return bad("Which docket?");
  const landed = await landSlot(ctx.orgId, staffId, id);
  return landed.ok ? { ok: true, value: null } : bad(landed.error);
}

/** Tiff reads the landed docket and it's kept, its prices into the book. */
export async function readDocketPurchase(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<{ purchase: Purchase }>> {
  const id = str(body.documentId, 60);
  if (!id) return bad("Take a photo of the docket first.");
  return done(await actAsPhoneUser(ctx, () => addPurchase(id)));
}

const placeTo = (v: unknown): PlaceTo | null => {
  if (v === "stock" || v === "open") return v;
  if (v && typeof v === "object" && typeof (v as { jobUuid?: unknown }).jobUuid === "string") return { jobUuid: (v as { jobUuid: string }).jobUuid };
  return null;
};

/** Add to job, Stock, or Undo. */
export async function placeLines(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<{ purchase: Purchase }>> {
  const to = placeTo(body.to);
  if (!to) return bad("Where should they go?");
  const ids = Array.isArray(body.lineIds) ? body.lineIds.filter((x): x is string => typeof x === "string") : [];
  return done(await actAsPhoneUser(ctx, () => placePurchaseLines(str(body.id, 60), ids, to)));
}

/** A price for a line that had none. */
export async function priceLine(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<{ purchase: Purchase }>> {
  const dollars = typeof body.dollars === "number" ? body.dollars : Number(body.dollars);
  return done(await actAsPhoneUser(ctx, () => pricePurchaseLine(str(body.id, 60), str(body.lineId, 60), dollars)));
}

/** One purchase, to come back to its lines. */
export async function readPhonePurchase(ctx: MobileCtx, id: string): Promise<Done<{ purchase: Purchase }>> {
  return done(await actAsPhoneUser(ctx, () => getPurchase(id)));
}

/** Which job?'s Recent. */
export async function recentJobs(ctx: MobileCtx): Promise<Done<{ jobs: { jobUuid: string; label: string }[] }>> {
  return { ok: true, value: { jobs: await actAsPhoneUser(ctx, () => recentJobsForPurchase()) } };
}
