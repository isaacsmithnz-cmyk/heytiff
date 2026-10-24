"use client";

import { quoteHref } from "@/lib/shell/links";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/shell/icon";
import { Button } from "@/components/parts/button";
import { Fade } from "@/components/parts/fade";
import { Initials } from "@/components/parts/initials";
import { Row, RowList } from "@/components/parts/row";
import { StateWord } from "@/components/parts/state";
import { Empty, Loading, Wrong } from "@/components/parts/states";
import { fmtAuTime, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import type { QuoteFacts } from "@/lib/quotes/quote-card";
import {
  acceptedRows,
  acceptedState,
  landingKind,
  landingMoney,
  progressLine,
  progressState,
  whoWords,
  type LandingState,
  type LandingWhen,
  type QuoteLanding,
} from "@/lib/quotes/quote-landing";

/* THE QUOTE TAB'S LANDING, "QUOTES" (Isaac, 2026-10-18; layout plan
   6-revisions, "The Quote tab opens on a landing"; mock-ups v2-land-first,
   v2-land-progress and v2-land-accepted). The job's one quote in one of
   three states, then ServiceM8's own quote under "Already in ServiceM8":

   - nothing yet: Create a quote (main) and, where ServiceM8 has quoted,
     Update ServiceM8's quote (second);
   - in progress: its card, with its name, version, total so far, a state
     word, who is on it with Tiff and when, and Continue;
   - accepted: its versions and variations under it, newest first, Continue
     on the variation still open, Open on the rest, and Start a variation.

   One quote: a second, separate quote on a job isn't in the data yet, so
   there is no New quote. Every door is the quote page as it stands: it has
   no entry yet for one version or one variation, so Open, Continue and
   Start a variation land on it, where its rail and Update quote take over.
   The money shows only where the server sent it, to a reader with money
   access (quote-landing.ts); ServiceM8's figure only to a reader who sees
   money (sm8-quote-of.ts). For everyone on the Workboard, techs too
   (Isaac, 2026-10-12: "For techs who are quoting a job"). */

const ROUTE = "/api/workboard/quote-status";

/** ServiceM8's own quote on the job: the PDF it generated, the day it went,
    and what it came to for a reader who sees money. */
export type Sm8Quote = {
  papers: JobMediaItem[];
  sentOn: string | null;
  /** Already worded, "$45,430 inc GST"; null without the money grant. */
  value: string | null;
  /** The same, as money, on the basis ServiceM8 holds it; null without the
      money grant. */
  quoted?: { cents: number; basis: "ex" | "inc" } | null;
};

const WHEN: LandingWhen = { day: fmtAuWeekdayDayMonth, time: (at) => fmtAuTime(new Date(at)) };

const quotePage = (job: string, start = false) => quoteHref(job, { start });

function State({ state }: { state: LandingState }) {
  return (
    <span className="qland-state">
      <StateWord tone={state.tone}>{state.word}</StateWord>
      {state.rest && <span className="qland-rest">{state.rest}</span>}
    </span>
  );
}

function Who({ name, words }: { name: string | null; words: string }) {
  if (!words) return null;
  return (
    <span className="qland-who">
      {name && <Initials name={name} size={24} beside />}
      <span>{words}</span>
    </span>
  );
}

export function JobQuoteCard({
  job,
  visible,
  sm8 = null,
  onOpenPaper,
}: {
  /** The job card's uuid, or the row's until the record read lands. */
  job: string;
  /** Read where the quote stands only once the section is opened. */
  visible: boolean;
  sm8?: Sm8Quote | null;
  onOpenPaper?: (item: JobMediaItem) => void;
}) {
  /* undefined while it's read; null when the read failed */
  const [read, setRead] = useState<{ facts: QuoteFacts; landing: QuoteLanding | null } | null | undefined>(undefined);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    Promise.resolve()
      .then(() => fetch(`${ROUTE}?job=${encodeURIComponent(job)}&landing=1`))
      .then((r) => r.json() as Promise<{ ok: boolean; facts?: QuoteFacts; landing?: QuoteLanding }>)
      .then((a) => live && setRead(a.ok && a.facts ? { facts: a.facts, landing: a.landing ?? null } : null))
      .catch(() => live && setRead(null));
    return () => {
      live = false;
    };
  }, [visible, job, reads]);

  const sm8Quoted = !!sm8 && (sm8.papers.length > 0 || !!sm8.sentOn);
  const sentLine = sm8?.sentOn ? `Sent to the client ${fmtAuWeekdayDayMonth(sm8.sentOn)}` : "Not sent yet";
  const sm8Value = sm8?.value ? <span className="qland-fig">{sm8.value}</span> : null;
  const sm8Block = sm8Quoted ? (
    <section className="qland-sm8" aria-labelledby="qland-sm8-label">
      <p className="qland-label" id="qland-sm8-label">
        Already in ServiceM8
      </p>
      <div className="qland-card qland-card--rows">
        <RowList label="ServiceM8's quote">
          {sm8.papers.length === 0 ? (
            <Row lead={<Icon name="file" size={16} />} name="ServiceM8's quote" line={sentLine} end={sm8Value} />
          ) : (
            sm8.papers.map((p) => (
              <Row
                key={p.remoteId}
                lead={<Icon name="file" size={16} />}
                name={sm8.papers.length > 1 ? p.name : "ServiceM8's quote"}
                line={sentLine}
                end={
                  <span className="qland-end">
                    {sm8Value}
                    <Button kind="quiet" size={32} onClick={() => onOpenPaper?.(p)} aria-label={`Open the PDF, ${p.name}`}>
                      Open the PDF
                    </Button>
                  </span>
                }
              />
            ))
          )}
        </RowList>
      </div>
    </section>
  ) : null;

  let body: ReactNode;
  if (read === undefined) body = <Loading what="Reading the quote" shape="card" />;
  else if (read === null)
    body = (
      <div className="qland-card">
        <Wrong
          word="The quote wasn't read"
          means="Where the quote stands couldn’t be read."
          action={
            <Button kind="second" onClick={() => setReads((n) => n + 1)}>
              Read the quote again
            </Button>
          }
        />
      </div>
    );
  else body = <Quote job={job} facts={read.facts} landing={read.landing} sm8Quoted={sm8Quoted} />;

  return (
    <div className="qland">
      <h2 className="qland-title">Quotes</h2>
      {body}
      {sm8Block}
    </div>
  );
}

function Quote({ job, facts, landing, sm8Quoted }: { job: string; facts: QuoteFacts; landing: QuoteLanding | null; sm8Quoted: boolean }) {
  const kind = landingKind(facts);
  if (kind === "first")
    return (
      <div className="qland-card qland-first">
        <Empty
          what="No quote in HeyTiff yet"
          action={
            <>
              <Button kind="main" href={quotePage(job, true)}>
                Create a quote
              </Button>
              {sm8Quoted && <Button href={quotePage(job, true)}>Update ServiceM8&rsquo;s quote</Button>}
            </>
          }
        />
      </div>
    );

  const name = landing?.name || "Quote";
  const total = landing?.totalCents ?? null;

  if (kind === "progress")
    return (
      <article className="qland-card" aria-label={name}>
        <div className="qland-top">
          <div className="qland-id">
            <h3 className="qland-name">
              <Fade lines={2}>{name}</Fade>
            </h3>
            <p className="qland-line">{progressLine(facts, landing ?? { startedAt: null }, WHEN)}</p>
          </div>
          {total != null && (
            <p className="qland-sum">
              <b>{landingMoney(total)}</b>
              <span>{facts.approved ? "ex GST" : "ex GST, so far"}</span>
            </p>
          )}
        </div>
        <div className="qland-foot">
          <State state={progressState(facts, WHEN)} />
          <Who name={landing?.who?.name ?? null} words={whoWords(landing?.who ?? null, facts.talked, WHEN)} />
          <Button kind="main" href={quotePage(job)}>
            Continue
          </Button>
        </div>
      </article>
    );

  /* accepted: its versions and variations, newest first */
  const rows = landing ? acceptedRows(facts, landing, WHEN) : [];
  const live = rows.find((r) => r.open)?.key ?? null;
  const money = landing?.money ?? false;
  return (
    <article className="qland-card" aria-label={name}>
      <div className="qland-top">
        <div className="qland-id">
          <h3 className="qland-name">
            <Fade lines={2}>{name}</Fade>
          </h3>
          <p className="qland-line">
            <State state={acceptedState(facts, landing ?? { acceptedAt: null }, WHEN)} />
          </p>
        </div>
        {total != null && (
          <p className="qland-sum">
            <b>{landingMoney(total)}</b>
            <span>ex GST</span>
          </p>
        )}
      </div>
      {rows.length > 0 && (
        <div className="qland-rows">
          <RowList label="Versions and variations">
            {rows.map((r) => (
              <Row
                key={r.key}
                name={r.title}
                line={<State state={r.state} />}
                end={
                  <span className="qland-end">
                    {r.who && <Who name={r.who} words={r.who} />}
                    {r.cents != null && <span className="qland-fig">{landingMoney(r.cents, r.signed)}</span>}
                    <Button kind={r.key === live ? "main" : "quiet"} size={32} href={quotePage(job)} aria-label={`${r.open ? "Continue" : "Open"} ${r.title.toLowerCase()}`}>
                      {r.open ? "Continue" : "Open"}
                    </Button>
                  </span>
                }
              />
            ))}
          </RowList>
        </div>
      )}
      {money && (
        <div className="qland-acts">
          <Button kind={live ? "second" : "main"} href={quotePage(job)}>
            Start a variation
          </Button>
        </div>
      )}
    </article>
  );
}
