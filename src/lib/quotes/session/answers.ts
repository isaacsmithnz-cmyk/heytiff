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

/** An answer given, as the thread keeps it: tapped, or `typed` in the
    person's own words and settled by her (settle). */
export type Answered = { index: number; label: string; by: string; at: string; typed?: true };

type AnyEvent = { id?: number; kind: string; author: string; at: string; body: Record<string, unknown> };

/** The questions she settled from a person's own words, as her settle
    tool's event carries them. */
export function settledIn(body: Record<string, unknown>): { question: number; answer: string }[] {
  if (body.name !== "settle" || body.ok === false) return [];
  const list = (body.detail as { settled?: unknown } | undefined)?.settled;
  return (Array.isArray(list) ? list : []).flatMap((x) => {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    return typeof o.question === "number" && typeof o.answer === "string" ? [{ question: o.question, answer: o.answer }] : [];
  });
}

/** Which of the thread's questions are answered: the first answer given to
    each, tapped or settled from the person's words, by its question's event
    id. (Isaac, 2026-10-11: "however I gave you the answers I should be able
    to do the same".) */
export function answeredOf(events: readonly AnyEvent[]): Map<number, Answered> {
  const out = new Map<number, Answered>();
  for (const e of events) {
    if (e.kind === "tool") {
      for (const s of settledIn(e.body)) if (!out.has(s.question)) out.set(s.question, { index: -1, label: s.answer, by: e.author, at: e.at, typed: true });
      continue;
    }
    const to = e.body.answered;
    if (e.kind !== "message" || typeof to !== "number" || out.has(to)) continue;
    out.set(to, { index: Number(e.body.index) || 0, label: String(e.body.text ?? ""), by: e.author, at: e.at });
  }
  return out;
}

/** Her questions still open, oldest first, with what the quote has for
    each now: what a person's own words can answer. */
export function openQuestionsOf(events: readonly (AnyEvent & { id: number })[]): { id: number; question: string; put: string }[] {
  const answered = answeredOf(events);
  return events
    .filter((e) => e.kind === "question" && !answered.has(e.id))
    .map((e) => ({ id: e.id, question: String(e.body.question ?? ""), put: typeof e.body.put === "string" ? e.body.put : "" }));
}

/** The questions she asked in her latest asking: those after the person's
    last message before her newest question. The list numbers them as her
    message did, and keeps the answered ones of it ticked. */
export function latestAsked(events: readonly (AnyEvent & { id: number })[]): number[] {
  let last = -1;
  for (let i = events.length - 1; i >= 0; i--) if (events[i]!.kind === "question") {
    last = i;
    break;
  }
  if (last < 0) return [];
  let from = 0;
  for (let i = last; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind === "message" && e.author !== "tiff" && typeof e.body.answered !== "number") {
      from = i + 1;
      break;
    }
  }
  return events.slice(from, last + 1).filter((e) => e.kind === "question").map((e) => e.id);
}
