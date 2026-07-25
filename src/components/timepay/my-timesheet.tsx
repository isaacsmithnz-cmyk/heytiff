"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { saveDay, submitWeek, type TimepayResult } from "@/app/actions/timepay";
import type { SheetState } from "@/lib/timepay/query";
import { dateOfDay } from "@/lib/timepay/period";
import { UpcomingHolidays } from "./upcoming-holidays";
import type { PayPeriod } from "./timepay";
import {
  type DayClass,
  type DayEntry,
  type Settings,
  type WeekCtx,
  type WeekDay,
  type StaffWeek,
  breakLine,
  dayClass,
  dayLabel,
  derive,
  derivedDayHours,
  dowOf,
  fmtH,
  fmtHval,
  isWeekend,
  ruleSummary,
  seedBreakMinutes,
  splitDay,
  submitNote,
  weekGroups,
} from "./logic";

/* My timesheet — everyone, always. The hours-ENTRY surface.

   Rebuilt on the original staff-facing design's mechanics: a week strip of day
   chips over a stack of day rows, one row expanding in place into its editor,
   and a rail that says what the period is worth. The skin is the current app
   language — white cards, Jakarta, ink/teal — not the prototype's blue.

   THE FIX THIS SCREEN EXISTS FOR: hours are DERIVED from the times, never
   typed. The old editor had a start, a finish AND an hours box, so a day could
   be saved with both times filled and 0.00 hours — a row that looks logged and
   pays nothing. There is now no hours input on a worked day at all: the times
   are the entry, `derivedDayHours` turns them into hours, and Save is refused
   outright when the times can't be read. Zero is no longer reachable by
   accident.

   The payroll line beside it is the REAL engine — `splitDay`, the same
   function the approver's screen and the pay run use — so what you're told
   your day is worth can't drift from what it is worth.

   NO MONEY LIVES HERE. Not a rate, not a gross, not a dollar sign. The wage
   isn't hidden at render time — `getMyWeek` doesn't select the column, so the
   payload has nothing to print. Multipliers and hours only. Your rate belongs
   on My profile → My Pay, which asks for it in its own query and can say
   something useful about it. */

const KINDS: { t: DayEntry["t"]; label: string }[] = [
  { t: "work", label: "Worked" },
  { t: "leave", label: "Annual leave" },
  { t: "sick", label: "Sick" },
  { t: "ph", label: "Public holiday" },
  { t: "empty", label: "Nothing" },
];

/* One word per day class, in the same palette the approver reads. `under` is
   not in the original design's list, but dropping it would call a short day
   "Normal" — and a workspace with an unpaid break configured makes short days
   routine, so it has to be sayable. */
const PILL: Record<DayClass, string> = {
  std: "Normal",
  over: "Overtime day",
  under: "Short day",
  leave: "Leave",
  sick: "Sick",
  ph: "Public holiday",
  miss: "Missing",
  empty: "No entry",
};

const STATUS_COPY: Record<SheetState["status"], { label: string; tone: string; sub: string }> = {
  draft: { label: "Draft", tone: "warn", sub: "Not sent yet — fill in your days and submit." },
  submitted: { label: "Submitted", tone: "ok", sub: "With your manager. You'll be told if anything needs a look." },
  approved: { label: "Approved", tone: "ok", sub: "Signed off. This week is closed." },
  sent_back: { label: "Sent back", tone: "bad", sub: "Your manager has a question — answer it and submit again." },
};

const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const BREAK_STEP = 5;
const BREAK_MAX = 120;

/** What a day is worth in payroll hours, split by multiplier — read off the
    real engine so this line and the pay run can never disagree. */
function payrollChip(h: number, dow: number, s: Settings): { parts: string[]; total: number } {
  const sp = splitDay(h, dow, s);
  const parts: string[] = [];
  if (sp.n) parts.push(`${fmtH(sp.n)}h ×1.0`);
  if (sp.o15) parts.push(`${fmtH(sp.o15)}h ×1.5`);
  if (sp.o2) parts.push(`${fmtH(sp.o2)}h ×2.0`);
  if (parts.length === 0) parts.push("0h ×1.0");
  return { parts, total: sp.n + sp.o15 * 1.5 + sp.o2 * 2 };
}

/** The summary a collapsed row shows on its right. */
function daySummary(d: DayEntry): string {
  if (d.t === "empty") return "";
  if (d.t === "work") return `${d.in} – ${d.out} · ${fmtH(d.h)}h`;
  return `${fmtH(d.h)}h`;
}

/* ---------------- the one editor ---------------- */

/* It opens inside its own row, in normal flow — a day is a small edit and
   shouldn't take over the screen. Keyed by day index by the caller, so
   switching days re-seeds the fields. */
function DayEditor({
  index,
  entry,
  ctx,
  settings,
  holidayName,
  busy,
  onSave,
  onCancel,
}: {
  index: number;
  entry: DayEntry;
  ctx: WeekCtx;
  settings: Settings;
  /** set when this day is a public holiday — named, so you know why */
  holidayName?: string;
  busy: boolean;
  onSave: (i: number, e: DayEntry) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<DayEntry["t"]>(entry.t);
  const [start, setStart] = useState(entry.t === "work" ? entry.in : "7:00 AM");
  const [end, setEnd] = useState(entry.t === "work" ? entry.out : "3:30 PM");
  // absence kinds still take hours directly — there are no times to derive
  // from. A fresh one is seeded with the org's standard day.
  const [hours, setHours] = useState(entry.t === "empty" || entry.t === "work" ? "" : String(entry.h));
  const [breakMin, setBreakMin] = useState(() => seedBreakMinutes(entry, settings));

  const hasBreak = settings.breakMinutes > 0;
  const adjustable = hasBreak && !settings.breakPaid;
  const derived = kind === "work" ? derivedDayHours(start, end, settings, breakMin) : null;
  const unreadable = kind === "work" && derived == null;

  const typed = Number(hours);
  const payHours = kind === "work" ? (derived ?? 0) : Number.isFinite(typed) ? typed : 0;
  const chip = payrollChip(payHours, dowOf(ctx.week[index]), settings);

  const pickKind = (t: DayEntry["t"]) => {
    setKind(t);
    // an absence with no hours yet means a standard day off, not a zero one
    if (t !== "work" && t !== "empty" && !Number(hours)) setHours(String(settings.standard));
  };

  const commit = () => {
    if (unreadable) return;
    onSave(
      index,
      kind === "empty"
        ? { t: "empty" }
        : kind === "work"
          ? { t: "work", in: start, out: end, h: derived ?? 0 }
          : { t: kind, h: Number.isFinite(typed) ? typed : 0 },
    );
  };

  return (
    <div className="mts2-edit">
      {holidayName && (
        <div className="mts2-ehol">
          <Icon name="calendar" size={11} />
          {holidayName}
        </div>
      )}
      <div className="mts2-form">
        <label className="mts-f">
          <span>Day</span>
          <select value={kind} onChange={(e) => pickKind(e.target.value as DayEntry["t"])}>
            {KINDS.map((k) => (
              <option key={k.t} value={k.t}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        {kind === "work" && (
          <>
            <label className="mts-f">
              <span>Start</span>
              <input value={start} onChange={(e) => setStart(e.target.value)} placeholder="7:00 AM" />
            </label>
            <label className="mts-f">
              <span>Finish</span>
              <input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="3:30 PM" />
            </label>
          </>
        )}
        {kind !== "empty" && kind !== "work" && (
          <label className="mts-f">
            <span>Hours</span>
            <input
              type="number"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="e.g. 8"
            />
          </label>
        )}
      </div>

      {/* the break, only when this workspace has one. Paid breaks are on the
          clock: nothing to deduct, so nothing to adjust. */}
      {kind === "work" && hasBreak && (
        <div className="mts2-brk">
          <span className="mts2-brkl">{breakLine(settings, breakMin)}</span>
          {adjustable && (
            <span className="mts2-brkstep">
              <button
                aria-label="Shorter break"
                onClick={() => setBreakMin((m) => Math.max(0, m - BREAK_STEP))}
              >
                −
              </button>
              <b>{breakMin}</b>
              <button
                aria-label="Longer break"
                onClick={() => setBreakMin((m) => Math.min(BREAK_MAX, m + BREAK_STEP))}
              >
                +
              </button>
            </span>
          )}
        </div>
      )}

      {/* what the times mean, live. No hours box: this IS the hours field. */}
      {kind === "work" && (
        <div className={`mts2-derv${unreadable ? " bad" : ""}`}>
          <Icon name="clock" size={13} />
          {unreadable ? (
            <span>Enter a start and finish we can read — like 7:00 AM and 3:30 PM.</span>
          ) : (
            <span>
              {start} – {end} · <b>{fmtH(derived)}h</b>
            </span>
          )}
        </div>
      )}

      {/* the same split the pay run uses — hours and multipliers, never money */}
      <div className="mts2-pay">
        <span className="mts2-payl">Payroll</span>
        <span className="mts2-paych">
          {chip.parts.join(" + ")} = <b>{fmtH(chip.total)}h</b>
        </span>
      </div>

      <div className="mts2-eacts">
        <button className="mts2-btn primary" disabled={busy || unreadable} onClick={commit}>
          <Icon name="check" size={14} />
          Save day
        </button>
        <button className="mts2-btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="mts2-btn" disabled={busy} onClick={() => onSave(index, { t: "empty" })}>
          Clear day
        </button>
      </div>
    </div>
  );
}

/* ---------------- the screen ---------------- */

export function MyTimesheet({
  me,
  week,
  today,
  todayISO,
  periodStart,
  periods,
  periodIndex,
  settings,
  sheet,
  holidays,
  state,
}: {
  me: StaffWeek;
  week: WeekCtx["week"];
  today: number;
  todayISO: string;
  periodStart: string;
  /** the same period switcher the admin screen uses, newest first */
  periods: PayPeriod[];
  periodIndex: number;
  settings: Settings;
  sheet: SheetState;
  /** org holidays for this staff member's state — period + upcoming */
  holidays: { date: string; name: string }[];
  /** which state's calendar those are, for the rail's toggle */
  state?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  /* weekend days you asked for. A Saturday with nothing on it isn't a row —
     it's an offer ("+ Add Saturday"), because most weeks it stays empty and a
     blank row every week is five weeks of noise a year. */
  const [revealed, setRevealed] = useState<number[]>([]);
  const [allHolidays, setAllHolidays] = useState(false);

  const ctx: WeekCtx = { week, today };
  const d = derive(me, settings, ctx);
  const groups = weekGroups(me.days);
  const multiWeek = groups.length > 1; // fortnight / month read as week-rows
  const period = periods[periodIndex];
  const sent = sheet.status === "submitted" || sheet.status === "approved";
  // a closed period is history: you can read it, you can't rewrite it
  const locked = sent || !period.live;
  const status = STATUS_COPY[sheet.status];

  // in-period holidays name themselves in the editor; the rail lists the month
  const holidayByDate = useMemo(() => new Map(holidays.map((h) => [h.date, h.name])), [holidays]);

  /* Which month the rail's holiday module is about: the one the middle of the
     period falls in, so a week straddling a month boundary belongs to the
     month it mostly lives in rather than to whichever day it happens to start
     on. A monthly cycle is trivially its own month. */
  const monthISO = dateOfDay(periodStart, Math.floor(week.length / 2)).slice(0, 7);
  const monthLabel = `${MONTHS_FULL[Number(monthISO.slice(5, 7)) - 1]} ${monthISO.slice(0, 4)}`;
  const monthHolidays = holidays.filter((h) => h.date.startsWith(monthISO));

  const run = (action: () => Promise<TimepayResult>) => {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.ok) {
        setSelected(null);
        router.refresh();
      } else setError(res.error);
    });
  };

  const goPeriod = (i: number) => {
    const target = periods[i];
    if (target) router.push(`/dashboard/my-timesheet?period=${target.start}`);
  };

  /* One selection, shared by the chip strip and the rows: clicking either one
     opens the same day, and opening a second closes the first. */
  const openDay = (i: number) => {
    if (locked) return;
    setRevealed((r) => (r.includes(i) ? r : [...r, i]));
    setSelected((cur) => (cur === i ? null : i));
  };

  /** A day earns a row when it's a weekday, when something is logged on it, or
      when you asked for it. Everything else is an offer at the foot of the
      week. */
  const hasRow = (entry: DayEntry, i: number) =>
    !isWeekend(dowOf(week[i])) || entry.t !== "empty" || revealed.includes(i);

  const cycleTitle =
    settings.cycle === "Fortnightly" ? "My fortnight" : settings.cycle === "Monthly" ? "My month" : "My week";

  /* hours × multiplier, the buckets that make up the payroll total. Paid
     absence sits in the ×1.0 bucket because that is how derive() weights it,
     so the chips add up to the number above them. */
  const buckets: [number, string][] = [
    [d.normal + d.leave + d.sick + d.ph, "×1.0"],
    [d.ot, "×1.5"],
    [d.ot2, "×2.0"],
  ];

  const rules = [
    `Normal ${fmtHval(settings.standard)} day`,
    `OT after ${fmtHval(settings.otAfter)}/${settings.otUnit}`,
    settings.breakMinutes > 0
      ? `${settings.breakMinutes} min break · ${settings.breakPaid ? "paid" : "unpaid"}`
      : null,
    settings.rules.sat.on ? `Sat ${ruleSummary(settings.rules.sat)}` : null,
    settings.rules.sun.on ? `Sun ${ruleSummary(settings.rules.sun)}` : null,
    submitNote(settings).replace(/^Open · /, ""),
  ].filter(Boolean);

  return (
    <div className="page in">
      <div className="wrap">
        <div className={`stg tpr mts2${locked ? " locked" : ""}`}>
          <div className="rhead">
            <div>
              <h1>My timesheet</h1>
              <div className="wknav">
                <button
                  className="arw"
                  aria-label="Previous period"
                  disabled={periodIndex >= periods.length - 1 || pending}
                  onClick={() => goPeriod(periodIndex + 1)}
                >
                  <Icon name="chevL" size={17} />
                </button>
                <span className="range">
                  {period.range} <em>{period.year}</em>
                </span>
                <button
                  className="arw"
                  aria-label="Next period"
                  disabled={periodIndex <= 0 || pending}
                  onClick={() => goPeriod(periodIndex - 1)}
                >
                  <Icon name="chevR" size={17} />
                </button>
                {period.live ? (
                  <span className="pstatus live">
                    <span className="d"></span>LIVE
                  </span>
                ) : (
                  <span className="pstatus hist">Historical</span>
                )}
              </div>
              <div className="autosub">{period.live ? submitNote(settings) : period.note}</div>
            </div>
            <div className="racts">
              <span className={`dchip ${status.tone}`}>
                <Icon name={sheet.status === "approved" ? "check" : "clock"} size={12} />
                {status.label}
              </span>
            </div>
          </div>

          {error && <div className="tp-err">{error}</div>}

          <div className="mts2-cols">
            <div className="mts2-main">
              {sheet.status === "sent_back" && sheet.reviewNote && (
                <div className="mts-back">
                  <Icon name="send" size={15} />
                  <span>
                    <b>Sent back with a question</b>
                    <em>{sheet.reviewNote}</em>
                  </span>
                </div>
              )}

              {groups.map((g) => {
                const offers = g.days.filter(({ entry, index }) => !hasRow(entry, index));
                return (
                  <div className="mts2-wk" key={g.start}>
                    {multiWeek && (
                      <div className="mts-wh">
                        <span>{g.label}</span>
                        <em>{fmtH(g.workedHours)}h</em>
                      </div>
                    )}

                    {/* the strip: seven days at a glance, a dot where
                        something is logged */}
                    <div className="mts2-chips">
                      {g.days.map(({ entry, index }) => {
                        const w = week[index];
                        const cls = [
                          "mts2-chip",
                          entry.t !== "empty" ? "done" : "",
                          isWeekend(dowOf(w)) ? "wknd" : "",
                          index === today ? "today" : "",
                          selected === index ? "sel" : "",
                        ]
                          .filter(Boolean)
                          .join(" ");
                        const inner = (
                          <>
                            <span className="cw">{w[0]}</span>
                            <span className="cd">{w[1]}</span>
                            <span className="cdot"></span>
                          </>
                        );
                        return locked ? (
                          <div className={cls} key={index}>
                            {inner}
                          </div>
                        ) : (
                          <button
                            type="button"
                            className={cls}
                            key={index}
                            aria-label={`${w[0]} ${w[1]}`}
                            aria-pressed={selected === index}
                            onClick={() => openDay(index)}
                          >
                            {inner}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mts2-rows">
                      {g.days.map(({ entry, index }) => {
                        if (!hasRow(entry, index)) return null;
                        const w: WeekDay = week[index];
                        const cls = dayClass(entry, index, settings, ctx);
                        const open = selected === index;
                        const summary = daySummary(entry);
                        return (
                          <div
                            className={`mts2-row ${cls}${open ? " open" : ""}${entry.t !== "empty" ? " has" : ""}`}
                            key={index}
                          >
                            <button
                              type="button"
                              className="mts2-rh"
                              aria-label={dayLabel(w)}
                              aria-expanded={open}
                              disabled={locked}
                              onClick={() => openDay(index)}
                            >
                              <span className="mts2-rd">
                                <b>{w[0]}</b>
                                <em>
                                  {w[1]} {w[2]}
                                </em>
                              </span>
                              <span className={`mts2-pill ${cls}`}>{PILL[cls]}</span>
                              <span className="mts2-sum">{summary}</span>
                              <span className="mts2-chev">
                                <Icon name="chevD" size={16} />
                              </span>
                            </button>
                            {open && !locked && (
                              <DayEditor
                                key={index}
                                index={index}
                                entry={me.days[index]}
                                ctx={ctx}
                                settings={settings}
                                holidayName={holidayByDate.get(dateOfDay(periodStart, index))}
                                busy={pending}
                                onSave={(idx, e) => run(() => saveDay(periodStart, idx, e))}
                                onCancel={() => setSelected(null)}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {!locked && offers.length > 0 && (
                      <div className="mts2-offers">
                        {offers.map(({ index }) => (
                          <button
                            className="mts2-offer"
                            key={index}
                            onClick={() => openDay(index)}
                          >
                            <Icon name="plus" size={13} />
                            Add {dowOf(week[index]) === 5 ? "Saturday" : "Sunday"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <aside className="mts2-rail">
              <section className="mts2-card">
                <div className="mts2-ch">
                  <span>{cycleTitle}</span>
                  <span className={`dchip ${status.tone}`}>{status.label}</span>
                </div>
                <div className="mts2-range">
                  {period.range} <em>{period.year}</em>
                </div>
                <div className="mts2-tot">
                  <div className="mts2-t">
                    <b>{fmtH(d.worked)}h</b>
                    <em>Actual worked</em>
                  </div>
                  <div className="mts2-t pay">
                    <b>{fmtH(d.weighted)}h</b>
                    <em>Payroll hrs</em>
                  </div>
                </div>
                <div className="mts2-bk">
                  {buckets
                    .filter(([h]) => h > 0)
                    .map(([h, mult]) => (
                      <span className="mts2-bkc" key={mult}>
                        {fmtH(h)}h {mult}
                      </span>
                    ))}
                </div>
                <div className="mts2-sub">{locked && !sent ? "This period is closed." : status.sub}</div>
                {!locked && (
                  <button
                    className="bbtn ink mts2-submit"
                    disabled={pending || d.entries === 0}
                    onClick={() => run(() => submitWeek(periodStart))}
                  >
                    <Icon name="send" size={14} />
                    {sheet.status === "sent_back" ? "Submit again" : "Submit week"}
                  </button>
                )}
              </section>

              <section className="mts2-card">
                <div className="mts2-ch">
                  <span>Public holidays — {monthLabel}</span>
                </div>
                {monthHolidays.length === 0 ? (
                  <div className="mts2-none">No public holidays this month</div>
                ) : (
                  <div className="mts2-hlist">
                    {monthHolidays.map((h) => (
                      <div className="mts2-h" key={h.date}>
                        <b>{Number(h.date.slice(8, 10))}</b>
                        <em>{h.name}</em>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  className="mts2-hlink"
                  aria-expanded={allHolidays}
                  onClick={() => setAllHolidays((v) => !v)}
                >
                  {`All ${state ?? ""} public holidays`.replace(/\s+/g, " ")}
                  <Icon name={allHolidays ? "chevD" : "chevR"} size={13} />
                </button>
                {allHolidays && <UpcomingHolidays holidays={holidays} today={todayISO} />}
              </section>

              <p className="mts2-rules">{rules.join(" · ")}</p>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
