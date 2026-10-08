import { lineOf } from "@/lib/workboard/job-steps";
import { plusDays } from "@/lib/workboard/dates";
import { fmtAud } from "@/lib/workboard/project-money";
import { workKindOf } from "@/lib/quotes/labour-history";
import { KINDS, kindLabel, type Decisions, type JobDecisions, type JobKind, type Question } from "./decisions";
import type { CategoryRole, Rules } from "./settings";

export { kindLabel, type JobKind };

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

/** A quote with no answer this long after the job was raised counts as lost
    (Isaac, 2026-10-08: "Do 60 days", the age ServiceM8 closes them at; it was
    180 from 2026-10-07). */
export const LAPSE_AFTER_DAYS = 60;
/** A quote kept open as a tender is lost only this long after it was raised
    ("with option to extend if it's a tender etc"). */
export const TENDER_AFTER_DAYS = 180;

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
  /** what its category's jobs are, the business's word or read from the name (settings) */
  role?: CategoryRole;
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
  kind: JobKind | null;
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
  if (norm(j.status) === "unsuccessful") {
    if (stageOf(j) === "unsuccessful") return unsuccessfulQuote(j);
    /* a work order the techs marked Unsuccessful: quoted as a work order is, or its quote went out */
    return unsuccessfulQuote(j) || (!!j.quotedOn && j.wonOn! > j.quotedOn);
  }
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
   - an enquiry never priced or quoted (9): not a quote;
   - a WORK ORDER THE TECHS MARKED UNSUCCESSFUL (Isaac, 2026-10-08: "The boys
     sometimes mark a job unsecessful if they have not completed it that
     day. So it would have gone quote, work order then marked
     unsuccessful"): of the 29 in two years, 25 had visits booked after the
     work order, so the work went ahead. An Unsuccessful job ServiceM8 dates
     a work order is read as the Work Order it was: won if it was quoted,
     else work that was never a quote (a call-out, a visit cut short).
   One priced at $3,000 or more with no sign of a quote leaving and no work
   order is asked whether it was a quote (1, $208k). */
const quoteWentOut = (j: AnalyticsJob) => !!j.quoteSentOn || !!j.quoteDocOn;

/** ServiceM8's status as the figures read it: an Unsuccessful job that was a
    Work Order is still the Work Order it was. */
export function stageOf(j: AnalyticsJob): string {
  const s = norm(j.status);
  return s === "unsuccessful" && j.wonOn ? "work order" : s;
}

function unsuccessfulQuote(j: AnalyticsJob): boolean {
  return quoteWentOut(j) || !!j.claimedOn;
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
export function outcomeOf(j: AnalyticsJob, today: string, lapseAfterDays: number = LAPSE_AFTER_DAYS, keptOpen = false): Outcome | null {
  if (!wasQuoted(j)) return null;
  const s = stageOf(j);
  if (s === "work order" || s === "completed") return "won";
  if (s === "quote" && j.claimedOn) return "won";
  /* a tender ServiceM8 closed with no answer is still open, for as long as a tender is */
  if (s === "unsuccessful" && !(keptOpen && j.closedUnanswered)) return "lost";
  if (s !== "quote" && s !== "unsuccessful") return null;
  if (!j.raisedOn) return "open";
  return daysBetween(j.raisedOn, today) > lapseAfterDays ? "lapsed" : "open";
}

/* ── what can't be placed ── */

/** A work order this big, with no quote sent, may have been quoted outside
    ServiceM8: asked. Cents, ex GST. */
export const QUOTE_LIKELY_FROM_CENTS = 300_000;

/** The rules a business hasn't set: the live account's (settings). */
export const DEFAULT_RULES: Rules = {
  lapseAfterDays: LAPSE_AFTER_DAYS,
  tenderAfterDays: TENDER_AFTER_DAYS,
  quoteFromCents: QUOTE_LIKELY_FROM_CENTS,
  closeAfterDays: null,
};

/** The days a quote has before it counts as lost: a tender's, or the rule's. */
export const limitOf = (d: JobDecisions | undefined, rules: Rules) =>
  d?.extend === "tender" ? Math.max(rules.tenderAfterDays, rules.lapseAfterDays) : rules.lapseAfterDays;
/** A won price this many times its kind's median, or this fraction of it, is
    asked about once the kind has PRICE_SAMPLE priced wins. */
export const PRICE_OUTLIER_TIMES = 4;
export const PRICE_SAMPLE = 5;

const INSTALL: ReadonlySet<JobKind> = new Set(["split", "multi", "ducted", "vrf"]);

/** A work order with no sign of a quote that reads like an install (by its
    kind or its category) and comes to $3,000 ex GST or more: quoted outside
    ServiceM8, or done and charged? */
function mightBeQuote(j: AnalyticsJob, quoteFromCents: number): boolean {
  if (wasQuoted(j)) return false;
  if (stageOf(j) === "unsuccessful") return (j.valueCents ?? 0) >= quoteFromCents;
  const installCategory = j.role ? j.role === "install" : /install|construction/i.test(j.category ?? "");
  const install = (j.kind !== null && INSTALL.has(j.kind)) || installCategory;
  return install && (j.valueCents ?? 0) >= quoteFromCents;
}

/* WHAT THE WORDS SAY WHEN THE PROGRESS LINE'S WORDS DON'T (Isaac,
   2026-10-07: "i just need the most accurate data"). Read against the 710
   jobs of the live account's two years whose kind workKindOf couldn't
   tell, each reading below was checked against the jobs it places:
   - multi first: one outdoor "to serve" several, bulkheads counted or "off
     an outdoor", one outdoor and two indoors, or "80multi";
   - ducted: a system of 7 kW or more with ducts, zones, return air or the
     Mitsubishi GAA/HAA series; a ducted model (PEAD; Daikin FDYAN, FBA); or
     a bulk head, as workKindOf reads "bulkhead".
     A duct, a zone motor or a return air grille alone is ductwork done to
     a system, or a rangehood's, not a ducted install, and stays unknown;
   - wall split: "split" on its own ("mits 2.5kw split"), but not "split
     level" or a split disconnected or reconnected; "high walls"; and the
     wall-split models (AP Series, Avanti, MHI Bronte, Daikin Cora and Zena,
     MSZ, FTXM). Bronte alone is a suburb, and "split air flow" a verb;
   - ventilation: exhaust and inline fans, subfloor ventilation, Lossnay and
     fresh air, which is none of the air conditioning kinds. A fan motor is
     an air conditioner's as often as not, and isn't read;
   - one unit of 6 kW or less and nothing else sized is a wall split: ducted
     starts above it, a cassette or a console is said so, and a job naming
     two sizes may be two units or a multi.
   Anything else stays unknown and is asked. */
const kwSizes = (words: string) => [...words.matchAll(/(\d+(?:\.\d+)?)\s*kw\b/gi)].map((m) => Number(m[1]));
const DUCTED_MODELS = /\b(pead|fdyan?|fdyq|fba)[\w-]*|\bbulk\s*heads?\b/i;
const DUCTED_WORDS = /\bducts?\b|\bzones?\b|\breturn\s+air\b|\b(gaa|haa)\b/i;
const MULTI_WORDS =
  /\boutdoor\b[^.]{0,40}\bto\s+serve\b|\bto\s+serve\s+\d+\s*x\b|\dmulti\b|\b\d+\s*x\s+[^.]{0,40}\bbulk\s*heads\b|\bbulk\s*heads\s+off\b/i;
const SPLIT_WORD = /\bsplits?\b(?!\s+(level|the|into|between|up|it|them|air|flow)\b)/i;
const SPLIT_MODELS = /\bap\s+series\b|\bavanti\b|\bmhi\s+bronte\b|\b(msz|ftxm|ctxm|ftxv)[\w-]*/i;
const NOT_AN_INSTALL = /\b(dis|re)connect\w*|\breinstall\w*/i;
const NOT_A_WALL_UNIT = /\bcassette\b|\bconsole\b|\bfloor\s*standing\b|\bbulkhead\b/i;
const VENTILATION_WORDS =
  /\b(exhaust|vent[a-z]*lation|lossnay|fresh\s*air|rangehood)\b|\b(inline|in-line|sub\s*floor|subfloor|underfloor|roof|bathroom)\s+fans?\b|\b\d+\s*mm\s+(\w+\s+){0,3}fans?\b/i;

function readsDucted(words: string): boolean {
  if (DUCTED_MODELS.test(words)) return true;
  return kwSizes(words).some((kw) => kw >= 7) && DUCTED_WORDS.test(words);
}

/** One outdoor and two indoors or more, sized: a multi. */
const oneOutdoorManyIndoors = (words: string) =>
  /\boutdoor\b/i.test(words) && (words.match(/\bindoors?\b/gi)?.length ?? 0) >= 2 && kwSizes(words).length > 0;

function readsSplit(words: string): boolean {
  if (SPLIT_MODELS.test(words)) return true;
  if (/\b(cora|zena)\b/i.test(words) && /\bdaikin\b/i.test(words)) return true;
  return SPLIT_WORD.test(words) && !NOT_AN_INSTALL.test(words);
}

/** One sized unit of 6 kW or less, not a cassette or a console, and nothing
    else sized or counted. */
function oneSmallUnit(words: string): boolean {
  const sizes = new Set(kwSizes(words));
  if (sizes.size !== 1 || /\b\d+\s*x\b|\boutdoor\b/i.test(words) || NOT_A_WALL_UNIT.test(words)) return false;
  const [kw] = [...sizes];
  return kw! > 0 && kw! <= 6;
}

/** The kind of work, read for the figures: a service call or maintenance by
    its category first, whatever its words mention (a "Service call" about a
    ducted system is a service, not a ducted install), then the job's words
    and its lines' names together ("MITSUBISHI ELEC. HIGH WALL SPLIT 4.2KW"),
    "HWS" being the trade's high wall split, then the readings above. */
export function analyticsKindOf(
  description: string | null,
  lineNames: readonly string[],
  category: string | null,
  role?: CategoryRole,
): JobKind | null {
  /* the business's role for the category stands in for its name, when there is one */
  const cat = (category ?? "").toLowerCase();
  if (role ? role === "service" : cat.includes("service")) return "service";
  if (role ? role === "maintenance" : cat.includes("maintenance")) return "maintenance";
  const words = [description ?? "", ...lineNames].join(" ");
  const read = workKindOf(words, role ? null : category);
  if (read) return read;
  if (/\bhws\b/i.test(words)) return "split";
  if (MULTI_WORDS.test(words) || oneOutdoorManyIndoors(words)) return "multi";
  if (readsDucted(words)) return "ducted";
  if (readsSplit(words)) return "split";
  if (VENTILATION_WORDS.test(words)) return "ventilation";
  if (oneSmallUnit(words)) return "split";
  return null;
}

/** ServiceM8's status and the money or the proposal disagree: Unsuccessful,
    never a Work Order, but paid or with a claim invoiced; or accepted in
    HeyTiff and still a Quote. */
function disputed(j: AnalyticsJob): boolean {
  const s = stageOf(j);
  return (
    (s === "unsuccessful" && (!!j.paid || !!j.claimedOn)) ||
    (s === "quote" && !!j.acceptedInHeyTiff && !j.claimedOn)
  );
}

export type Placement = {
  /** where it stands with the answers given; null when it isn't counted as a quote */
  outcome: Outcome | null;
  /** its kind, answered or read */
  kind: JobKind | null;
  /** the questions it raises, answered or not (price is decided across jobs, in placeIn) */
  raises: Question[];
};

/** One job with its answers applied. */
export function placeJob(j: AnalyticsJob, today: string, d: JobDecisions = {}, rules: Rules = DEFAULT_RULES): Placement {
  const kind = (d.kind as JobKind | undefined) ?? j.kind;
  const raises: Question[] = [];
  let outcome: Outcome | null;
  if (mightBeQuote(j, rules.quoteFromCents)) {
    raises.push("quote");
    outcome = d.quote === "quote" ? (norm(j.status) === "unsuccessful" ? "lost" : "won") : null;
  } else if (disputed(j)) {
    raises.push("outcome");
    outcome = d.outcome === "won" ? "won" : d.outcome === "lost" ? "lost" : null;
  } else {
    outcome = outcomeOf(j, today, limitOf(d, rules), d.extend === "tender");
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
  kind: JobKind | null;
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
  kind: JobKind | null;
  /** price: its kind's median, and how many times it the price is */
  median?: number;
  times?: number;
};

const NO_DECISIONS: Decisions = new Map();

/** The quotes on jobs raised in the span, the answers applied, and every
    question they raise. */
function placeIn(jobs: readonly AnalyticsJob[], span: Span, today: string, decisions: Decisions, rules: Rules): { placed: Placed[]; asks: Ask[] } {
  const placed: Placed[] = [];
  const asks: Ask[] = [];
  for (const job of jobs) {
    if (!inSpan(job.raisedOn, span)) continue;
    const d = decisions.get(job.id) ?? {};
    const p = placeJob(job, today, d, rules);
    for (const q of p.raises) asks.push({ question: q, job, answer: d[q] ?? null, kind: p.kind });
    if (p.outcome) placed.push({ job, outcome: p.outcome, kind: p.kind, priced: job.valueCents !== null });
  }

  /* A price far from its kind's is asked about, and left out of the prices
     until it is counted. The median is every won price of the kind, the odd
     one included: one stray can't move a middle of five. */
  const byKind = new Map<JobKind, number[]>();
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

/** Days from raised to a yes, in bins up to the business's lost-after
    days, and the wins after them. */
const YES_EDGES = [7, 14, 30, 60, 90, 180, 365];
export const yesBins = (lapseAfterDays: number = LAPSE_AFTER_DAYS) => {
  let from = 0;
  const bins = [...YES_EDGES.filter((e) => e < lapseAfterDays), lapseAfterDays].map((upTo) => {
    const bin = { label: `${from}–${upTo}`, upTo };
    from = upTo + 1;
    return bin;
  });
  return [...bins, { label: `Over ${lapseAfterDays}`, upTo: Infinity }];
};

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
  /** the span's quotes kept open as tenders */
  kept: AnalyticsJob[];
  /** open quotes today, whatever the period: the board's groups */
  openNow: {
    /** "going cold" after this many days; "reaching" the limit within `soonDays` */
    coldAfter: number;
    soonDays: number;
    /** the quotes reaching their limit soon, oldest first: to keep open, or let go */
    lapsing: AnalyticsJob[];
    toPrice: number;
    waiting: { count: number; cents: number };
    cold: { count: number; cents: number };
    /** reach the 180 days within the next 30 */
    lapsingSoon: { count: number; cents: number };
  };
};

/** When an open quote is going cold, and when its limit is near: halfway and
    a quarter of the way for a short limit, 60 and 30 days for a long one. */
const coldAfterOf = (limit: number) => (limit >= 120 ? 60 : Math.round(limit / 2));
const soonOf = (limit: number) => (limit >= 120 ? 30 : Math.max(7, Math.round(limit / 4)));

function lostWhy(p: Placed): LostWhy | null {
  if (p.outcome === "lapsed") return "lapsed";
  if (p.outcome !== "lost") return null;
  return p.job.closedUnanswered && norm(p.job.status) === "unsuccessful" ? "closed" : "marked";
}

function quotesFigures(jobs: readonly AnalyticsJob[], now: Placed[], today: string, decisions: Decisions, rules: Rules, span: Span): QuotesFigures {
  const bins = yesBins(rules.lapseAfterDays);
  const counts = bins.map(() => 0);
  let winsDated = 0;
  for (const p of now) {
    const yes = yesOn(p.job);
    if (p.outcome !== "won" || !yes || !p.job.raisedOn) continue;
    const d = Math.max(0, daysBetween(p.job.raisedOn, yes));
    counts[bins.findIndex((b) => d <= b.upTo)]!++;
    winsDated++;
  }
  const pack = (ps: Placed[]) => ({ count: ps.length, cents: sum(ps.map(valueOf)) });

  const coldAfter = coldAfterOf(rules.lapseAfterDays);
  const soonDays = soonOf(rules.lapseAfterDays);
  const open = {
    coldAfter,
    soonDays,
    lapsing: [] as { job: AnalyticsJob; age: number }[],
    toPrice: 0,
    waiting: { count: 0, cents: 0 },
    cold: { count: 0, cents: 0 },
    lapsingSoon: { count: 0, cents: 0 },
  };
  for (const job of jobs) {
    const d = decisions.get(job.id);
    if (placeJob(job, today, d, rules).outcome !== "open" || !job.raisedOn) continue;
    const age = Math.max(0, daysBetween(job.raisedOn, today));
    const cents = job.valueCents ?? 0;
    if (age > limitOf(d, rules) - soonDays) {
      open.lapsingSoon.count++;
      open.lapsingSoon.cents += cents;
      open.lapsing.push({ job, age });
    }
    if (job.valueCents === null) open.toPrice++;
    else if (age > coldAfter) {
      open.cold.count++;
      open.cold.cents += cents;
    } else {
      open.waiting.count++;
      open.waiting.cents += cents;
    }
  }
  return {
    daysToYes: bins.map((b, i) => ({ label: b.label, count: counts[i]!, late: b.upTo === Infinity })),
    lateWins: counts[counts.length - 1]!,
    winsDated,
    unsuccessful: pack(now.filter((p) => lostWhy(p) === "marked")),
    closed: pack(now.filter((p) => lostWhy(p) === "closed")),
    lapsed: pack(now.filter((p) => p.outcome === "lapsed")),
    lostJobs: now
      .filter((p) => p.outcome === "lost" || p.outcome === "lapsed")
      .sort((a, b) => (b.job.raisedOn ?? "").localeCompare(a.job.raisedOn ?? ""))
      .map((p) => ({ job: p.job, why: lostWhy(p)! })),
    openNow: { ...open, lapsing: open.lapsing.sort((a, b) => b.age - a.age).map((l) => l.job) },
    kept: jobs.filter((j) => decisions.get(j.id)?.extend === "tender" && inSpan(j.raisedOn, span)),
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
    /* a warranty call-out is the business's own work coming back, not an enquiry */
    if (!j.raisedOn || j.role === "warranty") continue;
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
  /** the rules the figures were worked out by: the business's, else the defaults */
  rules: Rules;
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
  rules: Rules = DEFAULT_RULES,
): JobAnalytics {
  const span = periodSpan(period, today);
  const before = spanBefore(span);
  /* a void job is not a job: out before anything is counted */
  const isVoid = (j: AnalyticsJob) => decisions.get(j.id)?.void === "void";
  const voided = jobs.filter((j) => isVoid(j) && inSpan(j.raisedOn, span)).sort((a, b) => (b.raisedOn ?? "").localeCompare(a.raisedOn ?? ""));
  jobs = jobs.filter((j) => !isVoid(j));
  const { placed: now, asks } = placeIn(jobs, span, today, decisions, rules);
  const { placed: prev } = placeIn(jobs, before, today, decisions, rules);
  return {
    period,
    span,
    before,
    top: topLine(jobs, now, prev, span, before),
    byKind: bars(now, KIND_KEYS, (p) => p.kind ?? "unknown"),
    byPrice: bars(now, PRICE_BANDS, (p) => bandOf(p.job.valueCents)),
    bySpeed: bars(now, SPEED_BUCKETS, speedBucketOf),
    quotes: quotesFigures(jobs, now, today, decisions, rules, span),
    prices: priceRows(now),
    enquiries: weeksOf(jobs, span, before),
    toDecide: toDecideOf(asks),
    voided,
    rules,
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
