"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeTask } from "@/app/actions/dashboard";
import { Icon } from "@/components/shell/icon";
import { useNowMin } from "@/components/workboard/board/use-now-min";
import { blockState } from "@/lib/workboard/focus";
import { clockLabel } from "@/lib/workboard/schedule";
import {
  placeRibbon,
  railBounds,
  railHourLabel,
  railHours,
  railItems,
  railSaysEmpty,
  railSpanLabel,
  ribbonLanes,
  ribbonScale,
  ribbonX,
  type RailItem,
  type RailMissing,
} from "@/lib/dashboard/day-rail";
import type { HomeRail } from "@/lib/dashboard/page-data";

/* THE DAY, ACROSS THE TOP.

   Home's day used to run down a column beside the card (the desk,
   2026-08-30). The three-room handoff (2026-09-14) lays it along the top
   instead, so the diary and the tasks under it get the whole height, and
   "where should I be" is read left to right the way a day is.

   WHAT IS ON IT IS UNCHANGED. The bookings are the viewer's own, narrowed by
   the ServiceM8 link; a task earns a place only by naming an hour; what
   ServiceM8 could not add is said above the day rather than instead of it,
   and the day is called clear only when the picture is complete. See
   `lib/dashboard/day-rail` for each of those laws — they were written for
   the column and the band reads them off the same functions. The one thing
   the band adds is a scale of its own: pixels per hour come from its width,
   which on a 1440 window is the Schedule tab's 110.

   A PILL IS NEVER NARROWER THAN ITS WORDS. A one-hour booking is 110px of
   axis and its number, name and span are more than that, so the pill grows
   past its hour rather than clipping the fact a glance is after. The lanes
   are packed on drawn pixels, so the packer has to know the words' width:
   the band measures every pill once it is on screen and lays the day out
   again with the real numbers. Before that, a guess from the letter count
   stands in — and the first paint is the same on the server and the
   browser, which is what keeps hydration whole.

   INK PILLS. A booking is the mark on a light ground; a finished one gives
   its ink up and keeps a tick; a quote is dashed; one that should have
   started and has not been clocked on wears a red dot. A task is paper and
   a hairline with a real checkbox, because a task on this band can be
   ticked off and a booking cannot. The band is otherwise a view: opening a
   job lives on the board. */

/** A 32px pill and its 8px of air. */
export const BAND_LANE_PX = 40;
/** The track and the hour labels, under the last lane. */
export const BAND_AXIS_PX = 44;
/** The width assumed before the band has measured itself. */
export const BAND_NOMINAL_PX = 1000;

/** What a pill's words come to before anything has been measured: the
    padding, the gaps, and about seven and a half pixels a letter at 13px.
    Over rather than under — a guess that is short puts two pills on one lane
    that are then drawn on top of each other for a frame. */
export function wordsWidthGuess(item: RailItem): number {
  const text =
    item.kind === "job"
      ? `${item.job.jobNumber ?? ""} ${item.job.clientName ?? "Unnamed client"} ${railSpanLabel(item.startMin, item.endMin)}`
      : `${item.task.title} ${clockLabel(item.task.atMin)}`;
  return 48 + text.length * 7.5;
}

export function HomeDayBand({ rail }: { rail: HomeRail }) {
  /* The browser's clock, not the loader's: the marker keeps moving while the
     page is open, and it reads null the moment the browser's own date
     disagrees with the band's day — a missing mark beats one that is hours
     wrong. Same hook the board's rail uses. */
  const liveNow = useNowMin(rail.dayISO);
  const router = useRouter();
  const [pending, start] = useTransition();

  const items = railItems(rail.blocks, rail.tasks);

  /* THE DAY HAS TO CONTAIN NOW. `rail.nowMin` is the loader's, in the
     workspace's zone, and it is what the server rendered — so the bounds are
     right in the first paint. `liveNow` is the browser's and is null until
     its effect runs, so the larger of the two is the server's at first and
     the browser's afterwards: a page left open through the evening widens
     by an hour instead of losing its marker off the end. */
  const nowForBounds =
    rail.nowMin !== null && liveNow !== null
      ? Math.max(rail.nowMin, liveNow)
      : (liveNow ?? rail.nowMin);
  const bounds = railBounds(items, nowForBounds);
  const hours = railHours(bounds);
  const span = bounds.endMin - bounds.startMin;
  const pct = (min: number) => `${(((min - bounds.startMin) / span) * 100).toFixed(3)}%`;
  const pctOf = (mins: number) => `${((mins / span) * 100).toFixed(3)}%`;

  /* Not `rail.tasks.length > 0` — the hollow/late law only means anything on
     an account that clocks on at all, and that is a fact about the bookings. */
  const tracksTime = rail.blocks.some((b) => b.onSite);
  const clock = { dayISO: rail.dayISO, today: rail.dayISO, nowMin: liveNow, tracksTime };

  const showNow =
    liveNow !== null && liveNow >= bounds.startMin && liveNow <= bounds.endMin;

  /* WHAT IS NOT IN THIS PICTURE, as one of three answers rather than a gate.
     `null` is the complete day, and the only state that may call it empty. */
  const missing: RailMissing = !rail.enabled ? "workboard" : !rail.linked ? "link" : null;
  const saysEmpty = railSaysEmpty(items.length, missing);

  /* THE MEASURE. One observer on the track and on every pill, so a resize
     of the window and a change to the words both come back through the same
     door. Set from the observer's callback — never synchronously in the
     effect — so the first render is the same on both sides of hydration and
     nothing asks React to re-render while it is rendering. The observer
     fires once on observe, which is what stands in for a mount-time read. */
  const track = useRef<HTMLDivElement | null>(null);
  const pills = useRef(new Map<string, HTMLElement>());
  const [measure, setMeasure] = useState<{
    width: number;
    words: ReadonlyMap<string, number>;
  } | null>(null);
  const keys = items.map((it) => it.key).join("|");
  useEffect(() => {
    const el = track.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const words = new Map<string, number>();
      for (const [key, pill] of pills.current) words.set(key, pill.offsetWidth);
      setMeasure({ width: el.clientWidth, words });
    });
    ro.observe(el);
    for (const pill of pills.current.values()) ro.observe(pill);
    return () => ro.disconnect();
    /* The keys as a string: a new set of pills needs observing, a re-render
       of the same set does not. */
  }, [keys]);
  const hold = (key: string) => (el: HTMLElement | null) => {
    if (el) pills.current.set(key, el);
    else pills.current.delete(key);
  };

  const width = measure?.width ?? BAND_NOMINAL_PX;
  const pph = ribbonScale(bounds, width);
  const placed = placeRibbon(
    items,
    bounds,
    pph,
    (it) => measure?.words.get(it.key) ?? wordsWidthGuess(it),
    width,
  );
  const lanes = ribbonLanes(placed);

  return (
    <>
      {/* WHAT SERVICEM8 COULDN'T ADD, above the day rather than instead of it.
          Not hint text: it is the difference between "nothing is on" and "we
          could not see what is on", which the drawing cannot express and
          which the reader has to have to trust the band. Gone the moment the
          picture is complete. */}
      {missing === "workboard" && (
        <p className="hm-daynote">
          Bookings aren’t in this picture — they need the workboard. Your timed
          work is.
        </p>
      )}
      {missing === "link" && (
        <p className="hm-daynote">
          Bookings aren’t in this picture: nobody in ServiceM8 is linked to your
          account yet.{" "}
          {/* The door only opens for someone who can walk through it — see the
              loader, which is where `linkHref` is decided. */}
          {rail.linkHref && <Link href={rail.linkHref}>Link yourself to the crew</Link>}
        </p>
      )}

      <div
        className="hm-track"
        ref={track}
        style={{ height: lanes * BAND_LANE_PX + BAND_AXIS_PX }}
        aria-label="The day"
      >
        <span className="hm-axis" aria-hidden="true" />
        {showNow && (
          <span className="hm-elapsed" style={{ width: pct(liveNow) }} aria-hidden="true" />
        )}
        {hours.map((h) => (
          <span className="hm-hrtick" key={`t${h}`} style={{ left: pct(h * 60) }} aria-hidden="true" />
        ))}
        {hours.map((h) => (
          <span className="hm-hour" key={h} style={{ left: pct(h * 60) }} aria-hidden="true">
            {railHourLabel(h, bounds)}
          </span>
        ))}

        {saysEmpty && (
          /* ONLY WHEN THE BAND HAS EVERYTHING. With a layer missing, a blank
             day is a fact about what we could read, and the note above does
             the talking. "On", not "booked": tasks share the band. */
          <p className="hm-daynone">Nothing on your day.</p>
        )}

        {placed.map((p) => {
          /* Positioned in percent until the band has measured itself, so the
             first paint lands every pill at its hour whatever the width turns
             out to be; in pixels afterwards, because that is the only way a
             pill hanging off the end can be brought back onto the card. */
          const top = p.lane * BAND_LANE_PX;
          const style: React.CSSProperties = measure
            ? {
                left: p.x,
                top,
                width:
                  p.item.kind === "job"
                    ? Math.max(
                        0,
                        ribbonX(p.item.endMin, bounds, pph) - ribbonX(p.item.startMin, bounds, pph),
                      )
                    : undefined,
              }
            : {
                left: pct(p.item.startMin),
                top,
                width: p.item.kind === "job" ? pctOf(p.item.endMin - p.item.startMin) : undefined,
              };

          if (p.item.kind === "task") {
            /* A DEADLINE IS NOT AN APPOINTMENT. `at` is a thing to be doing
               then and sits quietly at its hour; `by` is the moment you have
               RUN OUT, so its time wears the warning colour and says the
               word. Past it, either way, is red. */
            const t = p.item.task;
            const by = t.kind === "by";
            return (
              <div
                className={"hm-tsk" + (by ? " by" : "") + (t.overdue ? " over" : "")}
                key={p.item.key}
                ref={hold(p.item.key)}
                style={style}
              >
                {/* A REAL CHECKBOX — a drawn one on a row you cannot tick is a
                    lie. Same action the Tasks face runs; the row leaves the
                    band and the count on the rail moves with it. */}
                <button
                  type="button"
                  className="hm-cb"
                  aria-label={`Mark "${t.title}" done`}
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await completeTask(t.id);
                      router.refresh();
                    })
                  }
                />
                <b>{t.title}</b>
                <u>{by ? `by ${clockLabel(t.atMin)}` : clockLabel(t.atMin)}</u>
              </div>
            );
          }

          const b = p.item.job;
          const state = blockState(b, clock);
          const done = b.closure === "done";
          const qt = b.status === "Quote";
          return (
            <div
              className={
                "hm-job" + (done ? " done" : "") + (qt ? " qt" : "") + (state.late ? " late" : "")
              }
              key={p.item.key}
              ref={hold(p.item.key)}
              style={style}
            >
              {done && <Icon name="check" size={14} />}
              {state.late && <i className="hm-jobdot" aria-hidden="true" />}
              {b.jobNumber && <u>{b.jobNumber}</u>}
              <b>{b.clientName ?? "Unnamed client"}</b>
              {/* THE LENGTH, WRITTEN. Every pill is one height and a pill's
                  width is its hours only until its words are longer, so the
                  span is said in words where a task's time already sits. */}
              <span className="hm-jobsp">{railSpanLabel(b.startMin, b.endMin)}</span>
              {(done || state.late || qt) && (
                <span className="sr-only">{done ? "done" : state.late ? "late" : "quote"}</span>
              )}
            </div>
          );
        })}

        {showNow && (
          <span
            className="hm-now"
            style={{ left: pct(liveNow) }}
            data-now={clockLabel(liveNow)}
            aria-hidden="true"
          />
        )}
      </div>
    </>
  );
}
