import { priceBuildUp, type BuildLine, type BuildSettings, type BuildUp, type Visit } from "../buildup";
import { rollMetresOf } from "../components";

/* THE BENCH (the engine rebuild, slices 0.1–0.3) — every engine held to
   quotes a person built and stands by, part by part, not only the total
   (Isaac, 2026-10-06: live tests ran 30 to 64% under; "the bench holds Tiff
   to the chat's lines on every brief").

   A case is a real job: what was said about it, the business's settings as
   they priced it, and the lines a person built, each option on its own,
   with the total that went to the customer. An engine is anything that
   turns a case into lines. The score says which of the case's parts it
   found, which it missed, what it added that the case hasn't got, where its
   quantities differ, and how far its total is from the quoted one. Pure. */

export type CaseLine = {
  system: string;
  group: string;
  name: string;
  /** the price-book code; absent for an allowance or a line with no code */
  code?: string;
  kind: "unit" | "material" | "labour";
  qty: number;
  unit?: "" | "m" | "h";
  /** what one costs the business, cents; an hour's cost for labour */
  costCents: number;
  /** what one sells for, when the person set it; absent: at the markup */
  sellCents?: number;
  source?: "said" | "assumed" | "unknown" | "fitted" | "by_hand";
  why?: string;
};

export type BenchOption = { name: string; lines: CaseLine[]; quotedExGstCents: number | null };

export type BenchCase = {
  job: string;
  title: string;
  /** what was said about the job, as an engine would be given it */
  brief: string;
  settings: BuildSettings;
  options: BenchOption[];
  /** why the case's own total may differ from its lines, written down */
  knownGap?: string;
  /** what happened: approved, sent, accepted by the client */
  outcome?: string;
};

/** How much of a part, in metres when it's sold by length: one 20 m roll
    and 20 m by the metre are the same pipe. */
export const amountOf = (l: Pick<CaseLine, "qty" | "unit" | "name">) => (l.unit === "m" ? l.qty : l.qty * (rollMetresOf(l.name) ?? 1));

/** A part's identity: its code, else its name, folded. */
export const partKey = (l: Pick<CaseLine, "code" | "name">) => (l.code ? `code:${l.code.toUpperCase()}` : `name:${l.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`);

const known = (l: CaseLine) => !(l.source === "unknown" && l.costCents <= 0 && l.sellCents == null);

/** The case's lines as the build-up prices them: parts at cost and markup,
    labour as hours at its own rate, else the charge-out. */
export function priceCaseLines(lines: CaseLine[], s: BuildSettings): BuildUp {
  const priced = lines.filter(known);
  const parts: BuildLine[] = priced
    .filter((l) => l.kind !== "labour")
    .map((l, i) => ({
      key: `${i}`,
      group: l.group,
      name: l.name,
      code: l.code ?? null,
      supplierKey: null,
      qty: l.qty,
      unitBuyCents: l.costCents,
      unitSellCents: l.sellCents ?? null,
      kind: l.kind === "unit" ? "unit" : "material",
    }));
  const visits: Visit[] = priced
    .filter((l) => l.kind === "labour")
    .map((l) => ({ stage: "Install", people: 1, days: l.qty / s.dayHours, ...(l.sellCents != null ? { rateCents: l.sellCents } : {}) }));
  return priceBuildUp(parts, visits, s);
}

export type PartGap = { key: string; name: string; want: number; got: number };

export type Score = {
  /** the case's parts the engine found, by count of distinct parts */
  found: number;
  of: number;
  missing: string[];
  extra: string[];
  qtyOff: PartGap[];
  exGstCents: number;
  quotedExGstCents: number | null;
  /** the engine's total against the quoted one, percent; null with no quote */
  gapPct: number | null;
};

/** An engine's lines for one option held to the case's. */
export function scoreOption(want: BenchOption, got: CaseLine[], s: BuildSettings): Score {
  const sum = (ls: CaseLine[]) => {
    const m = new Map<string, { name: string; qty: number }>();
    for (const l of ls) {
      const k = partKey(l);
      const prev = m.get(k);
      m.set(k, { name: l.name, qty: (prev?.qty ?? 0) + amountOf(l) });
    }
    return m;
  };
  const w = sum(want.lines);
  const g = sum(got);
  const missing = [...w.keys()].filter((k) => !g.has(k)).map((k) => w.get(k)!.name);
  const extra = [...g.keys()].filter((k) => !w.has(k)).map((k) => g.get(k)!.name);
  const qtyOff = [...w.entries()]
    .filter(([k, v]) => g.has(k) && Math.abs(g.get(k)!.qty - v.qty) > 1e-9)
    .map(([k, v]) => ({ key: k, name: v.name, want: v.qty, got: g.get(k)!.qty }));
  const exGstCents = priceCaseLines(got, s).exGstCents;
  const q = want.quotedExGstCents;
  return {
    found: w.size - missing.length,
    of: w.size,
    missing,
    extra,
    qtyOff,
    exGstCents,
    quotedExGstCents: q,
    gapPct: q ? Math.round(((exGstCents - q) / q) * 1000) / 10 : null,
  };
}

/** An engine: a case in, each option's lines out (or null when it can't). */
export type Engine = (c: BenchCase) => CaseLine[][] | null;

export type BenchRow = { job: string; option: string; score: Score | null };

export function runBench(cases: BenchCase[], engine: Engine): BenchRow[] {
  const rows: BenchRow[] = [];
  for (const c of cases) {
    const out = engine(c);
    c.options.forEach((o, i) => rows.push({ job: c.job, option: o.name, score: out?.[i] ? scoreOption(o, out[i]!, c.settings) : null }));
  }
  return rows;
}

/** The table a person reads: one row per case option. */
export function benchReport(rows: BenchRow[]): string {
  const $ = (c: number | null) => (c == null ? "" : `$${(c / 100).toFixed(2)}`);
  return [
    "job   option                         parts    total vs quoted",
    ...rows.map((r) =>
      [
        r.job.padEnd(5),
        r.option.slice(0, 30).padEnd(30),
        r.score ? `${r.score.found}/${r.score.of}`.padEnd(8) : "no run  ",
        r.score ? `${$(r.score.exGstCents)} vs ${$(r.score.quotedExGstCents)} ${r.score.gapPct == null ? "" : `${r.score.gapPct}%`}` : "",
        r.score && r.score.missing.length ? `missing: ${r.score.missing.join(", ")}` : "",
      ].join(" ")
    ),
  ].join("\n");
}
