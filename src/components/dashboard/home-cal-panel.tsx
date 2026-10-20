"use client";

import { useState } from "react";
import Link from "next/link";
import type { CalItem, CompanyCalendar } from "@/lib/calendar/items";
import { detail, type DayDetail } from "@/lib/calendar/model";
import { Button } from "@/components/parts/button";
import { EventForm } from "@/components/making/event-form";
import { actionLink, CalSwatch, type Pick } from "./home-cal-parts";

/* THE PANEL, beside Month and Year (his handoff "Calendar"): the one
   choice, whichever view made it, under the box that adds to its day.
   Never empty — before anything is pressed it holds the first thing from
   today (`firstSelection`).

   A THING (`CalPanel`): its kicker in its category's ink, its title, when,
   the status in his capsule (a named exemption, law 26), which alone turns
   late for an admin date past its due, the sentence and the facts the
   calendar knows (`detail`, lib/calendar/model), and its action: a link
   for what lives elsewhere, or Edit for the company's own events, to
   whoever may add to the calendar.

   A DAY (`CalDay`, Isaac, 2026-09-26: "you can't click on the day for it
   to show up on the right"): the day in full, "Thursday 1 October", and
   everything shown on it (`dayDetail`), each a row that picks it — the
   panel then shows that thing as above — or "Nothing on.". What was just
   added to the day is lit in its list.

   It draws what the page hands it and nothing moves here: the page holds
   what was shown while a pointer's pick fades it out, and fades the next
   one in (./home-cal-page, his calPick). */

export function CalPanel({
  item,
  items,
  frame,
  canEdit = false,
  onDeleted,
}: {
  item: CalItem | null;
  items: readonly CalItem[];
  frame: CompanyCalendar;
  /** Whoever may add to the calendar may change what the company put on it. */
  canEdit?: boolean;
  /** A delete went in: the form, and the Edit that opened it, are gone, so
      the page says where focus goes. */
  onDeleted?: () => void;
}) {
  /* EDIT OPENS THE EVENT FORM (components/making/event-form) over the
     page, for the one thing it was pressed on, and choosing something else
     lets it go, so choosing that thing again shows it, never the form it
     had. Closed, the dialog gives focus back to Edit; after a delete there
     is no Edit left, and the page takes it. */
  const [editing, setEditing] = useState<string | null>(null);
  if (editing !== null && item?.id !== editing) setEditing(null);

  const d = item ? detail(item, items, frame) : null;
  if (!item || !d) return null;
  const go = actionLink(item);
  const editable = canEdit && item.action === "edit";
  return (
    <div className="hd-cal-dx" data-c={item.cat}>
      <div className="hd-cal-dxh">
        <span className="hd-cal-k">{d.kicker}</span>
        <h3 className="hd-cal-dxt">{item.title}</h3>
        <div className="hd-cal-w">{d.when}</div>
        <span className="hd-cal-chip" data-tone={d.status.tone} data-c={item.cat}>
          {d.status.text}
        </span>
      </div>
      {d.description && <p className="hd-cal-desc">{d.description}</p>}
      {d.facts.length > 0 && (
        <dl className="hd-cal-facts">
          {d.facts.map(([k, v], i) => (
            <div key={`${i}:${k}`}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {go && (
        <div className="hd-cal-acts">
          <Link className="hd-cal-go" href={go.href}>
            {go.label}
          </Link>
        </div>
      )}
      {editable && (
        <div className="hd-cal-acts">
          <button type="button" className="hd-cal-go" onClick={() => setEditing(item.id)}>
            Edit
          </button>
        </div>
      )}
      {editable && editing === item.id && (
        <EventForm item={item} items={items} frame={frame} onClose={() => setEditing(null)} onDeleted={onDeleted} />
      )}
    </div>
  );
}

/** A day chosen: the day in full, then what is on it, each a row that picks
    it, with its swatch, its title and an event's time, and, for whoever may
    add to the calendar, Add an event on that day (rule 52). */
export function CalDay({
  day,
  fresh,
  onPick,
  onAdd,
}: {
  day: DayDetail<CalItem>;
  /** Just added to the day: lit in its list for a moment. */
  fresh: readonly string[] | null;
  onPick: Pick;
  /** Opens Add an event on this day. */
  onAdd?: () => void;
}) {
  return (
    <div className="hd-cal-dx" data-kind="day">
      <h3 className="hd-cal-dxt">{day.title}</h3>
      {day.lines.length > 0 ? (
        <ul className="hd-cal-dl">
          {day.lines.map((l) => (
            <li key={l.item.id}>
              <button
                type="button"
                className="hd-cal-dli"
                data-fresh={fresh?.includes(l.item.id) ? "" : undefined}
                aria-label={l.time ? `${l.title}, ${l.time}` : l.title}
                onClick={(e) => onPick(l.item.id, e.detail > 0)}
              >
                <CalSwatch cat={l.item.cat} late={l.late} />
                <span className="hd-cal-dlt">{l.title}</span>
                {l.time && <span className="hd-cal-tm">{l.time}</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hd-cal-none">Nothing on.</p>
      )}
      {onAdd && (
        <div className="hd-cal-acts">
          <Button size={32} icon="plus" onClick={onAdd}>
            Add an event
          </Button>
        </div>
      )}
    </div>
  );
}

/* THE KEY, at the foot of Year's panel: what each fill and dot means. His
   swatches, sharp (a key on a drawing has corners). */
const KEY = [
  ["hol", "Public holiday"],
  ["shutdown", "Shutdown"],
  ["school", "School holidays"],
  ["event", "Event"],
  ["admin", "Admin due"],
  ["late", "Admin overdue"],
] as const;

export function CalKey() {
  return (
    <ul className="hd-cal-key" aria-label="Key">
      {KEY.map(([k, label]) => (
        <li key={k} className="hd-cal-ki">
          <span className="hd-cal-ks" data-k={k} aria-hidden="true">
            {(k === "event" || k === "admin" || k === "late") && <i />}
          </span>
          {label}
        </li>
      ))}
    </ul>
  );
}
