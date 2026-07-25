"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { fmtAuDayMonth } from "@/lib/au-dates";
import { UpcomingHolidays } from "./upcoming-holidays";
import { cancelLeave, requestLeave, type LeaveResult } from "@/app/actions/leave";
import {
  LEAVE_LABEL,
  SOURCE_LABEL,
  suggestedHours,
  type BalanceView,
  type LeaveKind,
  type LeaveRequest,
  type LeaveStatus,
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

export function MyLeave({
  today,
  standard,
  balances,
  requests,
  holidays,
}: {
  today: string;
  standard: number;
  balances: BalanceView[];
  requests: LeaveRequest[];
  holidays: { date: string; name: string }[];
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

  const holidaySet = useMemo(() => new Set(holidays.map((h) => h.date)), [holidays]);
  const suggested = useMemo(
    () => suggestedHours(startDate, endDate, standard, holidaySet),
    [startDate, endDate, standard, holidaySet],
  );
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
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      if (e.target.value > endDate) setEndDate(e.target.value);
                    }}
                  />
                </label>
                <label className="mts-f">
                  <span>To</span>
                  <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
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
              <div className="lv-fmeta">
                <span>
                  {suggested}h across the working days in this range
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
