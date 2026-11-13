import { leftOn } from "@/lib/quotes/quote-left";
import type { OptionPrice, QuotePrice } from "@/lib/quotes/quote-price-server";
import { labourOf, unitsOf } from "@/lib/quotes/quote-sum";
import type { LinesProposal } from "@/lib/quotes/lines-proposal";
import type { QuoteLine } from "@/lib/quotes/lines";
import { stillUnknown } from "@/lib/quotes/lines-price";
import { twinsOf } from "@/lib/quotes/line-twins";
import { answeredOf, settledIn } from "@/lib/quotes/session/answers";
import { buildingFirst, stepOf, turnStartOf, type Took } from "@/lib/quotes/session/time-left";
import { questionOf } from "@/lib/quotes/session/tools";
import { notPricedOf, pricedOnOf, writeUpOf } from "@/lib/quotes/write-up";

/* THE QUOTE, AS THE PHONE SHOWS IT (Isaac, 2 November 2026, "Ok build it", to the
   mock https://claude.ai/artifact/AfYQAbXLj2zaGBDKhQbkXu). The web's own view and
   price, reduced to what the screens say, so a buy price never crosses to the
   phone and the figures are the web's. Someone without money access gets no
   figure at all: the web's route has already taken them out. Pure. */

export type PhoneLine = {
  name: string;
  second: string;
  /** `second` is the model she picked, there to be read (Isaac, 3 November 2026: "That should be clear as day") */
  model: boolean;
  /** what a labour line was worked out from */
  tasks: { task: string; hours: number }[];
  cents: number | null;
  hours: number | null;
  check: boolean;
  /* to change it from the phone (Isaac, 6 November 2026, on 3054: "Need to
     be able to remove line items, swap them out etc on web and mobile"):
     which line and the version read, how many, whether nobody knows its
     price yet, whether it can be swapped for one from the book, and the same
     line on the other options. Never what it costs. */
  id: string;
  version: number;
  qty: number;
  unit: string;
  unknown: boolean;
  swap: boolean;
  twins: { id: string; version: number; option: number }[];
};
export type PhoneGroup = { name: string; cents: number | null; lines: PhoneLine[] };
export type PhoneOption = {
  /** the option's few words, "Units 2 and 12"; "" where it has only its number */
  title: string;
  exCents: number | null;
  unitsCents: number | null;
  materialsCents: number | null;
  labourCents: number | null;
  hours: number | null;
  profitCents: number | null;
  profitPct: number | null;
  /** something's still to price: every figure is so far */
  left: number;
  groups: PhoneGroup[];
  summary: string;
  areas: { name: string; items: string[] }[];
  included: string[];
  accepted: boolean;
};

export type LinesView = {
  money: boolean;
  lines: QuoteLine[];
  /** changes after it was accepted, each an option of its own */
  variations?: { option: number }[];
  accepted: number[];
  optionNames: string[];
  sent: { trial: boolean; at?: string; by?: string } | null;
  proposal: LinesProposal | null;
  approved: boolean;
};

export type Thread = { id: number; turnId: string | null; kind: string; author: string; body: Record<string, unknown>; at: string };
export type QuestionPrices = Record<number, { deltas: (number | null)[]; answered: unknown }>;

/** A name beside what someone did, and when. */
export type Mark = { by: string | null; at: string };
/** The question an answer is to, with what else could have been said. */
export type PhoneAsked = { event: number; question: string; answers: string[] };
export type PhoneTurn = { id: number; side: "me" | "them" | "tiff" | "mark" | "fault"; who: string | null; at: string; text: string; to?: PhoneAsked };
export type PhoneQuestion = { id: number; question: string; put: string; answers: { label: string; delta: number | null; can: boolean }[] };
/** What she's doing, for the phone's bar: it counts from `since`. */
export type PhoneDoing = {
  step: string | null;
  since: string | null;
  first: boolean;
  /** how long this business's turns of this kind took, seconds, sorted: the
      bar's time left is the middle of what those that ran this long still
      took (time-left.ts timeLeft); a phone before it runs on `first` */
  took?: number[];
};
export type QuoteWord = { word: string; tone: "look" | "good" | "info" };

const nameOf = (names: Record<string, string>, who: string) => names[who] ?? null;

/** Her words as plain lines: the phone doesn't draw her bold. */
const plain = (text: string) => text.replace(/\*\*(.+?)\*\*/g, "$1").trim();

/** The numbered list closing what she says, and its heading if she gave one, when it's the questions still open: the chat asks each of those itself. */
function withoutAskedList(text: string, open: number): string {
  if (open === 0) return text;
  const lines = text.split("\n");
  let from = lines.length;
  while (from > 0 && /^\s*\d+[.)]\s/.test(lines[from - 1]!)) from--;
  if (lines.length - from !== open) return text;
  if (from > 0 && lines[from - 1]!.trim().endsWith(":")) from--;
  return lines.slice(0, from).join("\n").trim();
}

const askedOf = (e: Thread): PhoneAsked | null => {
  const q = questionOf(e.body);
  return "error" in q ? null : { event: e.id, question: q.question, answers: q.answers.map((a) => a.label) };
};

/** What a message answers, and its words alone: tapped, or said with the question in front so she knows which it's to. */
function answerIn(e: Thread, asked: ReadonlyMap<number, PhoneAsked>): { to: PhoneAsked; text: string } | null {
  const text = String(e.body.text ?? "").trim();
  if (typeof e.body.answered === "number") return { to: asked.get(e.body.answered) ?? { event: e.body.answered, question: String(e.body.question ?? ""), answers: [] }, text };
  for (const a of asked.values()) if (text.startsWith(`${a.question} `)) return { to: a, text: text.slice(a.question.length).trim() };
  return null;
}

/** The conversation as it reads, in order: yours, hers, what was marked, what went wrong. A question comes in where it was answered, over its answer; one still open is the screen's to ask, last. (Isaac, 3 November 2026: "I need to make it so that the questions appear in the chat itself") */
export function phoneTurns(events: readonly Thread[], names: Record<string, string>, me: string): PhoneTurn[] {
  /* one she settled from words that didn't come with it has no answer to sit over: it follows what she said */
  const asked = new Map<number, PhoneAsked>();
  const overAnswer = new Set<number>();
  for (const e of events) {
    const a = e.kind === "question" ? askedOf(e) : null;
    if (a) asked.set(e.id, a);
    if (e.kind === "message") {
      const to = answerIn(e, asked)?.to.event;
      if (to !== undefined) overAnswer.add(to);
    }
  }
  const settled = answeredOf(events);

  const out: PhoneTurn[] = [];
  const open = new Set<number>();
  const seen = new Map<number, PhoneAsked>();
  const followed = new Set<number>();
  for (const e of events) {
    if (e.kind === "question") {
      const a = asked.get(e.id);
      if (a) {
        open.add(e.id);
        seen.set(e.id, a);
      }
    } else if (e.kind === "tool") {
      for (const s of settledIn(e.body)) open.delete(s.question);
    } else if (e.kind === "message") {
      const answer = answerIn(e, seen);
      if (typeof e.body.answered === "number") open.delete(e.body.answered);
      out.push({ id: e.id, side: e.author === me ? "me" : "them", who: nameOf(names, e.author), at: e.at, text: answer ? answer.text : String(e.body.text ?? "").trim(), ...(answer ? { to: answer.to } : {}) });
    } else if (e.kind === "reply" && e.body.working !== true) {
      out.push({ id: e.id, side: "tiff", who: null, at: e.at, text: withoutAskedList(plain(String(e.body.text ?? "")), open.size) });
      for (const id of open) {
        if (!settled.has(id) || overAnswer.has(id) || followed.has(id)) continue;
        followed.add(id);
        out.push({ id, side: "tiff", who: null, at: e.at, text: seen.get(id)!.question });
      }
    } else if (e.kind === "milestone") {
      const by = e.author === me ? "you" : (nameOf(names, e.author) ?? "someone");
      out.push({ id: e.id, side: "mark", who: null, at: e.at, text: `${String(e.body.text ?? "")} by ${by}` });
    } else if (e.kind === "error") {
      out.push({ id: e.id, side: "fault", who: null, at: e.at, text: String(e.body.message ?? "") });
    }
  }
  return out.filter((t) => t.text);
}

/** Her questions still open, each answer with what it does to the price. An answer the
    book can't make shows no price and can't be tapped, as on the web; `deltas` is empty
    where nothing could be priced at all, and those can still be answered. */
export function openQuestions(events: readonly Thread[], priced: QuestionPrices | undefined): PhoneQuestion[] {
  const out: PhoneQuestion[] = [];
  for (const e of events) {
    if (e.kind !== "question" || priced?.[e.id]?.answered) continue;
    const q = questionOf(e.body);
    if ("error" in q) continue;
    const deltas = priced?.[e.id]?.deltas ?? [];
    out.push({
      id: e.id,
      question: q.question,
      put: q.put ?? "",
      answers: q.answers.map((a, i) => ({ label: a.label, delta: deltas[i] ?? null, can: deltas.length === 0 || deltas[i] !== null })),
    });
  }
  return out;
}

export const doingOf = (events: readonly Thread[], took?: Took | null): PhoneDoing => {
  const since = turnStartOf(events);
  const first = buildingFirst(events);
  return { step: stepOf(events), since: since === null ? null : new Date(since).toISOString(), first, took: (first ? took?.first : took?.later) ?? [] };
};

/** The last time something was marked, and by whom. */
function markOf(events: readonly Thread[], test: RegExp, names: Record<string, string>): Mark | null {
  const e = events.findLast((x) => x.kind === "milestone" && test.test(String(x.body.text ?? "")));
  return e ? { by: nameOf(names, e.author), at: e.at } : null;
}

/** What to check on site, what it's priced on and what isn't in it: her latest
    write-up where she wrote one, otherwise what her lines say they assumed. */
export function scopeOf(events: readonly Thread[], lines: readonly QuoteLine[], notIncluded: readonly string[]) {
  const last = events.findLast((e) => e.kind === "tool" && e.body.name === "write_up" && e.body.ok !== false);
  const up = last ? writeUpOf((last.body.detail as { writeUp?: unknown } | undefined)?.writeUp) : null;
  const row = (r: { what: string; said: string }) => (r.what ? `${r.what}: ${r.said}` : r.said);
  const assumed = [...new Set(lines.filter((l) => l.source === "assumed" || l.source === "unknown").map((l) => (l.why ? `${l.name}: ${l.why}` : l.name)))];
  return {
    check: up ? [...up.toCheck.map(row), ...notPricedOf(up)] : assumed,
    pricedOn: up ? pricedOnOf(up).map(row) : [],
    notIncluded: [...notIncluded],
  };
}

function groupsOf(lines: readonly QuoteLine[], price: OptionPrice | null, all: readonly QuoteLine[], skip: ReadonlySet<number>, money: boolean): PhoneGroup[] {
  const names = [...new Set(lines.map((l) => l.group))];
  const sold = new Map((price?.build.groups ?? []).flatMap((g) => g.lines.map((l) => [l.key, l.sellCents] as const)));
  return names.map((name) => {
    const mine = lines.filter((l) => l.group === name);
    const labour = mine.every((l) => l.kind === "labour");
    const fromBuild = price?.build.groups.find((g) => g.name === name)?.sellCents ?? null;
    return {
      name,
      cents: labour ? (price?.build.labour.sellCents ?? null) : fromBuild,
      lines: mine.map((l) => ({
        name: l.name,
        second: l.kind === "unit" ? l.code || l.why : l.visit ? "" : l.kind === "labour" ? l.why : l.why || l.code || "",
        model: l.kind === "unit" && !!l.code,
        tasks: l.visit?.tasks.map((t) => ({ task: t.task, hours: t.hours })) ?? [],
        cents: l.kind === "labour" ? null : (sold.get(l.id) ?? null),
        hours: l.kind === "labour" ? l.qty : null,
        check: l.source === "assumed" || l.source === "unknown" || !!l.estimate,
        id: l.id,
        version: l.version,
        qty: l.qty,
        unit: l.unit,
        unknown: stillUnknown(l),
        swap: money && l.kind !== "labour",
        twins: skip.has(l.optionIndex) ? [] : twinsOf(l, all, skip).map((t) => ({ id: t.id, version: t.version, option: t.optionIndex })),
      })),
    };
  });
}

const titleOf = (name: string | undefined) => {
  const t = (name ?? "").trim();
  return /^option\s*\d+$/i.test(t) ? "" : t;
};

function optionOf(i: number, view: LinesView, price: OptionPrice | null): PhoneOption {
  const b = price?.build ?? null;
  const words = view.proposal?.options[i];
  const units = b ? unitsOf(b) : null;
  const labour = b ? labourOf(b) : null;
  return {
    title: titleOf(price?.name) || titleOf(view.optionNames[i]),
    exCents: b?.exGstCents ?? null,
    unitsCents: units,
    materialsCents: b && units !== null && labour !== null ? b.exGstCents - units - labour : null,
    labourCents: labour,
    hours: b ? b.labour.hours + (b.contingency?.hours ?? 0) : null,
    profitCents: price?.profit?.profitCents ?? null,
    profitPct: price?.profit?.pct ?? null,
    left: price ? leftOn(price).length : 0,
    groups: groupsOf(
      view.lines.filter((l) => l.optionIndex === i),
      price,
      view.lines,
      new Set((view.variations ?? []).map((v) => v.option)),
      view.money
    ),
    summary: words?.summary ?? "",
    areas: words?.areas ?? [],
    included: words?.included ?? [],
    accepted: view.accepted.includes(i),
  };
}

/** Where it's up to, in the words on the job's card. */
export function wordOf(q: { working: boolean; accepted: boolean; sent: boolean; approved: boolean; asked: number; toPrice: number; money: boolean; lines: number }): QuoteWord | null {
  /* "Building" read as a building (Isaac, 13 November 2026) */
  if (q.working) return { word: "Tiff's working on it", tone: "info" };
  if (q.accepted) return { word: "Customer accepted", tone: "good" };
  if (q.sent) return { word: "Sent", tone: "info" };
  if (q.approved) return { word: "Ready to send", tone: "good" };
  if (q.asked > 0) return { word: `${q.asked} to answer`, tone: "look" };
  if (q.lines === 0) return null;
  if (q.toPrice > 0) return { word: `${q.toPrice} to price`, tone: "look" };
  return q.money ? { word: "Priced", tone: "info" } : null;
}

/** `asked`: her questions still open. */
export function phoneQuoteOf(view: LinesView, price: QuotePrice | null, events: readonly Thread[], asked: number, working: boolean, names: Record<string, string>) {
  const priced = price && price.ok ? price.options : null;
  const count = Math.max(priced?.length ?? 0, ...view.lines.map((l) => l.optionIndex + 1), 0);
  const options = Array.from({ length: count }, (_, i) => optionOf(i, view, priced?.[i] ?? null));

  /* what's left before Mark ready to send can be pressed, as the web says it */
  const toPrice = options.reduce((n, o) => n + o.left, 0);
  const ready = view.money && !!priced && view.lines.length > 0 && toPrice === 0 && asked === 0;
  const why = [
    asked > 0 ? `${asked} ${asked === 1 ? "question" : "questions"} to answer` : "",
    price && !price.ok ? "Set Quoting to price it" : view.lines.length === 0 ? "Nothing on the quote yet" : toPrice > 0 ? `${toPrice} ${toPrice === 1 ? "line" : "lines"} to price` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const p = view.proposal;
  const sent = view.sent ? { trial: view.sent.trial, at: view.sent.at ?? null, by: nameOf(names, view.sent.by ?? "") } : null;
  const accepted = view.accepted.length > 0;
  return {
    money: view.money,
    lines: view.lines.length,
    options,
    /** the job's card */
    state: wordOf({ working, accepted, sent: !!sent, approved: view.approved, asked, toPrice, money: view.money, lines: view.lines.length }),
    scope: scopeOf(events, view.lines, p?.notIncluded ?? []),
    proposal: p && (p.title || p.intro) ? { title: p.title, intro: p.intro, notIncluded: p.notIncluded, stages: p.payment.stages } : null,
    approved: view.approved,
    marked: view.approved && p?.approvedAt ? { by: p.approvedBy ? nameOf(names, p.approvedBy) : null, at: p.approvedAt } : null,
    acceptedMark: accepted ? markOf(events, /accepted$/, names) : null,
    ready,
    why,
    sent,
  };
}

export type PhoneQuote = ReturnType<typeof phoneQuoteOf>;
