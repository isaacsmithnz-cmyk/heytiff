"use client";

import { useEffect, useRef, useState } from "react";
import {
  deleteCalendarEvent,
  editCalendarEvent,
  type CalendarEventPatch,
  type CalendarResult,
  type SeriesScope,
} from "@/app/actions/calendar";
import { DateField } from "@/components/ui/date-field";
import type { CalItem, CompanyCalendar } from "@/lib/calendar/items";

/* THE EDIT FORM, in the panel beside Month and Year: a company event as the
   calendar holds it — its name, its day (and its last day, for something
   that runs over several), its hours, where, who and its note — changed in
   place (H22, the Calendar spec's part D).

   A SERIES IS ONE THING AND ELEVEN DATES. "Every first Thursday" went on as
   a row per date, so a change can be to this one or to all of them: "Save
   this one" and "Save all 11", as its delete is "Delete this one" and
   "Delete all 11". All of them changes what every date says; the day moves
   only for this one, because each date is its rule's (app/actions/calendar
   `editCalendarEvent`). The number is the dates the calendar shows, and
   all is exactly those: the server holds "all" to the same twelve months.

   A DELETE ASKS TWICE. "Delete event" never deletes: it swaps the buttons
   for the question and the choice, and Keep, which takes focus, so a second
   Enter backs out rather than deletes.

   The server decides every rule again (who may, the times, the days); the
   form only keeps what it cannot send from being pressed. */

const FAILED = "Couldn't change that on the calendar.";

type Pressed = "one" | "series" | "delete-one" | "delete-series";

export function CalEdit({
  item,
  items,
  frame,
  kicker,
  onDone,
}: {
  item: CalItem;
  /** Every item, for how many dates its series has on the calendar. */
  items: readonly CalItem[];
  frame: Pick<CompanyCalendar, "today" | "windowStart" | "windowEnd">;
  /** What kind of thing it is, as the panel says it: "Event". */
  kicker: string;
  /** Saved, deleted or cancelled. */
  onDone: (how: "saved" | "deleted" | "cancelled") => void;
}) {
  const ev = item.event;
  const shutdown = ev?.kind === "shutdown";
  const series = item.seriesId ? items.filter((x) => x.seriesId === item.seriesId).length : 0;
  const inSeries = series > 1;
  /* A date in a series is one day; a shutdown, or anything already running
     over several days, has a last day to change. */
  const ranged = !item.seriesId && (shutdown || item.end > item.start);

  const [name, setName] = useState(item.title);
  const [day, setDay] = useState(item.start);
  const [last, setLast] = useState(item.end);
  const [from, setFrom] = useState(item.time ?? "");
  const [to, setTo] = useState(item.timeEnd ?? "");
  const [where, setWhere] = useState(ev?.location ?? "");
  const [who, setWho] = useState(ev?.audience ?? "");
  const [note, setNote] = useState(ev?.note ?? "");
  const [pressed, setPressed] = useState<Pressed | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A second press before the first one's render is not a second save. */
  const busy = useRef(false);
  const first = useRef<HTMLInputElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const del = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);

  const id = item.id.slice("ev:".length);
  const named = name.trim() !== "";

  /* Into the form at its name, once, as it opens. */
  useEffect(() => {
    first.current?.focus({ preventScroll: true });
  }, []);
  /* The question replaced the button that had focus: Keep takes it. Backed
     out of, the question gives it back to Delete event. */
  useEffect(() => {
    if (asking) {
      wasAsking.current = true;
      keep.current?.focus({ preventScroll: true });
    } else if (wasAsking.current) {
      wasAsking.current = false;
      del.current?.focus({ preventScroll: true });
    }
  }, [asking]);

  const run = async (how: Pressed, call: () => Promise<CalendarResult | { ok: true; count: number }>) => {
    if (busy.current) return;
    busy.current = true;
    setPressed(how);
    setError(null);
    let res: CalendarResult | { ok: true; count: number };
    try {
      res = await call();
    } catch {
      res = { ok: false, error: FAILED };
    }
    busy.current = false;
    setPressed(null);
    if (res.ok) return onDone(how === "one" || how === "series" ? "saved" : "deleted");
    setAsking(false);
    setError(res.error);
  };

  const save = (scope: SeriesScope) => {
    if (!named) return;
    const patch: CalendarEventPatch = {
      title: name,
      startsOn: day,
      endsOn: ranged ? last : day,
      startsAt: shutdown || !from ? null : from,
      endsAt: shutdown || !to ? null : to,
      location: where,
      audience: who,
      note,
    };
    void run(scope, () => editCalendarEvent(id, patch, scope));
  };

  const remove = (scope: SeriesScope) =>
    void run(scope === "series" ? "delete-series" : "delete-one", () => deleteCalendarEvent(id, scope));

  const out = pressed !== null;
  const word = (how: Pressed, words: string) =>
    pressed === how ? (how.startsWith("delete") ? "Deleting…" : "Saving…") : words;

  return (
    <form
      className="hd-cal-ed"
      aria-label={`Edit ${item.title}`}
      /* Enter saves this one: never all of a series, which is a press of its own. */
      onSubmit={(e) => {
        e.preventDefault();
        save("one");
      }}
    >
      <span className="hd-cal-k">{kicker}</span>
      <label className="hd-cal-edf">
        <span>Name</span>
        <input
          ref={first}
          className="hd-cal-fi"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
        />
      </label>
      <div className={ranged ? "hd-cal-edr" : undefined}>
        <label className="hd-cal-edf">
          <span>{ranged ? "First day" : "Day"}</span>
          <DateField
            className="hd-cal-fi"
            value={day}
            today={frame.today}
            min={frame.windowStart}
            max={frame.windowEnd}
            onChange={(iso) => {
              if (!iso) return;
              setDay(iso);
              if (last < iso) setLast(iso);
            }}
          />
        </label>
        {ranged && (
          <label className="hd-cal-edf">
            <span>Last day</span>
            <DateField
              className="hd-cal-fi"
              value={last}
              today={frame.today}
              min={day}
              onChange={(iso) => {
                if (iso) setLast(iso);
              }}
            />
          </label>
        )}
      </div>
      {!shutdown && (
        <div className="hd-cal-edr">
          <label className="hd-cal-edf">
            <span>From</span>
            <input className="hd-cal-fi" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="hd-cal-edf">
            <span>To</span>
            <input className="hd-cal-fi" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      )}
      <label className="hd-cal-edf">
        <span>Where</span>
        <input className="hd-cal-fi" value={where} maxLength={120} onChange={(e) => setWhere(e.target.value)} />
      </label>
      <label className="hd-cal-edf">
        <span>Who</span>
        <input className="hd-cal-fi" value={who} maxLength={80} onChange={(e) => setWho(e.target.value)} />
      </label>
      <label className="hd-cal-edf">
        <span>Note</span>
        <textarea className="hd-cal-fi" rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
      </label>

      {/* Two rows, never one row reused: a button that stayed in the DOM
          would keep the focus of the one pressed, whatever it now says. */}
      {asking ? (
        <div key="ask" className="hd-cal-eda" role="group" aria-label="Delete for good?">
          <span className="hd-cal-edq">Delete for good?</span>
          {inSeries ? (
            <>
              <button type="button" className="hd-cal-edb" disabled={out} onClick={() => remove("one")}>
                {word("delete-one", "Delete this one")}
              </button>
              <button type="button" className="hd-cal-edb" disabled={out} onClick={() => remove("series")}>
                {word("delete-series", `Delete all ${series}`)}
              </button>
            </>
          ) : (
            <button type="button" className="hd-cal-edb" disabled={out} onClick={() => remove("one")}>
              {word("delete-one", "Delete event")}
            </button>
          )}
          <button type="button" className="hd-cal-edb" ref={keep} disabled={out} onClick={() => setAsking(false)}>
            Keep
          </button>
        </div>
      ) : (
        <div key="acts" className="hd-cal-eda">
          <button type="submit" className="hd-cal-go" disabled={out || !named}>
            {word("one", inSeries ? "Save this one" : "Save changes")}
          </button>
          {inSeries && (
            <button type="button" className="hd-cal-edb" disabled={out || !named} onClick={() => save("series")}>
              {word("series", `Save all ${series}`)}
            </button>
          )}
          <button type="button" className="hd-cal-edb" ref={del} disabled={out} onClick={() => setAsking(true)}>
            Delete event
          </button>
          <button type="button" className="hd-cal-edb" disabled={out} onClick={() => onDone("cancelled")}>
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p className="tm-err" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
