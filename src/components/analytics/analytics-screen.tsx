"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button, LinkButton } from "@/components/parts/button";
import { Dot } from "@/components/parts/state";
import { Empty, Wrong } from "@/components/parts/states";
import { ViewTabs } from "@/components/parts/tabs";
import {
  change,
  daysBetween,
  longDay,
  money,
  pct,
  PERIODS,
  type AnalyticsJob,
  type JobAnalytics,
  type LostWhy,
  type PeriodKey,
} from "@/lib/analytics/job-analytics";
import { DaysToYes, EnquiriesChart, KIND_COLOUR, PriceTable, RateBars, STEP_COLOUR } from "./analytics-charts";
import { ToDecide } from "./analytics-decide";
import { useKeptOpen, useMarkLost, useVoids, VoidList, type KeepOpen } from "./analytics-jobs";
import "./analytics.css";

/* REPORTS (v2; it was Analytics) — the business's own jobs, read off
   ServiceM8's copy (docs/job-analytics-plan.md; the mock-up Isaac approved
   2026-10-07), in v2's layout: the head (the title, the dates as its fact
   line, the period on the right as a tray of links, so the address keeps
   it), the three views as soft tabs (rule 29), then each view on the white
   page in groups under thin lines. The figures are figures with their words
   (rule 14: one big one, the win rate; the rest at 20), the tables tables.

   Every number, query and gate is today's: the page reads it all
   (dashboard/analytics/page.tsx, `workboard_money`), and nothing here
   counts anything but how many of a list there are. */

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
      /** an owner may mark a Quote Unsuccessful in ServiceM8 */
      lostWrites?: "on" | "trial" | null;
    };

type Tab = "overview" | "quotes" | "decide";

const TAB_ID = "st2-rp-tab";
const PANEL_ID = "st2-rp-panel";

export function AnalyticsScreen({ state, period }: { state: AnalyticsState; period: PeriodKey }) {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div className="page in">
      <div className="wrap st2-rp">
        <header className="st2-rp-head">
          <div className="st2-id">
            <h1 className="st2-h1">Reports</h1>
            {state.kind === "ready" && (
              <p className="st2-facts">Quotes on jobs raised {spanWords(state.data)}, against the same days a year earlier.</p>
            )}
          </div>
          {state.kind === "ready" && <PeriodPicker period={period} />}
        </header>

        <ViewTabs
          ariaLabel="Reports"
          idPrefix={TAB_ID}
          panelPrefix={PANEL_ID}
          current={tab}
          onGo={(k) => setTab(k as Tab)}
          items={[
            { key: "overview", label: "Overview" },
            { key: "quotes", label: "Quotes" },
            {
              key: "decide",
              label: "To decide",
              count: state.kind === "ready" ? jobsToDecide(state.data) : 0,
              countLabel: (n) => `${n} ${n === 1 ? "job" : "jobs"} waiting on an answer`,
            },
          ]}
        />

        <section className="st2-rp-panel" id={`${PANEL_ID}-${tab}`} role="tabpanel" aria-labelledby={`${TAB_ID}-${tab}`} tabIndex={-1}>
          {state.kind === "standalone" && (
            <Empty
              what="ServiceM8 isn't connected"
              line="Reports read your quotes and jobs from ServiceM8."
              action={
                <Button kind="main" href="/dashboard/admin/integrations/servicem8">
                  Connect ServiceM8
                </Button>
              }
            />
          )}
          {state.kind === "unread" && <Wrong word="ServiceM8's copy couldn't be read just now" means="Reload the page in a minute." />}
          {state.kind === "ready" && tab === "overview" && (
            <Overview a={state.data} truncated={state.truncated} onDecide={() => setTab("decide")} />
          )}
          {state.kind === "ready" && tab === "quotes" && (
            <Quotes a={state.data} names={state.names ?? {}} canDecide={state.canDecide ?? false} lostWrites={state.lostWrites ?? null} />
          )}
          {state.kind === "ready" && tab === "decide" && (
            <ToDecide
              asks={state.data.toDecide.asks}
              names={state.names ?? {}}
              canDecide={state.canDecide ?? false}
              workOrders={state.workOrders ?? null}
              lostWrites={state.lostWrites ?? null}
              voided={state.data.voided}
              quoteFromCents={state.data.rules.quoteFromCents}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/** One of a few (rule 30), as links: the period is the address's. */
function PeriodPicker({ period }: { period: PeriodKey }) {
  return (
    <nav className="pt-tray st2-rp-period" aria-label="Period">
      {PERIODS.map((p) => (
        <Link
          key={p.key}
          className="pt-tray-opt"
          href={`/dashboard/analytics?period=${p.key}`}
          scroll={false}
          aria-current={p.key === period ? "true" : undefined}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}

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

/** A figure's words: grey, or a change in the colour of what it means (rule 17). */
type Note = { words: string; tone: "" | "ok" | "warn" };

/** A figure set beside the year before: up is good for money. */
function onYear(now: number, before: number): Note {
  const c = change(now, before);
  if (!c) return { words: "Nothing the year before", tone: "" };
  return { words: `${c.words} on the year before`, tone: c.up ? "ok" : "warn" };
}

const noteClass = (n: Note) => (n.tone === "ok" ? "st2-rp-note st2-rp-note--good" : n.tone === "warn" ? "st2-rp-note st2-rp-note--look" : "st2-rp-note");

/** A figure beside the big one: its label, the figure at 20, its words. */
function Fig({ label, value, note }: { label: string; value: string; note: Note }) {
  return (
    <div className="st2-rp-fig">
      <span className="st2-rp-label">{label}</span>
      <span className="st2-rp-value">{value}</span>
      <span className={noteClass(note)}>{note.words}</span>
    </div>
  );
}

function spanWords(a: JobAnalytics) {
  return `${longDay(a.span.from)} to ${longDay(a.span.to)}`;
}

/** A group on the page: its heading at 16, a line of what it holds, then it. */
function Group({ id, heading, say, children }: { id: string; heading: string; say?: string; children?: ReactNode }) {
  return (
    <section className="st2-rp-sec" aria-labelledby={id}>
      <h2 className="st2-rp-h" id={id}>
        {heading}
      </h2>
      {say != null && <p className="st2-rp-say">{say}</p>}
      {children}
    </section>
  );
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
    <div className="st2-rp-face">
      <div className="st2-rp-lede">
        <p className="st2-rp-say">
          Money is ex GST, from each job’s lines in ServiceM8.
          {a.voided.length > 0 && ` ${plural(a.voided.length, "void job is", "void jobs are")} left out.`}
          {truncated && " The account holds more jobs than one read carries, so the oldest are left out."}{" "}
          <LinkButton href="/dashboard/admin/analytics">How jobs are counted</LinkButton>
        </p>
        <ToDecideLine a={a} onDecide={onDecide} />
      </div>

      <section className="st2-rp-top" aria-label="The top line">
        <div className="st2-rp-lead">
          <span className="st2-rp-label">Win rate</span>
          <span className="st2-rp-big">{pct(t.winRate.rate)}</span>
          <div className="st2-rp-meter" aria-hidden="true">
            <span style={{ width: `${((t.winRate.rate ?? 0) * 100).toFixed(1)}%` }} />
          </div>
          <span className="st2-rp-note">
            {t.winRate.won} won of {plural(t.winRate.decided, "decided quote", "decided quotes")}
          </span>
          <span className={noteClass(rateNote)}>{rateNote.words}</span>
          <span className="st2-rp-note">By value, {pct(t.valueRate)}</span>
        </div>
        <div className="st2-rp-figs">
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
        </div>
      </section>

      <Group
        id="st2-rp-h-win"
        heading="Win rate"
        say={
          lapsed.count === 0
            ? `No quote in these dates has gone ${a.rules.lapseAfterDays} days without an answer.`
            : `${plural(lapsed.count, "quote", "quotes")} with no answer after ${a.rules.lapseAfterDays} days ${lapsed.count === 1 ? "counts" : "count"} as lost, ${money(lapsed.cents)} of work.`
        }
      >
        <div className="st2-rp-cols">
          <RateBars title="By job type" bars={a.byKind} colourOf={(k) => KIND_COLOUR[k] ?? "var(--q)"} />
          <RateBars title="By price" bars={a.byPrice} colourOf={(k) => STEP_COLOUR[["lt5", "lt10", "lt20", "rest"].indexOf(k)] ?? STEP_COLOUR[0]!} />
          <RateBars title="By days to quote" bars={a.bySpeed} colourOf={(k) => STEP_COLOUR[3 - ["d1", "d3", "d7", "slow"].indexOf(k)] ?? STEP_COLOUR[0]!} />
        </div>
      </Group>

      <Group
        id="st2-rp-h-price"
        heading="Price by job type"
        say={
          a.prices.length === 0
            ? "No won jobs with a price in these dates."
            : `${plural(a.prices.reduce((s, r) => s + r.jobs, 0), "won job", "won jobs")} with a price.`
        }
      >
        {a.prices.length > 0 && <PriceTable rows={a.prices} />}
      </Group>

      <Group
        id="st2-rp-h-enq"
        heading="Enquiries week by week"
        say={`${plural(a.enquiries.total, "job", "jobs")} raised, against ${a.enquiries.totalBefore.toLocaleString("en-AU")} the year before.`}
      >
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
      </Group>
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
    <div className="st2-rp-todo">
      <Dot hue="orange" />
      <span>
        {jobs > 0 && `${plural(jobs, "job", "jobs")} to decide.`}
        {jobs > 0 &&
          out.jobs > 0 &&
          ` ${out.jobs === jobs ? (jobs === 1 ? "It is" : "They are") : `${out.jobs.toLocaleString("en-AU")} of them, ${money(out.cents)} of work, are`} left out of these figures until then.`}
        {kinds > 0 && `${jobs > 0 ? " " : ""}${plural(kinds, "job has", "jobs have")} no job type: counted, as Not known by type.`}
      </span>
      <Button kind="second" size={32} onClick={onDecide}>
        {jobs > 0 ? `Decide ${plural(jobs, "job", "jobs")}` : "Give job types"}
      </Button>
    </div>
  );
}

/* ── Quotes ── */

function Quotes({
  a,
  names,
  canDecide,
  lostWrites,
}: {
  a: JobAnalytics;
  names: Record<string, string>;
  canDecide: boolean;
  /** an owner may mark a lost Quote Unsuccessful in ServiceM8 */
  lostWrites: "on" | "trial" | null;
}) {
  const voids = useVoids();
  const marks = useMarkLost();
  const keptOpen = useKeptOpen();
  const [review, setReview] = useState(false);
  const [reviewNear, setReviewNear] = useState(false);
  const [showKept, setShowKept] = useState(false);
  const q = a.quotes;
  /* a tender waits longer (Isaac, 2026-10-08: "Do 60 days with option to extend if it's a tender etc") */
  const keptIds = new Set(q.kept.map((j) => j.id));
  const keep = (can: KeepOpen["can"]): KeepOpen => ({ marks: keptOpen, server: (j) => keptIds.has(j.id), can, days: a.rules.tenderAfterDays });
  const whyLost = (id: string) => q.lostJobs.find((l) => l.job.id === id)?.why ?? "marked";
  /* lost with no answer and still a Quote in ServiceM8: the owner can make it Unsuccessful there */
  const stillQuote = (job: AnalyticsJob) => whyLost(job.id) === "lapsed" && (job.status ?? "").trim().toLowerCase() === "quote";
  const toMark = lostWrites ? q.lostJobs.map((l) => l.job).filter((j) => stillQuote(j) && marks.waiting(j) && !keptIds.has(j.id)) : [];
  async function markAll() {
    for (const j of toMark) await marks.mark(j);
  }
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
  const ledger: { why: string; count: number; cents: number }[] = [
    { why: "Marked Unsuccessful in ServiceM8", count: q.unsuccessful.count, cents: q.unsuccessful.cents },
    ...(q.closed.count > 0 ? [{ why: closedWords(a), count: q.closed.count, cents: q.closed.cents }] : []),
    { why: `No answer after ${a.rules.lapseAfterDays} days, still a Quote in ServiceM8`, count: q.lapsed.count, cents: q.lapsed.cents },
  ];

  return (
    <div className="st2-rp-face">
      <p className="st2-rp-say">
        {plural(t.quotes, "quote", "quotes")} on jobs raised {spanWords(a)}: {t.winRate.won.toLocaleString("en-AU")} won,{" "}
        {lost.toLocaleString("en-AU")} lost and {t.open.toLocaleString("en-AU")} still open.
      </p>

      <div className="st2-rp-two">
        <Group id="st2-rp-h-rule" heading="When a quote counts as lost" say={rule}>
          <DaysToYes bins={q.daysToYes} />
          <p className="an-axis">Days from the job being raised to a yes</p>
        </Group>

        <Group id="st2-rp-h-lost" heading={`The ${lost.toLocaleString("en-AU")} lost`}>
          <table className="st2-rp-table">
            <thead>
              <tr>
                <th>Why</th>
                <th className="st2-rp-num">Quotes</th>
                <th className="st2-rp-num">Work</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((r) => (
                <tr key={r.why}>
                  <td>{r.why}</td>
                  <td className="st2-rp-num st2-rp-strong">{r.count.toLocaleString("en-AU")}</td>
                  <td className="st2-rp-num st2-rp-quiet">{money(r.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Group>
      </div>

      {q.lostJobs.length > 0 && (
        <Group id="st2-rp-h-review" heading="Lost, or not a job at all?">
          <div className="st2-rp-acts">
            <Button kind="second" size={32} onClick={() => setReview((r) => !r)} aria-expanded={review}>
              {review ? "Hide the lost quotes" : `Review the ${q.lostJobs.length.toLocaleString("en-AU")} lost`}
            </Button>
            {review && toMark.length > 1 && (
              <Button kind="second" size={32} onClick={() => void markAll()}>
                {`Mark ${toMark.length.toLocaleString("en-AU")} Unsuccessful in ServiceM8`}
              </Button>
            )}
          </div>
          {review && (
            <VoidList
              jobs={q.lostJobs.map((l) => l.job)}
              names={names}
              voids={voids}
              serverVoid={false}
              what={(job) => lostWords(whyLost(job.id), a)}
              canDecide={canDecide}
              keep={keep((job) => whyLost(job.id) !== "marked")}
              markLost={lostWrites ? { marks, can: stillQuote } : undefined}
            />
          )}
        </Group>
      )}

      <Group id="st2-rp-h-open" heading="Open quotes today">
        <div className="st2-rp-figs st2-rp-figs--four">
          <Fig label="To price" value={open.toPrice.toLocaleString("en-AU")} note={{ words: "Nothing priced yet", tone: "" }} />
          <Fig
            label={`Waiting, under ${open.coldAfter} days`}
            value={open.waiting.count.toLocaleString("en-AU")}
            note={{ words: money(open.waiting.cents), tone: "" }}
          />
          <Fig
            label={`Going cold, ${open.coldAfter} to ${a.rules.lapseAfterDays} days`}
            value={open.cold.count.toLocaleString("en-AU")}
            note={{ words: money(open.cold.cents), tone: "" }}
          />
          <Fig
            label={`Reach ${a.rules.lapseAfterDays} days in the next ${open.soonDays}`}
            value={open.lapsingSoon.count.toLocaleString("en-AU")}
            note={{ words: money(open.lapsingSoon.cents), tone: open.lapsingSoon.count > 0 ? "warn" : "" }}
          />
        </div>
        {open.lapsing.length > 0 && (
          <>
            <div className="st2-rp-acts">
              <Button kind="second" size={32} onClick={() => setReviewNear((r) => !r)} aria-expanded={reviewNear}>
                {reviewNear ? "Hide them" : `Review the ${open.lapsing.length.toLocaleString("en-AU")} nearly lost`}
              </Button>
            </div>
            {reviewNear && (
              <VoidList
                jobs={open.lapsing}
                names={names}
                voids={voids}
                serverVoid={false}
                what={(job) => `Open ${daysBetween(job.raisedOn ?? a.span.to, a.span.to)} days, lost at ${keptIds.has(job.id) ? a.rules.tenderAfterDays : a.rules.lapseAfterDays}`}
                canDecide={canDecide}
                keep={keep(() => true)}
              />
            )}
          </>
        )}
      </Group>

      {q.kept.length > 0 && (
        <Group
          id="st2-rp-h-kept"
          heading="Kept open as tenders"
          say={`Lost only after ${a.rules.tenderAfterDays} days with no answer, ServiceM8 closing them or not.`}
        >
          <div className="st2-rp-acts">
            <Button kind="second" size={32} onClick={() => setShowKept((s) => !s)} aria-expanded={showKept}>
              {showKept ? "Hide them" : `Show the ${q.kept.length.toLocaleString("en-AU")} kept open`}
            </Button>
          </div>
          {showKept && (
            <VoidList
              jobs={q.kept}
              names={names}
              voids={voids}
              serverVoid={false}
              what={() => "Kept open as a tender"}
              canDecide={canDecide}
              keep={keep(() => true)}
            />
          )}
        </Group>
      )}
    </div>
  );
}
