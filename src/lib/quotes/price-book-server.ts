import { supabaseAdmin } from "@/lib/supabase-server";
import {
  DEFAULT_SUPPLIERS,
  compareOffers,
  netCents,
  type DiscountRule,
  type Offer,
  type PriceRow,
  type PricingKind,
  type Supplier,
} from "./price-book";

/* The price book's database side: the suppliers as stored (over the two
   defaults), a supplier's new file taken in, and a model looked up at every
   supplier. Service role; callers gate on `financials`. */

type SupplierRow = {
  key: string;
  name: string;
  pricing: string;
  discount_pct: number | string;
  rules: unknown;
  file_name: string | null;
  imported_at: string | null;
  item_count: number | null;
};

export type SupplierView = Supplier & { fileName: string | null; importedAt: string | null; itemCount: number | null };

const rulesOf = (raw: unknown): DiscountRule[] =>
  Array.isArray(raw)
    ? raw
        .map((r) => r as Record<string, unknown>)
        .filter((r) => typeof r.prefix === "string" && r.prefix.trim())
        .map((r) => ({ prefix: String(r.prefix).trim(), discountPct: Number(r.discount_pct ?? r.discountPct) || 0 }))
    : [];

export async function readSuppliers(orgId: string): Promise<SupplierView[]> {
  const { data } = await supabaseAdmin
    .from("quote_suppliers")
    .select("key, name, pricing, discount_pct, rules, file_name, imported_at, item_count")
    .eq("org_id", orgId);
  const stored = new Map(((data ?? []) as SupplierRow[]).map((r) => [r.key, r]));
  return DEFAULT_SUPPLIERS.map((d) => {
    const r = stored.get(d.key);
    if (!r) return { ...d, fileName: null, importedAt: null, itemCount: null };
    return {
      key: d.key,
      name: r.name || d.name,
      pricing: (r.pricing === "list_less" ? "list_less" : "net") as PricingKind,
      discountPct: Number(r.discount_pct) || 0,
      rules: rulesOf(r.rules),
      fileName: r.file_name,
      importedAt: r.imported_at,
      itemCount: r.item_count,
    };
  });
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

export type BookItem = { supplierKey: string; code: string; name: string; cents: number };

/** Every current item in the book, a page at a time. */
export async function currentItems(orgId: string): Promise<BookItem[]> {
  const out: BookItem[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("quote_price_items")
      .select("supplier_key, code, name, cents")
      .eq("org_id", orgId)
      .eq("current", true)
      .order("supplier_key")
      .order("code")
      .range(from, from + 999);
    if (error || !data) break;
    for (const r of data as { supplier_key: string; code: string; name: string; cents: number }[]) {
      out.push({ supplierKey: r.supplier_key, code: r.code, name: r.name, cents: r.cents });
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

/** A model (or a few words of its name) at every supplier that has it,
    cheapest first. The same code at two suppliers is one model. */
export async function findOffers(orgId: string, query: string, suppliers: Supplier[]): Promise<ModelOffers[]> {
  const q = query.trim().replace(/[%_,()]/g, " ").trim();
  if (q.length < 2) return [];
  /* the database narrows by the first word; every word must be in the
     code or the name */
  const words = q.toLowerCase().split(/\s+/).slice(0, 4);
  const { data: found } = await supabaseAdmin
    .from("quote_price_items")
    .select("supplier_key, code, name, cents")
    .eq("org_id", orgId)
    .eq("current", true)
    .or(`code.ilike.%${words[0]}%,name.ilike.%${words[0]}%`)
    .order("code")
    .limit(400);
  const data = ((found ?? []) as { supplier_key: string; code: string; name: string; cents: number }[]).filter((r) =>
    words.every((w) => `${r.code} ${r.name}`.toLowerCase().includes(w))
  );
  const byCode = new Map<string, { name: string; offers: Offer[] }>();
  const nameOf = new Map(suppliers.map((s) => [s.key, s]));
  for (const r of data) {
    const s = nameOf.get(r.supplier_key);
    if (!s) continue;
    const entry = byCode.get(r.code) ?? { name: r.name, offers: [] };
    entry.offers.push({ supplierKey: s.key, supplierName: s.name, code: r.code, name: r.name, netCents: netCents(s, r.code, r.cents) });
    byCode.set(r.code, entry);
  }
  return [...byCode.entries()]
    .slice(0, 40)
    .map(([code, e]) => ({ code, name: e.name, ...compareOffers(e.offers) }));
}
