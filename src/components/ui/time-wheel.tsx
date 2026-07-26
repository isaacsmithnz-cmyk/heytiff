"use client";

import { useEffect, useRef } from "react";
import { parseClock } from "@/components/timepay/logic";

/* A clock you scroll, not one you type.

   THE RULE THIS COMPONENT EXISTS FOR: a time can never be unreadable. The old
   timesheet took a free-text start and finish and ran them through
   `parseClock`, which is forgiving but not omniscient — "half seven", a
   stray letter, an empty box, and the day refused to save. Nobody types a
   time into software any more, and there is no reason a person entering the
   most routine fact about their day should be able to get it wrong.

   So the value is not typed, it is CHOSEN: three columns of fixed options,
   every one of which is a real time. The output is still the "7:00 AM" string
   the rest of Time & Pay reads and `time_entries.start_time` stores, so
   nothing downstream changes — but every value this emits round-trips through
   `parseClock` by construction. The parser stays for the rows already in the
   database, not for anything a person can produce from here.

   Each cell is a real <button>, so the wheel works by scroll, by click, by
   keyboard and by screen reader. The scroll is the nice way to use it, not
   the only way — a wheel you can only spin is a wheel a keyboard user can't
   reach. */

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MERIDIEM = ["AM", "PM"] as const;

/** Minutes, at the granularity a timesheet is actually kept to. Five is the
    finest anyone writes on a docket; a wheel of 60 is a wheel nobody can
    land on. */
const MINUTE_STEP = 5;
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);

export type ClockParts = { hour: number; minute: number; meridiem: "AM" | "PM" };

/** "7:05 AM" from its parts — the one place the stored format is written. */
export function formatClock({ hour, minute, meridiem }: ClockParts): string {
  return `${hour}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

/** Split a stored time into wheel positions. Anything unreadable — including
    the empty string a legacy row can carry — lands on a sane 7:00 AM rather
    than an empty wheel, because there is no "no time" position to show. */
export function clockParts(value: string): ClockParts {
  const mins = parseClock(value);
  if (mins == null) return { hour: 7, minute: 0, meridiem: "AM" };
  const h24 = Math.floor(mins / 60);
  /* Minutes are snapped to the wheel's step so an imported 7:07 shows as a
     position that exists. It is only a display snap — nothing is saved until
     the person moves a column. */
  const minute = Math.round((mins % 60) / MINUTE_STEP) * MINUTE_STEP;
  const rolled = minute === 60;
  const hour24 = (h24 + (rolled ? 1 : 0)) % 24;
  return {
    hour: ((hour24 + 11) % 12) + 1,
    minute: rolled ? 0 : minute,
    meridiem: hour24 < 12 ? "AM" : "PM",
  };
}

function Column<T extends string | number>({
  label,
  options,
  value,
  render,
  onPick,
  disabled,
}: {
  label: string;
  options: readonly T[];
  value: T;
  render: (o: T) => string;
  onPick: (o: T) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  /* Keep the chosen option under the wheel's centre line. Without this a wheel
     opens showing 1–4 o'clock with the real value scrolled out of sight, which
     reads as "no time set". */
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>("[data-on='true']");
    const box = ref.current;
    if (el && box) box.scrollTop = Math.max(0, el.offsetTop - (box.clientHeight - el.offsetHeight) / 2);
  }, [value]);

  return (
    <div className="tw-col">
      <span className="tw-lab">{label}</span>
      <div className="tw-scroll" ref={ref} role="listbox" aria-label={label}>
        {options.map((o) => (
          <button
            type="button"
            key={String(o)}
            role="option"
            aria-selected={o === value}
            data-on={o === value}
            className={`tw-opt${o === value ? " on" : ""}`}
            disabled={disabled}
            onClick={() => onPick(o)}
          >
            {render(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TimeWheel({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  /** a stored clock string — "7:00 AM" */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const parts = clockParts(value);
  const set = (p: Partial<ClockParts>) => onChange(formatClock({ ...parts, ...p }));

  return (
    <div className="tw" role="group" aria-label={label}>
      <div className="tw-head">
        <span className="tw-title">{label}</span>
        <b className="tw-val">{formatClock(parts)}</b>
      </div>
      <div className="tw-cols">
        <Column
          label="Hour"
          options={HOURS}
          value={parts.hour}
          render={(h) => String(h)}
          onPick={(hour) => set({ hour })}
          disabled={disabled}
        />
        <Column
          label="Minute"
          options={MINUTES}
          value={parts.minute}
          render={(m) => String(m).padStart(2, "0")}
          onPick={(minute) => set({ minute })}
          disabled={disabled}
        />
        <Column
          label="AM/PM"
          options={MERIDIEM}
          value={parts.meridiem}
          render={(m) => m}
          onPick={(meridiem) => set({ meridiem })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
