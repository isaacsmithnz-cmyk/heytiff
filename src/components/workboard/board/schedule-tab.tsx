"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtAuDayMonth, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { plusDays } from "@/lib/workboard/dates";
import { isWeekendISO, mondayOf } from "@/lib/workboard/board-status";
import { dowOfISO } from "@/lib/workboard/capacity";
import { scheduleDay } from "@/app/actions/workboard";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import type { SchedulePayload } from "@/lib/workboard/schedule-query";
import {
  clockLabel,
  fmtHoursShort,
  lanePresence,
  layoutScheduleDay,
  type ScheduleBlock,
  type ScheduleTracked,
} from "@/lib/workboard/schedule";
import {
  NO_CATEGORY_PAINT,
  scheduleBlockPaint,
  TRACKED_PAINT,
} from "@/lib/workboard/schedule-colour";
import {
  blockLabel,
  blockPaint,
  blockState as blockStateOf,
  dayStateOfMarks,
  focusJobOf,
  type DayClock,
} from "@/lib/workboard/focus";
import { Sm8Gap, sm8Gap } from "./sm8-gap";
import { ToolbarSync } from "./sm8-chip";
import { useNowMin } from "./use-now-min";
import { FocusInspector } from "./focus-inspector";
import { Split } from "./inspector";

/* Schedule — who is on what, and when. The Dispatch Board's question,
   answered from the mirror this account already syncs: one lane per staff
   member, dispatched bookings laid on a time rail, one day at a time.

   FETCH-ON-OPEN. This is the fourth tab, not the first; the Workboard page
   already loads three boards, so a day arrives when it is asked for (the
   JobSheet's pattern) and is cached for the session.

   NO TIME TEXT ON A BLOCK. Its place on the rail already says when; writing
   "7am–3pm" on the card as well is double handling (Isaac's words). The
   times live in the hover title and the aria-label, where they cost nothing.

   TWO COLOUR CHANNELS, ONE OVERRIDE. Category washes a block and colours its
   cap (the same axis the list rows' catdot uses); status is a second reading —
   Completed mutes and takes a tick, Unsuccessful mutes and takes the issue
   mark, a Quote takes a dashed edge. And OWNERSHIP OUTRANKS CATEGORY: a job
   promoted onto one of our boards leaves the palette and wears the tracked
   blue with the word beside the number, because it isn't pool work any more.

   NOTHING GOES WHITE, AND ONE THING GETS A MARK. A booking nobody has clocked
   on to keeps its category and hollows its cap. That is the ORDINARY state of
   most of a day rather than an exception — the morning this was measured, ten
   of twenty-one bookings were unstarted and seven more were closed, so a rail
   that whitened the first and paled the second showed seventeen white
   rectangles and hid the three that were live. The one genuine exception —
   past its start with nothing recorded — carries a mark in the corner
   instead, in the same slot the done tick uses. */

/* THE DAY FITS THE WIDTH. The rail used to be 110px an hour whatever the
   screen, so a 1440px laptop showed 6am to 3pm and scrolled for the rest,
   with a fade saying so. The hours share the width the rail has now — and
   the floor is what a NAME needs, not what a rectangle needs: a one-hour
   booking at 96px holds "Tom Hanaee" where at 64 it held four letters. Below
   it the rail scrolls again, which is the inspector open on a laptop. */
const MIN_PX_PER_HOUR = 96;
/* A sub-row must HOLD its own type: three lines — the customer at 13px, the
   job number's 16px box with the category, the suburb at 12px — at 1.2 with
   1px between them are ~48px, in a 52px block (Isaac, 2026-09-19: taller
   cards, so the number shows on every one). The row owns the arithmetic: a
   52px block, 4px between stacked blocks, 6px above and below the lane — a
   lane of one is 64px — and the first live walk's lesson (descenders clipped
   against the block's overflow:hidden) still holds. */
const BLOCK_PX = 52;
const LANE_ROW_PX = BLOCK_PX + 4;
const LANE_PAD_PX = 6;
const laneHeight = (rows: number) => rows * LANE_ROW_PX - (LANE_ROW_PX - BLOCK_PX) + LANE_PAD_PX * 2;
/** EVERY CARD CARRIES ITS NUMBER. The number rode beside the customer's name
    and fought it for the one line's width, so a narrow block dropped one of
    them; it leads the second line now, before the category, and the name has
    the first line to itself. Only a block too narrow for the number's own box
    gives up the words and keeps the number alone. */
const TIGHT_PX = 64;
/** Indexed by `dowOfISO` (Mon=0 … Sun=6) — the strip's window slides a day at
    a time now, so a card's weekday comes from its own date, never its slot. */
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A native day-booking — a project trip or maintenance visit. It has a DAY
    and no clock and mostly no person, so it rides a shelf above the lanes
    rather than being invented onto the rail. */
export type ScheduleShelfItem = {
  key: string;
  date: string;
  kind: "visit" | "project";
  id: string;
  label: string;
  sub: string | null;
};

/** What this day's diary says the job is doing — handed to the JobSheet when
    a block opens it, so the sheet's header can carry the same reading the
    rail drew. Only the day-states travel: the ServiceM8 statuses (Quote,
    Unsuccessful, Completed) are already the sheet's own chips. */
export type ScheduleJobState = {
  kind: "late" | "idle" | "on" | "stale";
  word: string;
};

type Props = {
  today: string;
  connected: boolean;
  /** Connected, but the `job_activities` backfill is still on its first walk. */
  syncing: boolean;
  manage: boolean;
  /** ServiceM8 job uuid → the board that owns it. Ownership recolours. */
  tracked: Map<string, ScheduleTracked>;
  /** day → payload, owned by the BOARD. Capacity is a tab of its own now, and
      it opens days out of this same map: a day read on either tab is warm on
      the other, and coming back here lands on the day you left. */
  dayCache: { current: Map<string, SchedulePayload> };
  shelfItems: ScheduleShelfItem[];
  onOpenJob: (job: AllJobsMirrorJob, state?: ScheduleJobState | null) => void;
  onOpenTracked: (target: { kind: "visit" | "project"; id: string }) => void;
};

function blockTitle(b: ScheduleBlock): string {
  return [
    b.jobNumber ? `#${b.jobNumber}` : null,
    b.clientName,
    b.suburb,
    `${clockLabel(b.startMin)}–${clockLabel(b.endMin)}`,
    b.categoryName,
    b.tracked?.label ?? null,
  ]
    .filter(Boolean)
    .join(", ");
}

export function ScheduleTab({
  today,
  connected,
  syncing,
  manage,
  tracked,
  dayCache,
  shelfItems,
  onOpenJob,
  onOpenTracked,
}: Props) {
  const [openDay, setOpenDay] = useState(today);
  /** The first day the strip shows. A WINDOW, not a week: the flanking arrows
      slide it one day at a time (Isaac's call — click past Sunday and Monday
      of the next week walks in), so it starts on a Monday and then goes where
      it's pushed. The week stepper in the header snaps it back to Mondays. */
  const [stripStart, setStripStart] = useState(() => mondayOf(today));
  const [payload, setPayload] = useState<SchedulePayload | null>(
    () => dayCache.current.get(today) ?? null
  );
  /** The job brought forward, by job uuid. Replaces the crew hover. */
  const [focusJob, setFocusJob] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  /** job uuid → its first block, so closing the stack returns focus there. */
  const blockRefs = useRef(new Map<string, HTMLButtonElement>());

  const load = (dayISO: string) => {
    startLoad(async () => {
      const p = await scheduleDay(dayISO);
      dayCache.current.set(dayISO, p);
      setPayload(p);
    });
  };

  const show = (dayISO: string) => {
    setOpenDay(dayISO);
    setFocusJob(null);
    const hit = dayCache.current.get(dayISO);
    if (hit) setPayload(hit);
    else load(dayISO);
  };

  /* The first open loads today — only the fetch, no state writes: openDay
     already IS today, and a transition's async callback is where the result
     lands. StrictMode double-invoking the effect costs one duplicate read,
     which the cache then absorbs for the session. */
  const openToday = useEffectEvent(() => {
    /* A day the board already holds is not read again — the cache outlives
       this component now that Capacity is a tab of its own, so coming back
       from it lands on the day that was already on screen. That payload is
       seeded in useState above, where a value that is ALREADY KNOWN belongs:
       setting it here instead is a second render before first paint, and the
       linter is right to say so.

       Mid-backfill the read is not just wasted, it's WRONG to show: a day
       drawn from half a walk is a diary with people missing from it, which
       reads as "nobody is on" rather than "not here yet". The gap below says
       so instead, and nothing is fetched to contradict it. */
    if (!dayCache.current.has(today) && connected && !syncing) load(today);
  });
  useEffect(() => {
    openToday();
  }, []);

  const current = payload && payload.dayISO === openDay ? payload : null;
  const day = useMemo(
    () =>
      current
        ? layoutScheduleDay({
            activities: current.activities,
            staff: current.staff,
            jobs: current.jobs,
            tracked,
            onSite: new Set(current.onSite),
          })
        : null,
    [current, tracked]
  );
  const jobById = useMemo(
    () => new Map((current?.jobs ?? []).map((j) => [j.remoteId, j])),
    [current]
  );
  /* People, not lanes: the unassigned lane is a row on the board and not a
     crew. */
  const crewCount = day ? day.lanes.filter((l) => l.staffUuid !== "").length : 0;

  const week = useMemo(
    () => Array.from({ length: 7 }, (_, i) => plusDays(stripStart, i)),
    [stripStart]
  );
  const shelf = shelfItems.filter((s) => s.date === openDay);

  /* ── moving through time, two grains ──
     The header's stepper walks WEEKS (it moves the open day ±7 and snaps the
     strip to that Monday); the strip's flanking arrows SLIDE the window one
     day, revealing the next day without changing what's open. The old design
     put the week arrows beside the day's name, which read as "next day" and
     stepped seven — Isaac kept getting caught by it. */
  const goWeek = (dir: 1 | -1) => {
    const target = plusDays(openDay, dir * 7);
    setStripStart(mondayOf(target));
    show(target);
  };
  const goToday = () => {
    setStripStart(mondayOf(today));
    show(today);
  };
  /* THE DAY-AT-A-TIME SLIDE WENT WITH THE STRIP'S OWN ARROWS. It moved the
     window one card without fetching or moving the open day — a free look at
     tomorrow. Two pairs of arrows cannot both sit on a 48px row, and of the
     two this was the quieter: the week arrows reach every day it reached, and
     they are the pair people found. If the free peek is missed, it comes back
     as a shift-click on these, or as the window sliding instead of stepping. */

  /* What the middle of the header calls the window. Named weeks only when the
     window IS a week — once it has been slid off a Monday it spans two, and
     the honest label is its own two ends. */
  const thisMon = mondayOf(today);
  const weekWord =
    stripStart !== mondayOf(stripStart)
      ? `${fmtAuDayMonth(stripStart)} – ${fmtAuDayMonth(plusDays(stripStart, 6))}`
      : stripStart === thisMon
        ? "This week"
        : stripStart === plusDays(thisMon, 7)
          ? "Next week"
          : stripStart === plusDays(thisMon, -7)
            ? "Last week"
            : `Week of ${fmtAuDayMonth(stripStart)}`;

  /* The now-line's minute — the same reading the capacity tab takes, from the
     one hook that owns the rule. */
  const nowMin = useNowMin(today);

  /* ── the rail's width, its scroll, and the edge fade ──
     The width is MEASURED, because the hours share it: opening the inspector
     narrows the rail and the day re-lays inside what is left. Measured in a
     layout effect first, so the first paint is already at the right scale,
     and observed after, for the inspector and the window. */
  const railRef = useRef<HTMLDivElement>(null);
  const [railW, setRailW] = useState(0);
  const [atEnd, setAtEnd] = useState(false);
  const judgeEnd = () => {
    const r = railRef.current;
    if (r) setAtEnd(r.scrollLeft + r.clientWidth >= r.scrollWidth - 2);
  };
  const hasRail = !!day && day.totalBookings > 0;
  useLayoutEffect(() => {
    const r = railRef.current;
    if (!r) return;
    const measure = () => {
      setRailW(r.clientWidth);
      setAtEnd(r.scrollLeft + r.clientWidth >= r.scrollWidth - 2);
    };
    measure();
    /* Feature-checked: jsdom has no ResizeObserver, and the rail still lays
       out at its floor without one. */
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(r);
    return () => ro?.disconnect();
  }, [hasRail]);
  const hours = day ? (day.railEnd - day.railStart) / 60 : 1;
  const pxPerHour = Math.max(MIN_PX_PER_HOUR, railW / hours);

  const landRail = useEffectEvent(() => {
    const r = railRef.current;
    if (!r || !day || day.totalBookings === 0) return;
    const first = day.lanes.reduce((m, l) => Math.min(m, l.blocks[0].startMin), Infinity);
    let target = ((first - day.railStart) / 60) * pxPerHour - 24;
    if (openDay === today && nowMin !== null && nowMin >= day.railStart && nowMin <= day.railEnd) {
      target = ((nowMin - day.railStart) / 60) * pxPerHour - r.clientWidth / 2;
    }
    r.scrollLeft = Math.max(0, target);
    judgeEnd();
  });
  /* Lands once per day, and once more when the width first arrives — never
     on a later width change, or opening the inspector would scroll the block
     you just clicked out from under the pointer. */
  const measured = railW > 0;
  useLayoutEffect(() => {
    landRail();
  }, [day, openDay, measured]);

  /* ── header ──
     Three stations, and NOTHING IN IT MAY MOVE AS YOU STEP. Left: the open
     day's name. Middle: the week stepper, with the Today pill on its left.
     Right: the day's summary chips. The day-to-day arrows live on the strip
     itself, flanking the cards they move.

     This was one flex row with auto margins, which centres on THE LEFTOVERS
     rather than on the card — and the leftovers changed constantly: the
     weekday name is wider on a Wednesday, the Today pill comes and goes, and
     the chips vanish entirely on a day with nothing booked, which threw the
     stepper at the right-hand edge exactly while you were clicking through
     empty weeks. The three stations are grid columns now, and the middle one
     is centred on the CARD. The Today pill sits in a reserved slot beside the

     The capacity window wears this header too, from its own tab. */
  /* ── ONE TOOLBAR ─────────────────────────────────────────────────────
     Three bands stood between the card and the first crew: the date with its
     week stepper, the seven-day strip, and the board's own top rule — 176px
     at 1600x900, on a screen whose whole point is how many crews you can see.
     They are one 48px row now: step the week, read the day, reset to today,
     pick a day, and the day's figures on the right.

     WHAT WENT, AND WHY IT COULD.
     · The strip's own ‹ › slid the window one day. That is a third grain
       beside the week stepper and picking a chip, and the two that remain
       reach every day the third did.
     · The day cards were three stacked lines — weekday, date, count — at 60px
       tall so the strip could read as cards. On one row they are one line,
       and the row is what carries them.
     · The calendar in a tinted blue square is the icon-in-a-tinted-square the
       design file names as the inherited look, in a blue that is not a state.
       The date says it is a date.
     · The three figure chips are a sentence. A chip is for something you tap
       (law 26), and nobody taps these.

     The capacity window wears this row too, from its own tab. */
  const head = (
    <div className="wb2-tbar">
      <div className="wb2-tbstep" role="group" aria-label="Week">
        <button className="wb2-tbarrow" aria-label="The week before" onClick={() => goWeek(-1)}>
          <Icon name="chevL" size={15} />
        </button>
        <button className="wb2-tbarrow" aria-label="The week after" onClick={() => goWeek(1)}>
          <Icon name="chevR" size={15} />
        </button>
      </div>
      <h2 className="wb2-tbh2">{fmtAuWeekdayDayMonth(openDay)}</h2>
      {/* The window's name only when it is not this week — on this week the
          seven days beside it already say which week it is — and Today only
          once there is somewhere to come back from. The row is full at a
          laptop's width, and both were words saying what the filled day
          chip already shows. */}
      {stripStart !== thisMon && <span className="wb2-tbwin">{weekWord}</span>}
      {(openDay !== today || stripStart !== thisMon) && (
        <button className="wb2-tbtoday" onClick={goToday}>
          Today
        </button>
      )}
      <span className="wb2-tbsep" aria-hidden="true" />
      <div className="wb2-schdays" role="group" aria-label="Days">
        {/* A DAY IS ITS NAME. Each chip carried the day's booking count in a
            figure box, and the row ended on a sentence of the open day's
            figures — booked, hours, on the road, jobs — which the board under
            it already shows by being drawn (Isaac, 2026-09-17: "get rid of
            number next to date, and this text"). */}
        {week.map((iso) => (
          <button
            key={iso}
            type="button"
            className={
              "wb2-schday" +
              (iso === openDay ? " on" : "") +
              (iso === today ? " today" : "") +
              (isWeekendISO(iso) ? " we" : "")
            }
            aria-pressed={iso === openDay}
            aria-label={fmtAuWeekdayDayMonth(iso)}
            onClick={() => show(iso)}
          >
            <span className="cw">{DOW[dowOfISO(iso)]}</span>
            <span className="cd">{parseInt(iso.slice(8, 10), 10)}</span>
          </button>
        ))}
      </div>
      <ToolbarSync />
    </div>
  );

  /* THE FIRST THING A DISCONNECTED ACCOUNT SEES. Schedule is the landing tab
     of the landing side, and it is the one surface with no native half to
     fall back on — so the gap is explained here or it isn't explained before
     somebody gives up. The day picker stays above it: the shape of the screen
     is part of the answer to "what would this look like connected?". */
  const gap = sm8Gap({ connected, syncing });
  if (gap) {
    return (
      <>
        {head}
        <Sm8Gap kind={gap} surface="diary" manage={manage} />
      </>
    );
  }

  const categoriesOnDay = day
    ? [
        ...new Map(
          day.lanes
            .flatMap((l) => l.blocks)
            .filter((b) => !b.tracked && b.categoryName && b.categoryColour)
            .map((b) => [b.categoryName as string, b.categoryColour as string])
        ).entries(),
      ].sort((a, b) => a[0].localeCompare(b[0]))
    : [];
  /* The lane dots' two gates, which are the block treatment's own: a day that
     has begun, and an account that records time at all. */
  const hollowReads = openDay <= today && !!day?.tracksTime;
  /* The minute past which an unstarted booking is late — the same judgement
     `blockState` makes per block, in the shape lanePresence wants. A day
     already gone is late in all of it; today needs the browser's clock, and
     without a trustworthy one nothing is claimed. */
  const overdueBefore = openDay < today ? 24 * 60 : openDay === today ? nowMin : null;

  /* WHAT ONE BLOCK IS DOING — asked of lib/workboard/focus.ts, which is the
     same call the focus card makes. The rail draws the answer as treatment
     and the card writes it as a word, and the two must not be able to drift
     apart: a card that says "not started" beside a block drawn as started is
     worse than either mark alone.

     FILLED MEANS SOMEONE IS ON IT; HOLLOW MEANS IT IS STILL ONLY BOOKED — the
     three gates and the late case are stated there, over this clock. `nowMin`
     is null when the browser's date disagrees with the board's, and lateness
     is then simply not claimed. */
  const clock: DayClock = {
    dayISO: openDay,
    today,
    nowMin,
    tracksTime: !!day?.tracksTime,
  };
  const blockState = (b: ScheduleBlock) => blockStateOf(b, clock);

  const hasBare = day
    ? day.lanes.some((l) => l.blocks.some((b) => !b.tracked && !b.categoryColour))
    : false;
  const hasTracked = day ? day.lanes.some((l) => l.blocks.some((b) => !!b.tracked)) : false;
  const hasDone = day ? day.lanes.some((l) => l.blocks.some((b) => b.closure === "done")) : false;
  const hasStale = day
    ? day.lanes.some((l) => l.blocks.some((b) => b.closure === "stale"))
    : false;
  /* The legend only claims what the day actually shows — on an account that
     never clocks on, `tracksTime` is false, no block is hollow, and offering
     a key for a state nothing is in would be its own small lie.

     BOTH ASK `blockState`, which is the same call the rail makes to draw. It
     used to restate the hollow rule here in its own words, and a key that
     derives a treatment separately from the thing it is a key FOR is one edit
     away from describing a board nobody is looking at. */
  const hasIdle = day ? day.lanes.some((l) => l.blocks.some((b) => blockState(b).hollow)) : false;
  const hasLate = day ? day.lanes.some((l) => l.blocks.some((b) => blockState(b).late)) : false;

  /* THE JOB BROUGHT FORWARD — read off the LAID-OUT day, so the cards are
     exactly the blocks that are on screen. The capacity window opens its days
     into the same card from the same function. */
  const focus = focusJob && day ? focusJobOf(day, focusJob, clock) : null;

  const closeFocus = () => {
    const was = focusJob;
    setFocusJob(null);
    if (was) blockRefs.current.get(was)?.focus();
  };

  /* THE BLOCKS APPEAR; THEY DO NOT ARRIVE (law 18). They used to rise into
     place one after another, left to right across the rail — the staggered
     entrance docs/design.md retires. */

  return (
    <>
      {head}
      {/* THE JOB BROUGHT FORWARD, beside the day rather than over it. The
          focus stack this replaces was a scrim and a card per person; the
          inspector holds the same `focusJobOf` reading with the board still in
          view, and the next block clicked replaces it. The rail is laid out in
          pixels per hour, so opening it narrows the view and moves no block. */}
      <Split
        aside={
          focus ? (
            <FocusInspector
              job={focus}
              day={openDay}
              onClose={closeFocus}
              onOpen={() => {
                const job = focusJob ? jobById.get(focusJob) : null;
                /* the day-state rides along so the sheet's header can wear the
                   same reading the rail drew — the statuses the sheet already
                   chips (Quote, Unsuccessful, Completed) stay its own. The
                   panel stays open under the sheet: closing the sheet comes
                   back to the job you were reading. */
                if (job) onOpenJob(job, dayStateOfMarks(focus.marks));
              }}
            />
          ) : null
        }
      >

        {shelf.length > 0 && (
          <div className="wb2-schshelf">
            <b>Also on this day</b>
            {shelf.map((s) => (
              <button
                key={s.key}
                type="button"
                className="wb2-schsv"
                onClick={() => onOpenTracked({ kind: s.kind, id: s.id })}
              >
                {s.label}
                {s.sub && <em>{s.sub}</em>}
              </button>
            ))}
          </div>
        )}

        {loading && !current && <p className="wb2-hint wb2-schload">Reading the day…</p>}

        {day && day.totalBookings === 0 && (
          <div className="wb2-empty">
            <Icon name="calendar" size={20} />
            <b>Nobody was dispatched</b>
            <em>A clear day in ServiceM8 — jobs waiting on a day are under Work orders, not here.</em>
          </div>
        )}

        {day && day.totalBookings > 0 && (
          <div className="wb2-schboard">
            <div className="wb2-schnames">
              {/* how many people are out, over the column that lists them */}
              <div className="wb2-schnh">
                {crewCount} {crewCount === 1 ? "crew" : "crews"}
              </div>
              {day.lanes.map((l) => {
                /* The gates are the block treatment's, unchanged: a day that has
                   begun, and an account that records time at all. An account
                   that never clocks on gets no dots rather than a column of
                   empty rings saying nothing. */
                const presence = hollowReads ? lanePresence(l.blocks, overdueBefore) : null;
                return (
                <div
                  key={l.staffUuid || "unassigned"}
                  className={"wb2-schn" + (l.staffUuid === "" ? " none" : "")}
                  style={{ height: laneHeight(l.rows.length) }}
                >
                  <b>
                    {/* WHO IS ACTUALLY OUT THERE, before you look at the rail.
                        Colour is not the only carrier and does not need to be:
                        every state here is already written on the blocks it
                        summarises — hollow ones say "not started", overdue ones
                        say so in their own label. The dot is emphasis, and the
                        word rides with it for anyone who cannot see it. The
                        dot's seat stays when there is nothing to claim, so every
                        name starts on the same line. */}
                    <span
                      className={"wb2-schpd" + (presence ? " " + presence : "")}
                      aria-hidden="true"
                    />
                    <span className="wb2-schnn">{l.name}</span>
                    {presence && (
                      <span className="wb2-sr">
                        {presence === "late"
                          ? " — nothing recorded yet"
                          : presence === "wait"
                            ? " — not started"
                            : " — started"}
                      </span>
                    )}
                  </b>
                  {/* The load is the line under the name. The 3px meter under it
                      said the same hours a second time, as a bar. */}
                  <em>
                    {l.blocks.length} {l.blocks.length === 1 ? "booking" : "bookings"},{" "}
                    {fmtHoursShort(l.minutes)}
                  </em>
                </div>
                );
              })}
            </div>

            <div className={"wb2-schrailwrap" + (atEnd ? " atend" : "")}>
              <div className="wb2-schrail" ref={railRef} onScroll={judgeEnd}>
                <div
                  className="wb2-schinner"
                  style={{
                    width: hours * pxPerHour,
                    "--hr": `${pxPerHour}px`,
                  } as CSSProperties}
                >
                  <div className="wb2-schhours">
                    {Array.from({ length: hours }, (_, i) => day.railStart + i * 60).map((m) => (
                      <span key={m} className="wb2-schhr" style={{ width: pxPerHour }}>
                        {clockLabel(m)}
                      </span>
                    ))}
                  </div>

                  {day.lanes.map((l) => (
                    <div
                      key={l.staffUuid || "unassigned"}
                      className="wb2-schlane"
                      style={{ height: laneHeight(l.rows.length) }}
                    >
                      {l.rows.flatMap((row, ri) =>
                        row.map((b) => {
                          const left = ((b.startMin - day.railStart) / 60) * pxPerHour;
                          const w = Math.max(
                            ((b.endMin - b.startMin) / 60) * pxPerHour,
                            46
                          );
                          const { hollow, late } = blockState(b);
                          const cls =
                            "wb2-schb" +
                            (b.tracked ? " proj" : "") +
                            (b.closure === "done" ? " done" : "") +
                            (b.closure === "stale" ? " stale" : "") +
                            (b.status === "Unsuccessful" ? " dan" : "") +
                            (b.status === "Quote" ? " qt" : "") +
                            (hollow ? " idle" : "") +
                            (late ? " late" : "") +
                            (w < TIGHT_PX ? " tight" : "") +
                          (b.remoteId === focusJob ? " on" : "") +
                            "";
                          /* OWNERSHIP OUTRANKS CATEGORY: a job on one of our
                             boards wears the tracked blue, everything else is
                             painted from its ServiceM8 category. */
                          const paint = blockPaint(b);
                          return (
                            <button
                              key={b.key}
                              type="button"
                              className={cls}
                              style={{
                                left,
                                width: w - 4,
                                top: LANE_PAD_PX + ri * LANE_ROW_PX,
                                height: BLOCK_PX,
                                "--fill": paint.fill,
                                "--btext": paint.ink,
                                "--chip": paint.chip,
                                "--bar": paint.bar,
                                "--pale": paint.pale,
                                "--pale-edge": paint.paleEdge,
                              } as CSSProperties}
                              title={blockTitle(b)}
                              aria-label={`Job ${b.jobNumber ? `#${b.jobNumber}` : ""} ${
                                b.clientName ?? ""
                              }, ${clockLabel(b.startMin)} to ${clockLabel(b.endMin)}${
                                /* the outline and the ring are not available to a
                                   screen reader, so the state is spoken as well */
                                b.closure === "stale"
                                  ? ", marked complete in ServiceM8"
                                  : b.status === "Unsuccessful"
                                    ? ", didn't go ahead"
                                    : late
                                      ? ", nothing recorded yet"
                                      : hollow
                                        ? ", not started"
                                        : b.closure === "done"
                                          ? ", done"
                                          : ""
                              }`}
                              ref={(el) => {
                                if (el) blockRefs.current.set(b.remoteId, el);
                              }}
                              /* A CLICK BRINGS IT FORWARD; it no longer opens
                                 the sheet directly. Every block does it, crew or
                                 not — a stack of one is still the same rule, and
                                 "Open job" then sits in the same place whatever
                                 was clicked. */
                              aria-pressed={b.remoteId === focusJob}
                            onClick={() => setFocusJob(b.remoteId)}
                            >
                              {/* THE CLIENT LEADS, the number follows. The name
                                  has the first line to itself; the second line
                                  opens on the job number — on every card, for
                                  cross-referencing ServiceM8 — then the category
                                  IN WORDS, so the hue is never the only thing
                                  naming one; the third line is where. A block
                                  too narrow for words keeps the number alone. */}
                              <b>{b.clientName ?? "Unnamed client"}</b>
                              <span className="wb2-schbm">
                                {b.jobNumber && <u>{b.jobNumber}</u>}
                                <em>
                                  {[blockLabel(b), b.status === "Quote" ? "Quote" : null]
                                    .filter(Boolean)
                                    .join(", ")}
                                </em>
                              </span>
                              {(b.suburb || b.closure === "stale") && (
                                <i>
                                  {[
                                    b.suburb,
                                    /* in words, because nothing on the block's paint
                                       says it, and a screen reader would otherwise
                                       hear a normal booking */
                                    b.closure === "stale" ? "Marked complete in ServiceM8" : null,
                                  ]
                                    .filter(Boolean)
                                    .join(", ")}
                                </i>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  ))}

                  {openDay === today &&
                    nowMin !== null &&
                    nowMin >= day.railStart &&
                    nowMin <= day.railEnd && (
                      <span
                        className="wb2-schnow"
                        style={{ left: ((nowMin - day.railStart) / 60) * pxPerHour }}
                        /* the cap's text — the sheet draws it, so the line and
                           its label can never end up in two different places */
                        data-now={clockLabel(nowMin)}
                        aria-hidden="true"
                      />
                    )}
                </div>
              </div>
            </div>
          </div>
        )}


        {day && day.totalBookings > 0 && (
          <div className="wb2-schfoot">
            <div className="wb2-schkey">
              {categoriesOnDay.map(([name, colour]) => (
                <span key={name}>
                  <i style={{ background: scheduleBlockPaint(colour).bar }} />
                  {name}
                </span>
              ))}
              {hasBare && (
                <span>
                  <i style={{ background: NO_CATEGORY_PAINT.bar }} />
                  No category
                </span>
              )}
              {hasTracked && (
                <span>
                  <i style={{ background: TRACKED_PAINT.bar }} />
                  On a board here
                </span>
              )}
              {/* The day's OTHER reading, and the one that needs saying in words:
                  a pale block is finished, not a category we forgot to colour.

                  THE SWATCH SHOWS THE CAP, because the cap is where the state
                  is. This used to be a white rectangle, back when the block was
                  one too — and a key that points at a treatment nothing wears
                  any more is worse than no key. */}
              {hasIdle && (
                <span>
                  <i className="hollow" style={{ "--kcap": NO_CATEGORY_PAINT.bar } as CSSProperties} />
                  Not started
                </span>
              )}
              {/* the one thing on the rail that is actually wrong, and the only
                  one carrying a mark — so it is the one entry here that is an
                  icon rather than a swatch. */}
              {hasLate && (
                <span>
                  <i className="mark" aria-hidden="true">
                    !
                  </i>
                  Nothing recorded yet
                </span>
              )}
              {hasDone && (
                <span>
                  <i
                    style={{
                      background: NO_CATEGORY_PAINT.pale,
                      boxShadow: `inset 0 0 0 1px ${NO_CATEGORY_PAINT.paleEdge}`,
                    }}
                  />
                  Done and closed
                </span>
              )}
              {hasStale && (
                <span>
                  <i
                    style={{
                      background: NO_CATEGORY_PAINT.fill,
                      boxShadow: `inset 4px 0 0 ${NO_CATEGORY_PAINT.bar}`,
                    }}
                  />
                  Marked complete in ServiceM8, still booked
                </span>
              )}
            </div>
          </div>
        )}
      </Split>
    </>
  );
}
