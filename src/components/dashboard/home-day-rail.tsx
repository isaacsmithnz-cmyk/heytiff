"use client";

import { Icon } from "@/components/shell/icon";
import { useNowMin } from "@/components/workboard/board/use-now-min";
import { blockLabel, blockPaint, blockState } from "@/lib/workboard/focus";
import { clockLabel } from "@/lib/workboard/schedule";
import {
  placeRail,
  railBounds,
  railHeight,
  railHourLabel,
  railHours,
  railItems,
  railTop,
} from "@/lib/dashboard/day-rail";
import type { HomeRail } from "@/lib/dashboard/page-data";

/* THE DAY, DOWN THE LEFT.

   Home's left side answers one question — "where should I be" — and answers it
   by drawing the day rather than listing it. Time is honest space here: the
   gap between eight and eleven IS three hours of column, so a crowded
   afternoon looks crowded and a clear run looks clear without a word.

   IT WEARS THE DISPATCH DIARY'S PAINT, NOT A COPY OF IT. Every colour comes
   from `blockPaint` — the wash at 94% light, the cap walked down until it
   clears 3:1 against its own wash, the stated neutral for finished work — and
   arrives as the same six custom properties the Schedule tab sets. What is
   NOT reused is that board's geometry: `.wb2-schb` is absolutely positioned
   for a horizontal rail inside `.wb2`, where `--wb2-dan` and `--ink` resolve.
   Home is not inside `.wb2`. So the classes are Home's and the colour law is
   the board's, which is the half that must never drift.

   THREE KINDS OF THING SHARE THE COLUMN. A booking from ServiceM8, and a task
   of yours that named an hour — the Hilux going in at 7:30 owns that morning
   as much as a job does. What has no clock time stays in the Tasks tab: a due
   date is a day, not an hour.

   The rail is a VIEW. Ticking a task off, opening a job, re-dating something —
   all of that lives where its whole flow already lives, one tab across. A
   checkbox here that only half worked would be worse than none. */

export function HomeDayRail({ rail }: { rail: HomeRail }) {
  /* The browser's clock, not the loader's: the marker has to keep moving
     while the page is open, and it reads null the moment the browser's own
     date disagrees with the rail's day — a missing mark beats one that is
     hours wrong. Same hook the board's rail uses. */
  const liveNow = useNowMin(rail.dayISO);

  const items = railItems(rail.blocks, rail.tasks);
  const bounds = railBounds(items);
  const placed = placeRail(items, bounds);
  const hours = railHours(bounds);

  /* Not `rail.tasks.length > 0` — the hollow/late law only means anything on
     an account that clocks on at all, and that is a fact about the bookings. */
  const tracksTime = rail.blocks.some((b) => b.onSite);
  const clock = {
    dayISO: rail.dayISO,
    today: rail.dayISO,
    nowMin: liveNow,
    tracksTime,
  };

  const showNow =
    liveNow !== null && liveNow >= bounds.startMin && liveNow <= bounds.endMin;

  return (
    <aside className="hm-day" aria-label="Today">
      {/* WHO IS OFF IS NOT HERE ANY MORE (Isaac, 2026-08-30). It sat under
          this label for one round, while the four-week view had no home; the
          Calendar tab is that home now, and one fact stated in two places on
          one screen is the thing that eventually disagrees with itself. */}
      <div className="wb2-sect">The day</div>

      {!rail.enabled ? (
        <p className="hm-daynone">The day’s bookings need the workboard.</p>
      ) : (
        <div className="hm-rl" style={{ height: railHeight(bounds) + 20 }}>
          {hours.map((h) => (
            <span
              className="hm-rlhr"
              key={h}
              style={{ top: railTop(h * 60, bounds) }}
              aria-hidden="true"
            >
              {railHourLabel(h, bounds)}
            </span>
          ))}

          {/* The items stand in their own track beside the hour gutter — see
              `.hm-rlitems`: an absolutely positioned child is placed against
              the padding box, so blocks in a padded rail draw over the hours. */}
          <div className="hm-rlitems">
            {placed.length === 0 && (
              <p className="hm-daynone hm-rlempty">Nothing booked today.</p>
            )}

            {placed.map(({ item, top, height, col, cols }) => {
              /* Two things at once each take half the column, three take a
                 third. The width is a percentage of the track so the rail keeps
                 working at any card width. */
              const width = `calc((100% - ${(cols - 1) * 6}px) / ${cols})`;
              const left = `calc((100% + 6px) / ${cols} * ${col})`;
              const style = { top, height, width, left } as React.CSSProperties;

              if (item.kind === "task") {
                return (
                  <div
                    className={`hm-rlt${item.task.overdue ? " over" : ""}`}
                    key={item.key}
                    style={style}
                  >
                    <Icon name="clock" size={13} />
                    <b>{item.task.title}</b>
                    <u>{clockLabel(item.task.atMin)}</u>
                  </div>
                );
              }

              const b = item.job;
              const paint = blockPaint(b);
              const state = blockState(b, clock);
              const done = b.closure === "done";
              return (
                <div
                  className={
                    "hm-rlb" +
                    (done ? " done" : "") +
                    (b.status === "Quote" ? " qt" : "") +
                    (b.status === "Unsuccessful" ? " dan" : "") +
                    (state.hollow ? " idle" : "") +
                    (state.late ? " late" : "")
                  }
                  key={item.key}
                  style={
                    {
                      ...style,
                      "--fill": paint.fill,
                      "--btext": paint.ink,
                      "--chip": paint.chip,
                      "--bar": paint.bar,
                      "--pale": paint.pale,
                      "--pale-edge": paint.paleEdge,
                    } as React.CSSProperties
                  }
                >
                  <span className="hm-rlbh">
                    {b.jobNumber && <u>{b.jobNumber}</u>}
                    <b>{b.clientName ?? "Unnamed client"}</b>
                  </span>
                  <em>
                    {[b.suburb, blockLabel(b)].filter(Boolean).join(" · ")}
                    {state.word ? ` · ${state.word}` : ""}
                  </em>
                </div>
              );
            })}

            {showNow && (
              <span
                className="hm-rlnow"
                style={{ top: railTop(liveNow, bounds) }}
                data-now={clockLabel(liveNow)}
                aria-hidden="true"
              />
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
