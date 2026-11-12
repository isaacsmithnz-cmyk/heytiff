"use server";

import { requireOrg } from "@/lib/permissions-server";
import { markOrdered, putMarksBack, readStock, setInStock, takeOption, type StockView } from "@/lib/stock/stock-server";
import type { Week } from "@/lib/stock/stock";

/* STOCK's presses (lib/stock/stock-server). Behind `workboard`, as Jobs and
   Schedule are. Each hands back the week as it now stands, so the page
   never reads twice. Server Functions are reachable by direct POST, so each
   re-checks the capability for itself. */

type Back = { ok: true; view: StockView } | { ok: false; reason: string };
const weekOf = (w: unknown): Week => (w === "after" ? "after" : "next");
const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(10_000, Math.round(n))) : null);

async function then(orgId: string, week: Week, r: { ok: true } | { ok: false; reason: string }): Promise<Back> {
  return r.ok ? { ok: true, view: await readStock(orgId, week) } : r;
}

export async function stockWeek(week: unknown): Promise<StockView> {
  const { orgId } = await requireOrg("workboard");
  return readStock(orgId, weekOf(week));
}

/** "We've got N" of an item (null: all of them). */
export async function stockInStock(week: unknown, key: unknown, total: unknown): Promise<Back> {
  const { orgId, userId } = await requireOrg("workboard");
  if (typeof key !== "string" || !key) return { ok: false, reason: "Which item?" };
  return then(orgId, weekOf(week), await setInStock(orgId, userId, weekOf(week), key, total === null ? null : count(total)));
}

export async function stockOrdered(week: unknown, supplierKey: unknown): Promise<Back> {
  const { orgId, userId } = await requireOrg("workboard");
  const key = typeof supplierKey === "string" && supplierKey ? supplierKey.slice(0, 40) : null;
  return then(orgId, weekOf(week), await markOrdered(orgId, userId, weekOf(week), key));
}

/** Undo of Mark ordered: each job's counts put back as they were. */
export async function stockPutBack(week: unknown, rows: unknown): Promise<Back> {
  const { orgId } = await requireOrg("workboard");
  const list = (Array.isArray(rows) ? rows : [])
    .slice(0, 500)
    .map((r) => r as Record<string, unknown>)
    .filter((r) => typeof r.uuid === "string" && typeof r.key === "string")
    .map((r) => ({ uuid: String(r.uuid), key: String(r.key).slice(0, 120), inStock: count(r.inStock) ?? 0, ordered: count(r.ordered) ?? 0 }));
  return then(orgId, weekOf(week), await putMarksBack(orgId, list));
}

/** The option the client took, pressed on Stock: marked accepted on the quote. */
export async function stockTakeOption(week: unknown, jobUuid: unknown, option: unknown): Promise<Back> {
  const { orgId, userId } = await requireOrg("workboard");
  if (typeof jobUuid !== "string" || !jobUuid) return { ok: false, reason: "Which job?" };
  return then(orgId, weekOf(week), await takeOption(orgId, userId, jobUuid, count(option) ?? 0));
}
