"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { clockLabel } from "@/lib/workboard/schedule";
import type { BlockPaint } from "@/lib/workboard/schedule-colour";

/* ONE JOB, BROUGHT FORWARD — what replaced the crew hover.

   THE HOVER IT REPLACES. Hovering any block of a multi-person job used to
   lift its siblings and rest the whole rest of the day at opacity .35. It
   answered a real question — which of these rectangles are the same job — but
   it answered it only while the mouse was still, it never answered it for
   anybody using a keyboard or a touchscreen, and dimming forty blocks to
   emphasise four is a lot of screen changing for a question you asked by
   accident on the way somewhere else. Isaac's call: a click, not a hover.

   WHY A STACK RATHER THAN A LIFT IN PLACE. The obvious reading of "bring the
   card forward" is to animate the block itself out of the rail. The blocks are
   absolutely positioned inside a horizontally scrolled lane, at whatever width
   their hours give them — a 30-minute booking is 46px — and the siblings are
   in other lanes, sometimes off-screen. Lifting four of those into a legible
   arrangement means animating four elements out of a scroll container and
   inventing a layout for them anyway. So the stack IS that layout, stated
   once: a card per person, in the paint their block already wears, so what
   arrives is recognisably what was clicked.

   IT PORTALS TO <body>, AND THAT IS NOT OPTIONAL. `.page.in`'s will-change
   creates a containing block that breaks position:fixed, and anything left
   inside `.fg` is unreachable under a body-portalled scrim at any z-index —
   both are documented traps in this codebase, and the fleet modal's `.fl-ov`
   is unscoped for exactly this reason. This reuses that scrim rather than
   growing a second one: the page gets ONE backdrop-filter, and it never gets
   a `-webkit-` twin, because the build ships only the prefixed one and the
   blur then silently disappears everywhere else. */

/** One person on the job, and what their booking is doing. */
export type FocusEntry = {
  key: string;
  who: string;
  startMin: number;
  endMin: number;
  /** The word for this booking's state, already decided by the rail so the two
      surfaces can never disagree. Null when there is nothing to claim. */
  state: string | null;
  paint: BlockPaint;
  /** Finished work is neutral on the rail and neutral here. */
  done: boolean;
};

/** One treatment this job's blocks wear, decoded: the swatch is drawn by the
    card in the job's own paint, the word says what it means. `cat` is always
    first — the category (or owning board) whose colour washes the block. */
export type FocusMark = {
  kind: "cat" | "qt" | "dan" | "done" | "stale" | "idle" | "late" | "on";
  word: string;
};

export type FocusJob = {
  jobNumber: string | null;
  clientName: string | null;
  suburb: string | null;
  /** The category, or the board that owns it — whatever the block says. */
  label: string;
  /** The job's own paint, for the marks' swatches. */
  paint: BlockPaint;
  /** The status of the job and what its colours mean — only what it wears. */
  marks: FocusMark[];
  entries: FocusEntry[];
};

export function ScheduleFocus({
  job,
  onOpen,
  onClose,
}: {
  job: FocusJob;
  onOpen: () => void;
  onClose: () => void;
}) {
  const openRef = useRef<HTMLButtonElement>(null);

  /* Escape closes, and focus lands on the one action this thing has so a
     keyboard arrives somewhere useful rather than at the top of the document.
     The caller returns focus to the block it came from on the way out. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    openRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const crew = job.entries.length;

  return createPortal(
    <div className="fl-ov wb2-scfov" onClick={onClose}>
      <div
        className="wb2-scf"
        role="dialog"
        aria-modal="true"
        aria-label={`Job ${job.jobNumber ? `#${job.jobNumber}` : ""} ${job.clientName ?? ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="wb2-scfh">
          <span>
            <b>{job.clientName ?? "Unnamed client"}</b>
            {job.jobNumber && <u>{job.jobNumber}</u>}
          </span>
          <em>
            {job.label}
            {job.suburb ? ` · ${job.suburb}` : ""}
          </em>
        </div>

        {/* THE STATUS, AND WHAT THE COLOURS MEAN — the rail's footer key,
            scoped to this one job. Each swatch is drawn in the job's own
            paint so what it decodes is literally what was clicked. */}
        <div
          className="wb2-scfkey"
          style={{
            ["--fill" as string]: job.paint.fill,
            ["--bar" as string]: job.paint.bar,
            ["--pale" as string]: job.paint.pale,
            ["--pale-edge" as string]: job.paint.paleEdge,
          }}
        >
          {job.marks.map((m) => (
            <span key={m.kind}>
              <i className={m.kind} aria-hidden="true">
                {m.kind === "late" ? "!" : ""}
              </i>
              {m.word}
            </span>
          ))}
        </div>

        {/* WHO IS ON IT — the question the hover existed to answer, now
            answered in words as well as by position. A one-person job gets a
            stack of one rather than a different screen: one rule, and the
            second step is always in the same place. */}
        <div className="wb2-scfstack">
          <span className="wb2-scfc">
            {crew === 1 ? "On this job" : `${crew} people on this job`}
          </span>
          {job.entries.map((e) => (
            <div
              key={e.key}
              className={"wb2-scfcard" + (e.done ? " done" : "")}
              style={{
                ["--fill" as string]: e.done ? e.paint.pale : e.paint.fill,
                ["--bar" as string]: e.paint.bar,
                ["--btext" as string]: e.paint.ink,
              }}
            >
              <b>{e.who}</b>
              <span>
                {clockLabel(e.startMin)}–{clockLabel(e.endMin)}
              </span>
              {e.state && <em>{e.state}</em>}
            </div>
          ))}
        </div>

        <div className="wb2-scfft">
          <button type="button" className="wb2-scfx" onClick={onClose}>
            Back to the day
          </button>
          <button ref={openRef} type="button" className="wb2-scfgo" onClick={onOpen}>
            Open job
            <Icon name="chevR" size={15} />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
