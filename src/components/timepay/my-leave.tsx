"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { Button } from "@/components/parts/button";
import { LeaveForm } from "@/components/making/leave-form";
import { fmtAuDayMonth } from "@/lib/au-dates";
import { UpcomingHolidays } from "./upcoming-holidays";
import { attachCertificate, cancelLeave, type LeaveResult } from "@/app/actions/leave";
import { uploadFile } from "@/lib/documents/upload-client";
import {
  LEAVE_LABEL,
  SOURCE_LABEL,
  certificateExpected,
  rangeBreakdown,
  type BalanceView,
  type LeaveKind,
  type LeaveRequest,
  type LeaveStatus,
} from "@/lib/timepay/leave";
import { fmt } from "./logic";

/* My leave — everyone, always. Book leave against a visible balance, see where
   each request is up to, and read the public holidays coming up. No dollars:
   leave is hours and entitlement, never pay. Asking for leave is its own
   form (components/making/leave-form), a dialog over this. */

const STATUS_COPY: Record<LeaveStatus, { label: string; tone: string }> = {
  pending: { label: "Pending", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  declined: { label: "Declined", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "mute" },
};

/* A kind is identity, so it carries a hue the status palette doesn't own —
   see the .lv-annual/.lv-personal/.lv-unpaid block in shell.css for why teal,
   amber and red are off limits here. The class sets --lvk; the tile rail, the
   icon chip, the balance bar and the request row's category bar all read it. */
const KIND_CLASS: Record<LeaveKind, string> = {
  annual: "lv-annual",
  personal: "lv-personal",
  unpaid: "lv-unpaid",
};

const KIND_ICON: Record<LeaveKind, string> = {
  annual: "compass",
  personal: "user",
  unpaid: "minus",
};

/** Where a balance sits on its own entitlement, as bar widths. Guards the
    empty entitlement (no divide by zero) and an over-booked one, where
    `available` goes negative and the booked run simply fills the track. */
export function balanceBars(total: number, available: number, booked: number) {
  if (!(total > 0)) return { avail: 0, booked: 0 };
  const clamp = (n: number) => Math.max(0, Math.min(100, (n / total) * 100));
  return { avail: clamp(available), booked: clamp(booked) };
}

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
  workDays,
  certAfterDays = null,
}: {
  today: string;
  standard: number;
  balances: BalanceView[];
  requests: LeaveRequest[];
  holidays: { date: string; name: string }[];
  /** the workspace's certificate threshold in WORKING days, or null when it
      never asks — the one number the form, the approver and the timesheet all
      read. See `certificateExpected`. */
  certAfterDays?: number | null;
  /** the requester's own roster (Mon=0) — suggestions count these days, the
      same days the timesheet will pay, so a part-timer's week isn't quoted
      as five days of entitlement */
  workDays?: number[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /* ASK FOR LEAVE (components/making/leave-form): the requests' own button
     opens it over the page. */
  const [asking, setAsking] = useState(false);
  /* One request armed for cancellation at a time — same shape the team
     directory uses for revoking an invite. Arming a second forgets the first. */
  const [armed, setArmed] = useState<string | null>(null);
  /* A certificate on its way to a request already booked. */
  const [uploading, setUploading] = useState(false);

  const holidayMap = useMemo(
    () => new Map(holidays.map((h) => [h.date, h.name] as const)),
    [holidays],
  );

  /** Upload, and attach it to a request that already exists. */
  const attachTo = async (requestId: string, file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    const res = await uploadFile(file, "medical_certificate");
    setUploading(false);
    if (!res.ok) return setError(res.error);
    run(() => attachCertificate(requestId, res.file.documentId));
  };

  /* The working days a booked request covers — the same count the form prints
     while you are choosing it, so a row can't disagree with the line that
     created it about whether it needs a certificate. */
  const workingDaysOf = (r: LeaveRequest) =>
    rangeBreakdown(r.startDate, r.endDate, holidayMap, workDays).working;
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

  const upcoming = requests.filter((r) => r.status === "pending" || r.status === "approved");
  const history = requests.filter((r) => r.status === "declined" || r.status === "cancelled");

  /* THE FRAME IS THE LAYOUT'S — `.page`, `.wrap`, `.stg tpr wb2`, the heading
     and the tab row all come from `(my-time)/layout.tsx`, which is what stops
     a switch from Timesheet rebuilding them.

     This screen used to write its own, and differently: a `.v2head` with a
     44px `h1` inline and 14px beneath it, against the timesheet's `.rhead` with
     a 38px one and 26px. Nothing chose those numbers — one page was written
     after the other. The visible effect was that clicking Leave grew the title
     and moved the tabs you had just pressed. It also lacked `tpr`, so anything
     in this screen scoped to that root simply didn't apply here. */
  return (
    <>
          <div className="wb2-card tp-card">
            {error && <div className="tp-err">{error}</div>}

            <div className="lv-bal">
            {balances.length === 0 ? (
              <div className="lv-balempty">
                No leave balances recorded yet. Your team sets these — until then you can still
                request unpaid leave.
              </div>
            ) : (
              balances.map((b) => {
                const bar = balanceBars(b.balanceHours, b.available, b.booked);
                return (
                  <div className={`lv-baltile ${KIND_CLASS[b.kind]}`} key={b.kind}>
                    <div className="lv-baltop">
                      <span className="lv-balic">
                        <Icon name={KIND_ICON[b.kind]} size={14} />
                      </span>
                      <em>{LEAVE_LABEL[b.kind]}</em>
                    </div>
                    <b>
                      {fmt(b.available)}
                      <span>h available</span>
                    </b>
                    {/* Decoration only — every number it draws is written out
                        in the line underneath, so a screen reader gains
                        nothing from the bar but a stack of percentages. */}
                    <div className="lv-balbar" aria-hidden="true">
                      <i style={{ width: `${bar.avail}%` }} />
                      {b.booked > 0 && <i className="bk" style={{ width: `${bar.booked}%` }} />}
                    </div>
                    <span className="lv-balsub">
                      {fmt(b.balanceHours)}h balance
                      {b.booked > 0 ? `, ${fmt(b.booked)}h booked` : ""}
                    </span>
                    <span className={`lv-src${b.source === "manual" ? "" : " synced"}`}>
                      {b.source !== "manual" && <Icon name="check" size={11} />}
                      {SOURCE_LABEL[b.source]}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className="lv-cols">
            <div className="lv-col">
              {/* The requests' own button: Ask for leave, a dialog over the
                  page (rule 52). */}
              <div className="lv-ch act">
                Your requests
                <Button kind="main" size={32} icon="plus" onClick={() => setAsking(true)} disabled={pending}>
                  Ask for leave
                </Button>
              </div>
              {asking && (
                <LeaveForm
                  today={today}
                  standard={standard}
                  balances={balances}
                  holidays={holidays}
                  workDays={workDays}
                  certAfterDays={certAfterDays}
                  onClose={() => setAsking(false)}
                />
              )}
              {upcoming.length === 0 ? (
                <div className="fl-hempty">Nothing booked. Ask for leave and it shows here.</div>
              ) : (
                upcoming.map((r) => (
                  <div className={`lv-req ${KIND_CLASS[r.kind]}`} key={r.id}>
                    <div className="lv-reqmain">
                      <b>{LEAVE_LABEL[r.kind]}</b>
                      <em>
                        {fmtRange(r.startDate, r.endDate)}, {fmt(r.hours)}h
                      </em>
                      {r.status === "declined" && r.reviewNote && <span className="lv-declined">{r.reviewNote}</span>}
                      {/* ATTACH IT AFTERWARDS — the common case, not the
                          fallback. You ring in sick on Tuesday, book the day,
                          and see a doctor on Wednesday. The row is where you
                          come back to. */}
                      {(r.certExpected ?? certificateExpected(r.kind, workingDaysOf(r), certAfterDays)) && (
                        <span className={`lv-reqcert${r.certificate ? " on" : ""}`}>
                          <Icon name={r.certificate ? "check" : "alert"} size={12} />
                          {r.certificate ? (
                            r.certificate.url ? (
                              <a href={r.certificate.url} target="_blank" rel="noreferrer">
                                {r.certificate.fileName}
                              </a>
                            ) : (
                              r.certificate.fileName
                            )
                          ) : (
                            <>
                              No certificate yet
                              <label className="lv-certadd">
                                Attach
                                <input
                                  type="file"
                                  accept="image/*,application/pdf"
                                  hidden
                                  disabled={uploading || pending}
                                  onChange={(e) => attachTo(r.id, e.target.files?.[0])}
                                />
                              </label>
                            </>
                          )}
                        </span>
                      )}
                    </div>
                    <span className={`dchip ${STATUS_COPY[r.status].tone}`}>{STATUS_COPY[r.status].label}</span>
                    {/* Arms before it fires: the first press asks, the second
                        goes through. Cancelling an approved booking gives back
                        days someone already planned around. */}
                    <button
                      className={`lv-cancel${armed === r.id ? " arm" : ""}`}
                      onClick={() => {
                        if (armed !== r.id) return setArmed(r.id);
                        run(() => cancelLeave(r.id), () => setArmed(null));
                      }}
                      disabled={pending}
                      aria-label={
                        armed === r.id
                          ? `Confirm cancelling ${LEAVE_LABEL[r.kind]} on ${fmtRange(r.startDate, r.endDate)}`
                          : `Cancel ${LEAVE_LABEL[r.kind]} on ${fmtRange(r.startDate, r.endDate)}`
                      }
                    >
                      <Icon name="x" size={13} />
                      {armed === r.id ? "Confirm" : "Cancel"}
                    </button>
                  </div>
                ))
              )}
              {history.length > 0 && (
                <div className="lv-hist">
                  {history.map((r) => (
                    <div className={`lv-req muted ${KIND_CLASS[r.kind]}`} key={r.id}>
                      <div className="lv-reqmain">
                        <b>{LEAVE_LABEL[r.kind]}</b>
                        <em>
                          {fmtRange(r.startDate, r.endDate)}, {fmt(r.hours)}h
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
    </>
  );
}
