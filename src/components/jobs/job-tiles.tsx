"use client";

import { useId, type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";
import { Tick } from "@/components/parts/tick";
import type { NextVisit, RailTask } from "@/lib/jobs/job-conversation";

/* THE OVERVIEW'S FOUR TILES (Isaac, 22 October 2026, the mock "Job card,
   four tiles": "4 square tiles on left then diary to the right. Tiles are
   summary, next visit, money, to do"), square, two by two, the same four in
   the same place on every job:

     Summary     the job's words as the office wrote them;
     Next visit  its day and time and who is booked, or Nothing booked and
                 Book a visit;
     Money       the figure, where collection stands, one line under it
                 (job-money-block's JobMoneyGlance), for whoever sees money;
     To do       what's open on the job (an ask in a note, a flag: the
                 attention rows, with their own doors), then its open
                 tasks, each a tick, the count in orange while any is
                 open, and Add task.

   Each thing is said once: where the job is up to is the stages line over
   the tiles, the crew is in the diary. A tile with a tab behind it opens it
   from anywhere on the tile (Next visit to Visits, Money to Billing); its
   own buttons and ticks still press on their own. */

function Tile({
  label,
  onOpen,
  aside,
  foot,
  className,
  children,
}: {
  label: string;
  /** Opens the tab behind the tile, from anywhere on it. */
  onOpen?: () => void;
  /** Beside the name, on the right: To do's count. */
  aside?: ReactNode;
  foot?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={["jt", onOpen ? "jt--door" : "", className ?? ""].filter(Boolean).join(" ")} aria-labelledby={id}>
      <h2 className="jt-h">
        {onOpen ? (
          <button type="button" className="jt-open" id={id} onClick={onOpen}>
            {label}
          </button>
        ) : (
          <span id={id}>{label}</span>
        )}
        {aside}
      </h2>
      <div className="jt-fill">{children}</div>
      {foot && <div className="jt-foot">{foot}</div>}
    </section>
  );
}

export function JobTiles({
  what,
  next,
  onVisits,
  onBook,
  money,
  onMoney,
  tasks,
  tasksRead,
  onTick,
  onAddTask,
  open,
  openCount = 0,
}: {
  /** The job's words, as the office wrote them. */
  what: string;
  next: NextVisit | null;
  onVisits: () => void;
  /** Book a visit, where the reader may book. */
  onBook?: () => void;
  /** The Money tile's insides; absent for whoever doesn't see money. */
  money?: ReactNode;
  onMoney?: () => void;
  tasks: RailTask[];
  /** The tasks have been read (empty means none, not not-yet). */
  tasksRead: boolean;
  onTick: (task: RailTask) => void;
  /** Add task, for whoever may set one. */
  onAddTask?: () => void;
  /** What's open on the job, an ask in a note or a flag, above its tasks. */
  open?: ReactNode;
  openCount?: number;
}) {
  const count = tasks.length + openCount;
  return (
    <div className="jt-grid">
      <Tile label="Summary" className="jt--summary">
        {what ? <p className="jt-what">{what}</p> : <p className="jt-cap">Nothing written about the job.</p>}
      </Tile>

      <Tile
        label="Next visit"
        onOpen={onVisits}
        foot={
          !next && onBook ? (
            <Button kind="main" onClick={onBook}>
              Book a visit
            </Button>
          ) : null
        }
      >
        {next ? (
          <>
            <b className="jt-when">{next.when}</b>
            {next.who && <p className="jt-read">{next.who}</p>}
            {next.state && <StateWord tone={next.state.tone}>{next.state.word}</StateWord>}
          </>
        ) : (
          <b className="jt-when">Nothing booked</b>
        )}
      </Tile>

      {money !== undefined && (
        <Tile label="Money" onOpen={onMoney}>
          {money}
        </Tile>
      )}

      <Tile
        label="To do"
        aside={count > 0 ? <span className="jt-count">{count}</span> : null}
        foot={
          onAddTask ? (
            <Button kind="second" onClick={onAddTask}>
              Add task
            </Button>
          ) : null
        }
      >
        {open}
        {tasks.length > 0 ? (
          <ul className="jt-tasks">
            {tasks.map((t) => (
              <li key={t.id}>
                <Tick
                  checked={false}
                  onChange={() => onTick(t)}
                  label={
                    <span className="jc-task">
                      <span className="jc-task-name">{t.title}</span>
                      <span className="jc-task-line">{t.line}</span>
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        ) : openCount > 0 ? null : (
          <p className="jt-cap">{tasksRead ? "Nothing to do on it." : "Reading the job's tasks"}</p>
        )}
      </Tile>
    </div>
  );
}
