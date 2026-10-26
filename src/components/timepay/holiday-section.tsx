"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/parts/button";
import { Chooser, type ChooserOption } from "@/components/parts/chooser";
import { Field, TextInput } from "@/components/parts/field";
import { Row, RowList } from "@/components/parts/row";
import { Empty, Loading } from "@/components/parts/states";
import { Wrong } from "@/components/settings/parts";
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

/* The public-holiday manager: the holidays group of Settings › Pay and
   holidays (v2, 25 October 2026; it was a folding row at the foot of Time &
   Pay's settings gear). Admin+.

   The calendar mostly maintains itself (holiday-sync tops it up from the
   statutory rules), so this is the exceptions surface: add a proclaimed
   one-off, remove a day this business works, restore one removed by mistake.
   Removed auto days stay listed under their own heading: they're tombstones
   the sync must not resurrect, so they must stay visible and reversible.

   "Worth confirming" covers the other half of the calendar: days that are real
   but whose DATE nobody can compute (WA's proclaimed King's Birthday, the
   Friday before the AFL Grand Final). The rules module never auto-writes those,
   so each is a row with its usual timing, and its button fills the form from
   it; the admin picks the date off the gazette, which lands it as a manual row.

   The page reads the calendar with the rest of Settings (`initial`), and the
   section re-reads it after every change through `load`, the admin-gated
   action, because the list is client-held: router.refresh() alone would
   leave the day just added off the screen it was added from. Without
   `initial` it reads on mount. */

const STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"] as const;
const STATE_OPTIONS: ChooserOption[] = STATES.map((s) => ({ value: s, label: s }));

/** The date, the state, and whether someone added it here by hand. */
const holidayLine = (h: Holiday) =>
  [fmtAuWeekdayDate(h.date), h.state, h.source === "manual" ? "added by hand" : null].filter(Boolean).join(", ");

export function HolidaySection({
  initial,
  load = getHolidayManagerData,
}: {
  /** the calendar as the page read it; left out, the section reads its own */
  initial?: HolidayManagerData | null;
  /** Injectable for tests; production uses the admin-gated server action. */
  load?: () => Promise<HolidayManagerData | null>;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  /* which press is out, so its own button says what it's doing */
  const [doing, setDoing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<HolidayManagerData | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);

  /* NULL until the admin picks one, rather than seeded from the org and then
     re-seeded on every re-fetch: the form re-reads its own calendar after each
     add, and a seeding effect would drag the picker back off the state they
     were working in mid-entry. Null simply means "still the org's". */
  const [picked, setPicked] = useState<string | null>(null);
  /* the years after this one, folded until asked for: three years of a
     state's calendar is forty rows (the Settings walk, 26 October 2026) */
  const [later, setLater] = useState(false);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const dateRef = useRef<HTMLButtonElement>(null);
  const dateId = useId();

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
    if (initial) return;
    const live = { current: true };
    fetchData(live);
    return () => {
      live.current = false;
    };
  }, [fetchData, initial]);

  const run = (key: string, action: () => Promise<HolidayResult>, onOk?: () => void) => {
    setError(null);
    setDoing(key);
    start(async () => {
      const res = await action();
      if (res.ok) {
        onOk?.();
        /* Both, in this order: the list is client-held, and the timesheets
           presume against this calendar, so the server render is owed too. */
        await fetchData();
        router.refresh();
      } else setError(res.error);
      setDoing(null);
    });
  };

  if (loading) return <Loading what="Reading the holiday calendar" />;
  if (!data) return <Wrong>{error ?? "Couldn't load the holiday calendar."} Reload the page to try again.</Wrong>;

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

  // by year, for a list you can scan
  const byYear = new Map<string, Holiday[]>();
  for (const h of active) {
    const y = h.date.slice(0, 4);
    byYear.set(y, [...(byYear.get(y) ?? []), h]);
  }
  const laterYears = [...byYear.keys()].filter((y) => Number(y) > thisYear);

  return (
    <div className="st2-pay-hol">
      <div className="st2-pay-holform">
        <Field label="State">
          <Chooser options={STATE_OPTIONS} value={state} onChange={setPicked} />
        </Field>
        <Field label="Date" id={dateId}>
          <DateField
            ref={dateRef}
            id={dateId}
            className="st2-pay-date"
            value={date || null}
            today={today}
            min={today.slice(0, 4) + "-01-01"}
            onChange={(iso) => setDate(iso ?? "")}
          />
        </Field>
        <Field label="Holiday name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Picnic Day" />
        </Field>
        <Button
          kind="main"
          disabled={busy || !date || !name.trim()}
          onClick={() =>
            run(
              "add",
              () => addHoliday({ state, date, name }),
              () => {
                setDate("");
                setName("");
              },
            )
          }
        >
          {doing === "add" ? "Adding the holiday" : "Add holiday"}
        </Button>
      </div>

      {error && <Wrong>{error}</Wrong>}

      {suggestions.length > 0 && (
        <div className="st2-pay-part">
          <h3 className="st2-pay-h3">Worth confirming</h3>
          <RowList label="Worth confirming">
            {suggestions.map((s) => (
              <Row
                key={`${s.year}-${s.name}`}
                lead={<span className="st2-pay-year">{s.year}</span>}
                name={s.name}
                line={s.usual}
                lines={2}
                end={
                  <Button
                    size={32}
                    aria-label={`Add the date of ${s.name}, ${s.year}`}
                    onClick={() => {
                      setPicked(s.state);
                      setName(s.name);
                      setDate("");
                      dateRef.current?.focus();
                    }}
                  >
                    Add the date
                  </Button>
                }
              />
            ))}
          </RowList>
        </div>
      )}

      {active.length === 0 ? (
        <Empty what="No public holidays yet" action={null} />
      ) : (
        [...byYear.entries()].filter(([year]) => later || Number(year) <= thisYear).map(([year, rows]) => (
          <div className="st2-pay-part" key={year}>
            <h3 className="st2-pay-h3">{year}</h3>
            <RowList label={`Public holidays in ${year}`}>
              {rows.map((h) => (
                <Row
                  key={h.id}
                  name={h.name}
                  line={holidayLine(h)}
                  end={
                    <Button kind="delete" size={32} disabled={busy} aria-label={`Remove ${h.name}`} onClick={() => run(`remove:${h.id}`, () => removeHoliday(h.id))}>
                      {doing === `remove:${h.id}` ? "Removing" : "Remove"}
                    </Button>
                  }
                />
              ))}
            </RowList>
          </div>
        ))
      )}

      {!later && laterYears.length > 0 && (
        <div>
          <Button kind="quiet" size={32} onClick={() => setLater(true)}>
            {`Show ${laterYears.join(" and ")}`}
          </Button>
        </div>
      )}

      {removed.length > 0 && (
        <div className="st2-pay-part">
          <h3 className="st2-pay-h3">Removed, worked as normal days</h3>
          <RowList label="Removed holidays">
            {removed.map((h) => (
              <Row
                key={h.id}
                name={h.name}
                line={holidayLine(h)}
                end={
                  <Button size={32} disabled={busy} aria-label={`Restore ${h.name}`} onClick={() => run(`restore:${h.id}`, () => restoreHoliday(h.id))}>
                    {doing === `restore:${h.id}` ? "Restoring" : "Restore"}
                  </Button>
                }
              />
            ))}
          </RowList>
        </div>
      )}
    </div>
  );
}
