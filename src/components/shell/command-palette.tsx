"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCommandPalette } from "./command-palette-context";
import { Icon } from "./icon";
import { Chevron } from "@/components/logo";
import { navFor, type NavItem } from "./nav";
import { searchAllJobs } from "@/app/actions/workboard";
import { SEARCH_MIN, jobSearchTerm } from "@/lib/workboard/work-search";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import type { Role } from "@/lib/roles-shared";
import type { Capability } from "@/lib/permissions";

/** How long typing pauses before the mirror is asked. A query per letter is
    a round trip per letter, and only the last one is ever read. */
const JOB_SEARCH_DELAY_MS = 250;

/** One list, top to bottom: the arrow keys walk screens and jobs alike. */
type Row =
  | { kind: "screen"; key: string; href: string; screen: NavItem }
  | { kind: "job"; key: string; href: string; job: AllJobsMirrorJob };

const NO_JOBS: AllJobsMirrorJob[] = [];

/** A job opens where its card lives: the Workboard, on the jobs side, with
    this job's sheet up — found in the board's window or past it. */
const jobHref = (job: AllJobsMirrorJob) =>
  `/dashboard/workboard?job=${encodeURIComponent(job.remoteId)}`;

export function CommandPalette({
  role,
  caps,
}: {
  role: Role | null;
  caps: readonly Capability[];
}) {
  /* open/close live in context rather than props — this is a SERVER slot (it
     needs the viewer's capabilities to build the entry list), so it cannot
     receive client state or a callback from the frame around it. */
  const { isOpen: open, close: onClose } = useCommandPalette();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [selRaw, setSel] = useState(0);

  /* JOBS, for whoever can open the Workboard. The search behind it checks
     the same grant; asking here only spares everyone else a round trip that
     has to come back empty. */
  const findsJobs = caps.includes("workboard");
  /* The answer, with the term it answers. A list is only shown under the
     question it was asked for, so a slow answer can never paint itself under
     a box that has moved on — and the sequence below means only the newest
     question may answer at all. */
  const [jobs, setJobs] = useState<{ term: string; rows: AllJobsMirrorJob[] } | null>(null);
  const jobSeq = useRef(0);
  const jobTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const term = findsJobs ? jobSearchTerm(query) : "";
  const asksJobs = term.length >= SEARCH_MIN;
  const jobsSettled = !asksJobs || jobs?.term === term;
  const jobRows = asksJobs && jobs?.term === term ? jobs.rows : NO_JOBS;

  const screens = useMemo(() => {
    const q = query.trim().toLowerCase();
    return navFor({ caps: new Set(caps), role }).filter(
      (n) => !q || `${n.label} ${n.hint}`.toLowerCase().includes(q)
    );
  }, [query, role, caps]);

  const rows = useMemo<Row[]>(
    () => [
      ...screens.map((s): Row => ({ kind: "screen", key: `screen:${s.key}`, href: s.href, screen: s })),
      ...jobRows.map((j): Row => ({ kind: "job", key: `job:${j.remoteId}`, href: jobHref(j), job: j })),
    ],
    [screens, jobRows]
  );

  /* The highlighted row, clamped as you read it rather than corrected after the
     fact. Typing shortens the list, which can strand the selection past the
     end; an effect that wrote the selection back would render the stale row
     once before fixing it. Derived, it is never wrong for even one frame. */
  const sel = rows.length ? Math.min(selRaw, rows.length - 1) : 0;

  /* Reopening starts clean. Done while rendering the change rather than in an
     effect: this is state derived from `open`, and an effect would paint the
     previous session's query for a frame first. The palette stays mounted when
     closed (it animates on a class), so without this the old text would still
     be sitting there next time. */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setSel(0);
    }
  }

  // focusing the input is a DOM effect, and stays one
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open]);

  /* Closing abandons whatever was on its way: the timer goes, and the
     sequence moves on so an answer already in flight lands on nothing. */
  useEffect(() => {
    if (!open) return;
    return () => {
      if (jobTimer.current) clearTimeout(jobTimer.current);
      jobSeq.current += 1;
    };
  }, [open]);

  /* Asked from the change handler, not an effect: the effect version sets
     state in an effect body, and the Workboard's own box learned that first. */
  const ask = (q: string) => {
    setQuery(q);
    setSel(0);
    if (!findsJobs) return;
    if (jobTimer.current) clearTimeout(jobTimer.current);
    const mine = ++jobSeq.current;
    const wanted = jobSearchTerm(q);
    if (wanted.length < SEARCH_MIN) return;
    jobTimer.current = setTimeout(() => {
      void searchAllJobs(wanted)
        .then((found) => {
          if (mine === jobSeq.current) setJobs({ term: wanted, rows: found });
        })
        /* A failed ask answers "none", or the list would say it was still
           searching for as long as the palette stayed open. */
        .catch(() => {
          if (mine === jobSeq.current) setJobs({ term: wanted, rows: [] });
        });
    }, JOB_SEARCH_DELAY_MS);
  };

  /* Declared ABOVE the key handler, and memoised, because it is one of its
     dependencies. As a bare function declaration it was a new value every
     render — hoisting made it reachable from the effect, which is exactly why
     the missing dependency went unnoticed — and naming it in the array would
     then have torn down and re-added the window listener on every keystroke,
     since `query` re-renders this component as you type. */
  const run = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router]
  );

  useEffect(() => {
    if (!open) return;
    /* The arrow keys can walk past the list's fold now that jobs make it
       long, so the row they land on is brought into view. Only the keys do
       this: scrolling under a resting pointer would hand the hover to the
       next row, and that row would scroll again. */
    const pick = (next: number) => {
      setSel(next);
      listRef.current?.querySelectorAll<HTMLElement>(".crow")[next]?.scrollIntoView?.({ block: "nearest" });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rows.length) pick((sel + 1) % rows.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rows.length) pick((sel - 1 + rows.length) % rows.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const row = rows[sel];
        if (row) run(row.href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, rows, sel, onClose, run]);

  return (
    <div className={`fg-cmd${open ? " open" : ""}`} id="fg-cmd">
      <div className="ov" onClick={onClose} />
      <div className="box">
        <div className="cin">
          <span className="ci">
            <Icon name="search" size={20} />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => ask(e.target.value)}
            placeholder={findsJobs ? "Search screens and jobs…" : "Jump to a screen…"}
            aria-label={findsJobs ? "Search screens and jobs" : "Jump to a screen"}
            autoComplete="off"
          />
          <kbd className="esc">ESC</kbd>
        </div>

        <div className="clist no-sb" id="fg-cmd-list" ref={listRef}>
          {rows.length === 0 ? (
            /* Says what it is doing while the jobs are still being asked
               for, and what it looked through once they have answered —
               never "no match" before the mirror has had its say. */
            <div className="cempty">
              <b>
                {!jobsSettled
                  ? "Searching jobs…"
                  : asksJobs
                    ? <>No screen or job matches &ldquo;{query}&rdquo;</>
                    : <>No screen matches &ldquo;{query}&rdquo;</>}
              </b>
            </div>
          ) : (
            rows.map((r, i) => (
              <Fragment key={r.key}>
                {/* "Navigate" — which is also what the footer calls moving the
                    selection with the arrow keys. One word, two meanings, six
                    inches apart. These name what the rows ARE; the jobs are
                    ServiceM8's, which is whose numbers they carry. */}
                {i === 0 && r.kind === "screen" && <div className="cgl">Screens</div>}
                {i === screens.length && r.kind === "job" && <div className="cgl">ServiceM8 jobs</div>}
                <button
                  className={`crow${i === sel ? " on" : ""}`}
                  onMouseMove={() => i !== sel && setSel(i)}
                  onClick={() => run(r.href)}
                  type="button"
                >
                  {r.kind === "screen" ? (
                    <>
                      <span className="ci2" style={{ background: `${r.screen.accent}15` }}>
                        <span style={{ color: r.screen.accent, display: "flex" }}>
                          <Icon name={r.screen.icon} size={17} />
                        </span>
                      </span>
                      <span className="ck">
                        <b>{r.screen.label}</b>
                        <em>{r.screen.hint}</em>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="ci2 job">
                        <Icon name="file" size={17} />
                      </span>
                      <span className="ck">
                        <b>
                          {r.job.jobNumber && <span className="cno">#{r.job.jobNumber}</span>}
                          {r.job.jobNumber && " "}
                          {r.job.clientName ?? "Unnamed client"}
                        </b>
                        <em>{r.job.description ?? r.job.suburb ?? "No description"}</em>
                      </span>
                      <span className="cst">{r.job.status ?? "Job"}</span>
                    </>
                  )}
                  <span className="cen">
                    <Icon name="cornerDL" size={14} />
                  </span>
                </button>
              </Fragment>
            ))
          )}
        </div>

        <div className="cfoot">
          <div className="cf-l">
            <span style={{ display: "flex" }}>
              <Icon name="arrowUp" size={9} />
              <Icon name="arrowDown" size={9} />
            </span>{" "}
            Navigate,{" "}
            <span style={{ display: "flex" }}>
              <Icon name="cornerDL" size={9} />
            </span>{" "}
            Select
          </div>
          <div className="cf-r">
            {/* The mark, not a sparkle. This corner signs the palette, and it
                was signing it with the badge every AI tool in the market wears
                — beside the word HeyTiff, which is the one thing here that is
                actually ours. `decorative` because that word already says it:
                the mark defaults to an aria-label of "HeyTiff" and would have
                the footer read "HeyTiff HeyTiff". */}
            <span style={{ display: "flex" }}>
              <Chevron size={15} gradient decorative />
            </span>{" "}
            {/* was "HeyTiff Command" — there are no commands in it */}
            HeyTiff
          </div>
        </div>
      </div>
    </div>
  );
}
