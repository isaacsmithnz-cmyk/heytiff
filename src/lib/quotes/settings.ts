import { COMPONENT_KEYS, type ComponentKey } from "./components";

/* QUOTING SETTINGS — one row per business (quote_settings): the markup on
   units and on materials, the length of an install day, and the price-book
   item each component is priced from. The Quoting page in Admin writes it;
   the quote's price build-up reads it. The labour RATE is not here: it
   stays the Rate Calculator's, and the build-up reads it from there. */

/** The price-book item a component is priced from: a supplier's code in
    HeyTiff's own price book (quote_price_items). */
export type Preferred = { supplierKey: string; code: string; rollM: number | null };

export type QuoteSettings = {
  unitMarkupPct: number;
  materialMarkupPct: number;
  dayHours: number;
  preferred: Partial<Record<ComponentKey, Preferred>>;
};

/** 25 on units, 40 on materials: what ServiceM8's catalogue carries on
    units today, and the pair that lands 23 real quotes closest with no lean
    either way (mean +0.1%, see past-jobs.test.ts). */
export const DEFAULT_QUOTE_SETTINGS: QuoteSettings = {
  unitMarkupPct: 25,
  materialMarkupPct: 40,
  dayHours: 8,
  preferred: {},
};

export const MAX_MARKUP_PCT = 300;
export const MAX_DAY_HOURS = 16;

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const clampTo = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = num(v);
  return n == null ? fallback : Math.min(hi, Math.max(lo, Math.round(n * 10) / 10));
};

function preferredOf(raw: unknown): QuoteSettings["preferred"] {
  const out: QuoteSettings["preferred"] = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const key of COMPONENT_KEYS) {
    const p = (raw as Record<string, unknown>)[key];
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const supplier = o.supplier_key ?? o.supplierKey;
    const code = o.code;
    if (typeof supplier !== "string" || !supplier || typeof code !== "string" || !code) continue;
    const roll = num(o.roll_m ?? o.rollM);
    out[key] = { supplierKey: supplier.slice(0, 40), code: code.slice(0, 80), rollM: roll && roll > 0 && roll <= 1000 ? roll : null };
  }
  return out;
}

/** The one gate between a stored row (or a person's edit) and a quote. */
export function normaliseQuoteSettings(raw: unknown): QuoteSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_QUOTE_SETTINGS;
  return {
    unitMarkupPct: clampTo(r.unit_markup_pct ?? r.unitMarkupPct, 0, MAX_MARKUP_PCT, d.unitMarkupPct),
    materialMarkupPct: clampTo(r.material_markup_pct ?? r.materialMarkupPct, 0, MAX_MARKUP_PCT, d.materialMarkupPct),
    dayHours: clampTo(r.day_hours ?? r.dayHours, 1, MAX_DAY_HOURS, d.dayHours),
    preferred: preferredOf(r.preferred),
  };
}

/** The row as the table stores it. */
export function quoteSettingsRow(s: QuoteSettings) {
  const preferred: Record<string, { supplier_key: string; code: string; roll_m: number | null }> = {};
  for (const [k, p] of Object.entries(s.preferred)) {
    if (p) preferred[k] = { supplier_key: p.supplierKey, code: p.code, roll_m: p.rollM };
  }
  return {
    unit_markup_pct: s.unitMarkupPct,
    material_markup_pct: s.materialMarkupPct,
    day_hours: s.dayHours,
    preferred,
  };
}
