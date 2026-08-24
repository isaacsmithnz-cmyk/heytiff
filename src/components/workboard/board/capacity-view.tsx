"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { fmtAuDayMonth, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { plusDays } from "@/lib/workboard/dates";
import { mondayOf } from "@/lib/workboard/board-status";
import { scheduleCapacity, scheduleDay, setScheduleCapacity } from "@/app/actions/workboard";
import type { CapacityPayload } from "@/lib/workboard/capacity-query";
import type { SchedulePayload } from "@/lib/workboard/schedule-query";
import {
  CAPACITY_WINDOW_DAYS,
  capacityMonthTotal,
  capacityWindow,
  daysFrom,
  type CapacityAllocation,
} from "@/lib/workboard/capacity";
import {
  fmtHoursShort,
  layoutScheduleDay,
  type ScheduleBlock,
  type ScheduleTracked,
} from "@/lib/workboard/schedule";
import {
  blockLabel,
  blockPaint,
  dayStateOfMarks,
  focusJobOf,
  type DayClock,
} from "@/lib/workboard/focus";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import { capacityCellPaint } from "@/lib/workboard/capacity-paint";
import { WbModal } from "../wb-modal";
import { ScheduleFocus } from "./schedule-focus";
import type { ScheduleJobState } from "./schedule-tab";

/* Capacity — the Schedule tab's other side: how full each day is, one gauge
   per cell. The maths lives in lib/workboard/capacity.ts (pure, tested) and
   the cell's paint in capacity-paint.ts; what matters HERE is the wiring,
   the rail's pattern repeated:

   A ROLLING FOUR WEEKS, NOT A MONTH. Isaac's call: the question this screen
   answers is "where can I put work", and the answer starts from now — so the
   current week is always the top row and the grid runs four Mondays deep. A
   month grid spent its first fortnight showing days already gone.

   FETCH-ON-OPEN, CACHED FOR THE SESSION. A window arrives when it is asked
   for and lands in a cache the parent owns, so flipping Day ↔ Capacity does
   not re-ask. The day panel reads through the SAME per-day cache the rail
   uses — one law for what a day holds, one round trip for both views.

   THE CELL IS A GAUGE. It fills from the bottom as the day does — green
   while there's room, red as it runs out — with the percentage over it in
   whichever of black or white actually reads (capacity-paint.ts measures,
   never guesses). The hours live in the cell's title and the day panel, not
   on the face. A day with no denominator (a weekend, an unset crew) gets NO
   figure and NO gauge: fillPct is null there, not zero, and drawing "0%"
   would dress a division by zero up as insight — capacity.ts's central
   promise, kept on the screen.

   THE DAY IS A MODAL, AND THE JOBS IN IT ARE THE RAIL'S CARDS. It used to
   open as a panel below the weeks, which never moved the grid but left a
   28-cell calendar and a job list fighting over one screen — the list ran off
   the bottom while three-quarters of the window sat above it, unread. Isaac's
   call: bring the day forward instead, in the same card the rail's blocks
   come forward in, and let the grid stay whole underneath it.

   AND THE JOBS ARE PAINTED. A row here is the block that would be on the
   rail: the category's wash, its cap, the number as a chip. Clicking one
   opens the SAME focus card the rail opens — literally the same component
   over the same `focusJobOf` — so "Back to the day" comes back here and
   "Open job" opens the sheet. One law for what a booking is doing; the
   capacity window does not get its own slightly different reading. */

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Props = {
  today: string;
  manage: boolean;
  /** Any day in the window on show (its Monday is derived here) — owned by
      the tab so the choice survives a flip to Day and back. */
  anchor: string;
  onAnchor: (iso: string) => void;
  /** Window-start → payload, owned by the tab for the same reason. */
  capCache: { current: Map<string, CapacityPayload> };
  /** THE RAIL'S OWN day cache, shared on purpose: a day opened here is warm
      when the rail visits it, and the panel obeys the same law as the lanes
      because it is literally the same read. */
  dayCache: { current: Map<string, SchedulePayload> };
  /** The Day/Capacity switcher, built by the tab — it lives in both headers
      so the header reads as one thing changing its contents. */
  switcher: React.ReactNode;
  /** ServiceM8 job uuid → the board that owns it. Ownership recolours, here
      exactly as it does on the rail. */
  tracked: Map<string, ScheduleTracked>;
  /** The browser's clock in minutes, or null when it cannot be trusted — the
      tab owns the reading, and a day card claims lateness only from it. */
  nowMin: number | null;
  /** The sheet, opened from a job brought forward — the rail's own door. */
  onOpenJob: (job: AllJobsMirrorJob, state?: ScheduleJobState | null) => void;
};

export function CapacityView({
  today,
  manage,
  anchor,
  onAnchor,
  capCache,
  dayCache,
  switcher,
  tracked,
  nowMin,
  onOpenJob,
}: Props) {
  /* The window starts on a Monday, always — the anchor is any day in it. */
  const start = mondayOf(anchor);
  const [cap, setCap] = useState<CapacityPayload | null>(
    () => capCache.current.get(start) ?? null
  );
  const [loading, startLoad] = useTransition();
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [detail, setDetail] = useState<SchedulePayload | null>(null);
  const [, startDetail] = useTransition();
  const [editing, setEditing] = useState(false);
  /** The job brought forward out of the open day, by job uuid — the rail's
      own state, in the rail's own card. */
  const [focusJob, setFocusJob] = useState<string | null>(null);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  /** job uuid → its row, so closing the card returns focus where it came
      from — the same courtesy the rail's blocks get. */
  const jobRefs = useRef(new Map<string, HTMLButtonElement>());

  const load = (startISO: string) => {
    startLoad(async () => {
      const p = await scheduleCapacity(startISO);
      capCache.current.set(startISO, p);
      setCap(p);
    });
  };

  /* The first open loads the anchored window — only the fetch, no state
     writes: `cap` was seeded from the cache in useState, and a transition's
     async callback is where the result lands (the rail's mount effect,
     repeated). */
  useEffect(() => {
    if (!capCache.current.get(start)) load(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first open only
  }, []);

  const showWindow = (startISO: string) => {
    onAnchor(startISO);
    setOpenDay(null);
    const hit = capCache.current.get(startISO);
    if (hit) setCap(hit);
    else load(startISO);
  };

  const current = cap && cap.anyDayISO === start ? cap : null;
  const days = useMemo(
    () =>
      current
        ? capacityWindow({
            days: daysFrom(start, CAPACITY_WINDOW_DAYS),
            activities: current.activities,
            allocation: current.allocation,
            staffNames: new Map(current.staffNames),
          })
        : null,
    [current, start]
  );
  const total = useMemo(() => (days ? capacityMonthTotal(days) : null), [days]);
  /* Every booked minute in the window, weekends included — the unscored
     window's one honest figure (the total only counts days WITH a
     denominator, which with an unset crew is none of them). */
  const windowBooked = useMemo(
    () => (days ?? []).reduce((s, d) => s + d.bookedMinutes, 0),
    [days]
  );
  const scored = total !== null && total.fillPct !== null;

  const closeDetail = () => {
    const was = openDay;
    setOpenDay(null);
    setFocusJob(null);
    if (was) cellRefs.current.get(was)?.focus();
  };

  const openDetail = (dayISO: string) => {
    if (openDay === dayISO) {
      closeDetail();
      return;
    }
    setOpenDay(dayISO);
    setFocusJob(null);
    const hit = dayCache.current.get(dayISO);
    if (hit) setDetail(hit);
    else {
      startDetail(async () => {
        const p = await scheduleDay(dayISO);
        dayCache.current.set(dayISO, p);
        setDetail(p);
      });
    }
  };

  /* Escape dismisses the day card and hands focus back to the cell it came
     from — wired at the document, the WbModal's own pattern. Not while the
     crew editor or the job card is up: each owns its own Escape. */
  useEffect(() => {
    if (openDay === null || editing || focusJob) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDetail();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const detailNow = openDay !== null && detail && detail.dayISO === openDay ? detail : null;
  /* THE DAY, LAID OUT — the rail's own function over the rail's own payload,
     not a second walk of the activities. It re-applies the `wasScheduled`
     filter, it stacks the same lanes, and every booking arrives wearing the
     paint and the closure the rail would have drawn. The minutes are the
     grid's minutes: `bookedMinutesOf` and a block's span are the same
     arithmetic, so a day that reads 18h in its cell reads 18h here. */
  const dayLayout = useMemo(
    () =>
      detailNow
        ? layoutScheduleDay({
            activities: detailNow.activities,
            staff: detailNow.staff,
            jobs: detailNow.jobs,
            tracked,
            onSite: new Set(detailNow.onSite),
          })
        : null,
    [detailNow, tracked]
  );
  const jobById = useMemo(
    () => new Map((detailNow?.jobs ?? []).map((j) => [j.remoteId, j])),
    [detailNow]
  );

  /* One row per JOB, gathered off the lanes: everyone on it, in the order the
     rail would stack them, and the hours the whole job holds that day. */
  const detailJobs = useMemo(() => {
    if (!dayLayout) return [];
    const by = new Map<string, { blocks: ScheduleBlock[]; people: string[] }>();
    for (const lane of dayLayout.lanes) {
      for (const b of lane.blocks) {
        const cell = by.get(b.remoteId) ?? { blocks: [], people: [] };
        cell.blocks.push(b);
        if (!cell.people.includes(lane.name)) cell.people.push(lane.name);
        by.set(b.remoteId, cell);
      }
    }
    return [...by.entries()]
      .map(([id, v]) => {
        const first = v.blocks[0];
        return {
          id,
          jobNumber: first.jobNumber,
          clientName: first.clientName,
          suburb: first.suburb,
          label: blockLabel(first),
          minutes: v.blocks.reduce((s, b) => s + (b.endMin - b.startMin), 0),
          people: v.people,
          paint: blockPaint(first),
          /* finished work is neutral here too — colour on this board means
             work still to do */
          done: v.blocks.every((b) => b.closure === "done"),
        };
      })
      .sort((a, b) =>
        (a.jobNumber ?? "").localeCompare(b.jobNumber ?? "", undefined, { numeric: true })
      );
  }, [dayLayout]);
  const detailMinutes = detailJobs.reduce((s, j) => s + j.minutes, 0);

  /* THE JOB BROUGHT FORWARD — the rail's card, built by the rail's function
     over this day's clock. */
  const clock: DayClock = {
    dayISO: openDay ?? today,
    today,
    nowMin,
    tracksTime: !!dayLayout?.tracksTime,
  };
  const focus = focusJob && dayLayout ? focusJobOf(dayLayout, focusJob, clock) : null;
  /* Closing the card puts the day back, and the day's rows are only mounted
     again on the NEXT render — so the row to return focus to is remembered
     rather than focused on the spot, where the ref still points at a node
     that has just left the document. */
  const cardRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<string | null>(null);
  const closeFocus = () => {
    returnTo.current = focusJob;
    setFocusJob(null);
  };
  useEffect(() => {
    if (focusJob !== null || !returnTo.current) return;
    jobRefs.current.get(returnTo.current)?.focus();
    returnTo.current = null;
  });

  /* A DIALOG THE KEYBOARD IS ACTUALLY IN. The panel this replaced sat in
     flow, so leaving focus on the cell was right; a card over a scrim is
     not — Escape and Tab have to belong to it. Focus lands on the card
     ONCE per day opened: coming back from a job card is not a new day, and
     re-landing here would steal the row the card just handed back. */
  const landed = useRef<string | null>(null);
  useEffect(() => {
    if (openDay === null) {
      landed.current = null;
      return;
    }
    if (focusJob !== null || landed.current === openDay) return;
    landed.current = openDay;
    cardRef.current?.focus();
  });

  const savedCrew = () => {
    setEditing(false);
    /* the allocation is the denominator under EVERY window, so every cached
       window is stale, not just this one */
    capCache.current.clear();
    load(start);
  };

  /* The window under the pointer: the current four weeks by default, stepped
     a week at a time. Its name is honest about which it is — "next four
     weeks" only while the window actually starts now. */
  const anchored = start === mondayOf(today);
  const rangeLabel = `${fmtAuDayMonth(start)} – ${fmtAuDayMonth(
    plusDays(start, CAPACITY_WINDOW_DAYS - 1)
  )}`;
  const windowWord = anchored ? "Next four weeks" : "These four weeks";

  return (
    <>
      <div className="wb2-chd">
        <span className="wb2-ci blue">
          <Icon name="calendar" size={19} />
        </span>
        <div>
          <div className="wb2-mchead">
            <button
              className="wb2-mcarrow"
              aria-label="The week before"
              onClick={() => showWindow(plusDays(start, -7))}
            >
              <Icon name="chevL" size={15} />
            </button>
            <b>{rangeLabel}</b>
            <button
              className="wb2-mcarrow"
              aria-label="The week after"
              onClick={() => showWindow(plusDays(start, 7))}
            >
              <Icon name="chevR" size={15} />
            </button>
            {!anchored && (
              <button className="wb2-mcnow" onClick={() => showWindow(mondayOf(today))}>
                This week
              </button>
            )}
          </div>
        </div>
        {switcher}
        <span className="wb2-mcsum">
          {manage && current && (
            <button type="button" className="wb2-scmcrew" onClick={() => setEditing(true)}>
              <Icon name="users" size={14} />
              Crew
            </button>
          )}
          {/* ONE chip, and it says WHAT is 69% full — a bare percentage next
              to a month name answered a question nobody had asked. The hours
              behind it live in each cell's title and the day panel. */}
          {scored && total && (
            <span className="wb2-chip">
              {windowWord} · {total.fillPct}% full
            </span>
          )}
          {current && !scored && windowBooked > 0 && (
            <span className="wb2-chip">{fmtHoursShort(windowBooked)} booked</span>
          )}
        </span>
      </div>

      {loading && !current && <p className="wb2-hint wb2-schload">Reading the weeks…</p>}

      {days && !scored && (
        <div className="wb2-scmnone">
          <b>The crew hasn&apos;t been set</b>
          <em>
            Nobody counts toward a day yet, so the weeks can&apos;t be scored — what&apos;s booked
            still shows.
          </em>
          {manage && (
            <button type="button" className="wb2-scmset" onClick={() => setEditing(true)}>
              Set the crew
            </button>
          )}
        </div>
      )}

      {days && (
        <>
          <div className="wb2-scmdow" aria-hidden="true">
            {DOW.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="wb2-scm" role="group" aria-label="How full each day is">
            {days.map((d, di) => {
              const hasPct = d.fillPct !== null;
              const clickable = d.jobs > 0;
              const sel = openDay === d.dayISO;
              const hours = hasPct
                ? `${fmtHoursShort(d.bookedMinutes)} of ${fmtHoursShort(d.capacityMinutes)}`
                : d.bookedMinutes > 0
                  ? `${fmtHoursShort(d.bookedMinutes)} booked`
                  : "";
              const title = [hours || null, d.over ? "over capacity" : null]
                .filter(Boolean)
                .join(" · ");
              const cls =
                "wb2-scmc" +
                (hasPct ? " gauge" : " ns") +
                (d.over ? " over" : "") +
                (d.dayISO === today ? " today" : "") +
                (sel ? " on" : "");
              /* the gauge rides custom properties so the sheet styles one
                 class and a test can measure what actually shipped — the
                 rail's --fill technique */
              const paint = hasPct ? capacityCellPaint(d.fillPct!, d.over) : null;
              const style = paint
                ? {
                    ["--capfill" as string]: paint.fill,
                    ["--caplevel" as string]: `${paint.level}%`,
                    ["--capink" as string]: paint.ink,
                    ...(paint.dateInk ? { ["--capdate" as string]: paint.dateInk } : {}),
                  }
                : undefined;
              /* a rolling window has no month around it, so a month TURN is
                 named on the cell where it happens — and on the first cell,
                 which is the window's own anchor */
              const dnum = Number(d.dayISO.slice(8, 10));
              const dateLabel =
                dnum === 1 || di === 0 ? `${dnum} ${MON3[Number(d.dayISO.slice(5, 7)) - 1]}` : dnum;
              const inner = (
                <>
                  <span className="wb2-scmd">{dateLabel}</span>
                  {hasPct ? (
                    <b className="wb2-scmp">{d.fillPct}%</b>
                  ) : d.bookedMinutes > 0 ? (
                    /* no figure and no gauge without a denominator — the dot
                       only says the day still holds work */
                    <i className="wb2-scmk" aria-hidden="true" />
                  ) : null}
                  {d.over && <em className="wb2-scmo">Over</em>}
                </>
              );
              if (!clickable) {
                return (
                  <span key={d.dayISO} className={cls} style={style} title={title || undefined}>
                    {inner}
                  </span>
                );
              }
              return (
                <button
                  key={d.dayISO}
                  type="button"
                  ref={(el) => {
                    if (el) cellRefs.current.set(d.dayISO, el);
                    else cellRefs.current.delete(d.dayISO);
                  }}
                  className={cls}
                  style={style}
                  title={title || undefined}
                  aria-pressed={sel}
                  aria-label={`${fmtAuWeekdayDayMonth(d.dayISO)}${
                    hasPct ? `, ${d.fillPct}% full` : ""
                  }${hours ? `, ${hours}` : ""}${d.over ? ", over capacity" : ""}, ${d.jobs} ${
                    d.jobs === 1 ? "job" : "jobs"
                  }`}
                  onClick={() => openDetail(d.dayISO)}
                >
                  {inner}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* THE DAY, BROUGHT FORWARD. It portals to <body> over `.fl-ov`'s scrim
          — `.page.in`'s will-change breaks position:fixed and anything left
          inside `.fg` is unreachable under a body-portalled scrim at any
          z-index, both documented traps here — and it reuses that ONE scrim
          rather than growing a second backdrop-filter.

          The focus card takes its place rather than stacking on it: two
          scrims is two blurs, and a card that came out of the day belongs in
          the day's slot, not on top of it. Escape and "Back to the day" put
          this back. */}
      {openDay !== null &&
        !focus &&
        createPortal(
          <div className="fl-ov wb2-scdov" onClick={closeDetail}>
            <div
              ref={cardRef}
              tabIndex={-1}
              className="wb2-scd"
              role="dialog"
              aria-modal="true"
              aria-label={`Jobs on ${fmtAuWeekdayDayMonth(openDay)}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="wb2-scdh">
                <span>
                  <b>{fmtAuWeekdayDayMonth(openDay)}</b>
                  {detailNow && (
                    <em>
                      {detailJobs.length} {detailJobs.length === 1 ? "job" : "jobs"} ·{" "}
                      {fmtHoursShort(detailMinutes)}
                    </em>
                  )}
                </span>
                <button
                  type="button"
                  className="wb2-scdx"
                  aria-label="Close the day"
                  onClick={closeDetail}
                >
                  <Icon name="x" size={15} />
                </button>
              </div>

              <div className="wb2-scdlist">
                {!detailNow && <p className="wb2-hint wb2-schload">Reading the day…</p>}
                {detailNow && detailJobs.length === 0 && (
                  <p className="wb2-hint wb2-schload">Nothing booked.</p>
                )}
                {/* A ROW IS THE BLOCK IT WOULD BE ON THE RAIL: the category's
                    wash, its cap on the leading edge, the number as a chip.
                    Clicking one brings the job forward — every row does it,
                    crew or not, so the next step is always in the same
                    place. */}
                {detailJobs.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    ref={(el) => {
                      if (el) jobRefs.current.set(row.id, el);
                      else jobRefs.current.delete(row.id);
                    }}
                    className={"wb2-scdjob" + (row.done ? " done" : "")}
                    style={{
                      ["--fill" as string]: row.done ? row.paint.pale : row.paint.fill,
                      ["--bar" as string]: row.paint.bar,
                      ["--chip" as string]: row.done ? "rgba(5,5,5,.06)" : row.paint.chip,
                      ["--btext" as string]: row.paint.ink,
                    }}
                    onClick={() => setFocusJob(row.id)}
                  >
                    <span className="wb2-scdjh">
                      <b>{row.clientName ?? "Unnamed client"}</b>
                      {row.jobNumber && <u>{row.jobNumber}</u>}
                      <em>{fmtHoursShort(row.minutes)}</em>
                    </span>
                    <em>{[row.label, row.suburb].filter(Boolean).join(" · ")}</em>
                    <i>{row.people.join(", ")}</i>
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* ONE JOB OUT OF THAT DAY — the rail's card, unchanged. "Back to the
          day" is literally that: the day card comes back. */}
      {focus && (
        <ScheduleFocus
          job={focus}
          onClose={closeFocus}
          onOpen={() => {
            const job = focusJob ? jobById.get(focusJob) : null;
            const dayState = dayStateOfMarks(focus.marks);
            /* the day closes with it: the sheet is its own surface, and a
               modal left underneath would be a second scrim behind it */
            setFocusJob(null);
            setOpenDay(null);
            if (job) onOpenJob(job, dayState);
          }}
        />
      )}

      {editing && current && (
        <CrewEditor
          allocation={current.allocation}
          onClose={() => setEditing(false)}
          onSaved={savedCrew}
        />
      )}
    </>
  );
}

/* ── the allocation editor ──
   The denominator, edited as the list it is and saved in one write. HOURS
   SURVIVE A TOGGLE: switching somebody out keeps their day so switching them
   back is one click, not a re-entry job — the difference between a checkbox
   and a delete (capacity.ts's words). */

const STEP_MIN = 30;
const DAY_MAX_MIN = 720; // 12h — nobody's TYPICAL day is longer

function CrewEditor({
  allocation,
  onClose,
  onSaved,
}: {
  allocation: CapacityAllocation[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState(() => allocation.map((a) => ({ ...a })));
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const included = rows.filter((r) => r.included);
  const dayMinutes = included.reduce((s, r) => s + r.dailyMinutes, 0);

  const patch = (staffUuid: string, p: Partial<CapacityAllocation>) =>
    setRows((rs) => rs.map((r) => (r.staffUuid === staffUuid ? { ...r, ...p } : r)));

  const save = () =>
    startSave(async () => {
      const res = await setScheduleCapacity(
        rows.map(({ staffUuid, included: inc, dailyMinutes }) => ({
          staffUuid,
          included: inc,
          dailyMinutes,
        }))
      );
      if (res.ok) onSaved();
      else setError(res.error);
    });

  return (
    <WbModal
      title="Who counts toward a day"
      sub={`${included.length} ${included.length === 1 ? "person" : "people"} · ${fmtHoursShort(
        dayMinutes
      )} a day`}
      onClose={onClose}
    >
      <div className="wb2-scmed">
        {rows.map((r) => (
          <div key={r.staffUuid} className={"wb2-scmrow" + (r.included ? "" : " off")}>
            <button
              type="button"
              role="switch"
              aria-checked={r.included}
              aria-label={`${r.name} counts toward the day`}
              className="wb2-scmtog"
              onClick={() => patch(r.staffUuid, { included: !r.included })}
            />
            <b>{r.name}</b>
            <div className="wb2-scmstep">
              <button
                type="button"
                className="wb2-scmsb"
                aria-label={`Fewer hours for ${r.name}`}
                disabled={!r.included || r.dailyMinutes <= 0}
                onClick={() =>
                  patch(r.staffUuid, { dailyMinutes: Math.max(0, r.dailyMinutes - STEP_MIN) })
                }
              >
                −
              </button>
              <span>{fmtHoursShort(r.dailyMinutes)}</span>
              <button
                type="button"
                className="wb2-scmsb"
                aria-label={`More hours for ${r.name}`}
                disabled={!r.included || r.dailyMinutes >= DAY_MAX_MIN}
                onClick={() =>
                  patch(r.staffUuid, {
                    dailyMinutes: Math.min(DAY_MAX_MIN, r.dailyMinutes + STEP_MIN),
                  })
                }
              >
                +
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="wb2-hint">ServiceM8 hasn&apos;t sent anyone across yet.</p>
        )}
        {error && <p className="wb2-scmerr">{error}</p>}
        <div className="wb2-scmft">
          <button type="button" className="fl-btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="fl-btn primary" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </WbModal>
  );
}
