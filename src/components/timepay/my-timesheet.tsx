"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { saveDay, submitWeek, type TimepayResult } from "@/app/actions/timepay";
import type { SheetState } from "@/lib/timepay/query";
import { dateOfDay } from "@/lib/timepay/period";
import { UpcomingHolidays } from "./upcoming-holidays";
import { DayLegend, MY_DAY_LEGEND, Tile } from "./tiles";
import type { PayPeriod } from "./timepay";
import {
  type DayEntry,
  type Settings,
  type WeekCtx,
  type StaffWeek,
  dayLabel,
  derive,
  fmt,
  submitNote,
  weekGroups,
} from "./logic";

/* My timesheet — everyone, always. The hours-ENTRY surface, now speaking the
   same language as the review screen an approver sees: one `.stg tpr` scope,
   one set of day tiles, one legend. A colour you pick means what a colour
   your manager reads means.

   NO MONEY LIVES HERE. Not a rate, not a gross, not a dollar sign. The wage
   isn't hidden at render time — `getMyWeek` doesn't select the column, so the
   payload has nothing to print. Your rate belongs on My profile → My Pay,
   which asks for it in its own query and can say something useful about it.
   A pay figure is a payslip's job, not a timesheet's. */

const KINDS: { t: DayEntry["t"]; label: string }[] = [
  { t: "work", label: "Worked" },
  { t: "leave", label: "Annual leave" },
  { t: "sick", label: "Sick" },
  { t: "ph", label: "Public holiday" },
  { t: "empty", label: "Nothing" },
];

const STATUS_COPY: Record<SheetState["status"], { label: string; tone: string; sub: string }> = {
  draft: { label: "Draft", tone: "warn", sub: "Not sent yet — fill in your days and submit." },
  submitted: { label: "Submitted", tone: "ok", sub: "With your manager. You'll be told if anything needs a look." },
  approved: { label: "Approved", tone: "ok", sub: "Signed off. This week is closed." },
  sent_back: { label: "Sent back", tone: "bad", sub: "Your manager has a question — answer it and submit again." },
};

/* The one editor. It opens under the week row of whichever tile you clicked,
   in normal flow — a day is a small edit and shouldn't take over the screen.
   Keyed by day index by the caller, so switching days re-seeds the fields. */
function DayEdit({
  index,
  entry,
  ctx,
  holidayName,
  busy,
  onSave,
  onCancel,
}: {
  index: number;
  entry: DayEntry;
  ctx: WeekCtx;
  /** set when this day is a public holiday — named, so you know why */
  holidayName?: string;
  busy: boolean;
  onSave: (i: number, e: DayEntry) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<DayEntry["t"]>(entry.t);
  const [start, setStart] = useState(entry.t === "work" ? entry.in : "7:00 AM");
  const [end, setEnd] = useState(entry.t === "work" ? entry.out : "3:30 PM");
  const [hours, setHours] = useState(entry.t === "empty" ? "" : String(entry.h));

  const commit = () => {
    const h = Number(hours);
    onSave(
      index,
      kind === "empty"
        ? { t: "empty" }
        : kind === "work"
          ? { t: "work", in: start, out: end, h: Number.isFinite(h) ? h : 0 }
          : { t: kind, h: Number.isFinite(h) ? h : 0 },
    );
  };

  return (
    <div className="dayedit">
      <div className="dehead">
        <b>{dayLabel(ctx.week[index])}</b>
        {holidayName && (
          <span className="dehol">
            <Icon name="calendar" size={11} />
            {holidayName}
          </span>
        )}
      </div>
      <div className="mts-form">
        <label className="mts-f">
          <span>Day</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as DayEntry["t"])}>
            {KINDS.map((k) => (
              <option key={k.t} value={k.t}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        {kind === "work" && (
          <>
            <label className="mts-f">
              <span>Start</span>
              <input value={start} onChange={(e) => setStart(e.target.value)} placeholder="7:00 AM" />
            </label>
            <label className="mts-f">
              <span>Finish</span>
              <input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="3:30 PM" />
            </label>
          </>
        )}
        {kind !== "empty" && (
          <label className="mts-f">
            <span>Hours</span>
            <input
              type="number"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="e.g. 8"
            />
          </label>
        )}
        <div className="mts-facts">
          <button className="fl-btn primary" disabled={busy} onClick={commit}>
            <Icon name="check" size={14} />
            Save day
          </button>
          <button className="fl-btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="fl-btn ghost" disabled={busy} onClick={() => onSave(index, { t: "empty" })}>
            Clear day
          </button>
        </div>
      </div>
    </div>
  );
}

export function MyTimesheet({
  me,
  week,
  today,
  todayISO,
  periodStart,
  periods,
  periodIndex,
  settings,
  sheet,
  holidays,
}: {
  me: StaffWeek;
  week: WeekCtx["week"];
  today: number;
  todayISO: string;
  periodStart: string;
  /** the same period switcher the admin screen uses, newest first */
  periods: PayPeriod[];
  periodIndex: number;
  settings: Settings;
  sheet: SheetState;
  /** org holidays for this staff member's state — period + upcoming */
  holidays: { date: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const ctx: WeekCtx = { week, today };
  const d = derive(me, settings, ctx);
  const groups = weekGroups(me.days);
  const multiWeek = groups.length > 1; // fortnight / month read as week-rows
  const period = periods[periodIndex];
  const sent = sheet.status === "submitted" || sheet.status === "approved";
  // a closed period is history: you can read it, you can't rewrite it
  const locked = sent || !period.live;
  const status = STATUS_COPY[sheet.status];

  // in-period holidays name themselves in the editor; the shared panel below
  // lists the year ahead
  const holidayByDate = useMemo(() => new Map(holidays.map((h) => [h.date, h.name])), [holidays]);

  const run = (action: () => Promise<TimepayResult>) => {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.ok) {
        setSelected(null);
        router.refresh();
      } else setError(res.error);
    });
  };

  const goPeriod = (i: number) => {
    const target = periods[i];
    if (target) router.push(`/dashboard/my-timesheet?period=${target.start}`);
  };

  return (
    <div className="page in">
      <div className="wrap">
        <div className={`stg tpr${locked ? " locked" : ""}`}>
          <div className="rhead">
            <div>
              <h1>My timesheet</h1>
              <div className="wknav">
                <button
                  className="arw"
                  aria-label="Previous period"
                  disabled={periodIndex >= periods.length - 1 || pending}
                  onClick={() => goPeriod(periodIndex + 1)}
                >
                  <Icon name="chevL" size={17} />
                </button>
                <span className="range">
                  {period.range} <em>{period.year}</em>
                </span>
                <button
                  className="arw"
                  aria-label="Next period"
                  disabled={periodIndex <= 0 || pending}
                  onClick={() => goPeriod(periodIndex - 1)}
                >
                  <Icon name="chevR" size={17} />
                </button>
                {period.live ? (
                  <span className="pstatus live">
                    <span className="d"></span>LIVE
                  </span>
                ) : (
                  <span className="pstatus hist">Historical</span>
                )}
              </div>
              <div className="autosub">{period.live ? submitNote(settings) : period.note}</div>
            </div>
            <div className="racts">
              <span className={`dchip ${status.tone}`}>
                <Icon name={sheet.status === "approved" ? "check" : "clock"} size={12} />
                {status.label}
              </span>
            </div>
          </div>

          {error && <div className="tp-err">{error}</div>}

          {sheet.status === "sent_back" && sheet.reviewNote && (
            <div className="mts-back">
              <Icon name="send" size={15} />
              <span>
                <b>Sent back with a question</b>
                <em>{sheet.reviewNote}</em>
              </span>
            </div>
          )}

          {/* Hours, overtime and paid absence — the three things a timesheet
              is actually about. No rate tile: see the file header. */}
          <div className="stats n3">
            <div className="stat hrs">
              <span className="si"><Icon name="clock" size={18} /></span>
              <div className="stk">
                <div className="sv">{fmt(d.worked)}h</div>
                <div className="sl">{multiWeek ? "Hours this period" : "Hours this week"}</div>
              </div>
            </div>
            <div className="stat ot">
              <span className="si"><Icon name="alert" size={18} /></span>
              <div className="stk">
                <div className="sv">{fmt(d.ot + d.ot2)}h</div>
                <div className="sl">Overtime</div>
              </div>
            </div>
            <div className="stat lv">
              <span className="si"><Icon name="calendar" size={18} /></span>
              <div className="stk">
                <div className="sv">{fmt(d.leave + d.sick + d.ph)}h</div>
                <div className="sl">Leave &amp; sick</div>
              </div>
            </div>
          </div>

          <DayLegend items={MY_DAY_LEGEND} />

          {groups.map((g) => (
            <div className="mts-week" key={g.start}>
              {multiWeek && (
                <div className="mts-wh">
                  <span>{g.label}</span>
                  <em>{fmt(g.workedHours)}h</em>
                </div>
              )}
              <div className="tiles">
                {g.days.map(({ entry, index }) => (
                  <Tile
                    key={index}
                    d={entry}
                    i={index}
                    settings={settings}
                    ctx={ctx}
                    selected={selected === index}
                    onClick={locked ? undefined : setSelected}
                  />
                ))}
              </div>
              {!locked &&
                selected !== null &&
                g.days.some((x) => x.index === selected) && (
                  <DayEdit
                    key={selected}
                    index={selected}
                    entry={me.days[selected]}
                    ctx={ctx}
                    holidayName={holidayByDate.get(dateOfDay(periodStart, selected))}
                    busy={pending}
                    onSave={(idx, e) => run(() => saveDay(periodStart, idx, e))}
                    onCancel={() => setSelected(null)}
                  />
                )}
            </div>
          ))}

          <div className="mts-foot">
            <span>{locked && !sent ? "This period is closed." : status.sub}</span>
            {!locked && (
              <button
                className="bbtn ink"
                disabled={pending || d.entries === 0}
                onClick={() => run(() => submitWeek(periodStart))}
              >
                <Icon name="send" size={14} />
                {sheet.status === "sent_back" ? "Submit again" : "Submit week"}
              </button>
            )}
          </div>

          <UpcomingHolidays holidays={holidays} today={todayISO} />
        </div>
      </div>
    </div>
  );
}
