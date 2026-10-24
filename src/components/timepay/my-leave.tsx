"use client";

import { useContext, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { Button, LinkButton } from "@/components/parts/button";
import { Menu } from "@/components/parts/menu";
import { Dialog } from "@/components/parts/dialog";
import { Row, RowList } from "@/components/parts/row";
import { StateWord, stateTone, type Tone } from "@/components/parts/state";
import { dayWords } from "@/components/parts/range-calendar";
import { LEAVE_ASKS, LeaveForm, type LeaveAsk } from "@/components/making/leave-form";
import { WindowsContext } from "@/components/records/records-context";
import { attachCertificate, cancelLeave, type LeaveResult } from "@/app/actions/leave";
import { uploadFile } from "@/lib/documents/upload-client";
import {
  LEAVE_LABEL,
  MON_FRI,
  SOURCE_LABEL,
  certificateExpected,
  rangeBreakdown,
  upcomingHolidays,
  type BalanceKind,
  type BalanceView,
  type LeaveRequest,
  type LeaveStatus,
} from "@/lib/timepay/leave";
import { fmt } from "./logic";

/* LEAVE (v2; Isaac's mock of 24 October 2026, YRqKF87knq2N35tMLa5hkz,
   section 2): your name › Leave, a page of its own, as Timesheet is. No
   strip of the old card's faces, no header bars, no coloured blocks.

   The title, and on its right one blue button, Add, opening a white menu of
   the four kinds of leave (rule 54; "You need to have a add button instead
   of ask for leave… the add would be leave request, sick day, etc."). Each
   opens the request form (components/making/leave-form) with its words as
   the heading. On the left what you have, your two balances as figures,
   and your requests as rows (rule 39): a dot, the kind, the dates and
   hours, and where it is up to as a word in its colour ("Waiting on the
   office should be waiting for approval"). A request opens on a press: its
   facts, the certificate a sick day can take afterwards, and Cancel
   request while it can still be cancelled. On the right, the public
   holidays coming up. No dollars: leave is hours and entitlement. */

/** Where a request is up to, said to the person who asked (rule 17). */
export const LEAVE_STATE: Record<LeaveStatus, { word: string; tone: Tone }> = {
  pending: { word: "Waiting for approval", tone: "look" },
  approved: { word: "Approved", tone: "good" },
  declined: { word: "Declined", tone: "wrong" },
  cancelled: { word: "Cancelled", tone: "info" },
};

const BALANCE_KINDS: readonly BalanceKind[] = ["annual", "personal"];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Annual leave, not set yet"; "Annual leave, 56 h booked, synced from Xero" */
function balanceCaption(kind: BalanceKind, b: BalanceView | undefined): string {
  if (!b) return `${LEAVE_LABEL[kind]}, not set yet`;
  const parts = [LEAVE_LABEL[kind]];
  if (b.booked > 0) parts.push(`${fmt(b.booked)} h booked`);
  if (b.source !== "manual") parts.push(SOURCE_LABEL[b.source].replace(/^Synced/, "synced"));
  return parts.join(", ");
}

const rangeWords = (r: Pick<LeaveRequest, "startDate" | "endDate">, between: string) =>
  r.startDate === r.endDate ? dayWords(r.startDate) : `${dayWords(r.startDate)}${between}${dayWords(r.endDate)}`;

const isLive = (r: LeaveRequest) => r.status === "pending" || r.status === "approved";

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
  /** from a while back to a year on: the form counts a day put in after
      against its own holidays; the page lists the ones to come */
  holidays: { date: string; name: string }[];
  /** the workspace's certificate threshold in WORKING days, or null when it
      never asks — the one number the form, the approver and the timesheet all
      read. See `certificateExpected`. */
  certAfterDays?: number | null;
  /** the requester's own roster (Mon=0) — the hours count these days, the
      same days the timesheet will pay, so a part-timer's week isn't quoted
      as five days of entitlement */
  workDays?: number[];
}) {
  const addRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [asking, setAsking] = useState<LeaveAsk | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  const holidayMap = useMemo(() => new Map(holidays.map((h) => [h.date, h.name] as const)), [holidays]);
  const roster = workDays?.length ? workDays : MON_FRI;
  const coming = upcomingHolidays(holidays, today);

  /* The working days a request covers: the same count the form printed
     while it was being picked, so a row can't disagree with the line that
     made it about whether it needs a certificate. */
  const workingDaysOf = (r: LeaveRequest) => rangeBreakdown(r.startDate, r.endDate, holidayMap, roster).working;
  const wantsCert = (r: LeaveRequest) => r.certExpected ?? certificateExpected(r.kind, workingDaysOf(r), certAfterDays);

  /** "Mon 21 Dec – Fri 1 Jan, 7 days, 56 h" */
  const lineOf = (r: LeaveRequest) => {
    const parts = [rangeWords(r, " – ")];
    const days = workingDaysOf(r);
    if (r.startDate !== r.endDate && days > 0) parts.push(plural(days, "day", "days"));
    parts.push(`${fmt(r.hours)} h`);
    if (isLive(r) && wantsCert(r) && !r.certificate) parts.push("no certificate yet");
    return parts.join(", ");
  };

  const open = requests.find((r) => r.id === opened) ?? null;

  return (
    <div className="wrap lv2">
      <header className="lv2-head">
        <h1 className="lv2-h1">Leave</h1>
        <Button ref={addRef} kind="main" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          Add
          <span className="lv2-chev" aria-hidden="true">
            <Icon name="chevD" size={16} />
          </span>
        </Button>
        <Menu
          open={menu}
          anchor={addRef}
          onClose={() => setMenu(false)}
          onSelect={(key) => {
            setMenu(false);
            setAsking(key as LeaveAsk);
          }}
          items={LEAVE_ASKS.map((a) => ({ key: a.key, label: a.heading, hint: a.hint }))}
          label="Add leave"
          align="end"
        />
      </header>

      <div className="lv2-cols">
        <div className="lv2-main">
          <section className="lv2-group">
            <h2 className="lv2-gh">What you have</h2>
            <dl className="lv2-figs">
              {BALANCE_KINDS.map((kind) => {
                const b = balances.find((x) => x.kind === kind);
                return (
                  <div key={kind}>
                    <dt>{balanceCaption(kind, b)}</dt>
                    <dd>{b ? `${fmt(b.available)} h` : "—"}</dd>
                  </div>
                );
              })}
            </dl>
          </section>

          <section className="lv2-group">
            <h2 className="lv2-gh">Your requests</h2>
            {requests.length === 0 ? (
              <p className="lv2-none">Nothing requested yet.</p>
            ) : (
              <RowList label="Your requests">
                {requests.map((r) => {
                  const state = LEAVE_STATE[r.status];
                  return (
                    <Row
                      key={r.id}
                      dot={stateTone(state.tone)}
                      name={LEAVE_LABEL[r.kind]}
                      line={lineOf(r)}
                      end={<span className={`lv2-word lv2-word--${state.tone}`}>{state.word}</span>}
                      onClick={() => setOpened(r.id)}
                    />
                  );
                })}
              </RowList>
            )}
          </section>
        </div>

        <section className="lv2-group">
          <h2 className="lv2-gh">Public holidays coming up</h2>
          {coming.length === 0 ? (
            <p className="lv2-none">No public holidays loaded for your state yet.</p>
          ) : (
            <ul className="lv2-hols" aria-label="Public holidays coming up">
              {coming.map((h) => (
                <li key={h.date}>
                  <b>{dayWords(h.date)}</b>
                  <span>{h.name}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {asking && (
        <LeaveForm
          key={asking}
          ask={asking}
          today={today}
          standard={standard}
          balances={balances}
          holidays={holidays}
          workDays={workDays}
          certAfterDays={certAfterDays}
          onClose={() => setAsking(null)}
        />
      )}
      {open && <RequestDialog request={open} today={today} wantsCert={wantsCert(open)} onClose={() => setOpened(null)} />}
    </div>
  );
}

/* A REQUEST, OPENED: its days and hours, where it is up to, its note and the
   answer it got, and the certificate a sick day can take afterwards, which
   is the common case, not the fallback: you ring in sick on Tuesday, book
   the day, and see a doctor on Wednesday. Cancel request is red (rule 25)
   and there only while it can still go: a request waiting for approval
   always, an approved one until it starts. The server decides again. */
function RequestDialog({
  request: r,
  today,
  wantsCert,
  onClose,
}: {
  request: LeaveRequest;
  today: string;
  wantsCert: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const host = useContext(WindowsContext);
  const certInput = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = LEAVE_STATE[r.status];
  const cancellable = r.status === "pending" || (r.status === "approved" && r.startDate > today);
  const busy = pending || uploading;

  const run = (action: () => Promise<LeaveResult>, onOk?: () => void) => {
    setError(null);
    start(async () => {
      const res = await action();
      if (!res.ok) return setError(res.error);
      onOk?.();
      router.refresh();
    });
  };

  /** Upload, and attach it to this request. */
  const attach = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    const res = await uploadFile(file, "medical_certificate");
    setUploading(false);
    if (!res.ok) return setError(res.error);
    run(() => attachCertificate(r.id, res.file.documentId));
  };

  return (
    <Dialog
      heading={LEAVE_LABEL[r.kind]}
      width={400}
      onClose={onClose}
      foot={
        <>
          {cancellable && (
            <Button
              kind="delete"
              disabled={busy}
              onClick={() =>
                run(
                  () => cancelLeave(r.id),
                  () => {
                    onClose();
                    host?.toast("Leave request cancelled");
                  },
                )
              }
            >
              Cancel request
            </Button>
          )}
          <Button kind="second" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="lv2-req">
        <dl className="lv2-facts">
          <div>
            <dt>Days</dt>
            <dd>{rangeWords(r, " to ")}</dd>
          </div>
          <div>
            <dt>Hours</dt>
            <dd>{fmt(r.hours)}</dd>
          </div>
          <div>
            <dt>Where it’s up to</dt>
            <dd>
              <StateWord tone={state.tone}>{state.word}</StateWord>
            </dd>
          </div>
          {r.note && (
            <div>
              <dt>Note</dt>
              <dd>{r.note}</dd>
            </div>
          )}
          {r.reviewNote && (
            <div>
              <dt>{r.status === "declined" ? "Why it was declined" : "Their note"}</dt>
              <dd>{r.reviewNote}</dd>
            </div>
          )}
          {wantsCert && (
            <div>
              <dt>Medical certificate</dt>
              <dd>
                {r.certificate ? (
                  r.certificate.url ? (
                    <LinkButton href={r.certificate.url} target="_blank" rel="noreferrer">
                      {r.certificate.fileName}
                    </LinkButton>
                  ) : (
                    r.certificate.fileName
                  )
                ) : (
                  "No certificate yet"
                )}
              </dd>
            </div>
          )}
        </dl>
        {wantsCert && !r.certificate && isLive(r) && (
          <div className="lv2-cert">
            <Button icon="upload" disabled={busy} onClick={() => certInput.current?.click()}>
              {uploading ? "Uploading the certificate" : "Attach certificate"}
            </Button>
            <input
              ref={certInput}
              type="file"
              accept="image/*,application/pdf"
              hidden
              onChange={(e) => {
                void attach(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        )}
        {error && (
          <p className="mk-team-wrong" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
