import { COMPONENT_KEYS, type ComponentKey } from "./components";

/* QUOTING SETTINGS — one row per business (quote_settings): the markup on
   units and on materials, the charge-out rate and the working day, and the
   price-book item each component is priced from, and the duct contingency.
   The Quoting page in Admin
   writes it; the quote reads it. A rate or a day left blank here is the
   business's Rate Calculator's (org-day.ts); nothing here has a default
   but the empty one. */

/** The price-book item a component is priced from: a supplier's code in
    HeyTiff's own price book (quote_price_items). */
export type Preferred = { supplierKey: string; code: string; rollM: number | null };

export type QuoteSettings = {
  /** null: the business hasn't set it, and nothing quotes on a guess */
  unitMarkupPct: number | null;
  materialMarkupPct: number | null;
  /** the install charge-out rate, cents an hour; null: the Rate Calculator's */
  chargeOutCents: number | null;
  /** the working day; null: the Rate Calculator's working hours */
  dayHours: number | null;
  /** the duct contingency: a share of a quote's ductwork and grilles, and
      hours on top at the charge-out rate; both null, none (Isaac, 2026-10-04) */
  contingencyPct: number | null;
  contingencyHours: number | null;
  preferred: Partial<Record<ComponentKey, Preferred>>;
};

/** A business that hasn't set a thing has nothing set (Isaac, 2026-10-04:
    "there are to be no made up figures. Everything has to come from the
    orgs own settings"). */
export const DEFAULT_QUOTE_SETTINGS: QuoteSettings = {
  unitMarkupPct: null,
  materialMarkupPct: null,
  chargeOutCents: null,
  dayHours: null,
  contingencyPct: null,
  contingencyHours: null,
  preferred: {},
};

export const MAX_MARKUP_PCT = 300;
export const MAX_DAY_HOURS = 16;
export const MAX_CONTINGENCY_PCT = 100;
export const MAX_CONTINGENCY_HOURS = 80;
/** $2,000 an hour: a typo's ceiling, not a guide */
export const MAX_CHARGE_OUT_CENTS = 200_000;

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const clampTo = (v: unknown, lo: number, hi: number): number | null => {
  const n = num(v);
  return n == null ? null : Math.min(hi, Math.max(lo, Math.round(n * 10) / 10));
};

const chargeOutOf = (v: unknown): number | null => {
  const n = num(v);
  return n == null || n <= 0 ? null : Math.min(MAX_CHARGE_OUT_CENTS, Math.round(n));
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
    unitMarkupPct: clampTo(r.unit_markup_pct ?? r.unitMarkupPct, 0, MAX_MARKUP_PCT) ?? d.unitMarkupPct,
    materialMarkupPct: clampTo(r.material_markup_pct ?? r.materialMarkupPct, 0, MAX_MARKUP_PCT) ?? d.materialMarkupPct,
    chargeOutCents: chargeOutOf(r.charge_out_cents ?? r.chargeOutCents) ?? d.chargeOutCents,
    dayHours: clampTo(r.day_hours ?? r.dayHours, 1, MAX_DAY_HOURS) ?? d.dayHours,
    contingencyPct: clampTo(r.contingency_pct ?? r.contingencyPct, 0, MAX_CONTINGENCY_PCT) ?? d.contingencyPct,
    contingencyHours: clampTo(r.contingency_hours ?? r.contingencyHours, 0, MAX_CONTINGENCY_HOURS) ?? d.contingencyHours,
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
    charge_out_cents: s.chargeOutCents,
    day_hours: s.dayHours,
    contingency_pct: s.contingencyPct,
    contingency_hours: s.contingencyHours,
    preferred,
  };
}
