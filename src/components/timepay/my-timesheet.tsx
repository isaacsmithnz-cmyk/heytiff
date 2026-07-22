"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { saveDay, submitWeek, type TimepayResult } from "@/app/actions/timepay";
import type { SheetState } from "@/lib/timepay/query";
import {
  type DayEntry,
  type Settings,
  type StaffWeek,
  type WeekCtx,
  dayClass,
  dayLabel,
  derive,
  fmt,
} from "./logic";

/* My timesheet — everyone, always. The first hours-ENTRY surface in the app:
   until now the "Edit" button on Time & Pay was dead and nothing wrote a day.

   THE ONE RULE THAT LOOKS LIKE AN OMISSION: your hourly rate is shown, and
   gross pay is not. `derive()` returns a gross and this screen deliberately
   never renders it, nor a PayBar. Since the rate is here, a total is trivially
   derivable — so this isn't a data boundary, it's a refusal to present an
   unofficial figure as though it were pay. That's a payslip's job. */

const KINDS: { t: DayEntry["t"]; label: string }[] = [
  { t: "work", label: "Worked" },
  { t: "leave", label: "Annual leave" },
  { t: "sick", label: "Sick" },
  { t: "ph", label: "Public holiday" },
  { t: "empty", label: "Nothing" },
];

const STATUS_COPY: Record<SheetState["status"], { label: string; tone: string; sub: string }> = {
  draft: { label: "Draft", tone: "warn", sub: "Not sent yet — fill in your days and submit." },
  submitted: { label: "Submitted", tone: "ok", sub: "With your manager. You'll be told if anything needs a look." },
  approved: { label: "Approved", tone: "ok", sub: "Signed off. This week is closed." },
  sent_back: { label: "Sent back", tone: "bad", sub: "Your manager has a question — answer it and submit again." },
};

function DayRow({
  index,
  entry,
  ctx,
  settings,
  locked,
  onSave,
}: {
  index: number;
  entry: DayEntry;
  ctx: WeekCtx;
  settings: Settings;
  locked: boolean;
  onSave: (i: number, e: DayEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DayEntry["t"]>(entry.t);
  const [start, setStart] = useState(entry.t === "work" ? entry.in : "7:00 AM");
  const [end, setEnd] = useState(entry.t === "work" ? entry.out : "3:30 PM");
  const [hours, setHours] = useState(entry.t === "empty" ? "" : String(entry.h));

  const cls = dayClass(entry, index, settings, ctx);
  const summary =
    entry.t === "empty"
      ? index < 5 && index <= ctx.today
        ? "Nothing logged"
        : "—"
      : entry.t === "work"
        ? `${entry.in} – ${entry.out} · ${fmt(entry.h)}h`
        : `${KINDS.find((k) => k.t === entry.t)?.label} · ${fmt(entry.h)}h`;

  const commit = () => {
    const h = Number(hours);
    onSave(
      index,
      kind === "empty"
        ? { t: "empty" }
        : kind === "work"
          ? { t: "work", in: start, out: end, h: Number.isFinite(h) ? h : 0 }
          : { t: kind, h: Number.isFinite(h) ? h : 0 },
    );
    setOpen(false);
  };

  return (
    <div className={`mts-day ${cls}`}>
      <div className="mts-dh">
        <span className="mts-dlab">{dayLabel(ctx.week[index])}</span>
        <span className="mts-dsum">{summary}</span>
        {!locked && (
          <button className="mts-edit" onClick={() => setOpen(!open)}>
            <Icon name="edit" size={13} />
            {entry.t === "empty" ? "Add" : "Edit"}
          </button>
        )}
      </div>
      {open && !locked && (
        <div className="mts-form">
          <label className="mts-f">
            <span>Day</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as DayEntry["t"])}>
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
          {kind !== "empty" && (
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
          <div className="mts-facts">
            <button className="fl-btn primary" onClick={commit}>
              <Icon name="check" size={14} />
              Save day
            </button>
            <button className="fl-btn ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MyTimesheet({
  me,
  week,
  today,
  periodStart,
  periodLabel,
  settings,
  sheet,
}: {
  me: StaffWeek;
  week: WeekCtx["week"];
  today: number;
  periodStart: string;
  periodLabel: string;
  settings: Settings;
  sheet: SheetState;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ctx: WeekCtx = { week, today };
  const d = derive(me, settings, ctx);
  const locked = sheet.status === "submitted" || sheet.status === "approved";
  const status = STATUS_COPY[sheet.status];

  const run = (action: () => Promise<TimepayResult>) => {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="v2head" style={{ marginBottom: 24, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
                My timesheet
              </h1>
              <div className="mts-period">{periodLabel}</div>
            </div>
            <span className={`dchip ${status.tone}`}>
              <Icon name={sheet.status === "approved" ? "check" : "clock"} size={12} />
              {status.label}
            </span>
          </div>

          {error && <div className="tp-err">{error}</div>}

          {sheet.status === "sent_back" && sheet.reviewNote && (
            <div className="mts-back">
              <Icon name="send" size={15} />
              <span>
                <b>Sent back with a question</b>
                <em>{sheet.reviewNote}</em>
              </span>
            </div>
          )}

          <div className="mts-tiles">
            <div className="mts-tile">
              <em>Hours this week</em>
              <b>{fmt(d.worked)}h</b>
            </div>
            <div className="mts-tile">
              <em>Leave &amp; sick</em>
              <b>{fmt(d.leave + d.sick + d.ph)}h</b>
            </div>
            {/* Your rate, read-only. Changing it is a Team action needing
                `financials` — this is where you CHECK it, not set it. */}
            <div className="mts-tile">
              <em>Your rate</em>
              <b>{me.rate == null ? "—" : `$${me.rate.toFixed(2)}/h`}</b>
            </div>
          </div>

          <div className="mts-days">
            {me.days.map((day, i) => (
              <DayRow
                key={i}
                index={i}
                entry={day}
                ctx={ctx}
                settings={settings}
                locked={locked || pending}
                onSave={(idx, e) => run(() => saveDay(periodStart, idx, e))}
              />
            ))}
          </div>

          <div className="mts-foot">
            <span>{status.sub}</span>
            {!locked && (
              <button
                className="fl-btn primary"
                disabled={pending || d.entries === 0}
                onClick={() => run(() => submitWeek(periodStart))}
              >
                <Icon name="send" size={14} />
                {sheet.status === "sent_back" ? "Submit again" : "Submit week"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
