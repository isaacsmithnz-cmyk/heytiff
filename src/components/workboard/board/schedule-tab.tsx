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
import { useNowMin } from "./use-now-min";
import { ScheduleFocus } from "./schedule-focus";

/* Schedule — who is on what, and when. The Dispatch Board's question,
   answered from the mirror this account already syncs: one lane per staff
   member, dispatched bookings laid on a time rail, one day at a time.

   FETCH-ON-OPEN. This is the fourth tab, not the first; the Workboard page
   already loads three boards, so a day arrives when it is asked for (the
   JobSheet's pattern) and is cached for the session. The strip's counts ride
   the same payload — one round trip per day, none per glance.

   NO TIME TEXT ON A BLOCK. Its place on the rail already says when; writing
   "7am–3pm" on the card as well is double handling (Isaac's words). The
   times live in the hover title and the aria-label, where they cost nothing.

   TWO COLOUR CHANNELS, ONE OVERRIDE. Category washes a block and colours its
   cap (the same axis the list rows' catdot uses); status is a second reading —
   Completed mutes and takes a tick, Unsuccessful takes the danger ring, a
   Quote takes a dashed edge. And OWNERSHIP OUTRANKS CATEGORY: a job promoted
   onto one of our boards leaves the palette and wears the tracked blue with
   the word beside the number, because it isn't pool work any more.

   NOTHING GOES WHITE, AND ONE THING GETS A MARK. A booking nobody has clocked
   on to keeps its category and hollows its cap. That is the ORDINARY state of
   most of a day rather than an exception — the morning this was measured, ten
   of twenty-one bookings were unstarted and seven more were closed, so a rail
   that whitened the first and paled the second showed seventeen white
   rectangles and hid the three that were live. The one genuine exception —
   past its start with nothing recorded — carries a mark in the corner
   instead, in the same slot the done tick uses. */

const PX_PER_HOUR = 110;
/* A sub-row must HOLD its own type: three lines at 1.3 line-height plus two
   2px gaps plus 10px of block padding is ~58px, and the first live walk
   shipped 56 — every suburb line's descenders clipped against the block's
   overflow:hidden ("bottom of names cut off"). The row owns the arithmetic:
   66 − 6 (block inset) = 60px of block for ~58px of content. */
const LANE_ROW_PX = 66;
const LANE_PAD_PX = 5;
/** Below this width a block drops to its number alone — three clipped lines
    say less than one whole one. */
const TIGHT_PX = 90;
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
  /** The Work orders tab's "waiting on a day" count — the dispatch board's
      unscheduled pane, already answered by the tab that owns the list. */
  waitingCount: number;
  onOpenJob: (job: AllJobsMirrorJob, state?: ScheduleJobState | null) => void;
  onOpenTracked: (target: { kind: "visit" | "project"; id: string }) => void;
  onGoWork: () => void;
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
    .join(" · ");
}

export function ScheduleTab({
  today,
  connected,
  syncing,
  manage,
  tracked,
  dayCache,
  shelfItems,
  waitingCount,
  onOpenJob,
  onOpenTracked,
  onGoWork,
}: Props) {
  const [openDay, setOpenDay] = useState(today);
  /** The first day the strip shows. A WINDOW, not a week: the flanking arrows
      slide it one day at a time (Isaac's call — click past Sunday and Monday
      of the next week walks in), so it starts on a Monday and then goes where
      it's pushed. The week stepper in the header snaps it back to Mondays. */
  const [stripStart, setStripStart] = useState(() => mondayOf(today));
  /** Every day-count the session has learned, merged across payloads — the
      sliding window crosses week boundaries, and a count learned last week is
      still the count. */
  const [counts, setCounts] = useState<Record<string, number>>(
    () => dayCache.current.get(today)?.weekCounts ?? {}
  );
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
      setCounts((c) => ({ ...c, ...p.weekCounts }));
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
       from it lands on the day that was already on screen. Both that payload
       and its week counts are seeded in useState above, where a value that is
       ALREADY KNOWN belongs: setting them here instead is a second render
       before first paint, and the linter is right to say so.

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
  const slide = (dir: 1 | -1) => setStripStart(plusDays(stripStart, dir));

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

  /* ── the rail's scroll: land where the day is, own the edge fade ── */
  const railRef = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);
  const judgeEnd = () => {
    const r = railRef.current;
    if (r) setAtEnd(r.scrollLeft + r.clientWidth >= r.scrollWidth - 2);
  };
  const landRail = useEffectEvent(() => {
    const r = railRef.current;
    if (!r || !day || day.totalBookings === 0) return;
    const first = day.lanes.reduce((m, l) => Math.min(m, l.blocks[0].startMin), Infinity);
    let target = ((first - day.railStart) / 60) * PX_PER_HOUR - 24;
    if (openDay === today && nowMin !== null && nowMin >= day.railStart && nowMin <= day.railEnd) {
      target = ((nowMin - day.railStart) / 60) * PX_PER_HOUR - r.clientWidth / 2;
    }
    r.scrollLeft = Math.max(0, target);
    judgeEnd();
  });
  useLayoutEffect(() => {
    landRail();
  }, [day, openDay]);

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
     stepper for the same reason — see the notes over .wb2-schhd.

     The capacity window wears this header too, from its own tab. */
  const head = (
    <div className="wb2-chd wb2-schhd">
      <div className="wb2-schhla">
        <span className="wb2-ci blue">
          <Icon name="calendar" size={19} />
        </span>
        <div className="wb2-mchead">
          <b>{fmtAuWeekdayDayMonth(openDay)}</b>
        </div>
      </div>
      <div className="wb2-schmid">
        {(openDay !== today || stripStart !== thisMon) && (
          <button className="wb2-mcnow" onClick={goToday}>
            Today
          </button>
        )}
        <div className="wb2-schweek" role="group" aria-label="Week">
          <button className="wb2-mcarrow" aria-label="The week before" onClick={() => goWeek(-1)}>
            <Icon name="chevL" size={15} />
          </button>
          <b>{weekWord}</b>
          <button className="wb2-mcarrow" aria-label="The week after" onClick={() => goWeek(1)}>
            <Icon name="chevR" size={15} />
          </button>
        </div>
      </div>
      <div className="wb2-schhrr">
        {day && day.totalBookings > 0 && (
          <span className="wb2-mcsum">
            <span className="wb2-chip">
              {day.totalBookings} booked · {fmtHoursShort(day.totalMinutes)}
            </span>
            <span className="wb2-chip">{day.lanes.length} on the road</span>
            <span className="wb2-chip ok">
              {day.jobCount} {day.jobCount === 1 ? "job" : "jobs"}
            </span>
          </span>
        )}
      </div>
    </div>
  );

  /* ── the seven-day strip, with its own arrows ──
     The flanking arrows slide the WINDOW one day — click past Sunday and next
     week's Monday walks in — without touching the open day. Picking a day is
     still the card's own job. */
  const strip = (
    <div className="wb2-schstrip">
      <button className="wb2-mcarrow" aria-label="The day before" onClick={() => slide(-1)}>
        <Icon name="chevL" size={15} />
      </button>
      <div className="wb2-schdays" role="group" aria-label="Days">
        {week.map((iso) => {
          const n = counts[iso] ?? null;
          return (
            <button
              key={iso}
              type="button"
              className={
                "wb2-schday" +
                (iso === openDay ? " on" : "") +
                (iso === today ? " today" : "") +
                (iso < today ? " past" : "") +
                (isWeekendISO(iso) ? " we" : "") +
                (n === 0 ? " free" : "")
              }
              aria-pressed={iso === openDay}
              aria-label={`${fmtAuWeekdayDayMonth(iso)}${n !== null ? `, ${n} booked` : ""}`}
              onClick={() => show(iso)}
            >
              <span className="cw">{DOW[dowOfISO(iso)]}</span>
              <span className="cd">{parseInt(iso.slice(8, 10), 10)}</span>
              <span className="cn">{n === null ? "" : n === 0 ? "clear" : n}</span>
            </button>
          );
        })}
      </div>
      <button className="wb2-mcarrow" aria-label="The day after" onClick={() => slide(1)}>
        <Icon name="chevR" size={15} />
      </button>
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

  /* The entrance stagger reads left to right across the whole rail. Built as a
     lookup, not a counter incremented inside the map: React Compiler 1.0
     cannot lower an update expression on a variable a lambda captures, and a
     memoised subtree would not re-run one anyway. */
  const staggerAt = new Map<string, number>();
  if (day) {
    let n = 0;
    for (const lane of day.lanes)
      for (const row of lane.rows)
        for (const b of row) {
          staggerAt.set(b.key, n);
          n += 1;
        }
  }

  return (
    <>
      {head}
      {strip}

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
            <div className="wb2-schnh" />
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
                style={{ height: l.rows.length * LANE_ROW_PX + LANE_PAD_PX * 2 }}
              >
                <b>
                  {/* WHO IS ACTUALLY OUT THERE, before you look at the rail.
                      Colour is not the only carrier and does not need to be:
                      every state here is already written on the blocks it
                      summarises — hollow ones say "not started", overdue ones
                      say so in their own label. The dot is emphasis, and the
                      word rides with it for anyone who cannot see it. */}
                  {presence && (
                    <span className={"wb2-schpd " + presence} aria-hidden="true" />
                  )}
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
                <em>
                  {l.blocks.length} {l.blocks.length === 1 ? "booking" : "bookings"} ·{" "}
                  {fmtHoursShort(l.minutes)}
                </em>
                {/* utilisation against an 8h day — neutral, a fact not a fault */}
                <span className="wb2-schmeter" aria-hidden="true">
                  <i style={{ width: `${Math.min(100, Math.round((l.minutes / 480) * 100))}%` }} />
                </span>
              </div>
              );
            })}
          </div>

          <div className={"wb2-schrailwrap" + (atEnd ? " atend" : "")}>
            <div className="wb2-schrail" ref={railRef} onScroll={judgeEnd}>
              <div
                className="wb2-schinner"
                style={{
                  width: ((day.railEnd - day.railStart) / 60) * PX_PER_HOUR,
                  "--hr": `${PX_PER_HOUR}px`,
                } as CSSProperties}
              >
                <div className="wb2-schhours">
                  {Array.from(
                    { length: (day.railEnd - day.railStart) / 60 },
                    (_, i) => day.railStart + i * 60
                  ).map((m) => (
                    <span key={m} className="wb2-schhr" style={{ width: PX_PER_HOUR }}>
                      {clockLabel(m)}
                    </span>
                  ))}
                </div>

                {day.lanes.map((l) => (
                  <div
                    key={l.staffUuid || "unassigned"}
                    className="wb2-schlane"
                    style={{ height: l.rows.length * LANE_ROW_PX + LANE_PAD_PX * 2 }}
                  >
                    {l.rows.flatMap((row, ri) =>
                      row.map((b) => {
                        const left = ((b.startMin - day.railStart) / 60) * PX_PER_HOUR;
                        const w = Math.max(
                          ((b.endMin - b.startMin) / 60) * PX_PER_HOUR,
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
                              width: w - 3,
                              top: LANE_PAD_PX + ri * LANE_ROW_PX,
                              height: LANE_ROW_PX - 6,
                              animationDelay: `${Math.min((staggerAt.get(b.key) ?? 0) * 14, 400)}ms`,
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
                            onClick={() => setFocusJob(b.remoteId)}
                          >
                            {/* THE CLIENT LEADS. The job number is the one
                                thing on this block that means nothing until
                                you have looked it up, and it used to be the
                                biggest word on it. It rides beside the name as
                                a chip now — still there for cross-referencing
                                ServiceM8, no longer the headline — and a tight
                                block drops back to it alone, which is the old
                                behaviour unchanged. The second line becomes
                                the category IN WORDS, so the hue is never the
                                only thing naming one. */}
                            <span className="wb2-schbh">
                              <b>{b.clientName ?? "Unnamed client"}</b>
                              {b.jobNumber && <u>{b.jobNumber}</u>}
                            </span>
                            <em>
                              {blockLabel(b)}
                              {b.status === "Quote" ? " · Quote" : ""}
                              {/* in words, because an amber ring alone would
                                  leave a screen reader with a normal booking */}
                              {b.closure === "stale" ? " · Marked complete in ServiceM8" : ""}
                            </em>
                            {b.suburb && <i>{b.suburb}</i>}
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
                      style={{ left: ((nowMin - day.railStart) / 60) * PX_PER_HOUR }}
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

      {focus && (
        <ScheduleFocus
          job={focus}
          onClose={closeFocus}
          onOpen={() => {
            const job = focusJob ? jobById.get(focusJob) : null;
            /* the day-state rides along so the sheet's header can wear the
               same reading the rail drew — the statuses the sheet already
               chips (Quote, Unsuccessful, Completed) stay its own */
            const dayState = dayStateOfMarks(focus.marks);
            setFocusJob(null);
            if (job) onOpenJob(job, dayState);
          }}
        />
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
          {waitingCount > 0 && (
            <button type="button" className="wb2-schwait" onClick={onGoWork}>
              {waitingCount} work {waitingCount === 1 ? "order is" : "orders are"} waiting on a
              day — see Work orders →
            </button>
          )}
        </div>
      )}
    </>
  );
}
