"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { DateField } from "@/components/ui/date-field";
import { fmtAuWeekdayDate } from "@/lib/au-dates";
import {
  addHoliday,
  getHolidayManagerData,
  removeHoliday,
  restoreHoliday,
  type HolidayResult,
} from "@/app/actions/holidays";
import { provisionalHolidays } from "@/lib/timepay/holiday-rules";
import type { HolidayManagerData } from "@/lib/timepay/leave-page";
import type { Holiday } from "@/lib/timepay/leave-query";

/* The public-holiday manager. It lives in one place: a folding admin+ section
   at the bottom of the Time & Pay settings gear. (The old admin page that also
   wrapped it is gone.)

   The calendar mostly maintains itself (holiday-sync tops it up from the
   statutory rules), so this is the exceptions surface: add a proclaimed
   one-off, remove a day this business works, restore one removed by mistake.
   Removed auto days stay listed under "Removed" — they're tombstones the
   sync must not resurrect, so they must stay visible and reversible.

   "Worth confirming" covers the other half of the calendar: days that are real
   but whose DATE nobody can compute (WA's proclaimed King's Birthday, the
   Friday before the AFL Grand Final). The rules module never auto-writes those,
   so the admin gets a quiet nudge with the usual timing, prefills the form from
   it, and types the date off the gazette — which lands it as a manual row.

   THE CALENDAR LOADS ON FIRST MOUNT, not with the Time & Pay page — the same
   pattern as the Xero section beside it, and this section is only mounted once
   its menu row is opened. A year of holiday rows plus a statutory top-up that
   can WRITE were being fetched on every visit to a screen about timesheets. */

const STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"] as const;

export function HolidaySection({
  load = getHolidayManagerData,
}: {
  /** Injectable for tests; production uses the admin-gated server action. */
  load?: () => Promise<HolidayManagerData | null>;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<HolidayManagerData | null>(null);
  const [loading, setLoading] = useState(true);

  /* NULL until the admin picks one, rather than seeded from the org and then
     re-seeded on every re-fetch: the form re-reads its own calendar after each
     add, and a seeding effect would drag the picker back off the state they
     were working in mid-entry. Null simply means "still the org's". */
  const [picked, setPicked] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const dateRef = useRef<HTMLButtonElement>(null);

  const fetchData = useCallback(
    (live: { current: boolean } = { current: true }) =>
      load()
        .then((d) => {
          if (live.current) setData(d);
        })
        .catch(() => {
          if (live.current) setError("Couldn't load the holiday calendar.");
        })
        .finally(() => {
          if (live.current) setLoading(false);
        }),
    [load],
  );

  useEffect(() => {
    const live = { current: true };
    fetchData(live);
    return () => {
      live.current = false;
    };
  }, [fetchData]);

  const run = (action: () => Promise<HolidayResult>, onOk?: () => void) => {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.ok) {
        onOk?.();
        /* Both, in this order. The list is client-held now, so router.refresh()
           alone would leave the day just added off the very screen it was added
           from; the refresh is still owed, because the timesheets behind this
           modal presume against this calendar. */
        await fetchData();
        router.refresh();
      } else setError(res.error);
    });
  };

  if (loading) return <p className="xp-note">Reading your holiday calendar…</p>;
  if (!data) return <p className="xp-note">{error ?? "Couldn't load the holiday calendar."}</p>;

  const { holidays, orgState, today } = data;
  const state = picked ?? orgState ?? "NSW";
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
            <select
              value={state}
              onChange={(e) => setPicked(e.target.value)}
            >
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="mts-f">
            <span>Date</span>
            <DateField
              ref={dateRef}
              value={date || null}
              today={today}
              min={today.slice(0, 4) + "-01-01"}
              onChange={(iso) => setDate(iso ?? "")}
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
                  setPicked(s.state);
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
