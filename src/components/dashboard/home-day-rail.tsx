"use client";

import { useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeTask } from "@/app/actions/dashboard";
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
  railSaysEmpty,
  railSpanLabel,
  railTop,
  RAIL_TAIL_PX,
  type RailMissing,
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

   SERVICEM8 IS A LAYER ON THIS RAIL, NOT THE RAIL (Isaac, 2026-09-01). It
   used to be the other way round: no workboard, or no `integration_links`
   row, and the whole timeline was replaced by a sentence — so an account
   without the mirror saw nothing of its own day, though every timed task it
   owned was already loaded and sitting in `rail.tasks`. The day is drawn from
   whatever has a clock time on it, and what ServiceM8 cannot contribute is
   said UNDERNEATH.

   THAT KEEPS THE ARGUMENT THE OLD GATE WAS MAKING. "You are free until
   Tuesday" is still the one wrong answer that looks exactly like a right one,
   so a rail missing its bookings never says the day is empty — the note below
   it does the talking, and the "nothing on" line is spoken only when the
   picture is complete. See `missing`.

   IT IS YOUR DAY, NOT THE CREW'S (Isaac, 2026-08-31). The bookings are
   narrowed to the ServiceM8 person the viewer is linked to; an unknown viewer
   gets none of them rather than all of them.

   The rail is a VIEW. Ticking a task off, opening a job, re-dating something —
   all of that lives where its whole flow already lives, one tab across. A
   checkbox here that only half worked would be worse than none. */

export function HomeDayRail({ rail }: { rail: HomeRail }) {
  /* The browser's clock, not the loader's: the marker has to keep moving
     while the page is open, and it reads null the moment the browser's own
     date disagrees with the rail's day — a missing mark beats one that is
     hours wrong. Same hook the board's rail uses. */
  const liveNow = useNowMin(rail.dayISO);
  const router = useRouter();
  const [pending, start] = useTransition();

  const items = railItems(rail.blocks, rail.tasks);

  /* THE RAIL HAS TO CONTAIN NOW, and which "now" is a real choice.

     `rail.nowMin` is the loader's, in the workspace's zone, and it is what the
     server rendered — so the bounds are right in the first paint and the rail
     does not re-lay itself out the moment `useNowMin`'s effect fires.
     `liveNow` is the browser's, and it is null until that effect runs, so the
     larger of the two is the server's at first and the browser's afterwards.
     That is what stops a page left open through the evening from losing its
     marker off the bottom again: it widens by an hour instead. */
  const nowForBounds =
    rail.nowMin !== null && liveNow !== null
      ? Math.max(rail.nowMin, liveNow)
      : (liveNow ?? rail.nowMin);
  const bounds = railBounds(items, nowForBounds);
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

  /* WHAT IS NOT IN THIS PICTURE, as one of three answers rather than a gate.
     `null` is the complete day — bookings and timed work, both accounted for
     — and it is the only state that may say the day is empty. */
  const missing: RailMissing = !rail.enabled
    ? "workboard"
    : !rail.linked
      ? "link"
      : null;
  /* Asked here once and used in both places that must agree — see
     `railSaysEmpty`, which is a function for exactly that reason. */
  const saysEmpty = railSaysEmpty(placed.length, missing);

  /* OPEN ON NOW. The rail is 64px an hour by law, so a nine-hour day is 600px
     of column and a laptop shows about two thirds of it — which put the
     afternoon below the fold on a screen whose whole job is "where should I
     be". It scrolls, and it now scrolls to the right place: the marker lands
     a third of the way down, so the next thing on is under it.

     Mount only, and guarded — re-running it on every tick would drag the
     column back under a reader who had scrolled somewhere on purpose. The
     minute comes from `liveNow`, so this waits for the browser's own clock
     and never reads one during render (see the hydration trap). */
  const scroller = useRef<HTMLDivElement | null>(null);
  const opened = useRef(false);
  const { startMin, endMin } = bounds;
  useEffect(() => {
    const el = scroller.current;
    /* THE ONE THING WORTH MORE THAN THE MARKER is the line saying the day is
       clear: it sits at the TOP of the track, so opening three hours down
       would hide it. Anything else, and the rail opens on now. */
    if (!el || opened.current || liveNow === null || !showNow) return;
    if (saysEmpty) return;
    opened.current = true;
    el.scrollTop = Math.max(0, railTop(liveNow, { startMin, endMin }) - el.clientHeight / 3);
    /* The bounds go in as the two NUMBERS they are. `bounds` is a fresh object
       every render, so depending on it re-runs this effect on every tick — the
       `opened` guard would still hold, but a dependency that always changes is
       a lie about when the effect matters. */
  }, [liveNow, showNow, startMin, endMin, saysEmpty]);

  return (
    <aside className="hm-day" aria-label="Today">
      {/* WHO IS OFF IS NOT HERE. It belongs to the Calendar face, and Isaac
          has now said so twice — the rail is where you have to BE, and a
          colleague's leave is not an appointment of yours. One fact, one
          home; two would eventually disagree. */}
      <div className="wb2-sect">The day</div>

      {/* WHAT SERVICEM8 COULDN'T ADD, above the day rather than instead of it.
          It is not hint text: it is the difference between "nothing is on" and
          "we could not see what is on", which the drawing below cannot express
          and which the reader has to have to trust the column. It disappears
          the moment the picture is complete.

          ABOVE, and outside the scroller, on purpose. Under the rail it was a
          footnote you had to scroll a whole day to reach — on the one state
          where the reader most needs it before they read anything. */}
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

      {/* THE TRACK SCROLLS, THE COLUMN DOESN'T. `The day` and the note above
          it are what the reader needs kept in front of them; the hours are
          what there is too much of. Splitting them is also what lets the rail
          open on the current hour without carrying its own heading away. */}
      <div className="hm-dayrl" ref={scroller}>
        <div className="hm-rl" style={{ height: railHeight(bounds) + RAIL_TAIL_PX }}>
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
            {saysEmpty && (
              /* ONLY WHEN THE RAIL HAS EVERYTHING. With a layer missing, the
                 day being blank is not a fact about the day — it is a fact
                 about what we could read — and the note under the rail is the
                 one that says so. Two sentences arguing about the same empty
                 column is how a screen ends up lying by accident.

                 "On" and not "booked": tasks share this column now, so a line
                 that only mentions bookings would be answering half of it. */
              <p className="hm-daynone hm-rlempty">Nothing on your day.</p>
            )}

            {placed.map(({ item, top, height, col, cols }) => {
              /* Two things at once each take half the column, three take a
                 third. The width is a percentage of the track so the rail keeps
                 working at any card width. */
              const width = `calc((100% - ${(cols - 1) * 6}px) / ${cols})`;
              const left = `calc((100% + 6px) / ${cols} * ${col})`;
              const style = { top, height, width, left } as React.CSSProperties;

              if (item.kind === "task") {
                /* A DEADLINE IS NOT AN APPOINTMENT, and the rail has to say
                   which it has. `at` is a thing to be doing then — it sits
                   quietly at its hour like a booking. `by` is the moment you
                   have RUN OUT, so it wears the warning colour and says the
                   word: "by 4:00" reads as an instruction, "4:00" reads as a
                   start time, and the second one arrives too late to act on.

                   Overdue still darkens it to danger. A missed deadline and a
                   late nudge are both red, because past-its-time is the same
                   fact whichever question the time was answering. */
                const by = item.task.kind === "by";
                return (
                  <div
                    className={
                      `hm-rlt${by ? " by" : ""}` + (item.task.overdue ? " over" : "")
                    }
                    key={item.key}
                    style={style}
                    title={
                      by
                        ? `${item.task.title} — finished by ${clockLabel(item.task.atMin)}`
                        : undefined
                    }
                  >
                    {/* A REAL CHECKBOX. A drawn one on a row you cannot tick
                        is a lie, so this runs the same action the Tasks face
                        runs and refreshes — the row leaves the rail and the
                        badge next door moves with it. */}
                    <button
                      type="button"
                      className="hm-rltc"
                      aria-label={`Mark "${item.task.title}" done`}
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          await completeTask(item.task.id);
                          router.refresh();
                        })
                      }
                    />
                    <b>{item.task.title}</b>
                    {/* ONE STRING, NOT A SPAN AND A NUMBER. The word was its
                        own element with a CSS margin, which looks right and
                        reads as "by4pm" to anything that walks the text —
                        the gap has to be a real space. */}
                    <u>
                      {by
                        ? `by ${clockLabel(item.task.atMin)}`
                        : clockLabel(item.task.atMin)}
                    </u>
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
                  title={[b.clientName, b.suburb, blockLabel(b), state.word]
                    .filter(Boolean)
                    .join(" · ")}
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
                  {/* ONE LINE. The suburb, the category and the state word had
                      a second line to themselves, which is what forced a tall
                      block — and none of them is what the eye is scanning a
                      rail for. They ride the row's title instead. */}
                  {done && <i className="hm-rlbt" aria-hidden="true" />}
                  {b.jobNumber && <u>{b.jobNumber}</u>}
                  <b>{b.clientName ?? "Unnamed client"}</b>
                  {/* THE LENGTH, WRITTEN RATHER THAN DRAWN. Every row on this
                      rail is one height by design, so a job from seven to
                      three looked exactly like a half-hour call and the only
                      place its span lived was the hover title — which a phone
                      has none of and a glance never waits for. It rides the
                      right of the row, where a task's time already sits, so
                      the two kinds of thing say when they are in the same
                      place. */}
                  <span className="hm-rlbw">
                    {railSpanLabel(b.startMin, b.endMin)}
                  </span>
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
      </div>
    </aside>
  );
}
