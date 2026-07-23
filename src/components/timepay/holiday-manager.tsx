"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { addHoliday, removeHoliday, type HolidayResult } from "@/app/actions/holidays";
import type { Holiday } from "@/lib/timepay/leave-query";

/* Admin public-holiday manager — the yearly-maintenance path. States gazette
   1–2 years ahead; the office manager enters next year's dates once a year.
   Since there's no maintained government feed, this (or a future accounting
   sync) is how the calendar stays current. */

const STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"] as const;

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
    .format(new Date(`${iso}T00:00:00Z`))
    .replace(",", "");
}

export function HolidayManager({
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

  // group by year for a scannable list
  const byYear = new Map<string, Holiday[]>();
  for (const h of holidays) {
    const y = h.date.slice(0, 4);
    byYear.set(y, [...(byYear.get(y) ?? []), h]);
  }

  return (
    <div className="wrap">
      <div className="stg">
        <div className="v2head" style={{ marginBottom: 8 }}>
          <div>
            <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
              Public holidays
            </h1>
          </div>
        </div>
        <p className="hol-intro">
          Your organisation&rsquo;s holiday calendar. Staff see these on their timesheet, and leave
          skips them when it suggests hours. States publish dates a year or two ahead — add next
          year&rsquo;s once they&rsquo;re gazetted.
        </p>

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
              <input type="date" value={date} min={today.slice(0, 4) + "-01-01"} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="mts-f" style={{ flex: 1, minWidth: 200 }}>
              <span>Holiday name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Labour Day" />
            </label>
            <div className="mts-facts" style={{ alignItems: "flex-end" }}>
              <button
                className="fl-btn primary"
                disabled={busy || !date || !name.trim()}
                onClick={() => run(() => addHoliday({ state, date, name }), () => { setDate(""); setName(""); })}
              >
                <Icon name="plus" size={14} />
                Add holiday
              </button>
            </div>
          </div>
        </div>

        {holidays.length === 0 ? (
          <div className="fl-hempty" style={{ marginTop: 20 }}>
            No holidays yet. Add your state&rsquo;s gazetted dates above.
          </div>
        ) : (
          [...byYear.entries()].map(([year, rows]) => (
            <div className="hol-year" key={year}>
              <div className="lv-ch">{year}</div>
              {rows.map((h) => (
                <div className="hol-row" key={h.id}>
                  <span className="hol-date">{fmtDate(h.date)}</span>
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
      </div>
    </div>
  );
}
