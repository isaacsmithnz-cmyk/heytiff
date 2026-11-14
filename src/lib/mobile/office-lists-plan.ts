import type { Ending, Waiting } from "./visit-ending-plan";

/* THE OFFICE'S LISTS, FROM HOW EACH VISIT ENDED (Isaac, 11 November 2026:
   "just so that the office knows the clear end result"; board 15 of
   https://claude.ai/artifact/ESTib5qakLMfgTXmUW9vCy, "Build from mocks
   approved"). Pure: what's read in (lib/mobile/office-lists) decides here.

   - READY TO INVOICE: Finished, charged. Leaves when the office has checked
     it (Checked), or the job's Completed or invoiced in ServiceM8. A visit
     at no charge is never on it.
   - TO BOOK: Coming back (no access, more time, someone else, or parts that
     have come in). Leaves when a visit's booked after the day it was said.
   - PARTS ON ORDER: Coming back, waiting on parts, until Parts are in moves
     it to To book (or a visit's booked).
   - QUOTES WAITING: Quote needed first, or Finished with a quote to build:
     to price until ServiceM8 says it's sent, then waiting from the day it
     went. Leaves when accepted (a work order after it), or the job's lost.
   - WARRANTY CLAIMS: a visit at no charge for a warranty, until the office
     says it's claimed from the supplier (board 11: "Claim from the
     supplier?"). It's on this list whatever else the visit was.
   Can't go ahead is on none: it was said, and that's the end of it.
   Only a job's latest answer counts. Each row says how long it's waited:
   past a week getting on, past a fortnight late. */

export type ListName = "ready" | "book" | "parts" | "quotes" | "claims";
export const LIST_TITLES: Record<ListName, string> = {
  ready: "Ready to invoice",
  book: "To book",
  parts: "Parts on order",
  quotes: "Quotes waiting",
  claims: "Warranty claims",
};
export const LIST_ORDER: ListName[] = ["ready", "book", "parts", "quotes", "claims"];

export type EndingRow = {
  jobUuid: string;
  day: string;
  ending: Ending & { detail: Ending["detail"] & { partsIn?: string; quoteJob?: string; checked?: string; claimed?: string } };
  by: string | null;
};
export type JobFacts = {
  number: string | null;
  suburb: string | null;
  status: string | null;
  active: boolean;
  invoiced: boolean;
  quoteSentOn: string | null;
  workOrderOn: string | null;
  quoted: number | null;
};
export type OfficeRow = { list: ListName; jobUuid: string; day: string; title: string; sub: string; days: number; tone: "late" | "getting" | null };
export type OfficeLists = { list: ListName; title: string; rows: OfficeRow[] }[];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayWord = (day: string) => {
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
};
const between = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
const money = (v: number) => `$${v.toLocaleString("en-AU", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const WAITING: Record<Waiting, string> = { more_time: "more time needed", parts: "parts", access: "no access", someone_else: "needs someone else" };

/** Whose answer, and when: "Leonardo, 30 Jul" */
const whoWhen = (r: EndingRow) => [r.by, dayWord(r.day)].filter(Boolean).join(", ");

export function tone(days: number): OfficeRow["tone"] {
  return days > 14 ? "late" : days > 7 ? "getting" : null;
}

/** A quote waiting: to price until ServiceM8 says it's sent, then from the day it went; gone once accepted or lost. */
function quoteRow(q: JobFacts, since: string, words: string | undefined, make: (sub: string, since?: string) => OfficeRow): OfficeRow | null {
  if (q.status === "Unsuccessful" || q.status === "Completed" || !q.active) return null;
  if (q.workOrderOn && q.workOrderOn >= since) return null;
  const sent = q.quoteSentOn && q.quoteSentOn >= since ? q.quoteSentOn : null;
  if (sent) return make([q.quoted && q.quoted > 0 ? money(q.quoted) : null, `sent ${dayWord(sent)}`].filter(Boolean).join(", "), sent);
  return make(["To price", words].filter(Boolean).join(", "));
}

/** Where each job's latest answer puts it today: none, one list, or two (Finished with a quote to build is to invoice, and its quote job is waiting). `bookedAfter` says a visit's been booked after the answer's day; `quoteJob` is the quote job it opened, once ServiceM8's mirror has it. */
export function placeEnding(r: EndingRow, job: JobFacts | undefined, bookedAfter: boolean, today: string, quoteJob?: JobFacts): OfficeRow[] {
  if (!job || !job.active) return [];
  const claim = r.ending.charge.kind === "none" && r.ending.charge.reason === "warranty" && !r.ending.detail.claimed ? r : null;
  const rows = placeAnswer(r, job, bookedAfter, today, quoteJob);
  if (!claim) return rows;
  const days = between(r.day, today);
  const words = r.ending.charge.kind === "none" ? r.ending.charge.words : undefined;
  return [...rows, { list: "claims", jobUuid: r.jobUuid, day: r.day, title: [job.number, job.suburb].filter(Boolean).join(", ") || "A job", sub: [words || "Warranty", whoWhen(r)].join(", "), days, tone: tone(days) }];
}

function placeAnswer(r: EndingRow, job: JobFacts, bookedAfter: boolean, today: string, quoteJob?: JobFacts): OfficeRow[] {
  const titleOf = (j: JobFacts) => [j.number, j.suburb].filter(Boolean).join(", ") || "A job";
  const e = r.ending;
  const row = (list: ListName, sub: string, since = r.day, on: { uuid: string; facts: JobFacts } = { uuid: r.jobUuid, facts: job }): OfficeRow => {
    const days = between(since, today);
    return { list, jobUuid: on.uuid, day: r.day, title: titleOf(on.facts), sub, days, tone: tone(days) };
  };

  if (e.answer === "finished") {
    const out: OfficeRow[] = [];
    if (e.charge.kind === "job" && !e.detail.checked && !job.invoiced && job.status !== "Completed") {
      const how = job.quoted && job.quoted > 0 && job.quoteSentOn && job.status !== "Quote" ? `, as quoted, ${money(job.quoted)}` : "";
      out.push(row("ready", `Finished${how}, ${whoWhen(r)}`));
    }
    if (e.detail.quoteToo) {
      const q =
        quoteJob && e.detail.quoteJob
          ? quoteRow(quoteJob, r.day, e.detail.quoteWords, (sub, since) => row("quotes", sub, since, { uuid: e.detail.quoteJob!, facts: { ...quoteJob, suburb: quoteJob.suburb ?? job.suburb } }))
          : row("quotes", ["To quote", e.detail.quoteWords, `from ${titleOf(job)}`].filter(Boolean).join(", "));
      if (q) out.push(q);
    }
    return out;
  }

  if (e.answer === "coming_back") {
    if (bookedAfter || job.status === "Completed" || job.status === "Unsuccessful") return [];
    if (e.detail.waiting === "parts" && !e.detail.partsIn) return [row("parts", [e.detail.needed || "Parts", whoWhen(r)].join(", "))];
    if (e.detail.waiting === "parts" && e.detail.partsIn) return [row("book", `Parts in ${dayWord(e.detail.partsIn)}, ${whoWhen(r)}`, e.detail.partsIn)];
    const why = e.detail.waiting ? cap(WAITING[e.detail.waiting]) : "Coming back";
    return [row("book", [why, e.detail.howLong ? `about ${e.detail.howLong}` : null, whoWhen(r)].filter(Boolean).join(", "))];
  }

  if (e.answer === "quote_first") {
    const words = [e.detail.quoteWords, e.detail.quoteWho ? `on ${e.detail.quoteWho}` : null].filter(Boolean).join(", ") || undefined;
    const q = quoteRow(job, r.day, words, (sub, since) => row("quotes", sub, since));
    return q ? [q] : [];
  }
  return [];
}

/** The four lists, each oldest first, only those with something on them. */
export function officeLists(rows: OfficeRow[]): OfficeLists {
  return LIST_ORDER.map((list) => ({
    list,
    title: LIST_TITLES[list],
    rows: rows.filter((r) => r.list === list).sort((a, b) => b.days - a.days),
  })).filter((l) => l.rows.length > 0);
}

/** Each job's latest answer only. */
export function latestPerJob(rows: EndingRow[]): EndingRow[] {
  const by = new Map<string, EndingRow>();
  for (const r of rows) {
    const k = r.jobUuid.toLowerCase();
    const had = by.get(k);
    if (!had || had.day < r.day) by.set(k, r);
  }
  return [...by.values()];
}
