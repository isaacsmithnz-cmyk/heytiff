"use client";

import { useContext, useEffect, useId, useRef, useState } from "react";
import { Dialog } from "@/components/parts/dialog";
import { Button, IconButton } from "@/components/parts/button";
import { Field, TextArea, TextInput } from "@/components/parts/field";
import { Chooser } from "@/components/parts/chooser";
import { Tray } from "@/components/parts/tabs";
import { TimeField } from "@/components/parts/time-field";
import { DateField } from "@/components/ui/date-field";
import { WindowsContext } from "@/components/records/records-context";
import {
  addCalendarEventForm,
  deleteCalendarEvent,
  editCalendarEvent,
  undoCalendarLine,
  type CalendarEventPatch,
  type SeriesScope,
} from "@/app/actions/calendar";
import { DAY_NAMES_LONG, dateOf, monthEnd, toDay, weekdayOf } from "@/lib/calendar/days";
import type { RepeatRule, Weekday } from "@/lib/calendar/repeat";
import type { CalItem, CompanyCalendar } from "@/lib/calendar/items";
import { hhmmOf, wheelOf } from "./clock";

/* ADD AN EVENT, AND AN EVENT'S EDIT (rules 51 and 52): one form for a
   company event or a shutdown, over the page you're on.

   It opens from the calendar's Add an event, with the day the calendar adds
   to; from a day picked on the calendar, with that day; and from an event's
   Edit, with everything the event holds. Saving keeps you where you were,
   with a toast and Undo.

   ADDING files through `addCalendarEventForm`, which holds the form to the
   rules Sort it out's line is held to (app/actions/calendar `fileRows`): a
   kind, Event or Shutdown; a name; a day and a last day; hours, which a
   shutdown never has; a repeat counted off the day, which a shutdown never
   has either, and which goes on as one row per date, skipping public
   holidays and shutdowns; where, who and a note. Undo takes every row it
   put on back off (`undoCalendarLine`).

   EDITING is today's `editCalendarEvent`, field for field. A date in a
   series can be changed alone or with all of them: "Save this one" and
   "Save all 11", and Enter saves this one, never all. Undo puts back what
   each date said before, one at a time. A delete asks twice, "Delete this
   one" or "Delete all 11" beside Keep, which takes focus; a delete has no
   Undo. The server decides every rule again; the form only holds back what
   it cannot send. */

export type EventFrame = Pick<CompanyCalendar, "today" | "windowStart" | "windowEnd">;

type Kind = "event" | "shutdown";
type Repeats = "none" | "week" | "fortnight" | "nth" | "last";
type Pressed = "add" | "one" | "series" | "delete-one" | "delete-series";

const FAILED = "Couldn't change that on the calendar.";
const KINDS = [
  { value: "event", label: "Event" },
  { value: "shutdown", label: "Shutdown" },
] as const;
const WEEKDAYS: readonly Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const NTH = ["", "first", "second", "third", "fourth"] as const;

/** The repeats a day can have, named off the day: Thursday 6 November is
    every Thursday, every second Thursday, every first Thursday, and, as
    the month's last, every last Thursday too. */
export function repeatChoices(iso: string): { value: Repeats; label: string }[] {
  const n = toDay(iso);
  const out: { value: Repeats; label: string }[] = [{ value: "none", label: "Doesn't repeat" }];
  if (Number.isNaN(n)) return out;
  const name = DAY_NAMES_LONG[weekdayOf(n)];
  const nth = Math.ceil(dateOf(n) / 7);
  out.push({ value: "week", label: `Every ${name}` }, { value: "fortnight", label: `Every second ${name}` });
  if (nth <= 4) out.push({ value: "nth", label: `Every ${NTH[nth]} ${name}` });
  if (n + 7 > monthEnd(n)) out.push({ value: "last", label: `Every last ${name}` });
  return out;
}

/** The rule a choice makes of its day, or null for none. */
export function repeatRule(choice: Repeats, iso: string): RepeatRule | null {
  const n = toDay(iso);
  if (choice === "none" || Number.isNaN(n)) return null;
  const day = WEEKDAYS[weekdayOf(n)]!;
  if (choice === "week" || choice === "fortnight") return { every: choice, day };
  if (choice === "last") return { every: "month", day, nth: "last" };
  const nth = Math.ceil(dateOf(n) / 7);
  return nth <= 4 ? { every: "month", day, nth: nth as 1 | 2 | 3 | 4 } : null;
}

/** What a date of the calendar says now, as the edit action takes it. */
const patchOf = (it: CalItem): CalendarEventPatch => ({
  title: it.title,
  startsOn: it.start,
  endsOn: it.end,
  startsAt: it.time ?? null,
  endsAt: it.timeEnd ?? null,
  location: it.event?.location ?? null,
  audience: it.event?.audience ?? null,
  note: it.event?.note ?? null,
});

export function EventForm({
  frame,
  day,
  item,
  items = [],
  onClose,
  onAdded,
  onDeleted,
}: {
  frame: EventFrame;
  /** The day a new event goes on: the calendar's, or the day picked. */
  day?: string | null;
  /** The event Edit was pressed on; left out, the form adds one. */
  item?: CalItem | null;
  /** Every item on the calendar, for how many dates a series has. */
  items?: readonly CalItem[];
  onClose: () => void;
  /** What went on, every date of it, and the first day it went on. */
  onAdded?: (ids: string[], day: string) => void;
  onDeleted?: () => void;
}) {
  const host = useContext(WindowsContext);
  const dayId = useId();
  const lastId = useId();
  const ev = item?.event ?? null;
  const editing = !!item;
  const seriesDates = item?.seriesId ? items.filter((x) => x.seriesId === item.seriesId) : [];
  const inSeries = seriesDates.length > 1;
  const id = item ? item.id.slice("ev:".length) : "";

  const [kind, setKind] = useState<Kind>(ev?.kind ?? "event");
  const [name, setName] = useState(item?.title ?? "");
  const [start, setStart] = useState(item?.start ?? day ?? frame.today);
  /* "" is the same day: one day, unless a last day is picked. */
  const [last, setLast] = useState(item && item.end > item.start ? item.end : "");
  const [from, setFrom] = useState(item?.time ?? "");
  const [to, setTo] = useState(item?.timeEnd ?? "");
  const [repeats, setRepeats] = useState<Repeats>("none");
  const [where, setWhere] = useState(ev?.location ?? "");
  const [who, setWho] = useState(ev?.audience ?? "");
  const [note, setNote] = useState(ev?.note ?? "");
  const [pressed, setPressed] = useState<Pressed | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A second press before the first one's render is not a second save. */
  const busy = useRef(false);
  const keep = useRef<HTMLButtonElement>(null);
  const del = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);

  /* The question replaces the button that had focus: Keep takes it, so a
     second Enter backs out rather than deletes. Backed out of, the question
     gives it back to Delete. */
  useEffect(() => {
    if (asking) {
      wasAsking.current = true;
      keep.current?.focus({ preventScroll: true });
    } else if (wasAsking.current) {
      wasAsking.current = false;
      del.current?.focus({ preventScroll: true });
    }
  }, [asking]);

  const shutdown = kind === "shutdown";
  const named = name.trim() !== "";
  const choices = repeatChoices(start);
  const repeat = !editing && !shutdown && choices.some((c) => c.value === repeats) ? repeats : "none";
  /* A date of a series is one day, and so is a repeat's every date. */
  const oneDay = repeat !== "none" || !!item?.seriesId;
  const out = pressed !== null;
  const word = shutdown ? "shutdown" : "event";

  const run = async (how: Pressed, call: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    if (busy.current) return;
    busy.current = true;
    setPressed(how);
    setError(null);
    let res: { ok: true } | { ok: false; error: string };
    try {
      res = await call();
    } catch {
      res = { ok: false, error: FAILED };
    }
    busy.current = false;
    setPressed(null);
    if (!res.ok) {
      setAsking(false);
      setError(res.error);
    }
  };

  const add = () => {
    if (!named) return;
    void run("add", async () => {
      const res = await addCalendarEventForm({
        kind,
        title: name,
        startsOn: start,
        endsOn: oneDay || !last ? start : last,
        startsAt: shutdown || !from ? null : from,
        endsAt: shutdown || !to ? null : to,
        repeat: shutdown ? null : repeatRule(repeat, start),
        location: where,
        audience: who,
        note,
      });
      if (!res.ok) return res;
      onClose();
      onAdded?.(res.ids, res.day);
      const n = res.ids.length;
      const said = n > 1 ? `${n} events added` : shutdown ? "Shutdown added" : "Event added";
      host?.toast(res.skips ? `${said}. ${res.skips}` : said, async () => {
        await undoCalendarLine(res.ids);
      });
      return res;
    });
  };

  const save = (scope: SeriesScope) => {
    if (!named || !item) return;
    const patch: CalendarEventPatch = {
      title: name,
      startsOn: start,
      endsOn: oneDay || !last ? start : last,
      startsAt: shutdown || !from ? null : from,
      endsAt: shutdown || !to ? null : to,
      location: where,
      audience: who,
      note,
    };
    /* What each date said before, for Undo: this one, or every date the
       calendar shows, which is what "all" changes. */
    const before = (scope === "series" && inSeries ? seriesDates : [item]).map((it) => [it.id.slice("ev:".length), patchOf(it)] as const);
    void run(scope, async () => {
      const res = await editCalendarEvent(id, patch, scope);
      if (!res.ok) return res;
      onClose();
      const n = before.length;
      host?.toast(n > 1 ? `${n} events saved` : shutdown ? "Shutdown saved" : "Event saved", async () => {
        for (const [eid, was] of before) await editCalendarEvent(eid, was, "one");
      });
      return res;
    });
  };

  const remove = (scope: SeriesScope) =>
    void run(scope === "series" ? "delete-series" : "delete-one", async () => {
      const res = await deleteCalendarEvent(id, scope);
      if (!res.ok) return res;
      onClose();
      onDeleted?.();
      host?.toast(res.count > 1 ? `${res.count} events deleted` : shutdown ? "Shutdown deleted" : "Event deleted");
      return { ok: true as const };
    });

  const label = (how: Pressed, words: string) =>
    pressed === how ? (how === "add" ? `Adding the ${word}` : how.startsWith("delete") ? `Deleting the ${word}` : `Saving the ${word}`) : words;

  const foot = asking ? (
    <div key="ask" className="mk-team-ask" role="group" aria-label="Delete for good?">
      <span className="mk-team-askq">Delete for good?</span>
      <Button kind="second" ref={keep} disabled={out} onClick={() => setAsking(false)}>
        Keep
      </Button>
      {inSeries ? (
        <>
          <Button kind="danger" disabled={out} onClick={() => remove("one")}>
            {label("delete-one", "Delete this one")}
          </Button>
          <Button kind="danger" disabled={out} onClick={() => remove("series")}>
            {label("delete-series", `Delete all ${seriesDates.length}`)}
          </Button>
        </>
      ) : (
        <Button kind="danger" disabled={out} onClick={() => remove("one")}>
          {label("delete-one", `Delete ${word}`)}
        </Button>
      )}
    </div>
  ) : editing ? (
    <>
      <Button kind="delete" ref={del} className="mk-team-first" disabled={out} onClick={() => setAsking(true)}>
        {`Delete ${word}`}
      </Button>
      <Button kind="second" disabled={out} onClick={onClose}>
        Cancel
      </Button>
      {inSeries && (
        <Button kind="second" disabled={out || !named} onClick={() => save("series")}>
          {label("series", `Save all ${seriesDates.length}`)}
        </Button>
      )}
      <Button kind="main" disabled={out || !named} onClick={() => save("one")}>
        {label("one", inSeries ? "Save this one" : "Save changes")}
      </Button>
    </>
  ) : (
    <>
      <Button kind="second" disabled={out} onClick={onClose}>
        Cancel
      </Button>
      <Button kind="main" disabled={out || !named} onClick={add}>
        {label("add", `Add ${word}`)}
      </Button>
    </>
  );

  return (
    <Dialog heading={editing ? `Edit ${word}` : "Add an event"} width={560} onClose={onClose} foot={foot}>
      <form
        className="mk-form"
        aria-label={item ? `Edit ${item.title}` : "Add an event"}
        /* Enter saves this one: never all of a series, which is a press of its own. */
        onSubmit={(e) => {
          e.preventDefault();
          if (editing) save("one");
          else add();
        }}
        /* The buttons are in the dialog's foot, outside the form, so Enter in
           a one-line field is what submits it. */
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing || (e.target as HTMLElement).tagName !== "INPUT") return;
          e.preventDefault();
          if (editing) save("one");
          else add();
        }}
      >
        {!editing && (
          <div className="pt-field">
            <span className="pt-field-label">Kind</span>
            <Tray ariaLabel="Kind" options={KINDS} value={kind} onChange={setKind} />
          </div>
        )}
        <Field label="Name">
          <TextInput value={name} maxLength={120} autoComplete="off" data-autofocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="mk-pair">
          <Field label="Day" id={dayId}>
            <DateField
              id={dayId}
              value={start}
              today={frame.today}
              min={frame.windowStart}
              max={frame.windowEnd}
              onChange={(iso) => {
                if (!iso) return;
                setStart(iso);
                if (last && last < iso) setLast(iso);
              }}
            />
          </Field>
          {!item?.seriesId && (
            <Field label="Last day" id={lastId}>
              <DateField
                id={lastId}
                value={oneDay ? null : last || null}
                today={frame.today}
                min={start}
                max={frame.windowEnd}
                clearable
                disabled={oneDay}
                placeholder="Same day"
                onChange={(iso) => setLast(iso ?? "")}
              />
            </Field>
          )}
        </div>
        {!shutdown && (
          <div className="mk-pair">
            <Field label="From">
              <ClockField value={from} onChange={setFrom} clear="Clear the start" />
            </Field>
            <Field label="To">
              <ClockField value={to} onChange={setTo} clear="Clear the finish" />
            </Field>
          </div>
        )}
        {!editing && !shutdown && (
          <Field label="Repeats">
            <Chooser options={choices} value={repeat} onChange={(v) => setRepeats(v as Repeats)} />
          </Field>
        )}
        <Field label="Where">
          <TextInput value={where} maxLength={120} onChange={(e) => setWhere(e.target.value)} />
        </Field>
        <Field label="Who">
          <TextInput value={who} maxLength={80} onChange={(e) => setWho(e.target.value)} />
        </Field>
        <Field label="Note">
          <TextArea value={note} rows={3} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && (
          <p className="mk-team-wrong" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/** A clock time on the wheel, "HH:MM" in and out, that can be cleared: no
    time is all day. */
function ClockField({ value, onChange, clear }: { value: string; onChange: (v: string) => void; clear: string }) {
  return (
    <div className="mk-team-time">
      <TimeField value={wheelOf(value)} onChange={(v) => onChange(hhmmOf(v))} placeholder="No time" />
      {value && <IconButton glyph="clear" label={clear} onClick={() => onChange("")} />}
    </div>
  );
}
