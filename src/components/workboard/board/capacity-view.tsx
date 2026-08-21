"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { plusDays } from "@/lib/workboard/dates";
import { scheduleCapacity, scheduleDay, setScheduleCapacity } from "@/app/actions/workboard";
import type { CapacityPayload } from "@/lib/workboard/capacity-query";
import type { SchedulePayload } from "@/lib/workboard/schedule-query";
import {
  bookedMinutesOf,
  capacityMonth,
  capacityMonthTotal,
  daysOfMonth,
  dowOfISO,
  type CapacityAllocation,
  type CapacityDay,
} from "@/lib/workboard/capacity";
import { fmtHoursShort } from "@/lib/workboard/schedule";
import { capacityInk, OVER_INK } from "@/lib/workboard/capacity-paint";
import { WbModal } from "../wb-modal";

/* Capacity — the Schedule tab's other side: how full each day of the month
   is, one big percentage per cell. The maths lives in lib/workboard/
   capacity.ts (pure, tested) and the figure's colour in capacity-paint.ts;
   what matters HERE is the wiring, the rail's pattern repeated:

   FETCH-ON-OPEN, CACHED FOR THE SESSION. A month arrives when it is asked
   for and lands in a cache the parent owns, so flipping Day ↔ Capacity does
   not re-ask. The day panel reads through the SAME per-day cache the rail
   uses — one law for what a day holds, one round trip for both views.

   THE FIGURE IS THE CELL. No meter, no hours on the face (Isaac's call) —
   the percentage set large, coloured by how full the day is, and the hours
   in the cell's title and the day panel. A day with no denominator (a
   weekend, an unset crew) gets NO figure and NO colour: fillPct is null
   there, not zero, and drawing "0%" would dress a division by zero up as
   insight — capacity.ts's central promise, kept on the screen.

   THE PANEL NEVER MOVES THE GRID. It opens BELOW the weeks, so picking a
   day reads as asking about it, not rearranging the month. */

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const monthKey = (iso: string) => iso.slice(0, 7);
const firstOf = (iso: string) => `${iso.slice(0, 7)}-01`;

type Props = {
  today: string;
  manage: boolean;
  /** Any day in the month on show — owned by the tab so the choice survives
      a flip to Day and back. */
  anchor: string;
  onAnchor: (iso: string) => void;
  /** Month-key → payload, owned by the tab for the same reason. */
  capCache: { current: Map<string, CapacityPayload> };
  /** THE RAIL'S OWN day cache, shared on purpose: a day opened here is warm
      when the rail visits it, and the panel obeys the same law as the lanes
      because it is literally the same read. */
  dayCache: { current: Map<string, SchedulePayload> };
  /** The Day/Capacity switcher, built by the tab — it lives in both headers
      so the header reads as one thing changing its contents. */
  switcher: React.ReactNode;
};

export function CapacityView({
  today,
  manage,
  anchor,
  onAnchor,
  capCache,
  dayCache,
  switcher,
}: Props) {
  const [cap, setCap] = useState<CapacityPayload | null>(
    () => capCache.current.get(monthKey(anchor)) ?? null
  );
  const [loading, startLoad] = useTransition();
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [detail, setDetail] = useState<SchedulePayload | null>(null);
  const [, startDetail] = useTransition();
  const [editing, setEditing] = useState(false);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());

  const load = (anyDayISO: string) => {
    startLoad(async () => {
      const p = await scheduleCapacity(anyDayISO);
      capCache.current.set(monthKey(anyDayISO), p);
      setCap(p);
    });
  };

  /* The first open loads the anchored month — only the fetch, no state
     writes: `cap` was seeded from the cache in useState, and a transition's
     async callback is where the result lands (the rail's mount effect,
     repeated). */
  useEffect(() => {
    if (!capCache.current.get(monthKey(anchor))) load(anchor);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first open only
  }, []);

  const showMonth = (anyDayISO: string) => {
    onAnchor(anyDayISO);
    setOpenDay(null);
    const hit = capCache.current.get(monthKey(anyDayISO));
    if (hit) setCap(hit);
    else load(anyDayISO);
  };

  const current = cap && monthKey(cap.anyDayISO) === monthKey(anchor) ? cap : null;
  const days = useMemo(
    () =>
      current
        ? capacityMonth({
            anyDayISO: firstOf(anchor),
            activities: current.activities,
            allocation: current.allocation,
            staffNames: new Map(current.staffNames),
          })
        : null,
    [current, anchor]
  );
  const total = useMemo(() => (days ? capacityMonthTotal(days) : null), [days]);
  /* Every booked minute in the month, weekends included — the unscored
     month's one honest figure (capacityMonthTotal only counts days WITH a
     denominator, which with an unset crew is none of them). */
  const monthBooked = useMemo(
    () => (days ?? []).reduce((s, d) => s + d.bookedMinutes, 0),
    [days]
  );
  const scored = total !== null && total.fillPct !== null;

  /* Lead-in and trailing days square the weeks off; they belong to the
     neighbouring months, so they carry a date and nothing else. */
  const grid = useMemo(() => {
    if (!days) return null;
    const first = firstOf(anchor);
    const cells: ({ kind: "day"; d: CapacityDay } | { kind: "out"; dayISO: string })[] = [];
    for (let i = dowOfISO(first); i > 0; i -= 1)
      cells.push({ kind: "out", dayISO: plusDays(first, -i) });
    for (const d of days) cells.push({ kind: "day", d });
    const nextFirst = plusDays(first, days.length);
    const tail = (7 - (cells.length % 7)) % 7;
    for (let i = 0; i < tail; i += 1) cells.push({ kind: "out", dayISO: plusDays(nextFirst, i) });
    return cells;
  }, [days, anchor]);

  const closeDetail = () => {
    const was = openDay;
    setOpenDay(null);
    if (was) cellRefs.current.get(was)?.focus();
  };

  const openDetail = (dayISO: string) => {
    if (openDay === dayISO) {
      closeDetail();
      return;
    }
    setOpenDay(dayISO);
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

  /* Escape dismisses the panel and hands focus back to the day it came from
     — wired at the document, the WbModal's own pattern. Not while the crew
     editor is up: its Escape belongs to the modal. */
  useEffect(() => {
    if (openDay === null || editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDetail();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const detailNow = openDay !== null && detail && detail.dayISO === openDay ? detail : null;
  const detailJobs = useMemo(() => {
    if (!detailNow) return [];
    const names = new Map(detailNow.staff.map((s) => [s.uuid, s.name]));
    const jobs = new Map(detailNow.jobs.map((j) => [j.remoteId, j]));
    const by = new Map<string, { minutes: number; people: Set<string> }>();
    for (const a of detailNow.activities) {
      /* the rail's single most important filter, re-applied here for the
         same reason capacityMonth re-applies it */
      if (a.wasScheduled !== 1 || !a.jobUuid) continue;
      const cell = by.get(a.jobUuid) ?? { minutes: 0, people: new Set<string>() };
      cell.minutes += bookedMinutesOf(a);
      cell.people.add(a.staffUuid ? (names.get(a.staffUuid) ?? "Nobody named") : "Nobody named");
      by.set(a.jobUuid, cell);
    }
    return [...by.entries()]
      .map(([id, v]) => ({
        id,
        job: jobs.get(id) ?? null,
        minutes: v.minutes,
        people: [...v.people].sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) =>
        (a.job?.jobNumber ?? "").localeCompare(b.job?.jobNumber ?? "", undefined, {
          numeric: true,
        })
      );
  }, [detailNow]);
  const detailMinutes = detailJobs.reduce((s, j) => s + j.minutes, 0);

  const savedCrew = () => {
    setEditing(false);
    /* the allocation is the denominator under EVERY month, so every cached
       month is stale, not just this one */
    capCache.current.clear();
    load(anchor);
  };

  const first = firstOf(anchor);
  const prevMonth = firstOf(plusDays(first, -1));
  const nextMonth = plusDays(first, daysOfMonth(first).length);
  const monthLabel = `${MONTHS[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}`;

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
              aria-label="The month before"
              onClick={() => showMonth(prevMonth)}
            >
              <Icon name="chevL" size={15} />
            </button>
            <b>{monthLabel}</b>
            <button
              className="wb2-mcarrow"
              aria-label="The month after"
              onClick={() => showMonth(nextMonth)}
            >
              <Icon name="chevR" size={15} />
            </button>
            {monthKey(anchor) !== monthKey(today) && (
              <button className="wb2-mcnow" onClick={() => showMonth(today)}>
                This month
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
          {scored && total && (
            <>
              <span className="wb2-chip">
                {fmtHoursShort(total.bookedMinutes)} of {fmtHoursShort(total.capacityMinutes)}
              </span>
              <span className="wb2-chip">{total.fillPct}% full</span>
            </>
          )}
          {current && !scored && monthBooked > 0 && (
            <span className="wb2-chip">{fmtHoursShort(monthBooked)} booked</span>
          )}
        </span>
      </div>

      {loading && !current && <p className="wb2-hint wb2-schload">Reading the month…</p>}

      {days && !scored && (
        <div className="wb2-scmnone">
          <b>The crew hasn&apos;t been set</b>
          <em>
            Nobody counts toward a day yet, so the month can&apos;t be scored — what&apos;s booked
            still shows.
          </em>
          {manage && (
            <button type="button" className="wb2-scmset" onClick={() => setEditing(true)}>
              Set the crew
            </button>
          )}
        </div>
      )}

      {grid && (
        <>
          <div className="wb2-scmdow" aria-hidden="true">
            {DOW.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="wb2-scm" role="group" aria-label={`How full each day of ${monthLabel} is`}>
            {grid.map((cell) => {
              if (cell.kind === "out") {
                return (
                  <span key={cell.dayISO} className="wb2-scmc out" aria-hidden="true">
                    <span className="wb2-scmd">{Number(cell.dayISO.slice(8, 10))}</span>
                  </span>
                );
              }
              const d = cell.d;
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
                (hasPct ? "" : " ns") +
                (d.over ? " over" : "") +
                (d.dayISO === today ? " today" : "") +
                (sel ? " on" : "");
              /* the figure's colour rides a custom property so the sheet
                 styles one class and a test can measure what actually
                 shipped — the rail's --fill technique */
              const style = hasPct
                ? { ["--capink" as string]: d.over ? OVER_INK : capacityInk(d.fillPct!) }
                : undefined;
              const inner = (
                <>
                  <span className="wb2-scmd">{Number(d.dayISO.slice(8, 10))}</span>
                  {hasPct ? (
                    <b className="wb2-scmp">{d.fillPct}%</b>
                  ) : d.bookedMinutes > 0 ? (
                    /* no figure and no ramp without a denominator — the dot
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

      {openDay !== null && (
        <div className="wb2-scmdet">
          <div className="wb2-scmdh">
            <b>{fmtAuWeekdayDayMonth(openDay)}</b>
            {detailNow && (
              <em>
                {detailJobs.length} {detailJobs.length === 1 ? "job" : "jobs"} ·{" "}
                {fmtHoursShort(detailMinutes)}
              </em>
            )}
            <button
              type="button"
              className="wb2-scmdx"
              aria-label="Close the day"
              onClick={closeDetail}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
          {!detailNow && <p className="wb2-hint wb2-schload">Reading the day…</p>}
          {detailNow && detailJobs.length === 0 && (
            <p className="wb2-hint wb2-schload">Nothing booked.</p>
          )}
          {detailJobs.map((row) => (
            <div key={row.id} className="wb2-scmjob">
              <span className="wb2-scmjh">
                <b>{row.job?.clientName ?? "Unnamed client"}</b>
                {row.job?.jobNumber && <u>{row.job.jobNumber}</u>}
                <em>{fmtHoursShort(row.minutes)}</em>
              </span>
              <em>
                {[row.job?.categoryName ?? "No category", row.job?.suburb]
                  .filter(Boolean)
                  .join(" · ")}
              </em>
              <i>{row.people.join(", ")}</i>
            </div>
          ))}
        </div>
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
