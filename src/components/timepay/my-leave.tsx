"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { DateField } from "@/components/ui/date-field";
import { MonthGrid, monthOf } from "@/components/ui/month-grid";
import { fmtAuDayMonth } from "@/lib/au-dates";
import { UpcomingHolidays } from "./upcoming-holidays";
import { attachCertificate, cancelLeave, requestLeave, type LeaveResult } from "@/app/actions/leave";
import { uploadFile } from "@/lib/documents/upload-client";
import {
  LEAVE_LABEL,
  SOURCE_LABEL,
  certificateExpected,
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
  const [open, setOpen] = useState(false);
  /* One request armed for cancellation at a time — same shape the team
     directory uses for revoking an invite. Arming a second forgets the first. */
  const [armed, setArmed] = useState<string | null>(null);

  const [kind, setKind] = useState<LeaveKind>("annual");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  /* The certificate, uploaded BEFORE the request exists — the bytes go to
     storage against a signed slot and the row is adopted on submit, the same
     three steps an expense receipt takes. Holding the file in memory until
     submit instead would put a 10 MB photo through a server action. */
  const [cert, setCert] = useState<{ documentId: string; fileName: string } | null>(null);
  const [uploading, setUploading] = useState(false);
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
  /* Whether THIS span wants a certificate — one rule, shared with the approver
     and the timesheet, counting the same working days the line under the
     calendar already prints. */
  const wantsCert = certificateExpected(kind, breakdown.working, certAfterDays);

  /** Upload, and hold the id until Submit adopts it. */
  const pickCertificate = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    const res = await uploadFile(file, "medical_certificate");
    setUploading(false);
    if (!res.ok) return setError(res.error);
    setCert({ documentId: res.file.documentId, fileName: res.file.fileName });
  };

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
      () =>
        requestLeave({
          kind,
          startDate,
          endDate,
          hours: effectiveHours,
          note: note.trim() || undefined,
          certificateDocumentId: cert?.documentId,
        }),
      () => {
        setOpen(false);
        setNote("");
        setHours("");
        setCert(null);
      },
    );
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
                      {b.booked > 0 ? ` · ${fmt(b.booked)}h booked` : ""}
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
              {/* ONE WAY IN, ONE WAY OUT, and the form opens under the button
                  that opens it. It used to render ABOVE `.lv-cols` — so
                  pressing "Request leave", in a header most of the way down the
                  card, made a calendar appear above the press and pushed the
                  button itself out from under the cursor. And the header then
                  said "Close" while the form said "Cancel": two controls, one
                  job, opposite ends of the thing.

                  While the form is open the trigger stands down; the form's own
                  Cancel is the way back. */}
              <div className="lv-ch act">
                Your requests
                {!open && (
                  <button
                    className="fl-btn tiny primary"
                    onClick={() => setOpen(true)}
                    disabled={pending}
                    aria-expanded={false}
                  >
                    <Icon name="plus" size={13} />
                    Request leave
                  </button>
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
                    {/* The placeholder IS the suggestion — leave it be and the
                        span's own working days are what get booked. */}
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

                  {/* THE CERTIFICATE, and only when this span actually wants
                      one. It never blocks Submit: somebody booking a sick day
                      usually hasn't seen a doctor yet, and a form that refused
                      them would keep the absence off the books rather than get
                      the document sooner. Missing here just means the row says
                      so, to them and to whoever approves it. */}
                  {wantsCert && (
                    <div className={`lv-cert${cert ? " on" : ""}`}>
                      <Icon name={cert ? "check" : "upload"} size={15} />
                      <span>
                        <b>{cert ? cert.fileName : "Medical certificate"}</b>
                        <em>
                          {cert
                            ? "Attached — it goes with this request."
                            : "Personal leave this long needs one. Add it now, or after you’ve seen someone."}
                        </em>
                      </span>
                      <label className="fl-btn tiny">
                        {uploading ? "Uploading…" : cert ? "Replace" : "Attach"}
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          hidden
                          disabled={uploading || pending}
                          onChange={(e) => pickCertificate(e.target.files?.[0])}
                        />
                      </label>
                    </div>
                  )}
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
              {upcoming.length === 0 ? (
                <div className="fl-hempty">Nothing booked. Request leave and it shows here.</div>
              ) : (
                upcoming.map((r) => (
                  <div className={`lv-req ${KIND_CLASS[r.kind]}`} key={r.id}>
                    <div className="lv-reqmain">
                      <b>{LEAVE_LABEL[r.kind]}</b>
                      <em>
                        {fmtRange(r.startDate, r.endDate)} · {fmt(r.hours)}h
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
    </>
  );
}
