import { lineOf } from "@/lib/workboard/job-steps";
import { plusDays } from "@/lib/workboard/dates";
import { fmtAud } from "@/lib/workboard/project-money";
import { WORK_KIND_WORDS, type WorkKind } from "@/lib/quotes/labour-history";

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

   MONEY is ServiceM8's job total, which is inc GST (job-money.ts). It is
   labelled, never converted. */

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
  /** the day it became a work order */
  wonOn: string | null;
  completedOn: string | null;
  /** the job's total in cents, inc GST; null when nothing is priced */
  valueCents: number | null;
  kind: WorkKind | null;
};

export type Outcome = "won" | "lost" | "lapsed" | "open";

const norm = (s: string | null) => (s ?? "").trim().toLowerCase();

/** Whole days from one day to another. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Where a quote stands today; null for a job that isn't a quote. */
export function outcomeOf(j: AnalyticsJob, today: string): Outcome | null {
  if (lineOf({ status: j.status, quoteSentOn: j.quoteSentOn }) !== "quote") return null;
  const s = norm(j.status);
  if (s === "work order" || s === "completed") return "won";
  if (s === "unsuccessful") return "lost";
  if (s !== "quote") return null;
  if (!j.raisedOn) return "open";
  return daysBetween(j.raisedOn, today) > LAPSE_AFTER_DAYS ? "lapsed" : "open";
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

type Placed = { job: AnalyticsJob; outcome: Outcome };

function quotesIn(jobs: readonly AnalyticsJob[], span: Span, today: string): Placed[] {
  const out: Placed[] = [];
  for (const job of jobs) {
    if (!inSpan(job.raisedOn, span)) continue;
    const outcome = outcomeOf(job, today);
    if (outcome) out.push({ job, outcome });
  }
  return out;
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
  const wonValues = won.map((p) => p.job.valueCents).filter((v): v is number => v !== null);
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
    medianWonBefore: median(wonPrev.map((p) => p.job.valueCents).filter((v): v is number => v !== null)),
    averageWonCents: wonValues.length ? sum(wonValues) / wonValues.length : null,
    speedDays: speedOf(now),
    speedBefore: speedOf(before),
    quotes: now.length,
    open: now.filter((p) => p.outcome === "open").length,
  };
}

/* ── win rate, broken down ── */

export type Bar = Rate & { key: string; label: string };

const KIND_ORDER: readonly WorkKind[] = ["split", "multi", "ducted", "vrf", "service", "maintenance"];

/** A kind of work as a row's label: "Wall split", "VRF". */
export const kindLabel = (k: WorkKind | null) =>
  k === null ? "Not known" : k === "vrf" ? "VRF" : WORK_KIND_WORDS[k].charAt(0).toUpperCase() + WORK_KIND_WORDS[k].slice(1);

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

const KIND_KEYS = [...KIND_ORDER.map((k) => ({ key: k as string, label: kindLabel(k) })), { key: "unknown", label: kindLabel(null) }];

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

export type QuotesFigures = {
  /** won quotes by days from the job being raised to its work order */
  daysToYes: { label: string; count: number; late: boolean }[];
  /** wins that came after the 180 days, which count as won */
  lateWins: number;
  winsDated: number;
  unsuccessful: { count: number; cents: number };
  lapsed: { count: number; cents: number };
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

function quotesFigures(jobs: readonly AnalyticsJob[], now: Placed[], today: string): QuotesFigures {
  const counts = YES_BINS.map(() => 0);
  let winsDated = 0;
  for (const p of now) {
    if (p.outcome !== "won" || !p.job.wonOn || !p.job.raisedOn) continue;
    const d = Math.max(0, daysBetween(p.job.raisedOn, p.job.wonOn));
    counts[YES_BINS.findIndex((b) => d <= b.upTo)]!++;
    winsDated++;
  }
  const pack = (ps: Placed[]) => ({ count: ps.length, cents: sum(ps.map(valueOf)) });

  const open = { toPrice: 0, waiting: { count: 0, cents: 0 }, cold: { count: 0, cents: 0 }, lapsingSoon: { count: 0, cents: 0 } };
  for (const job of jobs) {
    if (outcomeOf(job, today) !== "open" || !job.raisedOn) continue;
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
    unsuccessful: pack(now.filter((p) => p.outcome === "lost")),
    lapsed: pack(now.filter((p) => p.outcome === "lapsed")),
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
    if (p.outcome !== "won" || p.job.valueCents === null) continue;
    const k = p.job.kind ?? "unknown";
    by.set(k, [...(by.get(k) ?? []), p.job.valueCents]);
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
};

export function analyse(jobs: readonly AnalyticsJob[], today: string, period: PeriodKey): JobAnalytics {
  const span = periodSpan(period, today);
  const before = spanBefore(span);
  const now = quotesIn(jobs, span, today);
  const prev = quotesIn(jobs, before, today);
  return {
    period,
    span,
    before,
    top: topLine(jobs, now, prev, span, before),
    byKind: bars(now, KIND_KEYS, (p) => p.job.kind ?? "unknown"),
    byPrice: bars(now, PRICE_BANDS, (p) => bandOf(p.job.valueCents)),
    bySpeed: bars(now, SPEED_BUCKETS, speedBucketOf),
    quotes: quotesFigures(jobs, now, today),
    prices: priceRows(now),
    enquiries: weeksOf(jobs, span, before),
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
