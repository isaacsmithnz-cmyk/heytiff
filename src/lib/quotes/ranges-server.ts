import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { quotesByCode } from "./book-view-server";
import { netCents, type Supplier } from "./price-book";
import { currentItems, currentItemsByCode, readSuppliers, type BookItem, type SupplierView } from "./price-book-server";
import {
  RANGE_KEYS,
  RANGE_KINDS,
  cleanSize,
  inKind,
  lineLabel,
  rangeKindOf,
  sizeWords,
  wholeRange,
  type CandidateLine,
  type RangeKind,
  type RangeSize,
  type RangeView,
} from "./ranges";
import { familyWords } from "./families";
import type { RangeOffer } from "./job-price";

/* The business's ranges, stored (quote_range_items.sql): each item in a
   range at the size a person confirmed. What a quote prices from
   (rangeOffersFrom), what Quoting shows (rangeViews), the price-book items
   a range is chosen from (rangeCandidates), and a range changed
   (saveRange). Every read and write is the one business's. Service role;
   callers gate on `financials`. */

export type RangeRow = { kind: RangeKind; supplierKey: string; code: string; size: RangeSize };

type StoredRange = { kind: string; supplier_key: string; code: string; size: unknown };

/** Every item in the business's ranges, at its confirmed size. */
export async function readRanges(orgId: string): Promise<RangeRow[]> {
  const { data } = await supabaseAdmin.from("quote_range_items").select("kind, supplier_key, code, size").eq("org_id", orgId);
  return ((data ?? []) as StoredRange[]).flatMap((r) => {
    const kind = RANGE_KEYS.find((k) => k === r.kind);
    const size = kind ? cleanSize(kind, r.size) : null;
    return kind && size ? [{ kind, supplierKey: r.supplier_key, code: r.code, size }] : [];
  });
}

/** Each range's items at today's prices, for a quote: an item the book no
    longer holds is left out. Pure. */
export function rangeOffersFrom(rows: readonly RangeRow[], book: readonly BookItem[], suppliers: readonly Supplier[]): Map<RangeKind, RangeOffer[]> {
  const sup = new Map(suppliers.map((s) => [s.key, s]));
  const item = new Map(book.map((i) => [`${i.supplierKey}|${i.code}`, i]));
  const out = new Map<RangeKind, RangeOffer[]>();
  for (const r of rows) {
    const i = item.get(`${r.supplierKey}|${r.code}`);
    const s = sup.get(r.supplierKey);
    if (!i || !s) continue;
    const perUnitCents = netCents(s, i.code, i.cents, i.net);
    if (!(perUnitCents > 0)) continue;
    out.set(r.kind, [...(out.get(r.kind) ?? []), { size: r.size, perUnitCents, supplierKey: r.supplierKey, code: r.code, name: i.name }]);
  }
  return out;
}

/** Every range, its items by size, for the Quoting page. */
export async function rangeViews(orgId: string, suppliers?: SupplierView[]): Promise<RangeView[]> {
  const [rows, sups] = await Promise.all([readRanges(orgId), suppliers ? Promise.resolve(suppliers) : readSuppliers(orgId)]);
  const book = rows.length ? await currentItemsByCode(orgId, rows.map((r) => r.code)) : [];
  return viewsOf(rows, book, sups);
}

function viewsOf(rows: readonly RangeRow[], book: readonly BookItem[], suppliers: readonly SupplierView[]): RangeView[] {
  const sup = new Map(suppliers.map((s) => [s.key, s]));
  const item = new Map(book.map((i) => [`${i.supplierKey}|${i.code}`, i]));
  return RANGE_KEYS.map((kind) => ({
    kind,
    items: rows
      .filter((r) => r.kind === kind)
      .map((r) => {
        const i = item.get(`${r.supplierKey}|${r.code}`);
        const s = sup.get(r.supplierKey);
        return {
          supplierKey: r.supplierKey,
          supplierName: s?.name ?? r.supplierKey,
          code: r.code,
          name: i?.name ?? r.code,
          size: r.size,
          words: sizeWords(kind, r.size),
          buyCents: i && s ? netCents(s, i.code, i.cents, i.net) : null,
        };
      }),
  }));
}

/** The price book's product lines of a kind, each item with the size its
    name gives: the ones the business's quotes use most first. */
export async function rangeCandidates(orgId: string, kind: RangeKind): Promise<CandidateLine[]> {
  const [book, suppliers, uses] = await Promise.all([currentItems(orgId), readSuppliers(orgId), quotesByCode(orgId)]);
  const sup = new Map(suppliers.map((s) => [s.key, s]));
  const lines = new Map<string, CandidateLine>();
  for (const i of book) {
    const s = sup.get(i.supplierKey);
    if (!s || !inKind(kind, i.name)) continue;
    const buyCents = netCents(s, i.code, i.cents, i.net);
    if (!(buyCents > 0)) continue;
    const key = `${i.supplierKey}|${familyWords(i.name).join(" ").toUpperCase()}`;
    const line = lines.get(key) ?? { key, label: lineLabel(i.name) || i.name, supplierKey: i.supplierKey, supplierName: s.name, quotes: 0, items: [] };
    const size = RANGE_KINDS[kind].sizeOf(i.name);
    line.items.push({ code: i.code, name: i.name, size, words: size ? sizeWords(kind, size) : "", buyCents });
    line.quotes += uses.get(i.code) ?? 0;
    lines.set(key, line);
  }
  const sized = (l: CandidateLine) => l.items.filter((i) => i.size).length;
  return [...lines.values()]
    .filter((l) => sized(l) > 0)
    .sort((a, b) => b.quotes - a.quotes || sized(b) - sized(a) || a.label.localeCompare(b.label));
}

/** Items into a range at their confirmed sizes, and items out of it. Only
    current items of the business's own suppliers that are of the kind go
    in. The range after, for the page. */
export async function saveRange(
  orgId: string,
  userId: string,
  kind: RangeKind,
  add: readonly { supplierKey: string; code: string; size: unknown }[],
  remove: readonly { supplierKey: string; code: string }[]
): Promise<RangeView | null> {
  const suppliers = await readSuppliers(orgId);
  const keys = new Set(suppliers.map((s) => s.key));
  const book = add.length ? await currentItemsByCode(orgId, add.map((a) => a.code)) : [];
  const held = new Map(book.map((i) => [`${i.supplierKey}|${i.code}`, i]));
  const now = new Date().toISOString();
  const rows = add.flatMap((a) => {
    const i = held.get(`${a.supplierKey}|${a.code}`);
    const size = cleanSize(kind, a.size);
    return keys.has(a.supplierKey) && i && inKind(kind, i.name) && size
      ? [{ org_id: orgId, kind, supplier_key: a.supplierKey, code: a.code, size, added_by: userId, added_at: now }]
      : [];
  });
  for (const r of remove) {
    const { error } = await supabaseAdmin.from("quote_range_items").delete().eq("org_id", orgId).eq("kind", kind).eq("supplier_key", r.supplierKey).eq("code", r.code);
    if (error) return null;
  }
  if (rows.length) {
    const { error } = await supabaseAdmin.from("quote_range_items").upsert(rows, { onConflict: "org_id,kind,supplier_key,code" });
    if (error) return null;
  }
  const all = (await readRanges(orgId)).filter((r) => r.kind === kind);
  const items = all.length ? await currentItemsByCode(orgId, all.map((r) => r.code)) : [];
  return viewsOf(all, items, suppliers).find((v) => v.kind === kind) ?? { kind, items: [] };
}

/** An item chosen as preferred fills its range (ranges.ts, wholeRange):
    its product line at every size, over another line's item at those
    sizes. Nothing when the item is no range's, or its size can't be read. */
export async function preferRange(orgId: string, userId: string, supplierKey: string, code: string, wasName = ""): Promise<{ kind: RangeKind; sizes: number } | null> {
  const [item] = await currentItemsByCode(orgId, [code]);
  if (!item || item.supplierKey !== supplierKey) return null;
  const kind = rangeKindOf(item.name, wasName);
  if (!kind) return null;
  const line = (await rangeCandidates(orgId, kind)).find((l) => l.supplierKey === supplierKey && l.items.some((i) => i.code === code));
  if (!line) return null;
  const held = (await readRanges(orgId)).filter((r) => r.kind === kind);
  const { add, remove } = wholeRange(kind, line.items, supplierKey, held);
  if (add.length === 0) return null;
  const saved = await saveRange(orgId, userId, kind, add, remove);
  return saved ? { kind, sizes: add.length } : null;
}
