import type { BuildSettings } from "../buildup";
import type { LineUnit, QuoteLine } from "../lines";
import { priceLines } from "../lines-price";
import type { AnswerChange, NewLine, Question } from "./tools";

/* PRICED QUESTIONS (slice 6.1) — each of Tiff's questions comes with its
   answers, and each answer with the line changes it makes, so a tap changes
   the quote at once with no call to her (Isaac, 2026-10-06: "three phase
   +$519.96"). Before it's tapped, each answer shows what it does to the
   price: the quote priced as it is, and again with the answer's changes,
   from the same book and settings. An answer whose line has gone since, or
   whose item the book hasn't got, shows no price and can't be tapped. Pure. */

export type Priced = (code: string, unit: LineUnit) => { name: string; code: string; supplierKey: string; costCents: number; kind: "unit" | "material" } | null;

/** The quote's lines as they'd be with the answer's changes; null when a
    change can't be made. */
export function withChanges(lines: readonly QuoteLine[], changes: readonly AnswerChange[], price: Priced, hourCostCents: number | null): QuoteLine[] | null {
  let out = [...lines];
  for (const c of changes) {
    if (c.op === "add") {
      const l = newQuoteLine(c.line, price, hourCostCents, out.length);
      if (!l) return null;
      out = [...out, l];
      continue;
    }
    const i = out.findIndex((l) => l.id === c.lineId);
    if (i < 0) return null;
    const line = out[i]!;
    if (c.op === "remove") out = out.filter((_, j) => j !== i);
    else if (c.op === "qty") out[i] = { ...line, qty: c.qty };
    else {
      const p = price(c.code, line.unit);
      if (!p) return null;
      out[i] = { ...line, name: p.name, code: p.code, supplierKey: p.supplierKey, costCents: p.costCents, sellCents: null, source: "said" };
    }
  }
  return out;
}

function newQuoteLine(l: NewLine, price: Priced, hourCostCents: number | null, n: number): QuoteLine | null {
  const base = { id: `new-${n}`, version: 1, updatedAt: "", updatedBy: "", position: 9999, sellCents: null, duct: false, optionIndex: l.optionIndex, system: l.system, group: l.group, qty: l.qty, unit: l.unit, why: l.why };
  if (l.kind === "labour") return { ...base, name: l.name, code: null, supplierKey: null, kind: "labour", unit: "h", costCents: hourCostCents ?? 0, source: l.source };
  if (!l.code) return { ...base, name: l.name, code: null, supplierKey: null, kind: l.kind, costCents: 0, source: "unknown" };
  const p = price(l.code, l.unit);
  return p ? { ...base, name: p.name, code: p.code, supplierKey: p.supplierKey, kind: l.kind === "unit" || p.kind === "unit" ? "unit" : "material", costCents: p.costCents, source: l.source } : null;
}

const totalOf = (lines: QuoteLine[], s: BuildSettings) => priceLines(lines, [], s, { pct: null, labourCostCents: null }).reduce((n, o) => n + o.build.exGstCents, 0);

/** What each answer does to the quote's price, ex GST, cents: null for one
    that can't be made. */
export function answerDeltas(q: Question, lines: readonly QuoteLine[], price: Priced, hourCostCents: number | null, s: BuildSettings): (number | null)[] {
  const now = totalOf([...lines], s);
  return q.answers.map((a) => {
    const after = withChanges(lines, a.changes, price, hourCostCents);
    return after ? totalOf(after, s) - now : null;
  });
}

/** An answer given, as the thread keeps it. */
export type Answered = { index: number; label: string; by: string; at: string };

/** Which of the thread's questions are answered: the first answer given to
    each, by its question's event id. */
export function answeredOf(events: readonly { kind: string; author: string; at: string; body: Record<string, unknown> }[]): Map<number, Answered> {
  const out = new Map<number, Answered>();
  for (const e of events) {
    const to = e.body.answered;
    if (e.kind !== "message" || typeof to !== "number" || out.has(to)) continue;
    out.set(to, { index: Number(e.body.index) || 0, label: String(e.body.text ?? ""), by: e.author, at: e.at });
  }
  return out;
}
