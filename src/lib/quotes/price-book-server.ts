import { supabaseAdmin } from "@/lib/supabase-server";
import {
  BUILT_IN_SUPPLIERS,
  MAX_DISCOUNT_PCT,
  compareOffers,
  effectivePrice,
  netCents,
  COLUMN_FIELDS,
  type Columns,
  type DiscountRule,
  type Offer,
  type ImportSummary,
  type PriceRow,
  type PricePoint,
  type StoredItem,
  planInvoices,
  planPriceList,
  searchWords,
  type PricingKind,
  type Supplier,
  todayInSydney,
} from "./price-book";
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
  list_on: string | null;
  invoice_file_name: string | null;
  invoiced_at: string | null;
  invoice_items: number | null;
};

export type SupplierView = Supplier & {
  /** its price list: the file, when it came in, how many items, and the date its prices are from */
  fileName: string | null;
  importedAt: string | null;
  itemCount: number | null;
  listOn?: string | null;
  /** its latest invoices taken in */
  invoiceFileName?: string | null;
  invoicedAt?: string | null;
  invoiceItems?: number | null;
};

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
    .select("key, name, pricing, discount_pct, rules, file_name, imported_at, item_count, format, columns, list_on, invoice_file_name, invoiced_at, invoice_items")
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
    listOn: r.list_on,
    invoiceFileName: r.invoice_file_name,
    invoicedAt: r.invoiced_at,
    invoiceItems: r.invoice_items,
  });
  /* a supplier whose files HeyTiff reads is the business's only once it
     adds it: a new business starts with none, never with another's */
  const builtIn = BUILT_IN_SUPPLIERS.filter((d) => stored.has(d.key)).map((d) => view(stored.get(d.key)!, d));
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

/** A supplier whose own file HeyTiff reads (AAD's CSV, Reece's, the
    Mitsubishi trade book), added by the business. */
export async function addBuiltInSupplier(orgId: string, key: string): Promise<SupplierView | null> {
  const d = BUILT_IN_SUPPLIERS.find((s) => s.key === key);
  if (!d) return null;
  const existing = await readSuppliers(orgId);
  if (existing.some((s) => s.key === d.key)) return null;
  const { error } = await supabaseAdmin
    .from("quote_suppliers")
    .insert({ org_id: orgId, key: d.key, name: d.name, pricing: d.pricing, discount_pct: 0, rules: [] });
  if (error) return null;
  return { ...d, columns: null, fileName: null, importedAt: null, itemCount: null };
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

export type { ImportSummary } from "./price-book";

const CHUNK = 500;

/** A supplier's new PRICE LIST in (price-book.ts, planPriceList, says what
    changes), and the supplier stamped with the file and its date. */
export async function importPriceRows(
  orgId: string,
  supplier: Supplier,
  fileName: string,
  rows: PriceRow[],
  listOn: string = todayInSydney()
): Promise<ImportSummary> {
  const now = new Date().toISOString();
  const plan = planPriceList(await storedOf(orgId, supplier.key), rows, { orgId, supplierKey: supplier.key, now, listOn });
  for (let i = 0; i < plan.upserts.length; i += CHUNK) {
    const { error } = await supabaseAdmin
      .from("quote_price_items")
      .upsert(plan.upserts.slice(i, i + CHUNK), { onConflict: "org_id,supplier_key,code" });
    if (error) throw new Error(error.message);
  }
  for (const [codes, change] of [
    [plan.offList, { on_list: false }],
    [plan.gone, { current: false }],
  ] as const) {
    for (let i = 0; i < codes.length; i += CHUNK) {
      await supabaseAdmin
        .from("quote_price_items")
        .update(change)
        .eq("org_id", orgId)
        .eq("supplier_key", supplier.key)
        .in("code", codes.slice(i, i + CHUNK));
    }
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
      list_on: listOn,
      item_count: rows.length,
      updated_at: now,
    },
    { onConflict: "org_id,key" }
  );
  return plan.summary;
}

/** A supplier's INVOICES in (price-book.ts, planInvoices): only the codes
    on them change. */
export async function importInvoiceRows(orgId: string, supplier: Supplier, fileName: string, rows: PriceRow[]): Promise<ImportSummary> {
  const now = new Date().toISOString();
  const plan = planInvoices(await storedOf(orgId, supplier.key), rows, { orgId, supplierKey: supplier.key, now, today: todayInSydney() });
  for (let i = 0; i < plan.upserts.length; i += CHUNK) {
    const { error } = await supabaseAdmin
      .from("quote_price_items")
      .upsert(plan.upserts.slice(i, i + CHUNK), { onConflict: "org_id,supplier_key,code" });
    if (error) throw new Error(error.message);
  }
  await supabaseAdmin
    .from("quote_suppliers")
    .update({ invoice_file_name: fileName.slice(0, 200), invoiced_at: now, invoice_items: rows.length, updated_at: now })
    .eq("org_id", orgId)
    .eq("key", supplier.key);
  return plan.summary;
}

/** Every item a supplier has had in the book, by code. */
async function storedOf(orgId: string, supplierKey: string): Promise<Map<string, StoredItem>> {
  const out = new Map<string, StoredItem>();
  for (let from = 0; ; from += 1000) {
    const { data } = await supabaseAdmin
      .from("quote_price_items")
      .select("code, name, cents, previous_cents, price_changed_at, first_seen_at, last_import_at, current, on_list, paid_cents, paid_on, times_bought, qty_bought")
      .eq("org_id", orgId)
      .eq("supplier_key", supplierKey)
      .order("code")
      .range(from, from + 999);
    const page = (data ?? []) as StoredItem[];
    for (const r of page) out.set(r.code, r);
    if (page.length < 1000) break;
  }
  return out;
}

export type BookItem = {
  supplierKey: string;
  code: string;
  name: string;
  /** the price a quote takes: the newer of the price list's and the latest invoice's */
  cents: number;
  /** `cents` is already what was paid (an invoice's): no discount comes off */
  net: boolean;
  /** the date of the price taken, when it has one */
  pricedOn: string | null;
  /** the price not taken, when the item has both */
  other: PricePoint | null;
  timesBought: number | null;
  /** the unit it's sold by, when the file says (Reece: EA, MTR, COIL…) */
  uom: string | null;
};

/** The columns an item's prices are read from. */
const PRICE_COLUMNS = "cents, on_list, listed_on, last_import_at, priced_on, paid_cents, paid_on";

type StoredRow = {
  cents: number;
  on_list: boolean | null;
  listed_on: string | null;
  last_import_at: string | null;
  priced_on: string | null;
  paid_cents: number | null;
  paid_on: string | null;
};

/** An item's price as a quote takes it, from its stored prices. */
export function priceOfRow(r: StoredRow): { cents: number; net: boolean; pricedOn: string | null; other: PricePoint | null } {
  const { price, other } = effectivePrice({
    cents: r.cents,
    onList: r.on_list !== false,
    listedOn: r.listed_on,
    importedAt: r.last_import_at,
    pricedOn: r.priced_on,
    paidCents: r.paid_cents,
    paidOn: r.paid_on,
  });
  /* a plain price list's price has no date to show; an invoiced one does */
  return { cents: price.cents, net: price.net, pricedOn: price.from === "invoice" ? price.on : r.priced_on, other };
}

const PAGE = 1000;

/** Every current item in the book: the first page says how many there are,
    and the rest are asked for at once rather than one after another (eight
    pages in turn took seconds). */
export async function currentItems(orgId: string): Promise<BookItem[]> {
  const page = (from: number, count = false) =>
    supabaseAdmin
      .from("quote_price_items")
      .select(`supplier_key, code, name, times_bought, uom, ${PRICE_COLUMNS}`, count ? { count: "exact" } : undefined)
      .eq("org_id", orgId)
      .eq("current", true)
      .order("supplier_key")
      .order("code")
      .range(from, from + PAGE - 1);
  const first = await page(0, true);
  if (first.error || !first.data) return [];
  const total = first.count ?? first.data.length;
  const rest = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(total / PAGE) - 1) }, (_, i) => page((i + 1) * PAGE)));
  const rows = [first, ...rest].flatMap((r) => (r.data ?? []) as unknown as FoundRow[]);
  return rows.map(asBookItem);
}

export type ModelOffers = {
  code: string;
  name: string;
  offers: Offer[];
  cheapest: Offer | null;
  savesCents: number | null;
  /** the supplier's item the business put forward, when it has */
  preferred?: Offer | null;
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

/** The items the business put forward in the price book, "supplier|code" each. */
export async function readPreferred(orgId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin.from("quote_preferred_items").select("supplier_key, code").eq("org_id", orgId);
  return new Set(((data ?? []) as { supplier_key: string; code: string }[]).map((r) => `${r.supplier_key}|${r.code}`));
}

type FoundRow = { supplier_key: string; code: string; name: string; times_bought: number | null; uom: string | null } & StoredRow;

const asBookItem = (r: FoundRow): BookItem => ({
  supplierKey: r.supplier_key,
  code: r.code,
  name: r.name,
  ...priceOfRow(r),
  timesBought: r.times_bought,
  uom: r.uom,
});

/** The current items whose code or name holds every word (searchWords),
    and the confirmed same-item partners of what's found, though their names
    differ. The database narrows by the longest word — the one fewest names
    hold — up to `limit` rows; every word is then checked here. */
export async function matchingItems(orgId: string, words: string[], confirmed: [string, string][], limit = 400): Promise<BookItem[]> {
  if (words.length === 0) return [];
  const narrow = [...words].sort((a, b) => b.length - a.length)[0]!;
  const rows: FoundRow[] = [];
  for (let from = 0; from < limit; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("quote_price_items")
      .select(`supplier_key, code, name, times_bought, uom, ${PRICE_COLUMNS}`)
      .eq("org_id", orgId)
      .eq("current", true)
      .or(`code.ilike.%${narrow}%,name.ilike.%${narrow}%`)
      .order("supplier_key")
      .order("code")
      .range(from, Math.min(from + 999, limit - 1));
    if (error || !data) break;
    rows.push(...(data as unknown as FoundRow[]));
    if (data.length < 1000) break;
  }
  const found = rows.filter((r) => words.every((w) => `${r.code} ${r.name}`.toLowerCase().includes(w)));

  /* the confirmed partners of what was found */
  const foundRefs = new Set(found.map((r) => `${r.supplier_key}|${r.code}`));
  const partners = new Set<string>();
  for (const [a, b] of confirmed) {
    if (foundRefs.has(a) && !foundRefs.has(b)) partners.add(b);
    if (foundRefs.has(b) && !foundRefs.has(a)) partners.add(a);
  }
  if (partners.size > 0) {
    const codes = [...new Set([...partners].map((r) => r.slice(r.indexOf("|") + 1)))];
    for (let i = 0; i < codes.length; i += 200) {
      const { data: more } = await supabaseAdmin
        .from("quote_price_items")
        .select(`supplier_key, code, name, times_bought, uom, ${PRICE_COLUMNS}`)
        .eq("org_id", orgId)
        .eq("current", true)
        .in("code", codes.slice(i, i + 200));
      for (const r of (more ?? []) as unknown as FoundRow[]) if (partners.has(`${r.supplier_key}|${r.code}`)) found.push(r);
    }
  }
  return found.map(asBookItem);
}

/** A model (or a few words of its name) at every supplier that has it,
    cheapest first; the business's preferred items first, then its most
    bought. The same code at two suppliers is one model, and so is
    a pair a person confirmed as one part under two codes: finding AAD's
    PC1412 finds Reece's 9800006-1 beside it. */
export async function findOffers(orgId: string, query: string, suppliers: Supplier[]): Promise<ModelOffers[]> {
  const words = searchWords(query);
  if (words.join("").length < 2) return [];
  const [{ confirmed }, preferred] = await Promise.all([readSameDecisions(orgId), readPreferred(orgId)]);
  const items = await matchingItems(orgId, words, confirmed);
  const products = productsOf(items, confirmed);

  const byCode = new Map<string, { name: string; offers: Offer[]; bought: number }>();
  const nameOf = new Map(suppliers.map((s) => [s.key, s]));
  for (const i of items) {
    const s = nameOf.get(i.supplierKey);
    if (!s) continue;
    const key = products.get(`${i.supplierKey}|${i.code}`) ?? i.code;
    const entry = byCode.get(key) ?? { name: i.name, offers: [], bought: 0 };
    entry.offers.push({
      supplierKey: s.key,
      supplierName: s.name,
      code: i.code,
      name: i.name,
      netCents: netCents(s, i.code, i.cents, i.net),
      pricedOn: i.pricedOn,
    });
    entry.bought += i.timesBought ?? 0;
    byCode.set(key, entry);
  }
  /* what the business put forward comes first, then what it has bought most */
  return [...byCode.values()]
    .map((e) => {
      const cmp = compareOffers(e.offers);
      const pick = e.offers.find((o) => preferred.has(`${o.supplierKey}|${o.code}`)) ?? null;
      return { model: { code: cmp.cheapest?.code ?? "", name: e.name, ...cmp, preferred: pick }, bought: e.bought };
    })
    .sort((a, b) => (a.model.preferred ? 0 : 1) - (b.model.preferred ? 0 : 1) || b.bought - a.bought)
    .slice(0, 40)
    .map((m) => m.model);
}
