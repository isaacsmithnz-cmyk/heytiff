"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { plusDays } from "@/lib/workboard/dates";
import { isWeekendISO, mondayOf } from "@/lib/workboard/board-status";
import { scheduleDay } from "@/app/actions/workboard";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import type { SchedulePayload } from "@/lib/workboard/schedule-query";
import {
  clockLabel,
  fmtHoursShort,
  layoutScheduleDay,
  type ScheduleBlock,
  type ScheduleTracked,
} from "@/lib/workboard/schedule";
import { Sm8Gap, sm8Gap } from "./sm8-gap";

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

   TWO COLOUR CHANNELS, ONE OVERRIDE. Category tints a block (the same axis
   the list rows' catdot uses); status is a second reading — Completed mutes
   and takes a tick, Unsuccessful takes the danger ring, a Quote's bar goes
   dashed. And OWNERSHIP OUTRANKS CATEGORY: a job promoted onto one of our
   boards leaves the palette and wears the tracked blue with the word beside
   the number, because it isn't pool work any more. */

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

type Props = {
  today: string;
  connected: boolean;
  /** Connected, but the `job_activities` backfill is still on its first walk. */
  syncing: boolean;
  manage: boolean;
  /** ServiceM8 job uuid → the board that owns it. Ownership recolours. */
  tracked: Map<string, ScheduleTracked>;
  shelfItems: ScheduleShelfItem[];
  /** The Work orders tab's "waiting on a day" count — the dispatch board's
      unscheduled pane, already answered by the tab that owns the list. */
  waitingCount: number;
  onOpenJob: (job: AllJobsMirrorJob) => void;
  onOpenTracked: (target: { kind: "visit" | "project"; id: string }) => void;
  onGoWork: () => void;
};

/** rgba() from a sanitised #hex at a given alpha. */
function tintOf(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** The category hue driven down to a weight a 4px bar can carry — ServiceM8
    picks its colours to sit behind black text, so they arrive around 85%
    lightness and vanish as an accent. One hue, two jobs. */
function barOf(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const k = 0.55;
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r}, ${g}, ${b})`;
}

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
  shelfItems,
  waitingCount,
  onOpenJob,
  onOpenTracked,
  onGoWork,
}: Props) {
  const [openDay, setOpenDay] = useState(today);
  const [payload, setPayload] = useState<SchedulePayload | null>(null);
  const [hoverJob, setHoverJob] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const cache = useRef(new Map<string, SchedulePayload>());

  const load = (dayISO: string) => {
    startLoad(async () => {
      const p = await scheduleDay(dayISO);
      cache.current.set(dayISO, p);
      setPayload(p);
    });
  };

  const show = (dayISO: string) => {
    setOpenDay(dayISO);
    setHoverJob(null);
    const hit = cache.current.get(dayISO);
    if (hit) setPayload(hit);
    else load(dayISO);
  };

  /* The first open loads today — only the fetch, no state writes: openDay
     already IS today, and a transition's async callback is where the result
     lands. StrictMode double-invoking the effect costs one duplicate read,
     which the cache then absorbs for the session. */
  useEffect(() => {
    /* Mid-backfill the read is not just wasted, it's WRONG to show: a day
       drawn from half a walk is a diary with people missing from it, which
       reads as "nobody is on" rather than "not here yet". The gap below says
       so instead, and nothing is fetched to contradict it. */
    if (connected && !syncing) load(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first open only
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
          })
        : null,
    [current, tracked]
  );
  const jobById = useMemo(
    () => new Map((current?.jobs ?? []).map((j) => [j.remoteId, j])),
    [current]
  );
  /** Jobs that draw more than one block — the crew-hover only ever fires for
      these; lifting a lone block against a rested day would be noise. */
  const crewJobs = useMemo(() => {
    const seen = new Map<string, number>();
    for (const l of day?.lanes ?? []) {
      for (const b of l.blocks) seen.set(b.remoteId, (seen.get(b.remoteId) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  }, [day]);

  const monday = mondayOf(openDay);
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => plusDays(monday, i)), [monday]);
  const shelf = shelfItems.filter((s) => s.date === openDay);

  /* "Now" is drawn from the BROWSER's clock, and only when the browser's own
     date agrees with the board's today — the account's timezone lives on the
     server, and for a crew in the same country the two clocks agree. When
     they don't (a viewer overseas), the line simply doesn't draw; a missing
     mark beats one that's hours wrong. Set in an effect so this subtree
     could server-render someday without a hydration split. */
  const [nowMin, setNowMin] = useState<number | null>(null);
  useEffect(() => {
    const read = () => {
      const d = new Date();
      const localISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
      setNowMin(localISO === today ? d.getHours() * 60 + d.getMinutes() : null);
    };
    read();
    const t = setInterval(read, 60_000);
    return () => clearInterval(t);
  }, [today]);

  /* ── the rail's scroll: land where the day is, own the edge fade ── */
  const railRef = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);
  const judgeEnd = () => {
    const r = railRef.current;
    if (r) setAtEnd(r.scrollLeft + r.clientWidth >= r.scrollWidth - 2);
  };
  useLayoutEffect(() => {
    const r = railRef.current;
    if (!r || !day || day.totalBookings === 0) return;
    const first = day.lanes.reduce((m, l) => Math.min(m, l.blocks[0].startMin), Infinity);
    let target = ((first - day.railStart) / 60) * PX_PER_HOUR - 24;
    if (openDay === today && nowMin !== null && nowMin >= day.railStart && nowMin <= day.railEnd) {
      target = ((nowMin - day.railStart) / 60) * PX_PER_HOUR - r.clientWidth / 2;
    }
    r.scrollLeft = Math.max(0, target);
    judgeEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lands once per loaded day
  }, [day, openDay]);

  /* ── header ── */
  const head = (
    <div className="wb2-chd">
      <span className="wb2-ci blue">
        <Icon name="calendar" size={19} />
      </span>
      <div>
        <div className="wb2-mchead">
          <button
            className="wb2-mcarrow"
            aria-label="The day before"
            onClick={() => show(plusDays(openDay, -1))}
          >
            <Icon name="chevL" size={15} />
          </button>
          <b>{fmtAuWeekdayDayMonth(openDay)}</b>
          <button
            className="wb2-mcarrow"
            aria-label="The day after"
            onClick={() => show(plusDays(openDay, 1))}
          >
            <Icon name="chevR" size={15} />
          </button>
          {openDay !== today && (
            <button className="wb2-mcnow" onClick={() => show(today)}>
              Today
            </button>
          )}
        </div>
      </div>
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
  );

  /* ── the seven-day strip ── */
  const strip = (
    <div className="wb2-schdays" role="group" aria-label="Days this week">
      {week.map((iso, i) => {
        const n = current?.weekCounts[iso] ?? null;
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
            <span className="cw">{DOW[i]}</span>
            <span className="cd">{parseInt(iso.slice(8, 10), 10)}</span>
            <span className="cn">{n === null ? "" : n === 0 ? "clear" : n}</span>
          </button>
        );
      })}
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
  const hasBare = day
    ? day.lanes.some((l) => l.blocks.some((b) => !b.tracked && !b.categoryColour))
    : false;
  const hasTracked = day ? day.lanes.some((l) => l.blocks.some((b) => !!b.tracked)) : false;

  let bi = 0; // running block index — the entrance stagger reads left to right

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
        <div className={"wb2-schboard" + (hoverJob ? " linking" : "")}>
          <div className="wb2-schnames">
            <div className="wb2-schnh" />
            {day.lanes.map((l) => (
              <div
                key={l.staffUuid || "unassigned"}
                className={"wb2-schn" + (l.staffUuid === "" ? " none" : "")}
                style={{ height: l.rows.length * LANE_ROW_PX + LANE_PAD_PX * 2 }}
              >
                <b>{l.name}</b>
                <em>
                  {l.blocks.length} {l.blocks.length === 1 ? "booking" : "bookings"} ·{" "}
                  {fmtHoursShort(l.minutes)}
                </em>
                {/* utilisation against an 8h day — neutral, a fact not a fault */}
                <span className="wb2-schmeter" aria-hidden="true">
                  <i style={{ width: `${Math.min(100, Math.round((l.minutes / 480) * 100))}%` }} />
                </span>
              </div>
            ))}
          </div>

          <div className={"wb2-schrailwrap" + (atEnd ? " atend" : "")}>
            <div className="wb2-schrail" ref={railRef} onScroll={judgeEnd}>
              <div
                className="wb2-schinner"
                style={{
                  width: ((day.railEnd - day.railStart) / 60) * PX_PER_HOUR,
                  ["--hr" as string]: `${PX_PER_HOUR}px`,
                }}
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
                        const kin = hoverJob === b.remoteId;
                        const cls =
                          "wb2-schb" +
                          (b.tracked ? " proj" : "") +
                          (b.status === "Completed" ? " done" : "") +
                          (b.status === "Unsuccessful" ? " dan" : "") +
                          (b.status === "Quote" ? " qt" : "") +
                          (w < TIGHT_PX ? " tight" : "") +
                          (kin ? " kin" : "");
                        const colour = !b.tracked ? b.categoryColour : null;
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
                              animationDelay: `${Math.min(bi++ * 14, 400)}ms`,
                              ...(colour
                                ? {
                                    ["--tint" as string]: tintOf(colour, 0.5),
                                    ["--bar" as string]: barOf(colour),
                                    ["--edge" as string]: tintOf(colour, 0.55),
                                  }
                                : {}),
                            }}
                            title={blockTitle(b)}
                            aria-label={`Open job ${b.jobNumber ? `#${b.jobNumber}` : ""} ${
                              b.clientName ?? ""
                            }, ${clockLabel(b.startMin)} to ${clockLabel(b.endMin)}`}
                            onMouseEnter={() =>
                              setHoverJob(crewJobs.has(b.remoteId) ? b.remoteId : null)
                            }
                            onMouseLeave={() => setHoverJob(null)}
                            onFocus={() =>
                              setHoverJob(crewJobs.has(b.remoteId) ? b.remoteId : null)
                            }
                            onBlur={() => setHoverJob(null)}
                            onClick={() => {
                              const job = jobById.get(b.remoteId);
                              if (job) onOpenJob(job);
                            }}
                          >
                            <b>
                              {b.jobNumber ? `#${b.jobNumber}` : "Job"}
                              {b.tracked ? ` · ${b.tracked.kind === "project" ? "Project" : "Maintenance"}` : ""}
                              {b.status === "Quote" ? " · Quote" : ""}
                            </b>
                            <em>{b.clientName ?? "Unnamed client"}</em>
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
                <i style={{ background: tintOf(colour, 0.5), boxShadow: `inset 3px 0 0 ${barOf(colour)}` }} />
                {name}
              </span>
            ))}
            {hasBare && (
              <span>
                <i style={{ background: "#f2f3f5", boxShadow: "inset 3px 0 0 #b9bec7" }} />
                No category
              </span>
            )}
            {hasTracked && (
              <span>
                <i
                  style={{
                    background: "rgba(0,168,224,.14)",
                    boxShadow: "inset 3px 0 0 #007fa8",
                  }}
                />
                On a board here
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
