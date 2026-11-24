"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/parts/button";
import { Chooser, type ChooserOption } from "@/components/parts/chooser";
import { Empty } from "@/components/parts/states";
import { Fade } from "@/components/parts/fade";
import { SearchField } from "@/components/parts/search-field";
import { StateWord } from "@/components/parts/state";
import { ViewTabs } from "@/components/parts/tabs";
import { RecordLink } from "@/components/records/record-link";
import { Icon } from "@/components/shell/icon";
import { jobPageHref } from "@/lib/shell/links";
import { sm8Gap } from "@/components/workboard/board/sm8-gap";
import { fmtAud } from "@/lib/workboard/project-money";
import type { JobsListData } from "@/lib/workboard/jobs-list-query";
import { unpackRows, type PackedRow } from "@/lib/workboard/jobs-list-wire";
import {
  ANYONE,
  NOBODY,
  peopleOf,
  rowsFor,
  sortRows,
  sortsFor,
  viewsFor,
  withListState,
  type JobSort,
  type JobView,
  type JobsListRow,
  type ListState,
} from "@/lib/workboard/jobs-list";

/* JOBS (v2, step 5; the board v2-board-jobs). The title with what's open
   beside it, the search on the right; the seven views as soft tabs (rule
   29), with Who and Sort beside them; then the table, one row per job
   (rule 39), each row the door to the job.

   The state is the address: `?view=`, `?who=`, `?sort=`, `?q=`, written
   with replaceState as it changes, so an open tab holds it and nothing is
   asked of the server again. The rows came with the page, and narrowing
   them is done here. */

const PANEL = "jl-panel";

/* A ROW READS LIKE THE JOB'S OWN PAGE (Isaac, 17 November 2026, the
   first-look fixes, https://claude.ai/artifact/7ijojbkVbMJUGasurPCvVF: "the
   job card changes to match are good"). The coloured outline went: the
   number sits in the 40-high square of its colour that heads a job's page,
   the client beside it and the kind and the suburb on one line under, so a
   row is two lines, not three. Who went as a column of initials: whoever is
   on it is said by first name under Next. */
const firstNames = (names: readonly string[]): string => {
  const first = names.map((n) => n.trim().split(/\s+/)[0]).filter(Boolean);
  if (first.length <= 1) return first[0] ?? "";
  return `${first.slice(0, -1).join(", ")} and ${first[first.length - 1]}`;
};

/* A JOB YOU STARRED carries a filled star at its row's end, in ink (Isaac,
   24 November 2026, the Star a job mock: "a starred job carries the star at
   the end of its row"). The star is yours: someone else's never shows. */
function JobRow({ row, money, starred }: { row: JobsListRow; money: boolean; starred: boolean }) {
  const crew = firstNames(row.who);
  const line = [row.kind, row.site].filter(Boolean).join(", ");
  return (
    <li>
      <RecordLink href={row.href} className="jl-row">
        <span className="jl-cell jl-job">
          <span className={`jl-card jl-card--${row.hue}`}>
            {row.number && (
              <span className="jl-cn">
                {row.number}
                {row.numberOurs && <span className="jl-cn-ours">HeyTiff</span>}
              </span>
            )}
            <span className="jl-cb">
              <Fade className="jl-name">{row.client}</Fade>
              {line && <Fade className="jl-sub">{line}</Fade>}
            </span>
          </span>
        </span>
        <span className="jl-cell jl-state">
          <StateWord tone={row.tone}>{row.state}</StateWord>
        </span>
        <span className="jl-cell jl-next">
          <Fade className="jl-when">{row.next}</Fade>
          {crew && <Fade className="jl-sub">{crew}</Fade>}
        </span>
        {money && <span className="jl-cell jl-value">{row.valueCents !== null ? fmtAud(row.valueCents) : ""}</span>}
        <span className="jl-cell jl-star">
          {starred && (
            <span role="img" aria-label="Starred">
              <Icon name="star" size={18} />
            </span>
          )}
        </span>
      </RecordLink>
    </li>
  );
}

/** What an empty view says (rule 40): what's missing, and the way on. */
function Nothing({
  data,
  state,
  inView,
  go,
}: {
  data: JobsListData;
  state: ListState;
  /** the view's rows before the person and the search narrow them */
  inView: number;
  go: (next: Partial<ListState>) => void;
}) {
  const allJobs = (
    <Button kind="second" onClick={() => go({ view: "all" })}>
      See all jobs
    </Button>
  );
  if (data.rows.length === 0) {
    const gap = sm8Gap({ connected: data.connected, syncing: data.syncing });
    if (gap === "connect")
      return (
        <Empty
          what="ServiceM8 isn't connected"
          line="Connect it and its jobs, quotes and bookings come in here."
          action={data.manage ? <Button kind="main" href="/dashboard/admin/integrations/servicem8">Connect ServiceM8</Button> : null}
        />
      );
    if (gap === "syncing")
      return <Empty what="Bringing the jobs across from ServiceM8" line="The first sync is walking the account, and the list fills in as it goes." action={null} />;
  }
  if (inView > 0 && state.q)
    return (
      <Empty
        what={`No jobs here match "${state.q}"`}
        action={
          <Button kind="second" onClick={() => go({ q: "" })}>
            Clear the search
          </Button>
        }
      />
    );
  if (inView > 0)
    return (
      <Empty
        what={state.who === NOBODY ? "Everyone here has somebody on it" : "Nothing here for this person"}
        action={
          <Button kind="second" onClick={() => go({ who: ANYONE })}>
            Show everyone&apos;s jobs
          </Button>
        }
      />
    );
  const words: Record<JobView, string> = {
    all: "No open jobs",
    "to-book": "Every work order has a day",
    quotes: "No quotes waiting on an answer",
    ready: "No quotes marked ready to send",
    "to-invoice": "Nothing to invoice",
    owed: "Nothing owed on finished work",
    projects: "No projects running",
    agreements: "No service agreements",
  };
  if (state.view === "all") return <Empty what={words.all} line="Make one with New." action={null} />;
  return <Empty what={words[state.view]} action={allJobs} />;
}

/* A HUNDRED AT A TIME (Isaac, 25 October 2026: Jobs took two seconds to
   open, and all 971 rows were drawn in the page, 1.4 MB of it). A view draws
   its first hundred and Show more draws the next; the views, Who, Sort and
   the search still read every job, because they work on the rows' data, not
   on what is drawn. A change of view, person, sort or search starts again at
   a hundred. */
export const JOBS_PAGE = 100;

/** The page's door: the rows come packed (lib/workboard/jobs-list-wire) and
    are unpacked once, here, into the rows everything else reads. */
export function JobsListPage({ data, initial }: { data: Omit<JobsListData, "rows"> & { rows: PackedRow[] }; initial: ListState }) {
  const rows = useMemo(() => unpackRows(data.rows), [data.rows]);
  return <JobsList data={{ ...data, rows }} initial={initial} />;
}

export function JobsList({ data, initial }: { data: JobsListData; initial: ListState }) {
  const [state, setState] = useState<ListState>(initial);
  const money = data.moneyVisible;
  /* your stars, by the page each row opens */
  const stars = useMemo(() => new Set((data.starred ?? []).map((id) => jobPageHref(id))), [data.starred]);

  const go = (next: Partial<ListState>) => {
    const s = { ...state, ...next };
    setState(s);
    if (typeof window !== "undefined") window.history.replaceState(null, "", withListState(window.location.href, s));
  };

  const views = viewsFor(money);
  const shown = sortRows(rowsFor(data.rows, state), state.sort);
  const scope = `${state.view}|${state.who}|${state.sort}|${state.q}`;
  const [paged, setPaged] = useState({ scope, pages: 1 });
  const pages = paged.scope === scope ? paged.pages : 1;
  const drawn = shown.slice(0, JOBS_PAGE * pages);
  const inView = rowsFor(data.rows, { view: state.view, who: ANYONE, q: "" }).length;
  const viewLabel = views.find((v) => v.key === state.view)?.label ?? "All";

  const people = peopleOf(data.rows);
  const whoOptions: ChooserOption[] = [
    { value: ANYONE, label: "Anyone" },
    { value: NOBODY, label: "Nobody yet" },
    ...people,
  ];
  if (!whoOptions.some((o) => o.value === state.who)) whoOptions.push({ value: state.who, label: state.who });
  const sortOptions: ChooserOption[] = sortsFor(money).map((s) => ({ value: s.key, label: s.label }));

  return (
    <div className="jl">
      <header className="jl-head">
        <div className="jl-title">
          {/* no count beside the title (rule 29, Isaac, 20 October: "We need
              to rule it out everywhere"): "969 open" was one */}
          <h1>Jobs</h1>
        </div>
        <SearchField className="jl-search" label="Search jobs, clients and sites" value={state.q} onChange={(q) => go({ q })} />
      </header>

      <div className="jl-bar">
        <ViewTabs
          ariaLabel="Views of the jobs"
          idPrefix="jl-view"
          panelPrefix={PANEL}
          current={state.view}
          onGo={(key) => go({ view: key as JobView })}
          items={views.map((v) => ({ key: v.key, label: v.label }))}
        />
        <div className="jl-picks">
          <div className="jl-pick">
            <span className="jl-pick-word" aria-hidden="true">
              Who
            </span>
            <Chooser aria-label="Who" className="jl-pick-ch" options={whoOptions} value={state.who} onChange={(v) => go({ who: v })} />
          </div>
          <div className="jl-pick">
            <span className="jl-pick-word" aria-hidden="true">
              Sort
            </span>
            <Chooser aria-label="Sort" className="jl-pick-ch" options={sortOptions} value={state.sort} onChange={(v) => go({ sort: v as JobSort })} />
          </div>
        </div>
      </div>

      <div role="tabpanel" id={`${PANEL}-${state.view}`} aria-labelledby={`jl-view-${state.view}`} className="jl-panel">
        {data.truncated && state.view === "all" && (
          <p className="jl-note">Showing the newest open jobs: this account has more than one list carries. Search reaches all of them.</p>
        )}
        {shown.length === 0 ? (
          <Nothing data={data} state={state} inView={inView} go={go} />
        ) : (
          <div className={money ? "jl-table jl-table--money" : "jl-table"}>
            <div className="jl-row jl-row--head" aria-hidden="true">
              <span className="jl-cell">Job</span>
              <span className="jl-cell">Where it&apos;s up to</span>
              <span className="jl-cell">Next</span>
              {money && <span className="jl-cell jl-value">Value</span>}
              <span className="jl-cell" />
            </div>
            <ul className="jl-rows" aria-label={`${viewLabel}, ${shown.length} ${shown.length === 1 ? "job" : "jobs"}`}>
              {drawn.map((r) => (
                <JobRow key={r.key} row={r} money={money} starred={stars.has(r.href.split("?")[0] ?? r.href)} />
              ))}
            </ul>
            {drawn.length < shown.length && (
              <div className="jl-more">
                <Button onClick={() => setPaged({ scope, pages: pages + 1 })}>Show more</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
