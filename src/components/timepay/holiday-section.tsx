"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDate } from "@/lib/au-dates";
import {
  addHoliday,
  removeHoliday,
  restoreHoliday,
  type HolidayResult,
} from "@/app/actions/holidays";
import { provisionalHolidays } from "@/lib/timepay/holiday-rules";
import type { Holiday } from "@/lib/timepay/leave-query";

/* The public-holiday manager, embeddable — it lives inside the Time & Pay
   settings modal (admin+ section) and, until that fully replaces it, the old
   admin page wraps it too.

   The calendar mostly maintains itself (holiday-sync tops it up from the
   statutory rules), so this is the exceptions surface: add a proclaimed
   one-off, remove a day this business works, restore one removed by mistake.
   Removed auto days stay listed under "Removed" — they're tombstones the
   sync must not resurrect, so they must stay visible and reversible.

   "Worth confirming" covers the other half of the calendar: days that are real
   but whose DATE nobody can compute (WA's proclaimed King's Birthday, the
   Friday before the AFL Grand Final). The rules module never auto-writes those,
   so the admin gets a quiet nudge with the usual timing, prefills the form from
   it, and types the date off the gazette — which lands it as a manual row. */

const STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"] as const;

export function HolidaySection({
  holidays,
  orgState,
  today,
}: {
  holidays: Holiday[];
  orgState: string | null;
  today: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [state, setState] = useState<string>(orgState ?? "NSW");
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const dateRef = useRef<HTMLInputElement>(null);

  const run = (action: () => Promise<HolidayResult>, onOk?: () => void) => {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.ok) {
        onOk?.();
        router.refresh();
      } else setError(res.error);
    });
  };

  const active = holidays.filter((h) => !h.suppressed);
  const removed = holidays.filter((h) => h.suppressed);

  // Proclamation-dependent days for this org's state, this year and next, minus
  // any already on the calendar under that name — including removed ones, since
  // a tombstone is a decision not to observe it, not an invitation to re-suggest.
  const thisYear = Number(today.slice(0, 4));
  const suggestions = !orgState
    ? []
    : [thisYear, thisYear + 1].flatMap((year) =>
        provisionalHolidays(orgState, year)
          .filter(
            (p) =>
              !holidays.some(
                (h) =>
                  h.state === orgState && h.name === p.name && h.date.slice(0, 4) === String(year),
              ),
          )
          .map((p) => ({ ...p, year, state: orgState })),
      );

  // group by year for a scannable list
  const byYear = new Map<string, Holiday[]>();
  for (const h of active) {
    const y = h.date.slice(0, 4);
    byYear.set(y, [...(byYear.get(y) ?? []), h]);
  }

  return (
    <div className="hol-sec">
      {error && <div className="tp-err">{error}</div>}

      <div className="lv-form" style={{ marginTop: 4 }}>
        <div className="lv-frow">
          <label className="mts-f">
            <span>State</span>
            <select value={state} onChange={(e) => setState(e.target.value)}>
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="mts-f">
            <span>Date</span>
            <input
              ref={dateRef}
              type="date"
              value={date}
              min={today.slice(0, 4) + "-01-01"}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="mts-f" style={{ flex: 1, minWidth: 200 }}>
            <span>Holiday name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Picnic Day" />
          </label>
          <div className="mts-facts" style={{ alignItems: "flex-end" }}>
            <button
              className="fl-btn primary"
              disabled={busy || !date || !name.trim()}
              onClick={() =>
                run(
                  () => addHoliday({ state, date, name }),
                  () => {
                    setDate("");
                    setName("");
                  },
                )
              }
            >
              <Icon name="plus" size={14} />
              Add holiday
            </button>
          </div>
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="hol-sug">
          <div className="hol-sugh">
            Worth confirming
            <span>These are set by proclamation — add the date once it&rsquo;s gazetted.</span>
          </div>
          {suggestions.map((s) => (
            <div className="hol-sugrow" key={`${s.year}-${s.name}`}>
              <span className="hol-sugy">{s.year}</span>
              <span className="hol-sugmain">
                <b>{s.name}</b>
                <em>{s.usual}</em>
              </span>
              <button
                className="hol-sugadd"
                title="Prefill the form — you supply the gazetted date"
                onClick={() => {
                  setState(s.state);
                  setName(s.name);
                  setDate("");
                  dateRef.current?.focus();
                }}
              >
                <Icon name="plus" size={13} />
                Add
              </button>
            </div>
          ))}
        </div>
      )}

      {active.length === 0 ? (
        <div className="fl-hempty" style={{ marginTop: 20 }}>
          No holidays yet — they&rsquo;ll fill in automatically for your state, or add one above.
        </div>
      ) : (
        [...byYear.entries()].map(([year, rows]) => (
          <div className="hol-year" key={year}>
            <div className="lv-ch">{year}</div>
            {rows.map((h) => (
              <div className="hol-row" key={h.id}>
                <span className="hol-date">{fmtAuWeekdayDate(h.date)}</span>
                <span className="hol-name">{h.name}</span>
                <span className="dchip2 mute">{h.state}</span>
                <span className={`hol-src${h.source === "manual" ? "" : " synced"}`}>{h.source}</span>
                <button
                  className="lv-cancel"
                  disabled={busy}
                  title="Remove"
                  onClick={() => run(() => removeHoliday(h.id))}
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
          </div>
        ))
      )}

      {removed.length > 0 && (
        <div className="hol-year removed">
          <div className="lv-ch">Removed — this business works these days</div>
          {removed.map((h) => (
            <div className="hol-row off" key={h.id}>
              <span className="hol-date">{fmtAuWeekdayDate(h.date)}</span>
              <span className="hol-name">{h.name}</span>
              <span className="dchip2 mute">{h.state}</span>
              <button
                className="lv-cancel"
                disabled={busy}
                title="Restore"
                onClick={() => run(() => restoreHoliday(h.id))}
              >
                <Icon name="sync" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
