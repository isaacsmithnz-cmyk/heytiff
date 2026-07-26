"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import {
  approveLeave,
  declineLeave,
  setLeaveBalance,
  type LeaveResult,
} from "@/app/actions/leave";
import {
  LEAVE_LABEL,
  SOURCE_LABEL,
  type BalanceKind,
  type CalendarDay,
  type LeaveKind,
  type LeaveRequest,
} from "@/lib/timepay/leave";
import type { TeamBalanceCell, TeamBalanceRow } from "@/lib/timepay/balances";
import { fmt, initials, nameHue } from "./logic";
import { TimepayNav } from "./timepay-nav";

/* Team leave — the `timepay_all` Leave tab. Pending requests to decide (with
   `approvals`), a calendar of who's off when, and everyone's entitlements
   (set with `team`). No dollars: leave is hours. Without the capability each
   section is read-only — you can see the roster, not decide or set it. */

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

/* One person's entitlements. The chip says what the request form would offer
   them ("26h of 38h"); editing replaces the ENTITLEMENT, and the app keeps
   netting live bookings off it — never write "available" back as the balance. */
function BalanceRow({
  row,
  canManage,
  busy,
  onSet,
}: {
  row: TeamBalanceRow;
  canManage: boolean;
  busy: boolean;
  onSet: (staffId: string, kind: BalanceKind, hours: number, done: () => void) => void;
}) {
  const [editing, setEditing] = useState<BalanceKind | null>(null);
  const [hours, setHours] = useState("");

  const openEditor = (kind: BalanceKind, cell: TeamBalanceCell) => {
    setEditing(kind);
    setHours(cell ? String(cell.balanceHours) : "");
  };

  const chip = (kind: BalanceKind, cell: TeamBalanceCell) => (
    <span
      className={`dchip2 ${cell ? (cell.available > 0 ? "ok" : "warn") : "mute"}`}
      title={cell ? `As at ${cell.asAt} · ${SOURCE_LABEL[cell.source]}` : undefined}
    >
      {LEAVE_LABEL[kind]} ·{" "}
      {cell ? `${fmt(cell.available)}h of ${fmt(cell.balanceHours)}h` : "not set"}
    </span>
  );

  const valid = hours.trim() !== "" && Number(hours) >= 0;
  return (
    <div className="lv-pend">
      <span className="fl-dav" style={{ background: `hsl(${nameHue(row.name)} 64% 42%)` }}>
        {initials(row.name)}
      </span>
      <div className="lv-pmain">
        <b>{row.name}</b>
        <em>
          {chip("annual", row.annual)}
          {chip("personal", row.personal)}
        </em>
        {editing && (
          <div className="lv-decline">
            <input
              type="number"
              min={0}
              step={0.5}
              placeholder={`${LEAVE_LABEL[editing]} entitlement, in hours`}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
            <button
              className="fl-btn primary"
              disabled={busy || !valid}
              onClick={() => onSet(row.staffId, editing, Number(hours), () => setEditing(null))}
            >
              Save
            </button>
            <button className="fl-btn ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>
      {canManage && !editing && (
        <div className="lv-pacts">
          <button className="cedit" disabled={busy} onClick={() => openEditor("annual", row.annual)}>
            <Icon name="edit" size={13} />
            Annual
          </button>
          <button
            className="cedit"
            disabled={busy}
            onClick={() => openEditor("personal", row.personal)}
          >
            <Icon name="edit" size={13} />
            Personal
          </button>
        </div>
      )}
    </div>
  );
}

export function TeamLeave({
  pending,
  calendar,
  balances,
  canApprove,
  canManage,
}: {
  pending: LeaveRequest[];
  calendar: CalendarDay[];
  balances: TeamBalanceRow[];
  canApprove: boolean;
  canManage: boolean;
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

              <div className="lv-ch">Leave balances</div>
              {balances.length === 0 ? (
                <div className="fl-hempty">No active staff yet.</div>
              ) : (
                balances.map((row) => (
                  <BalanceRow
                    key={row.staffId}
                    row={row}
                    canManage={canManage}
                    busy={busy}
                    onSet={(staffId, kind, hrs, done) =>
                      run(async () => {
                        const res = await setLeaveBalance({
                          staffProfileId: staffId,
                          kind,
                          balanceHours: hrs,
                        });
                        if (res.ok) done();
                        return res;
                      })
                    }
                  />
                ))
              )}
            </div>

            <div className="lv-col">
              <div className="lv-ch">Who&rsquo;s off</div>
              {upcoming.length === 0 ? (
                <div className="fl-hempty">No approved leave in the next few weeks.</div>
              ) : (
                upcoming.map((day) => (
                  <div className="lv-calday" key={day.date}>
                    <span className="lv-caldate">{fmtRange(day.date, day.date)}</span>
                    <div className="lv-calnames">
                      {day.entries.map((e, i) => (
                        <span key={i} className={`dchip2 ${KIND_TONE[e.kind]}`}>
                          {e.staffName}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
