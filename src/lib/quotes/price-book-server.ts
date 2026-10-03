import { supabaseAdmin } from "@/lib/supabase-server";
import {
  BUILT_IN_SUPPLIERS,
  MAX_DISCOUNT_PCT,
  compareOffers,
  netCents,
  COLUMN_FIELDS,
  type Columns,
  type DiscountRule,
  type Offer,
  type PriceRow,
  type PricingKind,
  type Supplier,
} from "./price-book";
import { CATEGORIES, categoryOf, type CategoryKey } from "./categories";
import { decidedKey, productsOf } from "./same-items";

/* The price book's database side: the suppliers as stored (over the ones
   whose files HeyTiff reads out of the box), a supplier's new file taken
   in, and a model looked up at every supplier. Every read and write is the
   one business's. Service role; callers gate on `financials`. */

type SupplierRow = {
  key: string;
  name: string;
  pricing: string;
  discount_pct: number | string;
  rules: unknown;
  file_name: string | null;
  imported_at: string | null;
  item_count: number | null;
  format: string | null;
  columns: unknown;
};

export type SupplierView = Supplier & { fileName: string | null; importedAt: string | null; itemCount: number | null };

const rulesOf = (raw: unknown): DiscountRule[] =>
  Array.isArray(raw)
    ? raw
        .map((r) => r as Record<string, unknown>)
        .filter((r) => typeof r.prefix === "string" && r.prefix.trim())
        .map((r) => ({ prefix: String(r.prefix).trim(), discountPct: Number(r.discount_pct ?? r.discountPct) || 0 }))
    : [];

/** A stored column match, only the fields and letters it can hold. */
const columnsOf = (raw: unknown): Columns | null => {
  if (!raw || typeof raw !== "object") return null;
  const out: Columns = {};
  for (const { field } of COLUMN_FIELDS) {
    const v = (raw as Record<string, unknown>)[field];
    if (typeof v === "string" && /^[A-Z]{1,2}$/.test(v)) out[field] = v;
  }
  return out.code && out.price ? out : null;
};

export async function readSuppliers(orgId: string): Promise<SupplierView[]> {
  const { data } = await supabaseAdmin
    .from("quote_suppliers")
    .select("key, name, pricing, discount_pct, rules, file_name, imported_at, item_count, format, columns")
    .eq("org_id", orgId);
  const rows = (data ?? []) as SupplierRow[];
  const stored = new Map(rows.map((r) => [r.key, r]));
  const view = (r: SupplierRow, d: Supplier): SupplierView => ({
    key: d.key,
    name: r.name || d.name,
    pricing: (r.pricing === "list_less" ? "list_less" : "net") as PricingKind,
    file: d.file,
    format: d.format,
    discountPct: Number(r.discount_pct) || 0,
    rules: rulesOf(r.rules),
    columns: columnsOf(r.columns),
    fileName: r.file_name,
    importedAt: r.imported_at,
    itemCount: r.item_count,
  });
  const builtIn = BUILT_IN_SUPPLIERS.map((d) => {
    const r = stored.get(d.key);
    return r ? view(r, d) : { ...d, fileName: null, importedAt: null, itemCount: null };
  });
  /* the suppliers the business added: any CSV or workbook, by heading */
  const added = rows
    .filter((r) => !BUILT_IN_SUPPLIERS.some((d) => d.key === r.key))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => view(r, { key: r.key, name: r.name, pricing: "net", file: "xlsx", format: "headed", discountPct: 0, rules: [] }));
  return [...builtIn, ...added];
}

/** A key for a new supplier's name: "Ideal Air Group" → "ideal_air_group",
    with a number on the end if it's taken. */
export function supplierKeyFor(name: string, taken: string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "supplier";
  let key = base;
  for (let n = 2; taken.includes(key); n++) key = `${base}_${n}`;
  return key;
}

/** A supplier the business buys from that HeyTiff didn't know. */
export async function addSupplier(orgId: string, name: string): Promise<SupplierView | null> {
  const existing = await readSuppliers(orgId);
  if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) return null;
  const key = supplierKeyFor(name, existing.map((s) => s.key));
  const { error } = await supabaseAdmin
    .from("quote_suppliers")
    .insert({ org_id: orgId, key, name, pricing: "net", discount_pct: 0, rules: [], format: "headed" });
  if (error) return null;
  return { key, name, pricing: "net", file: "xlsx", format: "headed", discountPct: 0, rules: [], columns: null, fileName: null, importedAt: null, itemCount: null };
}

/** What the business takes off a list-price supplier: one discount for
    everything, and any range by the start of its codes. The prices stay as
    the list; the discount comes off as they're read, so it applies at once. */
export async function saveSupplierDiscount(orgId: string, supplier: Supplier, discountPct: number, rules: DiscountRule[]) {
  const pct = (n: number) => Math.min(MAX_DISCOUNT_PCT, Math.max(0, Math.round((Number(n) || 0) * 10) / 10));
  const { error } = await supabaseAdmin.from("quote_suppliers").upsert(
    {
      org_id: orgId,
      key: supplier.key,
      name: supplier.name,
      pricing: "list_less",
      discount_pct: pct(discountPct),
      rules: rules
        .map((r) => ({ prefix: r.prefix.trim().toUpperCase().slice(0, 20), discount_pct: pct(r.discountPct) }))
        .filter((r) => r.prefix)
        .slice(0, 20),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,key" }
  );
  return !error;
}

/** Keep the columns a person matched, and how the file's prices read. */
export async function saveSupplierLayout(orgId: string, supplier: Supplier, columns: Columns, pricing: PricingKind, discountPct: number) {
  await supabaseAdmin
    .from("quote_suppliers")
    .upsert(
      {
        org_id: orgId,
        key: supplier.key,
        name: supplier.name,
        columns,
        pricing,
        discount_pct: discountPct,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,key" }
    );
}

export type ImportSummary = {
  read: number;
  added: number;
  changed: number;
  /** in the book before, not in this file */
  gone: number;
};

const CHUNK = 500;

/** A supplier's new file: every row in (a changed price keeps the one it
    replaced), anything the file no longer lists marked not current, and the
    supplier's row stamped with the file. */
export async function importPriceRows(
  orgId: string,
  supplier: Supplier,
  fileName: string,
  rows: PriceRow[]
): Promise<ImportSummary> {
  const now = new Date().toISOString();
  const before = new Map<string, { cents: number; previous_cents: number | null; price_changed_at: string | null; first_seen_at: string }>();
  for (let from = 0; ; from += 1000) {
    const { data } = await supabaseAdmin
      .from("quote_price_items")
      .select("code, cents, previous_cents, price_changed_at, first_seen_at")
      .eq("org_id", orgId)
      .eq("supplier_key", supplier.key)
      .order("code")
      .range(from, from + 999);
    const page = (data ?? []) as { code: string; cents: number; previous_cents: number | null; price_changed_at: string | null; first_seen_at: string }[];
    for (const r of page) before.set(r.code, r);
    if (page.length < 1000) break;
  }

  let added = 0;
  let changed = 0;
  const upserts = rows.map((r) => {
    const had = before.get(r.code);
    if (!had) added++;
    const moved = had && had.cents !== r.cents;
    if (moved) changed++;
    return {
      org_id: orgId,
      supplier_key: supplier.key,
      code: r.code,
      name: r.name,
      cents: r.cents,
      previous_cents: moved ? had.cents : (had?.previous_cents ?? null),
      price_changed_at: moved ? now : (had?.price_changed_at ?? null),
      first_seen_at: had?.first_seen_at ?? now,
      last_import_at: now,
      current: true,
      priced_on: r.pricedOn ?? null,
      times_bought: r.timesBought ?? null,
      qty_bought: r.qtyBought ?? null,
      uom: r.uom ?? null,
    };
  });
  for (let i = 0; i < upserts.length; i += CHUNK) {
    const { error } = await supabaseAdmin
      .from("quote_price_items")
      .upsert(upserts.slice(i, i + CHUNK), { onConflict: "org_id,supplier_key,code" });
    if (error) throw new Error(error.message);
  }

  const inFile = new Set(rows.map((r) => r.code));
  const goneCodes = [...before.keys()].filter((c) => !inFile.has(c));
  for (let i = 0; i < goneCodes.length; i += CHUNK) {
    await supabaseAdmin
      .from("quote_price_items")
      .update({ current: false })
      .eq("org_id", orgId)
      .eq("supplier_key", supplier.key)
      .in("code", goneCodes.slice(i, i + CHUNK));
  }

  await supabaseAdmin.from("quote_suppliers").upsert(
    {
      org_id: orgId,
      key: supplier.key,
      name: supplier.name,
      pricing: supplier.pricing,
      discount_pct: supplier.discountPct,
      rules: supplier.rules.map((r) => ({ prefix: r.prefix, discount_pct: r.discountPct })),
      file_name: fileName.slice(0, 200),
      imported_at: now,
      item_count: rows.length,
      updated_at: now,
    },
    { onConflict: "org_id,key" }
  );

  return { read: rows.length, added, changed, gone: goneCodes.length };
}

export type BookItem = {
  supplierKey: string;
  code: string;
  name: string;
  cents: number;
  pricedOn: string | null;
  timesBought: number | null;
  /** the unit it's sold by, when the file says (Reece: EA, MTR, COIL…) */
  uom: string | null;
};

/** Every current item in the book, a page at a time. */
export async function currentItems(orgId: string): Promise<BookItem[]> {
  const out: BookItem[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("quote_price_items")
      .select("supplier_key, code, name, cents, priced_on, times_bought, uom")
      .eq("org_id", orgId)
      .eq("current", true)
      .order("supplier_key")
      .order("code")
      .range(from, from + 999);
    if (error || !data) break;
    for (const r of data as { supplier_key: string; code: string; name: string; cents: number; priced_on: string | null; times_bought: number | null; uom: string | null }[]) {
      out.push({
        supplierKey: r.supplier_key,
        code: r.code,
        name: r.name,
        cents: r.cents,
        pricedOn: r.priced_on,
        timesBought: r.times_bought,
        uom: r.uom,
      });
    }
    if (data.length < 1000) break;
  }
  return out;
}

export type ModelOffers = {
  code: string;
  name: string;
  offers: Offer[];
  cheapest: Offer | null;
  savesCents: number | null;
};

export type SameDecisions = {
  /** confirmed pairs, "supplier|code" each */
  confirmed: [string, string][];
  /** every decided pair, confirmed or not, by decidedKey */
  decided: Set<string>;
};

/* one part at two suppliers: see same-items.ts */
export async function readSameDecisions(orgId: string): Promise<SameDecisions> {
  const { data } = await supabaseAdmin.from("quote_same_items").select("a_ref, b_ref, decision").eq("org_id", orgId);
  const rows = (data ?? []) as { a_ref: string; b_ref: string; decision: string }[];
  return {
    confirmed: rows.filter((r) => r.decision === "confirmed").map((r) => [r.a_ref, r.b_ref]),
    decided: new Set(rows.map((r) => decidedKey(r.a_ref, r.b_ref))),
  };
}

type FoundRow = { supplier_key: string; code: string; name: string; cents: number; priced_on: string | null };

/** A model (or a few words of its name) at every supplier that has it,
    cheapest first. The same code at two suppliers is one model, and so is
    a pair a person confirmed as one part under two codes: finding AAD's
    PC1412 finds Reece's 9800006-1 beside it. */
export async function findOffers(orgId: string, query: string, suppliers: Supplier[]): Promise<ModelOffers[]> {
  const q = query.trim().replace(/[%_,()]/g, " ").trim();
  if (q.length < 2) return [];
  /* the database narrows by the first word; every word must be in the
     code or the name */
  const words = q.toLowerCase().split(/\s+/).slice(0, 4);
  const { data: found } = await supabaseAdmin
    .from("quote_price_items")
    .select("supplier_key, code, name, cents, priced_on")
    .eq("org_id", orgId)
    .eq("current", true)
    .or(`code.ilike.%${words[0]}%,name.ilike.%${words[0]}%`)
    .order("code")
    .limit(400);
  const data = ((found ?? []) as FoundRow[]).filter((r) => words.every((w) => `${r.code} ${r.name}`.toLowerCase().includes(w)));

  /* the confirmed partners of what was found, though their names differ */
  const { confirmed } = await readSameDecisions(orgId);
  const foundRefs = new Set(data.map((r) => `${r.supplier_key}|${r.code}`));
  const partners = new Set<string>();
  for (const [a, b] of confirmed) {
    if (foundRefs.has(a) && !foundRefs.has(b)) partners.add(b);
    if (foundRefs.has(b) && !foundRefs.has(a)) partners.add(a);
  }
  if (partners.size > 0) {
    const codes = [...partners].map((r) => r.slice(r.indexOf("|") + 1));
    const { data: more } = await supabaseAdmin
      .from("quote_price_items")
      .select("supplier_key, code, name, cents, priced_on")
      .eq("org_id", orgId)
      .eq("current", true)
      .in("code", codes.slice(0, 200));
    for (const r of (more ?? []) as FoundRow[]) if (partners.has(`${r.supplier_key}|${r.code}`)) data.push(r);
  }
  const products = productsOf(
    data.map((r) => ({ supplierKey: r.supplier_key, code: r.code })),
    confirmed
  );

  const byCode = new Map<string, { name: string; offers: Offer[] }>();
  const nameOf = new Map(suppliers.map((s) => [s.key, s]));
  for (const r of data) {
    const s = nameOf.get(r.supplier_key);
    if (!s) continue;
    const key = products.get(`${r.supplier_key}|${r.code}`) ?? r.code;
    const entry = byCode.get(key) ?? { name: r.name, offers: [] };
    entry.offers.push({
      supplierKey: s.key,
      supplierName: s.name,
      code: r.code,
      name: r.name,
      netCents: netCents(s, r.code, r.cents),
      pricedOn: r.priced_on,
    });
    byCode.set(key, entry);
  }
  return [...byCode.values()]
    .slice(0, 40)
    .map((e) => {
      const cmp = compareOffers(e.offers);
      return { code: cmp.cheapest?.code ?? "", name: e.name, ...cmp };
    });
}

export type CategoryCount = { key: CategoryKey; label: string; count: number };

/** How many products are on each shelf (a part at two suppliers is one). */
export async function categoryCounts(orgId: string): Promise<CategoryCount[]> {
  const [items, { confirmed }] = await Promise.all([currentItems(orgId), readSameDecisions(orgId)]);
  const products = productsOf(items, confirmed);
  const seen = new Map<CategoryKey, Set<string>>();
  for (const i of items) {
    const key = categoryOf(i.name, i.code);
    const ref = `${i.supplierKey}|${i.code}`;
    seen.set(key, (seen.get(key) ?? new Set()).add(products.get(ref) ?? ref));
  }
  return CATEGORIES.map((c) => ({ ...c, count: seen.get(c.key)?.size ?? 0 })).filter((c) => c.count > 0);
}

export type ShelfView = { total: number; models: ModelOffers[] };

const SHELF = 100;

/** One shelf's products, every supplier's price for each, cheapest first,
    in name order — narrowed by a few words when given. */
export async function browseCategory(orgId: string, category: CategoryKey, query: string, suppliers: Supplier[]): Promise<ShelfView> {
  const [items, { confirmed }] = await Promise.all([currentItems(orgId), readSameDecisions(orgId)]);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
  const onShelf = items.filter(
    (i) => categoryOf(i.name, i.code) === category && words.every((w) => `${i.code} ${i.name}`.toLowerCase().includes(w))
  );
  const products = productsOf(onShelf, confirmed);
  const sup = new Map(suppliers.map((s) => [s.key, s]));
  const byProduct = new Map<string, { name: string; offers: Offer[] }>();
  for (const i of onShelf) {
    const s = sup.get(i.supplierKey);
    if (!s) continue;
    const ref = `${i.supplierKey}|${i.code}`;
    const key = products.get(ref) ?? ref;
    const entry = byProduct.get(key) ?? { name: i.name, offers: [] };
    entry.offers.push({ supplierKey: s.key, supplierName: s.name, code: i.code, name: i.name, netCents: netCents(s, i.code, i.cents), pricedOn: i.pricedOn });
    byProduct.set(key, entry);
  }
  const all = [...byProduct.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    total: all.length,
    models: all.slice(0, SHELF).map((e) => {
      const cmp = compareOffers(e.offers);
      return { code: cmp.cheapest?.code ?? "", name: e.name, ...cmp };
    }),
  };
}
