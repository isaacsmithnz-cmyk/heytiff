"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { approveLeave, declineLeave, type LeaveResult } from "@/app/actions/leave";
import {
  LEAVE_LABEL,
  type CalendarDay,
  type LeaveKind,
  type LeaveRequest,
} from "@/lib/timepay/leave";
import { fmt, initials, nameHue } from "./logic";
import { TimepayNav } from "./timepay-nav";

/* Team leave — the `timepay_all` Leave tab. Pending requests to decide (with
   `approvals`), and a calendar of who's off when. No dollars: leave is hours.
   Without `approvals` this is read-only — you can see the roster, not decide it. */

function fmtRange(startISO: string, endISO: string): string {
  const d = (iso: string) =>
    new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
      .format(new Date(`${iso}T00:00:00Z`))
      .replace(",", "");
  return startISO === endISO ? d(startISO) : `${d(startISO)} – ${d(endISO)}`;
}

const KIND_TONE: Record<LeaveKind, string> = { annual: "ok", personal: "warn", unpaid: "mute" };

function PendingCard({
  r,
  canApprove,
  busy,
  onApprove,
  onDecline,
}: {
  r: LeaveRequest;
  canApprove: boolean;
  busy: boolean;
  onApprove: (id: string) => void;
  onDecline: (id: string, reason: string) => void;
}) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="lv-pend">
      <span className="fl-dav" style={{ background: `hsl(${nameHue(r.staffName ?? "")} 64% 42%)` }}>
        {initials(r.staffName ?? "?")}
      </span>
      <div className="lv-pmain">
        <b>{r.staffName}</b>
        <em>
          <span className={`dchip2 ${KIND_TONE[r.kind]}`}>{LEAVE_LABEL[r.kind]}</span>
          {fmtRange(r.startDate, r.endDate)} · {fmt(r.hours)}h
        </em>
        {r.note && <span className="lv-pnote">{r.note}</span>}
        {declining && (
          <div className="lv-decline">
            <input
              placeholder="Why is this declined? They'll see it."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button
              className="fl-btn primary"
              disabled={busy || !reason.trim()}
              onClick={() => onDecline(r.id, reason)}
            >
              Decline
            </button>
            <button className="fl-btn ghost" onClick={() => setDeclining(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>
      {canApprove && !declining && (
        <div className="lv-pacts">
          <button className="capprove" disabled={busy} onClick={() => onApprove(r.id)}>
            <Icon name="check" size={14} sw={2.6} />
            Approve
          </button>
          <button className="cedit sendback" disabled={busy} onClick={() => setDeclining(true)}>
            <Icon name="x" size={13} />
            Decline
          </button>
        </div>
      )}
    </div>
  );
}

export function TeamLeave({
  pending,
  calendar,
  canApprove,
}: {
  pending: LeaveRequest[];
  calendar: CalendarDay[];
  canApprove: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<LeaveResult>) => {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };

  // group the flat day list back into runs by person for a readable calendar
  const upcoming = useMemo(() => calendar.filter((d) => d.entries.length > 0), [calendar]);

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="rhead">
            <div>
              <h1>Time &amp; Pay</h1>
            </div>
          </div>
          <TimepayNav active="leave" />

          {error && <div className="tp-err">{error}</div>}

          <div className="lv-cols">
            <div className="lv-col">
              <div className="lv-ch">
                Pending requests{pending.length ? ` · ${pending.length}` : ""}
              </div>
              {pending.length === 0 ? (
                <div className="fl-hempty">Nothing waiting. Leave requests to review land here.</div>
              ) : (
                pending.map((r) => (
                  <PendingCard
                    key={r.id}
                    r={r}
                    canApprove={canApprove}
                    busy={busy}
                    onApprove={(id) => run(() => approveLeave(id))}
                    onDecline={(id, reason) => run(() => declineLeave(id, reason))}
                  />
                ))
              )}
            </div>

            {/* The roster's own question: who can't I put on. Booked leave and
                a casual's unavailability both answer it, so they share a list —
                but they are not the same claim, so they don't share a chip.
                Leave is an arrangement somebody approved; an unavailability is
                a casual telling you a fact. */}
            <div className="lv-col">
              <div className="lv-ch">Who can&rsquo;t work</div>
              {upcoming.length === 0 ? (
                <div className="fl-hempty">
                  Nobody&rsquo;s away and nobody has blocked out days in the next few weeks.
                </div>
              ) : (
                <>
                  {upcoming.map((day) => (
                    <div className="lv-calday" key={day.date}>
                      <span className="lv-caldate">{fmtRange(day.date, day.date)}</span>
                      <div className="lv-calnames">
                        {day.entries.map((e, i) =>
                          e.source === "unavailable" ? (
                            <span
                              key={i}
                              className="dchip2 unavail"
                              title={
                                e.note
                                  ? `Unavailable — ${e.note}`
                                  : "Unavailable — not booked leave, nothing to approve"
                              }
                            >
                              {e.staffName}
                              <em>can&rsquo;t work</em>
                            </span>
                          ) : (
                            <span key={i} className={`dchip2 ${KIND_TONE[e.kind ?? "annual"]}`}>
                              {e.staffName}
                            </span>
                          ),
                        )}
                      </div>
                    </div>
                  ))}
                  <p className="lv-callegend">
                    Names in grey have marked themselves unavailable — that&rsquo;s a casual telling
                    you when they can&rsquo;t be rostered, not leave, and there&rsquo;s nothing to
                    approve.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
