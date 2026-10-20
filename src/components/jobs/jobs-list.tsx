"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { Button, IconButton } from "@/components/parts/button";
import { Chooser, type ChooserOption } from "@/components/parts/chooser";
import { Empty } from "@/components/parts/states";
import { Fade } from "@/components/parts/fade";
import { TextInput } from "@/components/parts/field";
import { Initials } from "@/components/parts/initials";
import { Dot, StateWord } from "@/components/parts/state";
import { ViewTabs } from "@/components/parts/tabs";
import { RecordLink } from "@/components/records/record-link";
import { sm8Gap } from "@/components/workboard/board/sm8-gap";
import { fmtAud } from "@/lib/workboard/project-money";
import type { JobsListData } from "@/lib/workboard/jobs-list-query";
import {
  ANYONE,
  NOBODY,
  peopleOf,
  rowsFor,
  sortRows,
  sortsFor,
  viewCounts,
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

function JobRow({ row, money }: { row: JobsListRow; money: boolean }) {
  return (
    <li>
      <RecordLink href={row.href} className="jl-row">
        <span className="jl-cell jl-num">
          {row.number && <span className="jl-numv">{row.number}</span>}
          {row.numberOurs && <span className="jl-sub">HeyTiff</span>}
        </span>
        <span className="jl-cell jl-client">
          <Fade className="jl-name">{row.client}</Fade>
          {row.site && <Fade className="jl-sub">{row.site}</Fade>}
        </span>
        <span className="jl-cell jl-kind">
          <Dot hue={row.hue} />
          <Fade>{row.kind}</Fade>
        </span>
        <span className="jl-cell jl-state">
          <StateWord tone={row.tone}>{row.state}</StateWord>
        </span>
        <span className="jl-cell jl-next">
          <Fade>{row.next}</Fade>
        </span>
        <span className="jl-cell jl-who">
          {row.who.length > 0 ? (
            <span className="jl-discs">
              {row.who.map((n) => (
                <Initials key={n} name={n} size={24} />
              ))}
            </span>
          ) : (
            <span className="jl-sub">Nobody yet</span>
          )}
        </span>
        {money && <span className="jl-cell jl-value">{row.valueCents !== null ? fmtAud(row.valueCents) : ""}</span>}
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
    "to-invoice": "Nothing to invoice",
    owed: "Nothing owed on finished work",
    projects: "No projects running",
    agreements: "No service agreements",
  };
  if (state.view === "all") return <Empty what={words.all} line="Make one with New." action={null} />;
  return <Empty what={words[state.view]} action={allJobs} />;
}

export function JobsList({ data, initial }: { data: JobsListData; initial: ListState }) {
  const [state, setState] = useState<ListState>(initial);
  const money = data.moneyVisible;

  const go = (next: Partial<ListState>) => {
    const s = { ...state, ...next };
    setState(s);
    if (typeof window !== "undefined") window.history.replaceState(null, "", withListState(window.location.href, s));
  };

  const open = viewCounts(data.rows, { who: ANYONE, q: "" }).all;
  const views = viewsFor(money);
  const shown = sortRows(rowsFor(data.rows, state), state.sort);
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
          <h1>Jobs</h1>
          <span className="jl-open">{open} open</span>
        </div>
        <div className="jl-search" role="search">
          <span className="jl-search-icon" aria-hidden="true">
            <Icon name="search" size={16} />
          </span>
          <TextInput
            className="jl-search-input"
            aria-label="Search jobs, clients and sites"
            placeholder="Search jobs, clients and sites"
            value={state.q}
            onChange={(e) => go({ q: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape" && state.q) go({ q: "" });
            }}
          />
          {state.q && <IconButton glyph="clear" label="Clear the search box" size={32} className="jl-search-clear" onClick={() => go({ q: "" })} />}
        </div>
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
              <span className="jl-cell">Client and site</span>
              <span className="jl-cell">Kind</span>
              <span className="jl-cell">Where it&apos;s up to</span>
              <span className="jl-cell">Next</span>
              <span className="jl-cell">Who</span>
              {money && <span className="jl-cell jl-value">Value</span>}
            </div>
            <ul className="jl-rows" aria-label={`${viewLabel}, ${shown.length} ${shown.length === 1 ? "job" : "jobs"}`}>
              {shown.map((r) => (
                <JobRow key={r.key} row={r} money={money} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
