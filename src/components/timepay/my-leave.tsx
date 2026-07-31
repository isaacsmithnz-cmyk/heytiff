"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { DateField } from "@/components/ui/date-field";
import { MonthGrid, monthOf } from "@/components/ui/month-grid";
import { fmtAuDayMonth } from "@/lib/au-dates";
import { UpcomingHolidays } from "./upcoming-holidays";
import { MyTimeNav } from "./my-time-nav";
import { cancelLeave, requestLeave, type LeaveResult } from "@/app/actions/leave";
import {
  LEAVE_LABEL,
  SOURCE_LABEL,
  rangeBreakdown,
  suggestedHours,
  type BalanceView,
  type LeaveKind,
  type LeaveRequest,
  type LeaveStatus,
  type RangeBreakdown,
} from "@/lib/timepay/leave";
import { fmt } from "./logic";

/* My leave — everyone, always. Book leave against a visible balance, see where
   each request is up to, and read the public holidays coming up. No dollars:
   leave is hours and entitlement, never pay. */

const STATUS_COPY: Record<LeaveStatus, { label: string; tone: string }> = {
  pending: { label: "Pending", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  declined: { label: "Declined", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "mute" },
};

const KINDS: LeaveKind[] = ["annual", "personal", "unpaid"];

function fmtRange(startISO: string, endISO: string): string {
  return startISO === endISO
    ? fmtAuDayMonth(startISO)
    : `${fmtAuDayMonth(startISO)} – ${fmtAuDayMonth(endISO)}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/* What the span costs you, in words.

   A leave request is a range of dates, but what a person is actually deciding
   is how many days of entitlement it spends — and the two differ every time a
   public holiday lands mid-trip. So the line names the holidays it skipped
   while there are few enough to read (two), and counts them after that. */
export function breakdownLine(b: RangeBreakdown): string {
  const parts = [plural(b.working, "working day", "working days")];
  if (b.holidays.length > 0) {
    const named = b.holidays.length <= 2 ? ` (${b.holidays.map((h) => h.name).join(", ")})` : "";
    parts.push(
      `${plural(b.holidays.length, "public holiday", "public holidays")} skipped${named}`,
    );
  }
  return parts.join(" · ");
}

export function MyLeave({
  today,
  standard,
  balances,
  requests,
  holidays,
  workDays,
}: {
  today: string;
  standard: number;
  balances: BalanceView[];
  requests: LeaveRequest[];
  holidays: { date: string; name: string }[];
  /** the requester's own roster (Mon=0) — suggestions count these days, the
      same days the timesheet will pay, so a part-timer's week isn't quoted
      as five days of entitlement */
  workDays?: number[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const [kind, setKind] = useState<LeaveKind>("annual");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  /* The calendar's month, and whether a range is half-drawn. `awaitingEnd` is
     the whole of the click-click protocol: one click puts a single day down,
     the next stretches it, and a third starts again. No drag — a drag on a
     phone is a scroll, and the same gesture has to work on both. */
  const [month, setMonth] = useState(() => monthOf(startDate || today));
  const [awaitingEnd, setAwaitingEnd] = useState(false);

  const holidayMap = useMemo(
    () => new Map(holidays.map((h) => [h.date, h.name] as const)),
    [holidays],
  );
  const holidaySet = useMemo(() => new Set(holidayMap.keys()), [holidayMap]);
  const suggested = useMemo(
    () => suggestedHours(startDate, endDate, standard, holidaySet, workDays),
    [startDate, endDate, standard, holidaySet, workDays],
  );
  const breakdown = useMemo(
    () => rangeBreakdown(startDate, endDate, holidayMap, workDays),
    [startDate, endDate, holidayMap, workDays],
  );

  /* Clicking the grid and typing in the fields are the same edit: both write
     startDate/endDate, and the band is drawn from them. Nothing is mirrored,
     so the two can't drift. */
  const pickDay = (iso: string) => {
    if (awaitingEnd) {
      // ordered, whichever end was clicked second
      if (iso < startDate) {
        setEndDate(startDate);
        setStartDate(iso);
      } else setEndDate(iso);
      setAwaitingEnd(false);
    } else {
      setStartDate(iso);
      setEndDate(iso);
      setAwaitingEnd(true);
    }
  };

  const setFrom = (iso: string) => {
    setStartDate(iso);
    if (iso && iso > endDate) setEndDate(iso);
    setAwaitingEnd(false);
    if (iso) setMonth(monthOf(iso)); // bring the band into view rather than leaving it a month away
  };
  const effectiveHours = hours.trim() === "" ? suggested : Number(hours);
  const balanceOf = (k: LeaveKind) => balances.find((b) => b.kind === k);

  const run = (action: () => Promise<LeaveResult>, onOk?: () => void) => {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.ok) {
        onOk?.();
        router.refresh();
      } else setError(res.error);
    });
  };

  const submit = () => {
    run(
      () => requestLeave({ kind, startDate, endDate, hours: effectiveHours, note: note.trim() || undefined }),
      () => {
        setOpen(false);
        setNote("");
        setHours("");
      },
    );
  };

  const upcoming = requests.filter((r) => r.status === "pending" || r.status === "approved");
  const history = requests.filter((r) => r.status === "declined" || r.status === "cancelled");

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="v2head" style={{ marginBottom: 24, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
                My leave
              </h1>
            </div>
            <button className="fl-btn primary" onClick={() => setOpen((v) => !v)} disabled={pending}>
              <Icon name="plus" size={14} />
              Request leave
            </button>
          </div>
          <MyTimeNav active="leave" />

          {error && <div className="tp-err">{error}</div>}

          <div className="lv-bal">
            {balances.length === 0 ? (
              <div className="lv-balempty">
                No leave balances recorded yet. Your team sets these — until then you can still
                request unpaid leave.
              </div>
            ) : (
              balances.map((b) => (
                <div className="lv-baltile" key={b.kind}>
                  <em>{LEAVE_LABEL[b.kind]}</em>
                  <b>
                    {fmt(b.available)}
                    <span>h available</span>
                  </b>
                  <span className="lv-balsub">
                    {fmt(b.balanceHours)}h balance
                    {b.booked > 0 ? ` · ${fmt(b.booked)}h booked` : ""}
                  </span>
                  <span className={`lv-src${b.source === "manual" ? "" : " synced"}`}>
                    {b.source !== "manual" && <Icon name="check" size={11} />}
                    {SOURCE_LABEL[b.source]}
                  </span>
                </div>
              ))
            )}
          </div>

          {open && (
            <div className="lv-form">
              <div className="lv-cal">
                {/* The calendar leads, because the question is "which days" —
                    and a public holiday inside the span is the one thing the
                    fields alone can't show. Violet says "you don't spend
                    this one", and the band keeps its colour underneath. */}
                <div className="lv-calside">
                  <MonthGrid
                    month={month}
                    today={today}
                    range={startDate && endDate ? { start: startDate, end: endDate } : null}
                    holidays={holidayMap}
                    min={today}
                    onPick={pickDay}
                    onMonthChange={setMonth}
                  />
                  <p className="lv-callegend">
                    <span className="lv-legdot hol" aria-hidden="true" />
                    Public holiday — free, not leave
                  </p>
                  {/* a click-click range has to say so once; a drag is a
                      scroll on the phone half of this, so it isn't offered */}
                  <p className="lv-calhint">
                    {awaitingEnd ? "Now pick the last day off" : "Pick the first day off, then the last"}
                  </p>
                </div>

                <div className="lv-calfields">
                  <div className="lv-frow">
                    <label className="mts-f">
                      <span>Type</span>
                      <select value={kind} onChange={(e) => setKind(e.target.value as LeaveKind)}>
                        {KINDS.map((k) => (
                          <option key={k} value={k}>
                            {LEAVE_LABEL[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="mts-f">
                      <span>From</span>
                      <DateField
                        value={startDate || null}
                        today={today}
                        onChange={(iso) => setFrom(iso ?? "")}
                      />
                    </label>
                    <label className="mts-f">
                      <span>To</span>
                      <DateField
                        value={endDate || null}
                        today={today}
                        min={startDate}
                        onChange={(iso) => {
                          setEndDate(iso ?? "");
                          setAwaitingEnd(false);
                        }}
                      />
                    </label>
                    <label className="mts-f">
                      <span>Hours</span>
                      <input
                        type="number"
                        placeholder={String(suggested)}
                        value={hours}
                        onChange={(e) => setHours(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="lv-fnote">
                    <label className="mts-f" style={{ flex: 1 }}>
                      <span>Note (optional)</span>
                      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. family holiday" />
                    </label>
                  </div>
                </div>
              </div>
              <div className="lv-fmeta">
                <span>
                  {breakdownLine(breakdown)}
                  {kind !== "unpaid" && balanceOf(kind) ? ` · ${fmt(balanceOf(kind)!.available)}h available` : ""}
                </span>
                <div className="mts-facts">
                  <button className="fl-btn primary" disabled={pending || !(effectiveHours > 0)} onClick={submit}>
                    <Icon name="send" size={14} />
                    Submit request
                  </button>
                  <button className="fl-btn ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="lv-cols">
            <div className="lv-col">
              <div className="lv-ch">Your requests</div>
              {upcoming.length === 0 ? (
                <div className="fl-hempty">Nothing booked. Request leave and it shows here.</div>
              ) : (
                upcoming.map((r) => (
                  <div className="lv-req" key={r.id}>
                    <div className="lv-reqmain">
                      <b>{LEAVE_LABEL[r.kind]}</b>
                      <em>
                        {fmtRange(r.startDate, r.endDate)} · {fmt(r.hours)}h
                      </em>
                      {r.status === "declined" && r.reviewNote && <span className="lv-declined">{r.reviewNote}</span>}
                    </div>
                    <span className={`dchip ${STATUS_COPY[r.status].tone}`}>{STATUS_COPY[r.status].label}</span>
                    <button
                      className="lv-cancel"
                      onClick={() => run(() => cancelLeave(r.id))}
                      disabled={pending}
                      title="Cancel this request"
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                ))
              )}
              {history.length > 0 && (
                <div className="lv-hist">
                  {history.map((r) => (
                    <div className="lv-req muted" key={r.id}>
                      <div className="lv-reqmain">
                        <b>{LEAVE_LABEL[r.kind]}</b>
                        <em>
                          {fmtRange(r.startDate, r.endDate)} · {fmt(r.hours)}h
                        </em>
                      </div>
                      <span className={`dchip ${STATUS_COPY[r.status].tone}`}>{STATUS_COPY[r.status].label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="lv-col">
              {holidays.length === 0 ? (
                <>
                  <div className="lv-ch">Public holidays</div>
                  <div className="fl-hempty">
                    No public holidays loaded for your state yet — they&rsquo;ll appear here once
                    added.
                  </div>
                </>
              ) : (
                <UpcomingHolidays holidays={holidays} today={today} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
