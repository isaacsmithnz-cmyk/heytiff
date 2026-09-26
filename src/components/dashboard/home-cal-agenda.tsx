"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import type { CalItem } from "@/lib/calendar/items";
import type { AgendaDay, AgendaLine, AgendaRow, AgendaWeek } from "@/lib/calendar/model";
import { actionLink, CalSwatch, OWN_CONTROL, type Pick } from "./home-cal-parts";

/* 4 WEEKS: the agenda (his handoff "Calendar"). Today and the 27 days after
   it, as `agendaRows` lays them out (lib/calendar/model): a week header
   before the first day and on every Monday, with a tag for anything that
   runs over the week; a row only for a day with something starting on it,
   and for today always; each run of empty days folded to one quiet line. A
   public holiday's row is tinted, and an admin date carries its one action.

   A row is picked by a press anywhere on it, which goes through its title:
   the title is the row's button, pressed while its thing is the one
   chosen, so the keyboard picks it with Enter or Space. The action is its
   own.

   ONLY AN ADMIN DATE CARRIES ITS ACTION HERE (his calLine): an event's row
   says its time on the right and nothing else. A noticeboard event's
   "Open notice" is the panel's, as an event's Edit will be. */

export function CalAgenda({
  rows,
  selected,
  fresh,
  onPick,
}: {
  rows: AgendaRow<CalItem>[];
  selected: string | null;
  /** Just saved: lit for a moment. */
  fresh: string | null;
  onPick: Pick;
}) {
  return (
    <div className="hd-cal-ag" data-scroll="">
      {rows.map((r) =>
        r.kind === "week" ? (
          <Week key={r.key} week={r} />
        ) : r.kind === "day" ? (
          <Day key={r.key} day={r} selected={selected} fresh={fresh} onPick={onPick} />
        ) : (
          <div key={r.key} className="hd-cal-r" data-kind="quiet">
            <div className="hd-cal-d">{r.dates}</div>
            <div className="hd-cal-c" data-long={r.longWeekend ? "" : undefined}>
              {r.text}
            </div>
          </div>
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
  selected,
  fresh,
  onPick,
}: {
  day: AgendaDay<CalItem>;
  selected: string | null;
  fresh: string | null;
  onPick: Pick;
}) {
  return (
    <div
      className="hd-cal-r"
      data-kind="day"
      data-today={day.today ? "" : undefined}
      data-weekend={day.weekend ? "" : undefined}
      data-holiday={day.holiday ? "" : undefined}
    >
      <div className="hd-cal-d">
        <div className="hd-cal-day">
          <span className="hd-cal-dw">{day.weekday}</span>
          <span className="hd-cal-dn">{day.date}</span>
        </div>
        {day.today && <div className="hd-cal-tl">Today</div>}
      </div>
      <div className="hd-cal-c">
        {day.lines.map((l) => (
          <Line
            key={l.item.id}
            line={l}
            on={l.item.id === selected}
            fresh={l.item.id === fresh}
            onPick={onPick}
          />
        ))}
        {day.lines.length === 0 && <p className="hd-cal-none">Nothing on today.</p>}
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
