import "server-only";
import { markOrdered, orderForJobs, orderItem, putMarksBack, setHad, setInStock, setNeededAt, setOrderUrl, takeOption, type MarkSnap } from "./stock-server";
import type { HadWhere, OrderedTo, Week } from "./stock";

/* STOCK'S PRESSES, read from what the web's actions and the phone's
   /api/mobile/stock are sent, so the two doors take the same words. Every
   value is checked here: these are reachable by direct POST. */

export const weekOf = (w: unknown): Week => (w === "after" ? "after" : w === "later" ? "later" : "next");
const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(10_000, Math.round(n))) : null);
const str = (s: unknown, max: number) => (typeof s === "string" && s.trim() ? s.trim().slice(0, max) : null);
const day = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const to = (s: unknown): OrderedTo => (s === "site" ? "site" : "factory");
const where = (s: unknown): HadWhere | null => (s === "site" || s === "van" || s === "customer" ? s : null);
const ids = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === "string" && !!x).slice(0, 200) : []);

const snaps = (rows: unknown): MarkSnap[] =>
  (Array.isArray(rows) ? rows : [])
    .slice(0, 500)
    .map((r) => (r ?? {}) as Record<string, unknown>)
    .filter((r) => typeof r.uuid === "string" && typeof r.key === "string")
    .map((r) => ({
      uuid: String(r.uuid),
      key: String(r.key).slice(0, 120),
      inStock: count(r.inStock) ?? 0,
      ordered: count(r.ordered) ?? 0,
      had: count(r.had) ?? 0,
      orderedTo: to(r.orderedTo),
      orderedDue: day(r.orderedDue),
      orderRef: str(r.orderRef, 60),
      hadWhere: where(r.hadWhere),
      hadWho: str(r.hadWho, 80),
    }));

/** One press: `do` says which. Null when it isn't one. */
export async function stockPress(orgId: string, userId: string, b: Record<string, unknown>): Promise<{ ok: true } | { ok: false; reason: string } | null> {
  const week = weekOf(b.week);
  const key = str(b.key, 120);
  const supplier = str(b.supplier, 40);
  switch (b.do) {
    case "instock":
      return key ? setInStock(orgId, userId, week, key, b.total === null ? null : count(b.total)) : null;
    case "order":
      return key ? orderItem(orgId, userId, week, key, { supplierKey: supplier, to: to(b.to), due: day(b.due), ref: str(b.ref, 60) }) : null;
    case "ordered": {
      const due = (b.due ?? {}) as Record<string, unknown>;
      const sites: Record<string, string | null> = {};
      for (const [k, v] of Object.entries((due.sites ?? {}) as Record<string, unknown>).slice(0, 200)) sites[k] = day(v);
      return markOrdered(orgId, userId, week, supplier, { sites: ids(b.sites), due: { factory: day(due.factory), sites }, ref: str(b.ref, 60) });
    }
    case "bulk":
      return orderForJobs(orgId, userId, supplier, ids(b.jobs), { to: to(b.to), due: day(b.due), ref: str(b.ref, 60) });
    case "had": {
      const w = where(b.where);
      return key && w ? setHad(orgId, week, key, w, str(b.who, 80)) : null;
    }
    case "needed": {
      const job = str(b.job, 60);
      return job && key ? setNeededAt(orgId, job, key, b.visit === null ? null : count(b.visit)) : null;
    }
    case "back":
      return Array.isArray(b.rows) ? putMarksBack(orgId, snaps(b.rows)) : null;
    case "option": {
      const job = str(b.job, 60);
      return job ? takeOption(orgId, userId, job, count(b.option) ?? 0) : null;
    }
    case "site":
      return supplier && typeof b.url === "string" ? setOrderUrl(orgId, supplier, b.url) : null;
    default:
      return null;
  }
}
