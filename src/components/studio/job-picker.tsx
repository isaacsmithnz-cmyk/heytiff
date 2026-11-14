"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/parts/button";
import { Fade } from "@/components/parts/fade";
import { StateWord } from "@/components/parts/state";
import { Icon } from "@/components/shell/icon";
import { openedJobs } from "@/lib/jobs/opened-jobs";
import { streetLine, type JobPrefill, type StudioJobHit } from "@/lib/studio/job-link";
import type { JobSearch } from "./job-search";

/* NEW DESIGN'S JOB PICKER, AS JOB CARDS (Isaac, 14 November 2026, the mock
   "Designs from a job": "Job picker should look more like job cards",
   "Recent jobs at top", and "Both" to the jobs last opened and the newest).
   Under the search sit Recent, the jobs this browser last opened, then All
   jobs, newest number first, with Show more; what's typed replaces both
   with the jobs that match. Each is the Schedule's own card (.sc-card): the
   number in a box of the job's colour, the client, the street, the kind of
   job, and Plans read where Tiff has read plans on it. */

/** Where the picker's two lists come from. */
export type JobLists = {
  /** the jobs named, in the order named */
  recent: (ids: string[]) => Promise<StudioJobHit[]>;
  /** the newest number first, `limit` of them from `from` */
  list: (from: number, limit: number) => Promise<StudioJobHit[]>;
};

/** How many of the last opened jobs New design shows, and All jobs' first lot and each lot after. */
const RECENT_SHOWN = 4;
const FIRST_LOT = 6;
const NEXT_LOT = 12;

/** A job as its card says it. */
export type JobCardFacts = { number: string; client: string; site: string; kind: string; hue: NonNullable<StudioJobHit["hue"]>; plansRead: boolean };

export function cardOfHit(hit: StudioJobHit): JobCardFacts {
  const street = streetLine(hit.address);
  const suburb = (hit.suburb ?? "").trim();
  return {
    number: (hit.jobNumber ?? "").trim(),
    client: (hit.clientName ?? "").trim() || "Job",
    site: [street, suburb].filter(Boolean).join(", "),
    kind: (hit.kind ?? "").trim(),
    hue: hit.hue ?? "grey",
    plansRead: !!hit.plansRead,
  };
}

/** The job a design was opened on (the quote's Design step), as a card: its
    colour and kind arrive once the job is read. */
export function cardOfPrefill(job: JobPrefill, read?: StudioJobHit | null): JobCardFacts {
  if (read) return cardOfHit(read);
  return { number: job.jobNumber, client: job.client || "Job", site: job.site, kind: "", hue: "grey", plansRead: false };
}

/** A job card's inside: the number box, then the client, the street and the kind. */
export function JobCardFace({ job, plans = true }: { job: JobCardFacts; plans?: boolean }) {
  return (
    <>
      {job.number ? <span className="sc-cn">{job.number}</span> : null}
      <span className="sc-cb">
        <Fade className="sc-c1">{job.client}</Fade>
        {job.site ? <Fade className="sc-c2">{job.site}</Fade> : null}
        {job.kind || (plans && job.plansRead) ? (
          <span className="sc-c3">
            {job.kind ? <b>{job.kind}</b> : null}
            {plans && job.plansRead ? (
              <StateWord tone="good" className="sc-cs">
                Plans read
              </StateWord>
            ) : null}
          </span>
        ) : null}
      </span>
    </>
  );
}

function Cards({ label, jobs, onPick }: { label: string; jobs: StudioJobHit[]; onPick: (hit: StudioJobHit) => void }) {
  return (
    <ul className="ds2-nd-cards" aria-label={label}>
      {jobs.map((hit) => {
        const job = cardOfHit(hit);
        return (
          <li key={hit.remoteId}>
            <button
              type="button"
              className={`ds2-nd-card sc-card sc-card--${job.hue}`}
              aria-label={[job.number, job.client, job.site].filter(Boolean).join(", ")}
              onClick={() => onPick(hit)}
            >
              <JobCardFace job={job} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const NONE: StudioJobHit[] = [];

export function JobPicker({ onPick, search, lists }: { onPick: (hit: StudioJobHit) => void; search: JobSearch; lists?: JobLists }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StudioJobHit[]>(NONE);
  const [searching, setSearching] = useState(false);
  const [recent, setRecent] = useState<StudioJobHit[]>(NONE);
  const [all, setAll] = useState<StudioJobHit[]>(NONE);
  /* whether All jobs has more to bring: the last lot came full */
  const [more, setMore] = useState(false);
  const [bringing, setBringing] = useState(false);
  /* every keystroke asks and answers land out of order: only the newest may write */
  const seq = useRef(0);

  useEffect(() => {
    if (!lists) return;
    let live = true;
    const ids = openedJobs().slice(0, RECENT_SHOWN);
    if (ids.length)
      void lists
        .recent(ids)
        .then((jobs) => {
          if (live) setRecent(jobs);
        })
        .catch(() => {});
    void lists
      .list(0, FIRST_LOT)
      .then((jobs) => {
        if (!live) return;
        setAll(jobs);
        setMore(jobs.length === FIRST_LOT);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [lists]);

  const run = useCallback(
    (q: string) => {
      setQuery(q);
      const mine = ++seq.current;
      if (q.trim().length < 2) {
        setHits(NONE);
        setSearching(false);
        return;
      }
      setSearching(true);
      void search(q)
        .then((found) => {
          if (mine === seq.current) setHits(found);
        })
        .catch(() => {
          /* offline, or the search can't be reached: nothing matches */
          if (mine === seq.current) setHits(NONE);
        })
        .finally(() => {
          if (mine === seq.current) setSearching(false);
        });
    },
    [search]
  );

  const showMore = () => {
    if (!lists || bringing) return;
    setBringing(true);
    void lists
      .list(all.length, NEXT_LOT)
      .then((jobs) => {
        const had = new Set(all.map((j) => j.remoteId));
        setAll([...all, ...jobs.filter((j) => !had.has(j.remoteId))]);
        setMore(jobs.length === NEXT_LOT);
      })
      .catch(() => {})
      .finally(() => setBringing(false));
  };

  const typed = query.trim().length >= 2;
  /* a job in Recent isn't said again under All jobs */
  const recentIds = new Set(recent.map((j) => j.remoteId));
  const rest = all.filter((j) => !recentIds.has(j.remoteId));
  const found = hits.length === 1 ? "1 job" : `${hits.length} jobs`;

  return (
    <div className="ds2-nd-pick">
      <div className="ds-sm8-field">
        <label className="ds-sm8-search">
          <Icon name="search" size={15} />
          <input
            type="search"
            value={query}
            data-autofocus
            aria-label="Find a job"
            placeholder="Find a job by number, client or address"
            onChange={(e) => run(e.target.value)}
          />
        </label>
      </div>
      {typed ? (
        <div className="ds2-nd-group">
          <span className="pt-field-label" role="status">
            {hits.length > 0 ? found : searching ? "Searching" : "No jobs match"}
          </span>
          {hits.length > 0 && <Cards label="Jobs found" jobs={hits} onPick={onPick} />}
        </div>
      ) : (
        <>
          {recent.length > 0 && (
            <div className="ds2-nd-group">
              <span className="pt-field-label">Recent</span>
              <Cards label="Recent jobs" jobs={recent} onPick={onPick} />
            </div>
          )}
          {rest.length > 0 && (
            <div className="ds2-nd-group">
              <span className="pt-field-label">All jobs</span>
              <Cards label="All jobs" jobs={rest} onPick={onPick} />
              {more && (
                <span className="ds2-nd-addword">
                  <Button kind="quiet" size={32} disabled={bringing} onClick={showMore}>
                    Show more
                  </Button>
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
