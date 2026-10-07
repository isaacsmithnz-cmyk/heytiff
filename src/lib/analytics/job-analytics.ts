import { lineOf } from "@/lib/workboard/job-steps";
import { plusDays } from "@/lib/workboard/dates";
import { fmtAud } from "@/lib/workboard/project-money";
import { workKindOf, type WorkKind } from "@/lib/quotes/labour-history";
import { KINDS, kindLabel, type Decisions, type JobDecisions, type Question } from "./decisions";

export { kindLabel };

/* JOB ANALYTICS — what the business's own jobs say about its quoting
   (docs/job-analytics-plan.md; Isaac, 2026-10-07: "need an analytics page
   for jobs. Quotes, brands used, win rate, average price of job types").
   Pure: analytics-query.ts reads the ServiceM8 mirror and hands the jobs here,
   so the page and the tests read the same figures.

   WHAT COUNTS AS A QUOTE is the progress line's rule (job-steps `lineOf`): a
   job a quote was SENT for, or one still a Quote or Unsuccessful. A work
   order nobody quoted (a service call, a warranty visit, do-and-charge) is
   not a quote, so it never counts toward the win rate.

   THE 180-DAY RULE (Isaac, 2026-10-07: "jobs not converted to work order
   after 180 days can be marked as lost"). A Quote with no answer more than
   180 days after the job was raised counts as lost. Same clock as the
   Workboard's "Over 6 months" group (quote-worklist), so the two screens
   count the same quotes. It is applied when the figures are read and never
   stored: a quote that becomes a work order on day 200 counts as won from
   then on.

   WHICH QUOTES A PERIOD HOLDS is decided by the day the job was raised, the
   same day the rule counts from. Each figure is set beside the same span a
   year earlier.

   MONEY is the job's own lines, ex GST (analytics-query says why: the job
   total isn't there for most of the account). It is labelled, never
   converted.

   WHAT CAN'T BE PLACED IS ASKED (Isaac: "anything unknown or questionable
   should be manually decided"). Four questions, answered on the To decide tab
   and kept in job_analytics_decisions (decisions.ts):
   - Is it a quote? A work order no quote was sent for that reads like an
     install and comes to $3,000 ex GST or more. Until answered it is what the
     progress line says, not a quote.
   - Won or lost? ServiceM8 says Unsuccessful but the job was paid, or still a
     Quote though the client accepted HeyTiff's proposal. Until answered it is
     left out of the win rate.
   - What kind of job? A decided quote whose kind can't be read. Until
     answered it counts under "Not known".
   - Does this price belong? A won price four times its kind's median or a
     quarter of it, among five or more. Until answered it is left out of the
     prices; it still counts as won.
   And any job can be called void: not a real job. A void job is taken out
   before anything is counted, so it is in no figure at all, enquiries
   included, and is listed apart so it can be undone. */

/** A quote with no answer this long after the job was raised counts as lost. */
export const LAPSE_AFTER_DAYS = 180;

/** One ServiceM8 job, as the figures need it. Days are YYYY-MM-DD. */
export type AnalyticsJob = {
  id: string;
  /** ServiceM8's status, verbatim: Quote, Work Order, Completed, Unsuccessful */
  status: string | null;
  /** the day the job was raised (ServiceM8's job date) */
  raisedOn: string | null;
  /** the day the quote was sent, when ServiceM8 says */
  quoteSentOn: string | null;
  /** the day ServiceM8 made it a Quote */
  quotedOn?: string | null;
  /** its ServiceM8 category's name */
  category?: string | null;
  /** the day it became a work order, as ServiceM8 last set it */
  wonOn: string | null;
  /** the day its first progress claim was raised: a deposit is a yes */
  claimedOn?: string | null;
  /** the day ServiceM8 first made a quote document for it */
  quoteDocOn?: string | null;
  /** ServiceM8's own automation made it Unsuccessful 60 days after it became a Quote */
  closedUnanswered?: boolean;
  completedOn: string | null;
  /** what its lines come to, in cents ex GST; null when nothing is priced */
  valueCents: number | null;
  kind: WorkKind | null;
  /** ServiceM8 says it was paid */
  paid?: boolean;
  /** the client accepted HeyTiff's proposal for it */
  acceptedInHeyTiff?: boolean;
  /* what a To decide row shows of it */
  number?: string | null;
  suburb?: string | null;
  brief?: string | null;
  clientId?: string | null;
};

export type Outcome = "won" | "lost" | "lapsed" | "open";

const norm = (s: string | null) => (s ?? "").trim().toLowerCase();

/** Whole days from one day to another. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Whether a job was quoted: the progress line's rule (a quote was sent, or
    it is still a Quote or Unsuccessful), or ServiceM8 made it a Quote at least
    a day before it became a Work Order. The sent stamp exists only on jobs
    edited since mid-August 2026; the quote date covers the rest. On the live
    account a job a Quote a day or more before its work order is worth $5,400
    at the median, and one with no quote date $428: installs against call-outs. */
export function wasQuoted(j: AnalyticsJob): boolean {
  if (norm(j.status) === "unsuccessful") return unsuccessfulQuote(j);
  if (lineOf({ status: j.status, quoteSentOn: j.quoteSentOn }) === "quote") return true;
  return !!j.quotedOn && !!j.wonOn && j.wonOn > j.quotedOn;
}

/* WHAT UNSUCCESSFUL MEANS (Isaac, 2026-10-07: "You will have to investigate
   unsuccessful jobs"). Read against the 80 Unsuccessful jobs of the live
   account's year, it is four things:
   - a quote that went out and lost: a quote was sent or its quote document
     made (21 marked by hand, $284k);
   - a quote ServiceM8 closed itself, 60 days to the hour after it became a
     Quote, with no answer (32, $229k): still lost, and said apart;
   - a work order called off before anything was quoted: a call-out the
     tenant cancelled, a maintenance visit cut short (13): not a quote;
   - an enquiry never priced or quoted (9): not a quote.
   A job that was a Work Order and also had a quote sent or a claim invoiced
   is asked (4, $65k), and one priced at $3,000 or more with no sign of a
   quote leaving is asked whether it was a quote (1, $208k). */
const quoteWentOut = (j: AnalyticsJob) => !!j.quoteSentOn || !!j.quoteDocOn;

function unsuccessfulQuote(j: AnalyticsJob): boolean {
  return quoteWentOut(j) || !!j.claimedOn;
}

/** ServiceM8 made it Unsuccessful 60 days after it became a Quote, give or
    take two hours: its automation, not a client's no. Stamps are the
    account's wall clock, so the two are compared as they stand. */
export function closedAtSixtyDays(quoteStamp: string | null, editStamp: string | null): boolean {
  const at = (s: string | null) => (s && s.length >= 19 ? Date.parse(`${s.slice(0, 10)}T${s.slice(11, 19)}Z`) : NaN);
  const hours = (at(editStamp) - at(quoteStamp)) / 3_600_000;
  return Number.isFinite(hours) && Math.abs(hours - 60 * 24) <= 2;
}

/* THE FIRST YES (Isaac, 2026-10-07: "The proposal was updated which turned
   it back to a quote"). Updating an accepted proposal makes the job a Quote
   again, and its acceptance makes it a Work Order again, so ServiceM8's
   work-order date is the last yes, not the first: on the live account 53
   jobs had a claim invoiced before it (#2587: deposit 28 August, work order
   25 September). The first claim is the earliest sure yes, so the yes is
   whichever came first; and a Quote that already has a claim is a won job
   whose proposal is being updated, never an open or lapsed quote. */

/** The day of the first yes: the work order or the first claim, whichever came first. */
export function yesOn(j: AnalyticsJob): string | null {
  const days = [j.wonOn, j.claimedOn].filter((d): d is string => !!d).sort();
  return days[0] ?? null;
}

/** Where a quote stands today; null for a job that isn't a quote. */
export function outcomeOf(j: AnalyticsJob, today: string): Outcome | null {
  if (!wasQuoted(j)) return null;
  const s = norm(j.status);
  if (s === "work order" || s === "completed") return "won";
  if (s === "quote" && j.claimedOn) return "won";
  if (s === "unsuccessful") return "lost";
  if (s !== "quote") return null;
  if (!j.raisedOn) return "open";
  return daysBetween(j.raisedOn, today) > LAPSE_AFTER_DAYS ? "lapsed" : "open";
}

/* ── what can't be placed ── */

/** A work order this big, with no quote sent, may have been quoted outside
    ServiceM8: asked. Cents, ex GST. */
export const QUOTE_LIKELY_FROM_CENTS = 300_000;
/** A won price this many times its kind's median, or this fraction of it, is
    asked about once the kind has PRICE_SAMPLE priced wins. */
export const PRICE_OUTLIER_TIMES = 4;
export const PRICE_SAMPLE = 5;

const INSTALL: ReadonlySet<WorkKind> = new Set(["split", "multi", "ducted", "vrf"]);

/** A work order with no sign of a quote that reads like an install (by its
    kind or its category) and comes to $3,000 ex GST or more: quoted outside
    ServiceM8, or done and charged? */
function mightBeQuote(j: AnalyticsJob): boolean {
  if (wasQuoted(j)) return false;
  if (norm(j.status) === "unsuccessful") return !j.wonOn && (j.valueCents ?? 0) >= QUOTE_LIKELY_FROM_CENTS;
  const install = (j.kind !== null && INSTALL.has(j.kind)) || /install|construction/i.test(j.category ?? "");
  return install && (j.valueCents ?? 0) >= QUOTE_LIKELY_FROM_CENTS;
}

/** The kind of work, read for the figures: a service call or maintenance by
    its category first, whatever its words mention (a "Service call" about a
    ducted system is a service, not a ducted install), then the job's words
    and its lines' names together ("MITSUBISHI ELEC. HIGH WALL SPLIT 4.2KW"),
    "HWS" being the trade's high wall split. */
export function analyticsKindOf(description: string | null, lineNames: readonly string[], category: string | null): WorkKind | null {
  const cat = (category ?? "").toLowerCase();
  if (cat.includes("service")) return "service";
  if (cat.includes("maintenance")) return "maintenance";
  const words = [description ?? "", ...lineNames].join(" ");
  return workKindOf(words, category) ?? (/\bhws\b/i.test(words) ? "split" : null);
}

/* A DAY AT TAFE IS NOT A JOB (Isaac, 2026-10-07: "TAFE NSW is the booking
   to mark the apprentices day at tafe"). Until March 2026 the apprentice's
   day at TAFE went into ServiceM8 as a job card for the client TAFE NSW, one
   a week, mostly under Warranty: 162 on the live account, none quoted,
   invoiced or paid. Time off has been ServiceM8's staff leave since
   (workboard/away). A card for a client named TAFE that was never quoted,
   invoiced or paid is that booking, and is left out before any figure: it
   would count as a job raised, an enquiry and a warranty call-out. Work done
   for a TAFE campus is quoted or invoiced, and counts. */
export function isTafeDay(clientName: string | null, card: { quoted: boolean; invoiced: boolean; paid: boolean }): boolean {
  return /\btafe\b/i.test(clientName ?? "") && !card.quoted && !card.invoiced && !card.paid;
}

/** ServiceM8's status and the money or the proposal disagree: Unsuccessful
    but paid, with a claim invoiced, or once a Work Order on a quote that went
    out; or accepted in HeyTiff and still a Quote. */
function disputed(j: AnalyticsJob): boolean {
  const s = norm(j.status);
  return (
    (s === "unsuccessful" && (!!j.paid || !!j.claimedOn || (!!j.wonOn && quoteWentOut(j)))) ||
    (s === "quote" && !!j.acceptedInHeyTiff && !j.claimedOn)
  );
}

export type Placement = {
  /** where it stands with the answers given; null when it isn't counted as a quote */
  outcome: Outcome | null;
  /** its kind, answered or read */
  kind: WorkKind | null;
  /** the questions it raises, answered or not (price is decided across jobs, in placeIn) */
  raises: Question[];
};

/** One job with its answers applied. */
export function placeJob(j: AnalyticsJob, today: string, d: JobDecisions = {}): Placement {
  const kind = (d.kind as WorkKind | undefined) ?? j.kind;
  const raises: Question[] = [];
  let outcome: Outcome | null;
  if (mightBeQuote(j)) {
    raises.push("quote");
    outcome = d.quote === "quote" ? (norm(j.status) === "unsuccessful" ? "lost" : "won") : null;
  } else if (disputed(j)) {
    raises.push("outcome");
    outcome = d.outcome === "won" ? "won" : d.outcome === "lost" ? "lost" : null;
  } else {
    outcome = outcomeOf(j, today);
  }
  if (outcome !== null && outcome !== "open" && j.kind === null) raises.push("kind");
  return { outcome, kind, raises };
}

/* ── periods ── */

export type PeriodKey = "quarter" | "fy" | "12m";
export const PERIODS: readonly { key: PeriodKey; label: string }[] = [
  { key: "quarter", label: "Quarter" },
  { key: "fy", label: "Financial year" },
  { key: "12m", label: "12 months" },
];
export const DEFAULT_PERIOD: PeriodKey = "12m";

export function isPeriodKey(v: unknown): v is PeriodKey {
  return v === "quarter" || v === "fy" || v === "12m";
}

export type Span = { from: string; to: string };

/** The same calendar day a year earlier; 29 February becomes the 28th. */
export function yearEarlier(day: string): string {
  const y = Number(day.slice(0, 4)) - 1;
  const md = day.slice(5) === "02-29" ? "02-28" : day.slice(5);
  return `${y}-${md}`;
}

/** The days a period covers, ending today. A quarter is the calendar
    quarter so far; the financial year starts on 1 July. */
export function periodSpan(key: PeriodKey, today: string): Span {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  if (key === "12m") return { from: plusDays(yearEarlier(today), 1), to: today };
  if (key === "fy") return { from: m >= 7 ? `${y}-07-01` : `${y - 1}-07-01`, to: today };
  const q = Math.floor((m - 1) / 3) * 3 + 1;
  return { from: `${y}-${String(q).padStart(2, "0")}-01`, to: today };
}

export const spanBefore = (s: Span): Span => ({ from: yearEarlier(s.from), to: yearEarlier(s.to) });

const inSpan = (day: string | null, s: Span) => !!day && day >= s.from && day <= s.to;

/* ── small sums ── */

export type Rate = { won: number; decided: number; rate: number | null };

const rateOf = (won: number, decided: number): Rate => ({ won, decided, rate: decided ? won / decided : null });

function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

export const median = (xs: readonly number[]) => quantile([...xs].sort((a, b) => a - b), 0.5);

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/* ── the figures ── */

type Placed = {
  job: AnalyticsJob;
  outcome: Outcome;
  kind: WorkKind | null;
  /** its price counts toward the prices */
  priced: boolean;
};

/** A question about one job, for the To decide tab: its answer if one was
    given. A price question carries what the price was set against. */
export type Ask = {
  question: Question;
  job: AnalyticsJob;
  answer: string | null;
  /** the job's kind, answered or read */
  kind: WorkKind | null;
  /** price: its kind's median, and how many times it the price is */
  median?: number;
  times?: number;
};

const NO_DECISIONS: Decisions = new Map();

/** The quotes on jobs raised in the span, the answers applied, and every
    question they raise. */
function placeIn(jobs: readonly AnalyticsJob[], span: Span, today: string, decisions: Decisions): { placed: Placed[]; asks: Ask[] } {
  const placed: Placed[] = [];
  const asks: Ask[] = [];
  for (const job of jobs) {
    if (!inSpan(job.raisedOn, span)) continue;
    const d = decisions.get(job.id) ?? {};
    const p = placeJob(job, today, d);
    for (const q of p.raises) asks.push({ question: q, job, answer: d[q] ?? null, kind: p.kind });
    if (p.outcome) placed.push({ job, outcome: p.outcome, kind: p.kind, priced: job.valueCents !== null });
  }

  /* A price far from its kind's is asked about, and left out of the prices
     until it is counted. The median is every won price of the kind, the odd
     one included: one stray can't move a middle of five. */
  const byKind = new Map<WorkKind, number[]>();
  for (const p of placed) if (p.outcome === "won" && p.kind && p.job.valueCents !== null) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p.job.valueCents]);
  const medians = new Map([...byKind].filter(([, xs]) => xs.length >= PRICE_SAMPLE).map(([k, xs]) => [k, median(xs)!]));
  for (const p of placed) {
    if (p.outcome !== "won" || !p.kind || p.job.valueCents === null || !medians.has(p.kind)) continue;
    const mid = medians.get(p.kind)!;
    const times = p.job.valueCents / mid;
    if (times <= PRICE_OUTLIER_TIMES && times >= 1 / PRICE_OUTLIER_TIMES) continue;
    const answer = decisions.get(p.job.id)?.price ?? null;
    p.priced = answer === "count";
    asks.push({ question: "price", job: p.job, answer, kind: p.kind, median: mid, times });
  }
  return { placed, asks };
}

const decided = (p: Placed) => p.outcome !== "open";
const valueOf = (p: Placed) => p.job.valueCents ?? 0;

export type TopLine = {
  /** won of decided quotes, by count */
  winRate: Rate;
  winRateBefore: Rate;
  /** won of decided, by value */
  valueRate: number | null;
  quotedCents: number;
  quotedBefore: number;
  wonCents: number;
  wonBefore: number;
  /** jobs of any kind completed in the span */
  completedCents: number;
  completedBefore: number;
  medianWonCents: number | null;
  medianWonBefore: number | null;
  averageWonCents: number | null;
  /** median days from the job being raised to the quote going out */
  speedDays: number | null;
  speedBefore: number | null;
  quotes: number;
  open: number;
};

function speedOf(ps: readonly Placed[]): number | null {
  const days = ps
    .filter((p) => p.job.quoteSentOn && p.job.raisedOn)
    .map((p) => Math.max(0, daysBetween(p.job.raisedOn!, p.job.quoteSentOn!)));
  return median(days);
}

function topLine(jobs: readonly AnalyticsJob[], now: Placed[], before: Placed[], span: Span, prev: Span): TopLine {
  const won = now.filter((p) => p.outcome === "won");
  const wonPrev = before.filter((p) => p.outcome === "won");
  const dec = now.filter(decided);
  const wonValues = won.filter((p) => p.priced).map((p) => p.job.valueCents!);
  const completed = (s: Span) =>
    sum(jobs.filter((j) => norm(j.status) === "completed" && inSpan(j.completedOn, s)).map((j) => j.valueCents ?? 0));
  const decidedCents = sum(dec.map(valueOf));
  return {
    winRate: rateOf(won.length, dec.length),
    winRateBefore: rateOf(wonPrev.length, before.filter(decided).length),
    valueRate: decidedCents ? sum(won.map(valueOf)) / decidedCents : null,
    quotedCents: sum(now.map(valueOf)),
    quotedBefore: sum(before.map(valueOf)),
    wonCents: sum(won.map(valueOf)),
    wonBefore: sum(wonPrev.map(valueOf)),
    completedCents: completed(span),
    completedBefore: completed(prev),
    medianWonCents: median(wonValues),
    medianWonBefore: median(wonPrev.filter((p) => p.priced).map((p) => p.job.valueCents!)),
    averageWonCents: wonValues.length ? sum(wonValues) / wonValues.length : null,
    speedDays: speedOf(now),
    speedBefore: speedOf(before),
    quotes: now.length,
    open: now.filter((p) => p.outcome === "open").length,
  };
}

/* ── win rate, broken down ── */

export type Bar = Rate & { key: string; label: string };

function bars(
  ps: readonly Placed[],
  keys: readonly { key: string; label: string }[],
  keyOf: (p: Placed) => string | null,
): Bar[] {
  const tally = new Map<string, { won: number; decided: number }>();
  for (const p of ps) {
    if (!decided(p)) continue;
    const k = keyOf(p);
    if (k === null) continue;
    const t = tally.get(k) ?? { won: 0, decided: 0 };
    t.decided++;
    if (p.outcome === "won") t.won++;
    tally.set(k, t);
  }
  return keys
    .filter((k) => tally.has(k.key))
    .map((k) => ({ key: k.key, label: k.label, ...rateOf(tally.get(k.key)!.won, tally.get(k.key)!.decided) }));
}

const KIND_KEYS = [...KINDS.map((k) => ({ key: k as string, label: kindLabel(k) })), { key: "unknown", label: kindLabel(null) }];

export const PRICE_BANDS = [
  { key: "lt5", label: "Under $5k", below: 500_000 },
  { key: "lt10", label: "$5k to $10k", below: 1_000_000 },
  { key: "lt20", label: "$10k to $20k", below: 2_000_000 },
  { key: "rest", label: "$20k and over", below: Infinity },
] as const;

function bandOf(cents: number | null): string | null {
  if (cents === null) return null;
  return PRICE_BANDS.find((b) => cents < b.below)!.key;
}

export const SPEED_BUCKETS = [
  { key: "d1", label: "Same or next day", upTo: 1 },
  { key: "d3", label: "2 to 3 days", upTo: 3 },
  { key: "d7", label: "4 to 7 days", upTo: 7 },
  { key: "slow", label: "Over a week", upTo: Infinity },
] as const;

function speedBucketOf(p: Placed): string | null {
  if (!p.job.quoteSentOn || !p.job.raisedOn) return null;
  const d = Math.max(0, daysBetween(p.job.raisedOn, p.job.quoteSentOn));
  return SPEED_BUCKETS.find((b) => d <= b.upTo)!.key;
}

/* ── the Quotes tab ── */

export const YES_BINS = [
  { label: "0–7", upTo: 7 },
  { label: "8–14", upTo: 14 },
  { label: "15–30", upTo: 30 },
  { label: "31–60", upTo: 60 },
  { label: "61–90", upTo: 90 },
  { label: "91–180", upTo: LAPSE_AFTER_DAYS },
  { label: "Over 180", upTo: Infinity },
] as const;

/** A lost quote, for the review that voids the ones that weren't real jobs. */
/** Why a lost quote is lost: marked Unsuccessful by hand, closed by
    ServiceM8 at 60 days with no answer, or past the 180 days as a Quote. */
export type LostWhy = "marked" | "closed" | "lapsed";
export type LostJob = { job: AnalyticsJob; why: LostWhy };

export type QuotesFigures = {
  /** won quotes by days from the job being raised to its work order */
  daysToYes: { label: string; count: number; late: boolean }[];
  /** wins that came after the 180 days, which count as won */
  lateWins: number;
  winsDated: number;
  /** marked Unsuccessful by hand */
  unsuccessful: { count: number; cents: number };
  /** made Unsuccessful by ServiceM8 at 60 days, with no answer */
  closed: { count: number; cents: number };
  lapsed: { count: number; cents: number };
  /** every lost quote in the span, newest first, to review */
  lostJobs: LostJob[];
  /** open quotes today, whatever the period: the board's groups */
  openNow: {
    toPrice: number;
    waiting: { count: number; cents: number };
    cold: { count: number; cents: number };
    /** reach the 180 days within the next 30 */
    lapsingSoon: { count: number; cents: number };
  };
};

const COLD_AFTER = 60;
const SOON = 30;

function lostWhy(p: Placed): LostWhy | null {
  if (p.outcome === "lapsed") return "lapsed";
  if (p.outcome !== "lost") return null;
  return p.job.closedUnanswered && norm(p.job.status) === "unsuccessful" ? "closed" : "marked";
}

function quotesFigures(jobs: readonly AnalyticsJob[], now: Placed[], today: string, decisions: Decisions): QuotesFigures {
  const counts = YES_BINS.map(() => 0);
  let winsDated = 0;
  for (const p of now) {
    const yes = yesOn(p.job);
    if (p.outcome !== "won" || !yes || !p.job.raisedOn) continue;
    const d = Math.max(0, daysBetween(p.job.raisedOn, yes));
    counts[YES_BINS.findIndex((b) => d <= b.upTo)]!++;
    winsDated++;
  }
  const pack = (ps: Placed[]) => ({ count: ps.length, cents: sum(ps.map(valueOf)) });

  const open = { toPrice: 0, waiting: { count: 0, cents: 0 }, cold: { count: 0, cents: 0 }, lapsingSoon: { count: 0, cents: 0 } };
  for (const job of jobs) {
    if (placeJob(job, today, decisions.get(job.id)).outcome !== "open" || !job.raisedOn) continue;
    const age = Math.max(0, daysBetween(job.raisedOn, today));
    const cents = job.valueCents ?? 0;
    if (age > LAPSE_AFTER_DAYS - SOON) {
      open.lapsingSoon.count++;
      open.lapsingSoon.cents += cents;
    }
    if (job.valueCents === null) open.toPrice++;
    else if (age > COLD_AFTER) {
      open.cold.count++;
      open.cold.cents += cents;
    } else {
      open.waiting.count++;
      open.waiting.cents += cents;
    }
  }
  return {
    daysToYes: YES_BINS.map((b, i) => ({ label: b.label, count: counts[i]!, late: b.upTo === Infinity })),
    lateWins: counts[counts.length - 1]!,
    winsDated,
    unsuccessful: pack(now.filter((p) => lostWhy(p) === "marked")),
    closed: pack(now.filter((p) => lostWhy(p) === "closed")),
    lapsed: pack(now.filter((p) => p.outcome === "lapsed")),
    lostJobs: now
      .filter((p) => p.outcome === "lost" || p.outcome === "lapsed")
      .sort((a, b) => (b.job.raisedOn ?? "").localeCompare(a.job.raisedOn ?? ""))
      .map((p) => ({ job: p.job, why: lostWhy(p)! })),
    openNow: open,
  };
}

/* ── price by job type ── */

export type PriceRow = {
  key: string;
  label: string;
  jobs: number;
  median: number;
  average: number;
  /** the middle half of won prices */
  p25: number;
  p75: number;
  /** the spread, cheapest 5% to dearest 5% off */
  p5: number;
  p95: number;
};

function priceRows(now: Placed[]): PriceRow[] {
  const by = new Map<string, number[]>();
  for (const p of now) {
    if (p.outcome !== "won" || !p.priced) continue;
    const k = p.kind ?? "unknown";
    by.set(k, [...(by.get(k) ?? []), p.job.valueCents!]);
  }
  return KIND_KEYS.filter((k) => by.has(k.key)).map((k) => {
    const xs = by.get(k.key)!.sort((a, b) => a - b);
    return {
      key: k.key,
      label: k.label,
      jobs: xs.length,
      median: quantile(xs, 0.5)!,
      average: sum(xs) / xs.length,
      p25: quantile(xs, 0.25)!,
      p75: quantile(xs, 0.75)!,
      p5: quantile(xs, 0.05)!,
      p95: quantile(xs, 0.95)!,
    };
  });
}

/* ── enquiries through the period ── */

export type Week = { start: string; now: number; before: number };

/* Whole weeks, counted back from the period's last day, so the line never
   ends on a week of one day that reads as a collapse. A few days left over at
   the start fall outside the chart, and the totals still count them. */
function weeksOf(jobs: readonly AnalyticsJob[], span: Span, prev: Span): { weeks: Week[]; total: number; totalBefore: number } {
  const n = Math.max(1, Math.floor((daysBetween(span.from, span.to) + 1) / 7));
  const first = plusDays(span.to, -7 * n + 1);
  const firstBefore = plusDays(prev.to, -7 * n + 1);
  const weeks: Week[] = Array.from({ length: n }, (_, i) => ({ start: plusDays(first, i * 7), now: 0, before: 0 }));
  let total = 0;
  let totalBefore = 0;
  for (const j of jobs) {
    if (!j.raisedOn) continue;
    if (inSpan(j.raisedOn, span)) {
      total++;
      const i = Math.floor(daysBetween(first, j.raisedOn) / 7);
      if (i >= 0) weeks[i]!.now++;
    } else if (inSpan(j.raisedOn, prev)) {
      totalBefore++;
      const i = Math.floor(daysBetween(firstBefore, j.raisedOn) / 7);
      if (i >= 0 && i < n) weeks[i]!.before++;
    }
  }
  return { weeks, total, totalBefore };
}

/* ── the whole page ── */

export type JobAnalytics = {
  period: PeriodKey;
  span: Span;
  before: Span;
  top: TopLine;
  byKind: Bar[];
  byPrice: Bar[];
  bySpeed: Bar[];
  quotes: QuotesFigures;
  prices: PriceRow[];
  enquiries: { weeks: Week[]; total: number; totalBefore: number };
  toDecide: ToDecide;
  /** jobs raised in the span that were called void, newest first */
  voided: AnalyticsJob[];
};

export type ToDecide = {
  /** every question the span's jobs raise, answered or not */
  asks: Ask[];
  /** questions still waiting on an answer */
  open: number;
  /** jobs left out of a figure until they're decided: the quote, outcome and
      price questions (an unknown kind still counts, as "Not known") */
  leftOut: { jobs: number; cents: number };
};

function toDecideOf(asks: Ask[]): ToDecide {
  const out = new Map<string, number>();
  for (const a of asks) if (a.answer === null && a.question !== "kind") out.set(a.job.id, a.job.valueCents ?? 0);
  return {
    asks,
    open: asks.filter((a) => a.answer === null).length,
    leftOut: { jobs: out.size, cents: sum([...out.values()]) },
  };
}

export function analyse(
  jobs: readonly AnalyticsJob[],
  today: string,
  period: PeriodKey,
  decisions: Decisions = NO_DECISIONS,
): JobAnalytics {
  const span = periodSpan(period, today);
  const before = spanBefore(span);
  /* a void job is not a job: out before anything is counted */
  const isVoid = (j: AnalyticsJob) => decisions.get(j.id)?.void === "void";
  const voided = jobs.filter((j) => isVoid(j) && inSpan(j.raisedOn, span)).sort((a, b) => (b.raisedOn ?? "").localeCompare(a.raisedOn ?? ""));
  jobs = jobs.filter((j) => !isVoid(j));
  const { placed: now, asks } = placeIn(jobs, span, today, decisions);
  const { placed: prev } = placeIn(jobs, before, today, decisions);
  return {
    period,
    span,
    before,
    top: topLine(jobs, now, prev, span, before),
    byKind: bars(now, KIND_KEYS, (p) => p.kind ?? "unknown"),
    byPrice: bars(now, PRICE_BANDS, (p) => bandOf(p.job.valueCents)),
    bySpeed: bars(now, SPEED_BUCKETS, speedBucketOf),
    quotes: quotesFigures(jobs, now, today, decisions),
    prices: priceRows(now),
    enquiries: weeksOf(jobs, span, before),
    toDecide: toDecideOf(asks),
    voided,
  };
}

/* ── words ── */

/** "46%", or a dash with nothing decided. */
export const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

/** Money as a figure: "$4,650", "$612k", "$1.86M". */
export function money(cents: number | null): string {
  if (cents === null) return "—";
  const d = cents / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(2)}M`;
  if (Math.abs(d) >= 100_000) return `$${Math.round(d / 1000)}k`;
  return fmtAud(Math.round(d) * 100);
}

/** A change on the year before, as a share: "+14%", "−3%"; null when there
    is nothing to compare with. */
export function change(now: number | null, before: number | null): { words: string; up: boolean } | null {
  if (now === null || before === null || before === 0) return null;
  const c = Math.round(((now - before) / before) * 100);
  return { words: `${c >= 0 ? "+" : "−"}${Math.abs(c)}%`, up: c >= 0 };
}

/** "8 October 2025" */
export function longDay(day: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(
    new Date(`${day}T00:00:00Z`),
  );
}
