"use client";

import Link from "next/link";
import { useState } from "react";
import { ViewTabs } from "@/components/shell/view-tabs";
import {
  change,
  longDay,
  money,
  pct,
  PERIODS,
  type JobAnalytics,
  type LostWhy,
  type PeriodKey,
} from "@/lib/analytics/job-analytics";
import { DaysToYes, EnquiriesChart, KIND_COLOUR, PriceTable, RateBars, STEP_COLOUR } from "./analytics-charts";
import { ToDecide } from "./analytics-decide";
import { useVoids, VoidList } from "./analytics-jobs";
import "./analytics.css";

/* ANALYTICS — the business's own jobs, read off ServiceM8's copy
   (docs/job-analytics-plan.md; the mock-up Isaac approved 2026-10-07).
   Two faces, switched on the client like the price book's: Overview, the
   top line and what moves the win rate, and Quotes, the 180-day rule and
   what is open now. The period is the URL's, so a link keeps it. Owner-tier
   by default: every figure is job money (`workboard_money`). */

export type AnalyticsState =
  | { kind: "standalone" }
  | { kind: "unread" }
  | {
      kind: "ready";
      data: JobAnalytics;
      truncated: boolean;
      /** client names for the To decide rows, by ServiceM8 company uuid */
      names?: Record<string, string>;
      /** answers can be kept: the decisions table is there */
      canDecide?: boolean;
      /** a Quote can be made a Work Order in ServiceM8 from here (cleanup-offer) */
      workOrders?: "on" | "trial" | null;
    };

type Tab = "overview" | "quotes" | "decide";

export function AnalyticsScreen({ state, period }: { state: AnalyticsState; period: PeriodKey }) {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div className="page in full">
      <div className="wrap">
        <div className="stg">
          <ViewTabs
            lead={<h1 className="wb2-h1">Analytics</h1>}
            ariaLabel="Analytics"
            idPrefix="ant"
            panelPrefix="anp"
            active={tab}
            onGo={(k) => setTab(k as Tab)}
            items={[
              { key: "overview", label: "Overview" },
              { key: "quotes", label: "Quotes" },
              {
                key: "decide",
                label: "To decide",
                count: state.kind === "ready" ? jobsToDecide(state.data) : 0,
                tone: "warn",
                countLabel: (n) => `, ${n} ${n === 1 ? "job" : "jobs"} waiting on an answer`,
              },
            ]}
          >
            {state.kind === "ready" && <PeriodPicker period={period} />}
          </ViewTabs>
          <div className="wb2-card">
            <div className="wb2-panel pad">
              <section id={`anp-${tab}`} role="tabpanel" aria-labelledby={`ant-${tab}`} tabIndex={-1}>
                {state.kind === "standalone" && (
                  <div className="an-empty">
                    <Link className="pbtn primary" href="/dashboard/admin/integrations/servicem8">
                      Connect ServiceM8
                    </Link>
                    <p>Analytics reads your quotes and jobs from ServiceM8.</p>
                  </div>
                )}
                {state.kind === "unread" && (
                  <div className="an-empty">
                    <p>ServiceM8&rsquo;s copy couldn&rsquo;t be read just now. Reload the page in a minute.</p>
                  </div>
                )}
                {state.kind === "ready" && tab === "overview" && (
                  <Overview a={state.data} truncated={state.truncated} onDecide={() => setTab("decide")} />
                )}
                {state.kind === "ready" && tab === "quotes" && (
                  <Quotes a={state.data} names={state.names ?? {}} canDecide={state.canDecide ?? false} />
                )}
                {state.kind === "ready" && tab === "decide" && (
                  <ToDecide
                    asks={state.data.toDecide.asks}
                    names={state.names ?? {}}
                    canDecide={state.canDecide ?? false}
                    workOrders={state.workOrders ?? null}
                    voided={state.data.voided}
                    quoteFromCents={state.data.rules.quoteFromCents}
                  />
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PeriodPicker({ period }: { period: PeriodKey }) {
  return (
    <nav className="an-period" aria-label="Period">
      {PERIODS.map((p) => (
        <Link key={p.key} href={`/dashboard/analytics?period=${p.key}`} scroll={false} aria-current={p.key === period ? "true" : undefined}>
          {p.label}
        </Link>
      ))}
    </nav>
  );
}

/** Jobs with a question still waiting on an answer. */
/** Jobs waiting on an answer that moves a figure: job type only fills the
    job-type breakdowns, and is counted apart. */
const jobsToDecide = (a: JobAnalytics) =>
  new Set(a.toDecide.asks.filter((x) => x.answer === null && x.question !== "kind").map((x) => x.job.id)).size;
const kindsToDecide = (a: JobAnalytics) => a.toDecide.asks.filter((x) => x.answer === null && x.question === "kind").length;

/* ── words for the figures ── */

const days = (d: number | null) => (d === null ? "—" : `${Math.round(d * 10) / 10} ${d === 1 ? "day" : "days"}`);
/** Why a lost quote is lost, on its row in the review. */
const lostWords = (why: LostWhy, a: JobAnalytics) =>
  why === "marked"
    ? "Marked Unsuccessful in ServiceM8"
    : why === "closed"
      ? closedWords(a)
      : `No answer after ${a.rules.lapseAfterDays} days`;
const closedWords = (a: JobAnalytics) =>
  a.rules.closeAfterDays ? `No answer, closed by ServiceM8 at ${a.rules.closeAfterDays} days` : "No answer, closed by ServiceM8";
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-AU")} ${n === 1 ? one : many}`;

type Note = { words: string; tone: "" | "ok" | "warn" };

/** A figure set beside the year before: up is good for money. */
function onYear(now: number, before: number): Note {
  const c = change(now, before);
  if (!c) return { words: "Nothing the year before", tone: "" };
  return { words: `${c.words} on the year before`, tone: c.up ? "ok" : "warn" };
}

function Fig({ label, value, note }: { label: string; value: string; note: Note }) {
  return (
    <div className="an-fig">
      <span className="an-label">{label}</span>
      <span className="an-value">{value}</span>
      <span className={note.tone ? `an-note ${note.tone}` : "an-note"}>{note.words}</span>
    </div>
  );
}

function spanWords(a: JobAnalytics) {
  return `${longDay(a.span.from)} to ${longDay(a.span.to)}`;
}

/* ── Overview ── */

function Overview({ a, truncated, onDecide }: { a: JobAnalytics; truncated: boolean; onDecide: () => void }) {
  const t = a.top;
  const open = a.quotes.openNow;
  const openCount = open.toPrice + open.waiting.count + open.cold.count;
  const rateNote: Note =
    t.winRateBefore.rate === null || t.winRate.rate === null
      ? { words: "Nothing decided the year before", tone: "" }
      : Math.round(t.winRate.rate * 100) === Math.round(t.winRateBefore.rate * 100)
        ? { words: `${pct(t.winRateBefore.rate)} the year before`, tone: "" }
        : t.winRate.rate > t.winRateBefore.rate
          ? { words: `Up from ${pct(t.winRateBefore.rate)}`, tone: "ok" }
          : { words: `Down from ${pct(t.winRateBefore.rate)}`, tone: "warn" };
  const speedNote: Note =
    t.speedDays === null || t.speedBefore === null || t.speedDays === t.speedBefore
      ? { words: t.speedBefore === null ? "Nothing the year before" : `${days(t.speedBefore)} the year before`, tone: "" }
      : t.speedDays < t.speedBefore
        ? { words: `Down from ${days(t.speedBefore)}`, tone: "ok" }
        : { words: `Up from ${days(t.speedBefore)}`, tone: "warn" };
  const lapsed = a.quotes.lapsed;

  return (
    <div className="an">
      <p className="an-facts">
        Quotes on jobs raised {spanWords(a)}, against the same days a year earlier. Money is ex GST, from each job’s lines in ServiceM8.
        {a.voided.length > 0 &&
          ` ${plural(a.voided.length, "void job is", "void jobs are")} left out.`}
        {truncated && " The account holds more jobs than one read carries, so the oldest are left out."}{" "}
        <Link href="/dashboard/admin/analytics" className="an-door">
          How jobs are counted
        </Link>
      </p>
      <ToDecideLine a={a} onDecide={onDecide} />

      <section className="an-top" aria-label="The top line">
        <div className="an-lead">
          <span className="an-label">Win rate</span>
          <span className="an-big">{pct(t.winRate.rate)}</span>
          <div className="an-meter" aria-hidden="true">
            <span style={{ width: `${((t.winRate.rate ?? 0) * 100).toFixed(1)}%` }} />
          </div>
          <span className="an-note">
            {t.winRate.won} won of {plural(t.winRate.decided, "decided quote", "decided quotes")}
          </span>
          <span className={rateNote.tone ? `an-note ${rateNote.tone}` : "an-note"}>{rateNote.words}</span>
          <span className="an-note">By value, {pct(t.valueRate)}</span>
        </div>
        <Fig label="Quoted" value={money(t.quotedCents)} note={onYear(t.quotedCents, t.quotedBefore)} />
        <Fig label="Won" value={money(t.wonCents)} note={onYear(t.wonCents, t.wonBefore)} />
        <Fig label="Completed work" value={money(t.completedCents)} note={onYear(t.completedCents, t.completedBefore)} />
        <Fig
          label="Median job won"
          value={money(t.medianWonCents)}
          note={{ words: t.averageWonCents === null ? "No wins yet" : `Average ${money(t.averageWonCents)}`, tone: "" }}
        />
        <Fig
          label="Open quotes"
          value={money(open.waiting.cents + open.cold.cents)}
          note={{ words: `${plural(openCount, "quote", "quotes")} under ${a.rules.lapseAfterDays} days`, tone: "" }}
        />
        <Fig label="Days to quote" value={days(t.speedDays)} note={speedNote} />
      </section>

      <section className="an-sec" aria-labelledby="an-h-win">
        <h2 id="an-h-win">Win rate</h2>
        <p className="an-say">
          {lapsed.count === 0
            ? `No quote in these dates has gone ${a.rules.lapseAfterDays} days without an answer.`
            : `${plural(lapsed.count, "quote", "quotes")} with no answer after ${a.rules.lapseAfterDays} days ${lapsed.count === 1 ? "counts" : "count"} as lost, ${money(lapsed.cents)} of work.`}
        </p>
        <div className="an-cols">
          <RateBars title="By job type" bars={a.byKind} colourOf={(k) => KIND_COLOUR[k] ?? "var(--q)"} />
          <RateBars title="By price" bars={a.byPrice} colourOf={(k) => STEP_COLOUR[["lt5", "lt10", "lt20", "rest"].indexOf(k)] ?? STEP_COLOUR[0]!} />
          <RateBars title="By days to quote" bars={a.bySpeed} colourOf={(k) => STEP_COLOUR[3 - ["d1", "d3", "d7", "slow"].indexOf(k)] ?? STEP_COLOUR[0]!} />
        </div>
      </section>

      <section className="an-sec" aria-labelledby="an-h-price">
        <h2 id="an-h-price">Price by job type</h2>
        {a.prices.length === 0 ? (
          <p className="an-say">No won jobs with a price in these dates.</p>
        ) : (
          <>
            <p className="an-say">{plural(a.prices.reduce((s, r) => s + r.jobs, 0), "won job", "won jobs")} with a price.</p>
            <PriceTable rows={a.prices} />
          </>
        )}
      </section>

      <section className="an-sec" aria-labelledby="an-h-enq">
        <h2 id="an-h-enq">Enquiries week by week</h2>
        <p className="an-say">
          {plural(a.enquiries.total, "job", "jobs")} raised, against {a.enquiries.totalBefore.toLocaleString("en-AU")} the year before.
        </p>
        <div className="an-key">
          <span>
            <i aria-hidden="true" />
            These dates
          </span>
          <span>
            <i className="before" aria-hidden="true" />
            The year before
          </span>
        </div>
        <EnquiriesChart weeks={a.enquiries.weeks} />
      </section>
    </div>
  );
}

/** What is waiting on an answer, and what it keeps out of the figures. */
function ToDecideLine({ a, onDecide }: { a: JobAnalytics; onDecide: () => void }) {
  const jobs = jobsToDecide(a);
  const kinds = kindsToDecide(a);
  if (jobs === 0 && kinds === 0) return null;
  const out = a.toDecide.leftOut;
  return (
    <div className="an-todo">
      <span className="an-todo-dot" aria-hidden="true" />
      <span>
        {jobs > 0 && `${plural(jobs, "job", "jobs")} to decide.`}
        {jobs > 0 &&
          out.jobs > 0 &&
          ` ${out.jobs === jobs ? (jobs === 1 ? "It is" : "They are") : `${out.jobs.toLocaleString("en-AU")} of them, ${money(out.cents)} of work, are`} left out of these figures until then.`}
        {kinds > 0 && `${jobs > 0 ? " " : ""}${plural(kinds, "job has", "jobs have")} no job type: counted, as Not known by type.`}
      </span>
      <button type="button" className="an-door" onClick={onDecide}>
        {jobs > 0 ? `Decide ${plural(jobs, "job", "jobs")}` : "Give job types"}
      </button>
    </div>
  );
}

/* ── Quotes ── */

function Quotes({ a, names, canDecide }: { a: JobAnalytics; names: Record<string, string>; canDecide: boolean }) {
  const voids = useVoids();
  const [review, setReview] = useState(false);
  const q = a.quotes;
  const t = a.top;
  const lost = q.unsuccessful.count + q.closed.count + q.lapsed.count;
  const inside = q.winsDated - q.lateWins;
  const rule =
    q.winsDated === 0
      ? `At ${a.rules.lapseAfterDays} days with no answer. No wins in these dates yet.`
      : q.lateWins === 0
        ? `At ${a.rules.lapseAfterDays} days with no answer. All ${q.winsDated.toLocaleString("en-AU")} wins came inside that.`
        : `At ${a.rules.lapseAfterDays} days with no answer. ${inside.toLocaleString("en-AU")} of the ${q.winsDated.toLocaleString("en-AU")} wins came inside that, and the ${q.lateWins} that came later count as won.`;
  const open = q.openNow;

  return (
    <div className="an">
      <p className="an-facts">
        {plural(t.quotes, "quote", "quotes")} on jobs raised {spanWords(a)}: {t.winRate.won.toLocaleString("en-AU")} won,{" "}
        {lost.toLocaleString("en-AU")} lost and {t.open.toLocaleString("en-AU")} still open.
      </p>

      <div className="an-two">
        <section className="an-sec" aria-labelledby="an-h-rule">
          <h2 id="an-h-rule">When a quote counts as lost</h2>
          <p className="an-say">{rule}</p>
          <DaysToYes bins={q.daysToYes} />
          <p className="an-axis">Days from the job being raised to a yes</p>
        </section>

        <section className="an-sec" aria-labelledby="an-h-lost">
          <h2 id="an-h-lost">The {lost.toLocaleString("en-AU")} lost</h2>
          <div className="an-ledger">
            <div>
              <span>Marked Unsuccessful in ServiceM8</span>
              <b>{q.unsuccessful.count.toLocaleString("en-AU")}</b>
              <em>{money(q.unsuccessful.cents)}</em>
            </div>
            {q.closed.count > 0 && (
              <div>
                <span>{closedWords(a)}</span>
                <b>{q.closed.count.toLocaleString("en-AU")}</b>
                <em>{money(q.closed.cents)}</em>
              </div>
            )}
            <div>
              <span>No answer after {a.rules.lapseAfterDays} days, still a Quote in ServiceM8</span>
              <b>{q.lapsed.count.toLocaleString("en-AU")}</b>
              <em>{money(q.lapsed.cents)}</em>
            </div>
          </div>
        </section>
      </div>

      {q.lostJobs.length > 0 && (
        <section className="an-sec" aria-labelledby="an-h-review">
          <h2 id="an-h-review">Lost, or not a job at all?</h2>
          <button type="button" className="an-more" onClick={() => setReview((r) => !r)} aria-expanded={review}>
            {review ? "Hide the lost quotes" : `Review the ${q.lostJobs.length.toLocaleString("en-AU")} lost`}
          </button>
          {review && (
            <VoidList
              jobs={q.lostJobs.map((l) => l.job)}
              names={names}
              voids={voids}
              serverVoid={false}
              what={(job) => lostWords(q.lostJobs.find((l) => l.job.id === job.id)?.why ?? "marked", a)}
              canDecide={canDecide}
            />
          )}
        </section>
      )}

      <section className="an-sec" aria-labelledby="an-h-open">
        <h2 id="an-h-open">Open quotes today</h2>
        <div className="an-top">
          <Fig label="To price" value={open.toPrice.toLocaleString("en-AU")} note={{ words: "Nothing priced yet", tone: "" }} />
          <Fig label="Waiting, under 60 days" value={open.waiting.count.toLocaleString("en-AU")} note={{ words: money(open.waiting.cents), tone: "" }} />
          <Fig label={`Going cold, 60 to ${a.rules.lapseAfterDays} days`} value={open.cold.count.toLocaleString("en-AU")} note={{ words: money(open.cold.cents), tone: "" }} />
          <Fig
            label={`Reach ${a.rules.lapseAfterDays} days in the next 30`}
            value={open.lapsingSoon.count.toLocaleString("en-AU")}
            note={{ words: money(open.lapsingSoon.cents), tone: open.lapsingSoon.count > 0 ? "warn" : "" }}
          />
        </div>
      </section>
    </div>
  );
}
