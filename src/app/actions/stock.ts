"use server";

import { requireOrg } from "@/lib/permissions-server";
import { readStock, type StockView } from "@/lib/stock/stock-server";
import { stockPress as press, weekOf } from "@/lib/stock/stock-press";

/* STOCK's presses (lib/stock/stock-press says each one). Behind `workboard`,
   as Jobs and Schedule are. Each hands back the week as it now stands, so
   the page never reads twice. Server Functions are reachable by direct
   POST, so each re-checks the capability for itself. */

type Back = { ok: true; view: StockView } | { ok: false; reason: string };

export async function stockWeek(week: unknown): Promise<StockView> {
  const { orgId } = await requireOrg("workboard");
  return readStock(orgId, weekOf(week));
}

/** One press, by `do`: instock, order, ordered, bulk, had, needed, back, option, site. */
export async function stockPress(body: unknown): Promise<Back> {
  const { orgId, userId } = await requireOrg("workboard");
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const r = await press(orgId, userId, b);
  if (!r) return { ok: false, reason: "What should happen?" };
  return r.ok ? { ok: true, view: await readStock(orgId, weekOf(b.week)) } : r;
}
