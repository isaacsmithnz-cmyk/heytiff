"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import type { CalItem } from "@/lib/calendar/items";
import { fmtDay, type AgendaDay, type AgendaLine, type AgendaQuiet, type AgendaRow, type AgendaWeek } from "@/lib/calendar/model";
import { actionLink, CalSwatch, OWN_CONTROL, OWN_THING, type Pick, type PickDay } from "./home-cal-parts";

/* 4 WEEKS: the agenda (his handoff "Calendar"). Today and the 27 days after
   it, as `agendaRows` lays them out (lib/calendar/model): a week header
   before the first day and on every Monday, with a tag for anything that
   runs over the week; a row only for a day with something starting on it,
   and for today always; each run of empty days folded to one quiet line. A
   public holiday's row is tinted, and an admin date carries its one action.

   A THING is picked by a press anywhere on its line, which goes through its
   title: the title is the line's button, pressed while its thing is the one
   chosen, so the keyboard picks it with Enter or Space. The action is its
   own.

   A DAY is picked the same way (Isaac, 2026-09-26: "there's no way to
   select different days to add different things to them"): a press on its
   row that is not on one of its things or their controls, which goes
   through its date — the date is the day's button, pressed while the day
   is the one chosen, and the box at the top of the rail then adds to it. A
   quiet run's dates are its first day's button, and pressed while the day
   chosen falls in it.

   ONLY AN ADMIN DATE CARRIES ITS ACTION HERE (his calLine): an event's row
   says its time on the right and nothing else. A noticeboard event's
   "Open notice" is the panel's, as an event's Edit will be. */

export function CalAgenda({
  rows,
  selected,
  day,
  fresh,
  onPick,
  onPickDay,
}: {
  rows: AgendaRow<CalItem>[];
  selected: string | null;
  /** The day chosen, when the choice is a day. */
  day: string | null;
  /** Just saved, or just put on by Tiff (every date of it): lit for a moment. */
  fresh: readonly string[] | null;
  onPick: Pick;
  onPickDay: PickDay;
}) {
  return (
    <div className="hd-cal-ag" data-scroll="">
      {rows.map((r) =>
        r.kind === "week" ? (
          <Week key={r.key} week={r} />
        ) : r.kind === "day" ? (
          <Day
            key={r.key}
            day={r}
            on={r.day === day}
            selected={selected}
            fresh={fresh}
            onPick={onPick}
            onPickDay={onPickDay}
          />
        ) : (
          <Quiet key={r.key} run={r} chosen={day} onPickDay={onPickDay} />
        ),
      )}
    </div>
  );
}

function Week({ week }: { week: AgendaWeek<CalItem> }) {
  return (
    <div className="hd-cal-r" data-kind="week">
      <div className="hd-cal-d" />
      <div className="hd-cal-c">
        <h3 className="hd-cal-wkl">{week.label}</h3>
        <span className="hd-cal-wkr">{week.range}</span>
        {week.tags.map((t) => (
          /* His span tag: a named exemption (law 26), a capsule where the
             law has a word. */
          <span key={t.item.id} className="hd-cal-tag" data-kind={t.kind} data-c={t.item.cat}>
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Day({
  day,
  on,
  selected,
  fresh,
  onPick,
  onPickDay,
}: {
  day: AgendaDay<CalItem>;
  /** This day is the one chosen. */
  on: boolean;
  selected: string | null;
  fresh: readonly string[] | null;
  onPick: Pick;
  onPickDay: PickDay;
}) {
  const onRow = (e: MouseEvent<HTMLDivElement>) => {
    const hit = (e.target as Element).closest(OWN_THING);
    if (hit && e.currentTarget.contains(hit)) return;
    onPickDay(day.day, true);
  };
  return (
    <div
      className="hd-cal-r"
      data-kind="day"
      data-today={day.today ? "" : undefined}
      data-weekend={day.weekend ? "" : undefined}
      data-holiday={day.holiday ? "" : undefined}
      onClick={onRow}
    >
      <div className="hd-cal-d">
        <button
          type="button"
          className="hd-cal-day"
          aria-pressed={on}
          aria-label={fmtDay(day.day)}
          aria-current={day.today ? "date" : undefined}
          onClick={(e) => onPickDay(day.day, e.detail > 0)}
        >
          <span className="hd-cal-dw">{day.weekday}</span>
          <span className="hd-cal-dn">{day.date}</span>
        </button>
        {day.today && <div className="hd-cal-tl">Today</div>}
      </div>
      <div className="hd-cal-c">
        {day.lines.map((l) => (
          <Line
            key={l.item.id}
            line={l}
            on={l.item.id === selected}
            fresh={!!fresh?.includes(l.item.id)}
            onPick={onPick}
          />
        ))}
        {day.lines.length === 0 && <p className="hd-cal-none">Nothing on today.</p>}
      </div>
    </div>
  );
}

/** A run of days with nothing starting on them: a press picks its first,
    and leaves a day already chosen in it where it is. */
function Quiet({ run, chosen, onPickDay }: { run: AgendaQuiet; chosen: string | null; onPickDay: PickDay }) {
  const on = chosen !== null && run.start <= chosen && chosen <= run.end;
  const target = on ? chosen : run.start;
  const onRow = (e: MouseEvent<HTMLDivElement>) => {
    const hit = (e.target as Element).closest(OWN_CONTROL);
    if (hit && e.currentTarget.contains(hit)) return;
    onPickDay(target, true);
  };
  return (
    <div className="hd-cal-r" data-kind="quiet" onClick={onRow}>
      <div className="hd-cal-d">
        <button
          type="button"
          className="hd-cal-qd"
          aria-pressed={on}
          aria-label={run.label}
          onClick={(e) => onPickDay(target, e.detail > 0)}
        >
          {run.dates}
        </button>
      </div>
      <div className="hd-cal-c" data-long={run.longWeekend ? "" : undefined}>
        {run.text}
      </div>
    </div>
  );
}

function Line({ line, on, fresh, onPick }: { line: AgendaLine<CalItem>; on: boolean; fresh: boolean; onPick: Pick }) {
  const x = line.item;
  const go = x.cat === "admin" ? actionLink(x) : null;
  const onRow = (e: MouseEvent<HTMLDivElement>) => {
    const hit = (e.target as Element).closest(OWN_CONTROL);
    if (hit && e.currentTarget.contains(hit)) return;
    onPick(x.id, true);
  };
  return (
    <div
      className="hd-cal-it"
      data-c={x.cat}
      data-sel={on ? "" : undefined}
      data-fresh={fresh ? "" : undefined}
      onClick={onRow}
    >
      <CalSwatch cat={x.cat} late={!!x.overdue} />
      <div className="hd-cal-tx">
        <button
          type="button"
          className="hd-cal-itt"
          data-c={x.cat}
          aria-pressed={on}
          onClick={(e) => onPick(x.id, e.detail > 0)}
        >
          {line.title}
        </button>
        {line.sub && <div className="hd-cal-s">{line.sub}</div>}
      </div>
      {(line.time || go) && (
        <div className="hd-cal-rs">
          {line.time && <span className="hd-cal-tm">{line.time}</span>}
          {go && (
            <Link className="hd-cal-ab" href={go.href}>
              {go.label}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
