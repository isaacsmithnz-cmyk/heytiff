import { plusDays } from "./dates";
import type { AllJobRow } from "./all-jobs";

/* THE QUOTES TAB AS A WORKLIST — every open quote in the one group that says
   what to do with it next (Isaac, 2026-09-30: "the quote page needs a fairly
   big overhaul"; the mock he approved that day).

   - To price: nothing priced on it in ServiceM8 yet. Next: start the quote.
   - Waiting on an answer: priced, under 60 days. A follow-up at 7 days and
     another at 21.
   - Going cold: priced, 60 to 180 days without an answer. Chase it or close it.
   - Over 6 months: open in ServiceM8 for longer than that, priced or not.
     Folded: 210 of 341 live, and read in one go when they are read at all.

   Age runs from the day it was quoted, or the day the job was raised when
   ServiceM8 has no quote date. "Priced" is read off the job's lines, not its
   total, so it means the same with or without the money grant. Pure. */

export type QuoteSummary = {
  /** active lines on the job, not counting part invoices */
  lines: number;
  /** any line with a price on it */
  priced: boolean;
  /** what was quoted, in a few words, from the lines that name a system */
  headline: string | null;
};

export type QuoteLine = { name: string | null; quantity: number | null; price: number | null };

/* Lines that are bookkeeping, not what was quoted. */
const NOT_SCOPE = /partial invoice|deposit|progress payment|credit card|discount|surcharge/i;
/* Lines that name a system. */
const SYSTEM =
  /\d+(\.\d+)?\s*kw|ducted|split|multi|cassette|bulkhead|console|vrf|vrv|pumy|\bhws\b|high wall|changeover|ventilation|exhaust/i;
/* The opening a typed line wears in front of its scope. */
const PREAMBLE = /^(as per quote|option\.?\s*\d+|materials?|supply and install(ation of)?|supply & install)\s*[-:–.]*\s*/i;

const BRANDS: [RegExp, string][] = [
  [/\bmitsubishi\s+elec(tric|\.)?\s*/i, "Mitsubishi "],
  [/\bmits(y|i)?\s+elec\.?\s*/i, "Mitsubishi "],
  [/\bme\s+(?=\d|ducted|bulkhead|pumy)/i, "Mitsubishi "],
  [/\bdaikin\b/i, "Daikin"],
  [/\bfujitsu\b/i, "Fujitsu"],
  [/\bactron(air)?\b/i, "Actron"],
  [/\bsamsung\b/i, "Samsung"],
  [/\bhaier\b/i, "Haier"],
];

/** A line's name as a person would say it: "MITSUBISHI ELEC. DUCTED 12.5KW"
    reads "Mitsubishi ducted 12.5 kW". */
export function cleanLineName(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim().replace(PREAMBLE, "");
  const brand = BRANDS.find(([re]) => re.test(s));
  if (brand) s = s.replace(brand[0], "");
  s = s
    .toLowerCase()
    .replace(/(\d+(?:\.\d+)?)\s*kw\b/g, "$1 kW")
    .replace(/\b2\s*pce\b/g, "2-piece")
    .replace(/\b3\s*ph\b/g, "3-phase")
    .replace(/\b1\s*ph\b/g, "1-phase")
    .replace(/\b(mitsubishi|daikin|fujitsu|actron|samsung|haier|temperzone)\b/g, (b) => b.charAt(0).toUpperCase() + b.slice(1))
    .replace(/\bhws\b/g, "high wall split")
    .replace(/\bvrv\b/g, "VRV")
    .replace(/\bvrf\b/g, "VRF")
    .replace(/\bpumy\b/g, "PUMY")
    .replace(/\s*\((indoor and outdoor|in|indoor)[^)]*\)?/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const out = (brand ? `${brand[1].trim()} ${s}` : s).trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** What a quote's lines say was quoted. The system lines, biggest first, two
    at most; a third and more are counted, not listed. */
export function summariseQuoteLines(lines: readonly QuoteLine[]): QuoteSummary {
  const scope = lines.filter((l) => l.name && !NOT_SCOPE.test(l.name));
  const priced = scope.some((l) => (l.price ?? 0) > 0 && (l.quantity ?? 0) > 0);
  const systems = scope
    .filter((l) => SYSTEM.test(l.name!) && (l.price ?? 0) * Math.max(1, l.quantity ?? 1) >= 400)
    .sort((a, b) => (b.price ?? 0) * (b.quantity ?? 1) - (a.price ?? 0) * (a.quantity ?? 1));
  const names: string[] = [];
  for (const l of systems) {
    const n = cleanLineName(l.name!);
    if (n && !names.some((m) => m.toLowerCase() === n.toLowerCase())) names.push(n);
  }
  let headline: string | null = null;
  if (names.length === 1) headline = names[0]!;
  else if (names.length === 2) headline = joinTwo(names[0]!, names[1]!);
  else if (names.length > 2) headline = `${names[0]} and ${names.length - 1} more systems`;
  return { lines: scope.length, priced, headline };
}

/* Two systems of one kind say the kind once: "Mitsubishi high wall split
   2.5 kW and 4.8 kW", not the whole name twice. */
function joinTwo(a: string, b: string): string {
  const aw = a.split(" ");
  const bw = b.split(" ");
  let i = 0;
  while (i < aw.length - 1 && i < bw.length - 1 && aw[i]!.toLowerCase() === bw[i]!.toLowerCase()) i++;
  if (i >= 2) return `${a} and ${bw.slice(i).join(" ")}`;
  return `${a} and ${/^[A-Z][a-z]+\b/.test(b) && BRAND_WORD.test(b) ? b : b.charAt(0).toLowerCase() + b.slice(1)}`;
}
const BRAND_WORD = /^(Mitsubishi|Daikin|Fujitsu|Actron|Samsung|Haier|Temperzone)\b/;

/* What a job's own description says, cut to a line: the forward and the
   greeting off the front, the first sentence, 90 characters at a word. The
   enquiry in full is one press away on the job. */
const BRIEF_PREAMBLE = [
  /^(fw|fwd|re)\s*:\s*/i,
  /^mitsubishi electric australia\s*-\s*lead accepted:\s*[a-z]+(\s+[a-z]+)?\s*/i,
  /^(supply and install(ation of)?|supply & install)\s*[:\-–]*\s*/i,
  /^(hi|hello|hey|good (morning|afternoon))\b[^,.]*[,.]\s*/i,
  /^(hope you(\'|’)re well|thanks for[^.!]*)[.,!]?\s*/i,
];
/* a phone number or an email in a brief is a contact, not what was quoted */
const CONTACT = /(\+?61\s?|0)4\d{2}\s?\d{3}\s?\d{3}|\(?0[2-9]\)?\s?\d{4}\s?\d{4}|[\w.+-]+@[\w-]+\.[\w.]+/g;
export function cleanBrief(text: string | null): string | null {
  if (!text) return null;
  let s = text.replace(CONTACT, "").replace(/\s+/g, " ").replace(/\s+([.,])/g, "$1").trim();
  for (let pass = 0; pass < 3; pass++) for (const re of BRIEF_PREAMBLE) s = s.replace(re, "");
  s = s.replace(/^[\s*•:\-–|]+/, "");
  const stop = s.search(/(?<=[a-z0-9)])\.\s|\s[*•]\s|\s\|\s|\s-\s(?=[A-Z])/);
  if (stop > 12) s = s.slice(0, stop);
  if (s.length > 90) s = `${s.slice(0, 90).replace(/\s+\S*$/, "")}…`;
  s = s.trim().replace(/[\s,]+(and|or|&)$/i, "").replace(/[,(]$/, "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
}

export type QuoteGroupKey = "price" | "wait" | "cold" | "stale";

export const QUOTE_GROUPS: { key: QuoteGroupKey; title: string }[] = [
  { key: "price", title: "To price" },
  { key: "wait", title: "Waiting on an answer" },
  { key: "cold", title: "Going cold" },
  { key: "stale", title: "Over 6 months" },
];

export const FOLLOW_UP_DAYS = [7, 21] as const;
const COLD_AFTER = 60;
const STALE_AFTER = 180;

/** What to do next, as a word in a state's colour: "info" is work to start,
    "warn" is something due, "" is a date still to come (`on`, the day). */
export type QuoteNext = { word: string; tone: "" | "info" | "warn"; on?: string };

export type QuoteItem = {
  row: AllJobRow;
  /** days since it was quoted */
  age: number;
  group: QuoteGroupKey;
  next: QuoteNext;
  /** what was quoted, or the job's own description */
  what: string | null;
};

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function nextFor(group: QuoteGroupKey, age: number, quoted: string): QuoteNext {
  if (group === "price") return { word: "Start quote", tone: "info" };
  if (group === "wait") {
    if (age < FOLLOW_UP_DAYS[0]) return { word: "Follow up", tone: "", on: plusDays(quoted, FOLLOW_UP_DAYS[0]) };
    if (age < FOLLOW_UP_DAYS[1]) return { word: "Follow up", tone: "warn" };
    return { word: "Follow up again", tone: "warn" };
  }
  if (group === "cold") return { word: "Chase or close", tone: "warn" };
  return { word: "Chase or close", tone: "" };
}

export type QuoteWorklist = {
  groups: Record<QuoteGroupKey, QuoteItem[]>;
  total: number;
  stale: { count: number; oldest: string | null; neverPriced: number };
};

export function quoteWorklist(rows: readonly AllJobRow[], today: string): QuoteWorklist {
  const groups: Record<QuoteGroupKey, QuoteItem[]> = { price: [], wait: [], cold: [], stale: [] };
  let oldest: string | null = null;
  for (const row of rows) {
    const quoted = row.date ? row.date.slice(0, 10) : today;
    const age = Math.max(0, daysBetween(quoted, today));
    const priced = row.quote?.priced ?? (row.money?.valueCents ?? 0) > 0;
    const group: QuoteGroupKey = age > STALE_AFTER ? "stale" : !priced ? "price" : age > COLD_AFTER ? "cold" : "wait";
    if (group === "stale" && (oldest === null || quoted < oldest)) oldest = quoted;
    groups[group].push({ row, age, group, next: nextFor(group, age, quoted), what: row.quote?.headline ?? cleanBrief(row.title) });
  }
  /* newest first in every group: the freshest lead is the one to act on */
  for (const k of Object.keys(groups) as QuoteGroupKey[]) groups[k].sort((a, b) => a.age - b.age);
  return {
    groups,
    total: rows.length,
    stale: { count: groups.stale.length, oldest, neverPriced: groups.stale.filter((i) => !(i.row.quote?.priced ?? false)).length },
  };
}

/** "Today", "1 day", "12 days". */
export const ageWords = (age: number) => (age === 0 ? "Today" : age === 1 ? "1 day" : `${age} days`);
