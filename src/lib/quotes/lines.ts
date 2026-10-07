/* A QUOTE'S LINES, KEPT — the engine rebuild's own record of what a quote
   holds (slice 2.1; docs/migrations/quote_lines.sql).

   Each line is one row: where it sits (option, system, group), what it is
   (a book item, or an allowance with no code), how many, what one costs the
   business and, when a person set it, what one sells for. Where it came
   from rides along: what the brief said, what was assumed, what isn't known
   yet, what was made to fit, or what a person typed.

   A line changes one at a time, against the version it was read at, so two
   people editing two lines never clash and a change made to an old copy is
   refused rather than lost. Every change is kept (quote_line_changes) with
   its before and after, so any change can be undone.

   Pure: the gate every edit and every stored row passes through. */

export type LineKind = "unit" | "material" | "labour";
export type LineUnit = "" | "m" | "h";
export type LineSource = "said" | "assumed" | "unknown" | "fitted" | "by_hand";
export type Engine = "old" | "lines";

export const LINE_KINDS: readonly LineKind[] = ["unit", "material", "labour"];
export const LINE_UNITS: readonly LineUnit[] = ["", "m", "h"];
export const LINE_SOURCES: readonly LineSource[] = ["said", "assumed", "unknown", "fitted", "by_hand"];

/** What a person or Tiff can set on a line. */
export type LineFields = {
  optionIndex: number;
  system: string;
  group: string;
  position: number;
  name: string;
  code: string | null;
  supplierKey: string | null;
  kind: LineKind;
  qty: number;
  unit: LineUnit;
  /** what one costs the business, cents (a tenth of a cent kept: cable by the metre) */
  costCents: number;
  /** what one sells for, cents; null: cost at the business's markup */
  sellCents: number | null;
  source: LineSource;
  why: string;
  duct: boolean;
};

export type QuoteLine = LineFields & {
  id: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
};

export const MAX_OPTIONS = 20;
export const MAX_NAME = 200;
export const MAX_WHY = 400;
export const MAX_SYSTEM = 60;
/** 100,000 of anything, or $1m each: a typo's ceiling, not a guide */
export const MAX_QTY = 100_000;
export const MAX_EACH_CENTS = 100_000_000;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
/** a tenth of a cent, never more */
const tenth = (n: number) => Math.round(n * 10) / 10;
const oneOf = <T extends string>(v: unknown, all: readonly T[], fallback: T): T => (all.includes(v as T) ? (v as T) : fallback);

/** A line as a person or Tiff gave it, made safe; null when it can't be a
    line (no name, no group). Accepts the stored row's names too. */
export function normaliseLine(raw: unknown): LineFields | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const name = text(r.name, MAX_NAME);
  const group = text(r.group ?? r.grp, MAX_SYSTEM);
  if (!name || !group) return null;
  const opt = num(r.optionIndex ?? r.option_index) ?? 0;
  const qty = num(r.qty);
  const cost = num(r.costCents ?? r.cost_cents);
  const sell = num(r.sellCents ?? r.sell_cents);
  const code = text(r.code, 80) || null;
  const supplier = text(r.supplierKey ?? r.supplier_key, 40) || null;
  return {
    optionIndex: Math.min(MAX_OPTIONS - 1, Math.max(0, Math.round(opt))),
    system: text(r.system, MAX_SYSTEM),
    group,
    position: Math.max(0, Math.round(num(r.position) ?? 0)),
    name,
    code,
    supplierKey: code ? supplier : null,
    kind: oneOf(r.kind, LINE_KINDS, "material"),
    qty: qty == null ? 0 : Math.min(MAX_QTY, Math.max(0, Math.round(qty * 1000) / 1000)),
    unit: oneOf(r.unit, LINE_UNITS, ""),
    costCents: cost == null ? 0 : Math.min(MAX_EACH_CENTS, Math.max(0, tenth(cost))),
    sellCents: sell == null ? null : Math.min(MAX_EACH_CENTS, Math.max(0, tenth(sell))),
    source: oneOf(r.source, LINE_SOURCES, "by_hand"),
    why: text(r.why, MAX_WHY),
    duct: (r.duct ?? false) === true,
  };
}

/** A stored row back as a line; null when the row isn't one. */
export function lineFromRow(row: unknown): QuoteLine | null {
  const r = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const f = normaliseLine(r);
  if (!f || typeof r.id !== "string") return null;
  return {
    ...f,
    id: r.id,
    version: Math.max(1, Math.round(num(r.version) ?? 1)),
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : "",
    updatedBy: typeof r.updated_by === "string" ? r.updated_by : "",
  };
}

/** The row as the table stores it. */
export function lineRow(f: LineFields) {
  return {
    option_index: f.optionIndex,
    system: f.system,
    grp: f.group,
    position: f.position,
    name: f.name,
    code: f.code,
    supplier_key: f.supplierKey,
    kind: f.kind,
    qty: f.qty,
    unit: f.unit,
    cost_cents: f.costCents,
    sell_cents: f.sellCents,
    source: f.source,
    why: f.why,
    duct: f.duct,
  };
}

/** A change to a line: only the fields it names, each made safe against the
    line as it stands. Returns the line as it would be, and what changed. */
export function applyPatch(line: LineFields, patch: unknown): { next: LineFields; changed: (keyof LineFields)[] } | null {
  const p = patch && typeof patch === "object" ? (patch as Record<string, unknown>) : {};
  const merged = normaliseLine({ ...line, ...p });
  if (!merged) return null;
  /* a person setting the sell back to blank means "at the markup" */
  if ("sellCents" in p && (p.sellCents === null || p.sellCents === "")) merged.sellCents = null;
  const changed = (Object.keys(merged) as (keyof LineFields)[]).filter((k) => merged[k] !== line[k]);
  /* a line a person changed is theirs: it says so, unless the change itself
     says where it came from */
  if (changed.length > 0 && !("source" in p) && changed.some((k) => k === "qty" || k === "costCents" || k === "sellCents" || k === "code")) {
    merged.source = "by_hand";
    if (line.source !== "by_hand") changed.push("source");
  }
  return { next: merged, changed };
}

/** The fields a change touched, before and after, for the line's history. */
export function diffOf(before: LineFields, after: LineFields): { before: Partial<LineFields>; after: Partial<LineFields> } {
  const b: Partial<LineFields> = {};
  const a: Partial<LineFields> = {};
  for (const k of Object.keys(after) as (keyof LineFields)[]) {
    if (before[k] !== after[k]) {
      (b as Record<string, unknown>)[k] = before[k];
      (a as Record<string, unknown>)[k] = after[k];
    }
  }
  return { before: b, after: a };
}

/** The order lines read in: option, then position, then when made. */
export function sortLines<T extends Pick<LineFields, "optionIndex" | "position">>(lines: T[]): T[] {
  return [...lines].sort((x, y) => x.optionIndex - y.optionIndex || x.position - y.position);
}

export const engineOf = (v: unknown): Engine => (v === "lines" ? "lines" : "old");

/** How a line on another option stands against option 1: the same part at
    the same qty, the same part at another qty, or a part option 1 hasn't
    got (by code, else by name). Option 1's own lines are themselves. */
export type AgainstFirst = "same" | "changed" | "added";
export function againstFirst<T extends Pick<LineFields, "optionIndex" | "code" | "name" | "qty">>(line: T, all: readonly T[]): AgainstFirst {
  if (line.optionIndex === 0) return "same";
  const key = (l: Pick<LineFields, "code" | "name">) => (l.code ? `c:${l.code.toUpperCase()}` : `n:${l.name.toLowerCase()}`);
  const first = all.filter((l) => l.optionIndex === 0 && key(l) === key(line));
  if (first.length === 0) return "added";
  return first.some((l) => l.qty === line.qty) ? "same" : "changed";
}

/** What option 1 has that this option hasn't: taken off, for the option to say. */
export function missingFromFirst<T extends Pick<LineFields, "optionIndex" | "code" | "name">>(option: number, all: readonly T[]): T[] {
  if (option === 0) return [];
  const key = (l: Pick<LineFields, "code" | "name">) => (l.code ? `c:${l.code.toUpperCase()}` : `n:${l.name.toLowerCase()}`);
  const mine = new Set(all.filter((l) => l.optionIndex === option).map(key));
  return all.filter((l) => l.optionIndex === 0 && !mine.has(key(l)));
}
