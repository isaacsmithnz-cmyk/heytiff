"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { boughtForJob, jobLabelFor, materialsAllowance, placeLines, priceLine, purchaseAddedBy, purchaseFromDocument, readPurchase, recentPurchaseJobs, type BoughtLine } from "@/lib/purchases/purchase-server";
import type { Purchase } from "@/lib/purchases/purchase";

/* PURCHASES (lib/purchases/purchase.ts says what one is). Add a purchase
   from a docket that has landed in the bucket, put its lines on jobs or in
   stock, Undo, and price a line that had none.

   WHO: whoever can use the board (`workboard`), which is whoever is on the
   job and bought the stuff, the same tier that files a job's paperwork. A
   purchase is opened by the person who added it, or by someone with money
   access (`financials`), who sees every purchase under Team. The phone runs
   these same actions as its person (lib/mobile/purchases). */

type Ctx = { orgId: string; userId: string };

async function context(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId || !(await can("workboard"))) return null;
  return { orgId, userId };
}

/** Whether this person may open and change this purchase. */
async function mayOpen(ctx: Ctx, id: string): Promise<boolean> {
  const by = await purchaseAddedBy(ctx.orgId, id);
  if (!by) return false;
  return by === ctx.userId || (await can("financials"));
}

const refresh = () => revalidatePath("/dashboard/team");

export type PurchaseResult = { ok: true; purchase: Purchase } | { ok: false; error: string };

/** Read a docket the person just uploaded, keep it, and put its prices in the book. */
export async function addPurchase(documentId: string): Promise<PurchaseResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Adding a purchase needs the board." };
  if (typeof documentId !== "string" || !documentId) return { ok: false, error: "Take a photo of the docket first." };
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId);
  if (!staffId) return { ok: false, error: "Your account isn't linked to a staff record." };
  const made = await purchaseFromDocument(ctx.orgId, { userId: ctx.userId, staffId }, documentId);
  if (!made.ok) return { ok: false, error: made.reason };
  const purchase = await readPurchase(ctx.orgId, made.id);
  if (!purchase) return { ok: false, error: "The purchase couldn't be read back. Try again." };
  refresh();
  return { ok: true, purchase };
}

export async function getPurchase(id: string): Promise<PurchaseResult> {
  const ctx = await context();
  if (!ctx || typeof id !== "string" || !(await mayOpen(ctx, id))) return { ok: false, error: "That purchase isn't yours to open." };
  const purchase = await readPurchase(ctx.orgId, id);
  return purchase ? { ok: true, purchase } : { ok: false, error: "No such purchase." };
}

export type PlaceTo = { jobUuid: string } | "stock" | "open";

/** Add to job, Stock, or Undo (back to open). */
export async function placePurchaseLines(id: string, lineIds: string[], to: PlaceTo): Promise<PurchaseResult> {
  const ctx = await context();
  if (!ctx || typeof id !== "string" || !(await mayOpen(ctx, id))) return { ok: false, error: "That purchase isn't yours to change." };
  const ids = Array.isArray(lineIds) ? lineIds.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
  if (!ids.length) return { ok: false, error: "Tick a line first." };
  try {
    if (to === "stock") await placeLines(ctx.orgId, id, ids, { wentTo: "stock" }, ctx.userId);
    else if (to === "open") await placeLines(ctx.orgId, id, ids, { wentTo: "open" }, ctx.userId);
    else {
      const jobUuid = typeof to?.jobUuid === "string" ? to.jobUuid : "";
      const label = jobUuid ? await jobLabelFor(ctx.orgId, jobUuid) : null;
      if (!label) return { ok: false, error: "That job couldn't be found." };
      await placeLines(ctx.orgId, id, ids, { wentTo: "job", jobUuid, jobLabel: label }, ctx.userId);
    }
  } catch (err) {
    console.error("[purchases] placing lines failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "That didn't save. Try again." };
  }
  const purchase = await readPurchase(ctx.orgId, id);
  if (!purchase) return { ok: false, error: "No such purchase." };
  refresh();
  return { ok: true, purchase };
}

/** A price typed for a line that had none, in dollars before GST. */
export async function pricePurchaseLine(id: string, lineId: string, dollars: number): Promise<PurchaseResult> {
  const ctx = await context();
  if (!ctx || typeof id !== "string" || !(await mayOpen(ctx, id))) return { ok: false, error: "That purchase isn't yours to change." };
  const cents = Math.round(Number(dollars) * 100);
  if (!Number.isFinite(cents) || cents <= 0 || cents > 100_000_000) return { ok: false, error: "Enter the price of one, before GST." };
  try {
    await priceLine(ctx.orgId, id, String(lineId), cents);
  } catch {
    return { ok: false, error: "That didn't save. Try again." };
  }
  const purchase = await readPurchase(ctx.orgId, id);
  if (!purchase) return { ok: false, error: "No such purchase." };
  refresh();
  return { ok: true, purchase };
}

/** The Which job? sheet's Recent: the jobs this person's purchases went to. */
export async function recentJobsForPurchase(): Promise<{ jobUuid: string; label: string }[]> {
  const ctx = await context();
  return ctx ? recentPurchaseJobs(ctx.orgId, ctx.userId) : [];
}

/** A job's Bought, for its Materials: the lines, and the quote's allowance
    for materials. Money only with money access: without it, what was
    bought, never what it cost. */
export async function jobBought(jobUuid: string): Promise<{ lines: BoughtLine[]; allowanceCents: number | null; money: boolean }> {
  const ctx = await context();
  if (!ctx || typeof jobUuid !== "string" || !jobUuid) return { lines: [], allowanceCents: null, money: false };
  const money = await can("financials");
  const [lines, allowanceCents] = await Promise.all([boughtForJob(ctx.orgId, jobUuid), money ? materialsAllowance(ctx.orgId, jobUuid) : Promise.resolve(null)]);
  return {
    lines: money ? lines : lines.map((l) => ({ ...l, cents: null, bookBefore: null, bookAfter: null })),
    allowanceCents,
    money,
  };
}
