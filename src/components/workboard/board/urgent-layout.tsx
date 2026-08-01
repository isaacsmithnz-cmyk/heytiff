"use client";

import type { ReactNode } from "react";

/* The Urgent card's shape, shared by both boards.

   The queue is READ, not scanned: a flat list of everything urgent makes you
   work out which rows are the same kind of problem. So the work splits into
   two named groups — what's already late, and what turns bad this week —
   and personal tasks sit in their own lane down the right, divided by a hair
   rule. Tasks are a different KIND of obligation (yours, not the crew's);
   side by side you read both in one glance instead of scrolling past one to
   reach the other.

   The second column only exists when both sides have something to say.
   One-sided, it collapses to a single column rather than leaving a lane of
   whitespace — and the projects board, which has no task lane at all, gets
   the groups without ever paying for the grid. */

export function UrgentBody({
  overdue,
  soon,
  tasks,
}: {
  /** Rows already late. */
  overdue: ReactNode[];
  /** Everything else the queue is holding — gaps, flags, blocks. */
  soon: ReactNode[];
  /** The personal lane. Omit entirely on boards that have no tasks. */
  tasks?: ReactNode[];
}) {
  const hasQueue = overdue.length > 0 || soon.length > 0;
  const hasTasks = (tasks?.length ?? 0) > 0;

  return (
    <div className={"wb2-urbody" + (hasQueue && hasTasks ? " twocol" : "")}>
      {hasQueue && (
        <div className="wb2-urqueue">
          {overdue.length > 0 && (
            <div className="wb2-urgrp">
              <span className="wb2-sect">Overdue</span>
              {overdue}
            </div>
          )}
          {soon.length > 0 && (
            <div className="wb2-urgrp">
              <span className="wb2-sect">Deal with it today</span>
              {soon}
            </div>
          )}
        </div>
      )}
      {hasTasks && (
        <div className="wb2-urgrp wb2-urside">
          <span className="wb2-sect">Your tasks</span>
          <div className="wb2-tasks">{tasks}</div>
        </div>
      )}
    </div>
  );
}

/* A task reads as a line you tick, not a job card: the tick is the whole
   point, so it leads. Everything else — who it's for, when it was due —
   trails behind it at a glance weight. */
export function TaskRow({
  title,
  who,
  due,
  tone,
  busy,
  onDone,
}: {
  title: string;
  who: string | null;
  due: string;
  tone: "dan" | "warn";
  busy: boolean;
  onDone: () => void;
}) {
  return (
    <div className="wb2-tk">
      <button
        type="button"
        className="wb2-tkb"
        disabled={busy}
        aria-label={`Mark done — ${title}`}
        onClick={onDone}
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </button>
      <div className="wb2-tkt">
        <b>{title}</b>
        {who && <em>{who}</em>}
      </div>
      <span className={"wb2-chip " + tone}>{due}</span>
    </div>
  );
}
