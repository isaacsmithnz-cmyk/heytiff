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
  /** what a kit carries that isn't one price-book item, at cost; null: not set */
  allowances: Record<AllowanceKey, number | null>;
  /** how the business usually runs ductwork, for a brief that doesn't say;
      null: asked */
  usualLayout: UsualLayout | null;
  /** whether a quote shows the customer its line items unless it says
      otherwise; false: each option's total only (Isaac, 2026-10-05) */
  showLines: boolean;
  /** the share of a quote's price the business means to keep as profit,
      percent; null: not set, and no quote is checked against one (Isaac,
      2026-10-07: "if it's over then great, if it's under it needs a
      warning") */
  profitTargetPct: number | null;
  /** what an hour of labour costs the business, cents; null: the charge-out
      rate less the profit target, since the rate already carries it */
  labourCostCents: number | null;
  /** the business's own hours for a task (slice 8.1): a zone, an outlet or
      grille, a metre of pipe, a visit; null: not set. Empty for a new
      business: nothing is ever priced from them, they're a check */
  taskHours: Record<TaskKey, number | null>;
  preferred: Partial<Record<ComponentKey, Preferred>>;
};

export type TaskKey = "zone" | "grille" | "metre" | "visit";
/** Each task: what one is, as Quoting asks for its hours. */
export const TASKS: Record<TaskKey, { label: string; per: string }> = {
  zone: { label: "A zone", per: "a zone" },
  grille: { label: "An outlet or grille", per: "an outlet" },
  metre: { label: "A metre of pipe", per: "a metre" },
  visit: { label: "A visit", per: "a visit" },
};
export const TASK_KEYS = Object.keys(TASKS) as TaskKey[];
/** 40 hours for one task: a typo's ceiling, not a guide */
export const MAX_TASK_HOURS = 40;

export type UsualLayout = "trunks" | "plenum";
export const USUAL_LAYOUT_WORDS: Record<UsualLayout, string> = {
  trunks: "Trunks of Ø350 off the unit, up to three outlets each, stepped down through BTOs and Ys",
  plenum: "A plenum on the unit with a spigot for each outlet",
};

export type AllowanceKey = "consumables" | "newCircuit" | "flush" | "recovery";
/** Each allowance: its words, and the column it's kept in. */
export const ALLOWANCES: Record<AllowanceKey, { label: string; per: string; column: string }> = {
  consumables: { label: "Consumables", per: "a head", column: "consumables_cents" },
  newCircuit: { label: "New circuit", per: "a circuit", column: "new_circuit_cents" },
  flush: { label: "Pipe flush", per: "a system", column: "flush_cents" },
  recovery: { label: "Recovery and removal", per: "a system", column: "recovery_cents" },
};
export const ALLOWANCE_KEYS = Object.keys(ALLOWANCES) as AllowanceKey[];
/** $5,000: a typo's ceiling */
export const MAX_ALLOWANCE_CENTS = 500_000;

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
  allowances: { consumables: null, newCircuit: null, flush: null, recovery: null },
  usualLayout: null,
  showLines: false,
  profitTargetPct: null,
  labourCostCents: null,
  taskHours: { zone: null, grille: null, metre: null, visit: null },
  preferred: {},
};

export const MAX_MARKUP_PCT = 300;
export const MAX_DAY_HOURS = 16;
export const MAX_CONTINGENCY_PCT = 100;
export const MAX_CONTINGENCY_HOURS = 80;
/** $2,000 an hour: a typo's ceiling, not a guide */
export const MAX_CHARGE_OUT_CENTS = 200_000;
/** a profit target is a share of the price, so under 100: 90 is a typo's ceiling */
export const MAX_PROFIT_TARGET_PCT = 90;

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

/** Each allowance from a stored row (its column) or an edit (allowances.key). */
function allowancesOf(r: Record<string, unknown>): QuoteSettings["allowances"] {
  const edit = r.allowances && typeof r.allowances === "object" ? (r.allowances as Record<string, unknown>) : {};
  const out = { ...DEFAULT_QUOTE_SETTINGS.allowances };
  for (const k of ALLOWANCE_KEYS) {
    const n = num(r[ALLOWANCES[k].column] ?? edit[k]);
    out[k] = n == null || n < 0 ? null : Math.min(MAX_ALLOWANCE_CENTS, Math.round(n));
  }
  return out;
}

function taskHoursOf(raw: unknown): QuoteSettings["taskHours"] {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_QUOTE_SETTINGS.taskHours };
  for (const k of TASK_KEYS) {
    const n = num(o[k]);
    out[k] = n == null || n <= 0 ? null : Math.min(MAX_TASK_HOURS, Math.round(n * 100) / 100);
  }
  return out;
}

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
    allowances: allowancesOf(r),
    usualLayout: ((v: unknown) => (v === "trunks" || v === "plenum" ? v : null))(r.usual_layout ?? r.usualLayout),
    showLines: (r.show_lines ?? r.showLines) === true,
    profitTargetPct: clampTo(r.profit_target_pct ?? r.profitTargetPct, 0, MAX_PROFIT_TARGET_PCT) ?? d.profitTargetPct,
    labourCostCents: chargeOutOf(r.labour_cost_cents ?? r.labourCostCents) ?? d.labourCostCents,
    taskHours: taskHoursOf(r.task_hours ?? r.taskHours),
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
    ...Object.fromEntries(ALLOWANCE_KEYS.map((k) => [ALLOWANCES[k].column, s.allowances[k]])),
    usual_layout: s.usualLayout,
    show_lines: s.showLines,
    profit_target_pct: s.profitTargetPct,
    labour_cost_cents: s.labourCostCents,
    task_hours: s.taskHours,
    preferred,
  };
}
