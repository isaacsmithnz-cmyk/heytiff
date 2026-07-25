"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDate } from "@/lib/au-dates";
import {
  addHoliday,
  removeHoliday,
  restoreHoliday,
  type HolidayResult,
} from "@/app/actions/holidays";
import type { Holiday } from "@/lib/timepay/leave-query";

/* The public-holiday manager, embeddable — it lives inside the Time & Pay
   settings modal (admin+ section) and, until that fully replaces it, the old
   admin page wraps it too.

   The calendar mostly maintains itself (holiday-sync tops it up from the
   statutory rules), so this is the exceptions surface: add a proclaimed
   one-off, remove a day this business works, restore one removed by mistake.
   Removed auto days stay listed under "Removed" — they're tombstones the
   sync must not resurrect, so they must stay visible and reversible. */

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
