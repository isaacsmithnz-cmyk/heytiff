"use client";

import { useContext, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Field, TextInput } from "@/components/parts/field";
import { RangeCalendar, addDay, dayWords, pickDay, spanEnd, weekdayIndex, weekdayWord, type DaySpan } from "@/components/parts/range-calendar";
import { WindowsContext } from "@/components/records/records-context";
import { cancelLeave, requestLeave } from "@/app/actions/leave";
import { uploadFile } from "@/lib/documents/upload-client";
import {
  LEAVE_LOOKBACK_DAYS,
  MON_FRI,
  certificateExpected,
  rangeBreakdown,
  suggestedHours,
  type BalanceView,
  type LeaveKind,
  type RangeBreakdown,
} from "@/lib/timepay/leave";
import { fmt } from "@/components/timepay/logic";

/* A LEAVE REQUEST, PICKED ON A CALENDAR (Isaac, 24 October 2026, his mock
   YRqKF87knq2N35tMLa5hkz, sections 6 and 7): your name › Leave › Add, then
   the kind, as a dialog over your leave (rules 51 and 54).

   "You need to have a add button instead of ask for leave… the add would be
   leave request, sick day, etc." Each of Add's four opens this form with its
   own words as the heading. An annual or unpaid leave request is planned:
   two months side by side, today and later, a first day off and then a
   last. "Sick day, you should be able to add ones in the past. Or select the
   current day, at least": a sick day opens on one month with today picked,
   and any day before it can be put in after; carer's leave is the same,
   and can be planned ahead too. Sick days and carer's leave both come off
   personal leave, and the leave table records one kind for both, so both
   go in as personal leave.

   Under the months, what the days come to: the working days and the hours
   in bold, counted on your own roster with the public holidays left out,
   and one grey line about your balance. The hours fill themselves from the
   roster and can be changed for a part day. A certificate is offered when
   the workspace asks for one on a span this long, and it never blocks
   sending: somebody booking a sick day usually hasn't seen a doctor yet.

   Everything is decided again by `requestLeave`: one live booking a day,
   and no more than a balance that is set has available. Sending keeps you on
   your leave, with a toast whose Undo withdraws the request (`cancelLeave`). */

export type LeaveAsk = "annual" | "sick" | "carers" | "unpaid";

/** Add's four, in its order: the words are the menu's and the form's heading. */
export const LEAVE_ASKS: readonly { key: LeaveAsk; heading: string; kind: LeaveKind; hint?: string }[] = [
  { key: "annual", heading: "Annual leave request", kind: "annual" },
  { key: "sick", heading: "Sick day", kind: "personal", hint: "Personal leave" },
  { key: "carers", heading: "Carer's leave", kind: "personal", hint: "Personal leave" },
  { key: "unpaid", heading: "Unpaid leave request", kind: "unpaid" },
];

/** A day away (a sick day, carer's leave) is put in on the day or after; a request is planned. */
const isDayAway = (ask: LeaveAsk) => ask === "sick" || ask === "carers";

const KIND_WORDS: Record<LeaveKind, string> = { annual: "annual leave", personal: "personal leave", unpaid: "unpaid leave" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const hoursWords = (h: number) => (h > 0 ? plural(Number(fmt(h)), "hour", "hours") : "no hours");

/* THE STEP, above the months: what the next press does. */
export function stepLine(ask: LeaveAsk, span: DaySpan, today: string): { lead: string; rest?: string } {
  const { start, end } = span;
  if (!start) return { lead: "Pick your first day off" };
  if (end && end > start) return { lead: `${dayWords(start)} to ${dayWords(end)}`, rest: "press a day to start again" };
  if (isDayAway(ask)) {
    const lead = start === today ? `Today, ${dayWords(start)}` : dayWords(start);
    return { lead, rest: start < today ? "a day already gone, put in after" : "press another day, or a second one for a run of days" };
  }
  if (!end) return { lead: "Now your last day off", rest: `from ${dayWords(start)}` };
  return { lead: dayWords(start), rest: "press a day to start again" };
}

/* WHAT THE DAYS COME TO, in bold, and the one grey line beside it: why a
   day takes no hours, or what the hours do to the balance. */
export function whatItComesTo({
  kind,
  start,
  last,
  breakdown,
  suggested,
  hours,
  standard,
  roster,
  holidayMap,
  balance,
}: {
  kind: LeaveKind;
  start: string;
  last: string;
  breakdown: RangeBreakdown;
  /** the roster's hours for the span */
  suggested: number;
  /** the hours that will be sent */
  hours: number;
  standard: number;
  roster: readonly number[];
  holidayMap: ReadonlyMap<string, string>;
  balance: BalanceView | undefined;
}): { bold: string; why: string } {
  const one = start === last;
  const bold = one
    ? `${dayWords(start)}, ${hoursWords(hours)}`
    : breakdown.working === 0
      ? "No working days, no hours"
      : `${plural(breakdown.working, "working day", "working days")}, ${hoursWords(hours)}`;
  const nothingOff = kind === "unpaid" ? "there are no hours to take" : `nothing comes off your ${KIND_WORDS[kind]}`;
  if (suggested === 0) {
    const holiday = one ? holidayMap.get(start) : undefined;
    if (holiday !== undefined && roster.includes(weekdayIndex(start))) return { bold, why: `${holiday} is a public holiday, so ${nothingOff}.` };
    if (one)
      return {
        bold,
        why: `${weekdayWord(start)} isn't one of your working days, so ${nothingOff}. On a working day it's that day's hours, ${fmt(standard)}.`,
      };
    return { bold, why: `None of these is one of your working days, so ${nothingOff}.` };
  }
  if (kind === "unpaid") return { bold, why: "Unpaid leave comes off no balance, so it goes in as a request, waiting for approval." };
  if (!balance) return { bold, why: `Your ${KIND_WORDS[kind]} balance isn't set yet, so it goes in as a request, waiting for approval.` };
  if (hours > balance.available)
    return {
      bold,
      why: `You have ${fmt(balance.available)} hours of ${KIND_WORDS[kind]} available, so this is ${fmt(hours - balance.available)} hours more than you have.`,
    };
  return { bold, why: `Comes off your ${KIND_WORDS[kind]}: ${fmt(balance.available)} hours available, ${fmt(balance.available - hours)} after this.` };
}

export function LeaveForm({
  ask,
  today,
  standard,
  balances,
  holidays,
  workDays,
  certAfterDays = null,
  onClose,
}: {
  ask: LeaveAsk;
  today: string;
  /** a working day's hours, for the suggestion */
  standard: number;
  balances: BalanceView[];
  holidays: { date: string; name: string }[];
  /** the requester's own roster (Mon=0): the hours count these days, the
      same days the timesheet will pay */
  workDays?: number[];
  /** the workspace's certificate threshold in working days, or null when it
      never asks (`certificateExpected`) */
  certAfterDays?: number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const host = useContext(WindowsContext);
  const certInput = useRef<HTMLInputElement>(null);
  const meta = LEAVE_ASKS.find((a) => a.key === ask)!;
  const kind = meta.kind;
  const dayAway = isDayAway(ask);
  const roster = workDays?.length ? workDays : MON_FRI;

  /* a sick day and carer's leave open on today, picked; a request on nothing */
  const [span, setSpan] = useState<DaySpan>(dayAway ? { start: today, end: today } : { start: null, end: null });
  /* the hours as typed, or null to follow the roster; a new pick follows it again */
  const [typed, setTyped] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [cert, setCert] = useState<{ documentId: string; fileName: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const holidayMap = useMemo(() => new Map(holidays.map((h) => [h.date, h.name] as const)), [holidays]);
  const holidaySet = useMemo(() => new Set(holidayMap.keys()), [holidayMap]);
  const start = span.start;
  const last = spanEnd(span);
  const breakdown = start && last ? rangeBreakdown(start, last, holidayMap, roster) : null;
  const suggested = start && last ? suggestedHours(start, last, standard, holidaySet, roster) : 0;
  const hours = typed === null ? suggested : Number(typed);
  /* Whether THIS span wants a certificate: one rule, shared with the
     approver and the timesheet, counting the working days the line prints. */
  const wantsCert = !!breakdown && certificateExpected(kind, breakdown.working, certAfterDays);
  const balance = balances.find((b) => b.kind === kind);

  const min = dayAway ? addDay(today, -LEAVE_LOOKBACK_DAYS) : today;
  const max = ask === "sick" ? today : addDay(today, 365);
  const step = stepLine(ask, span, today);

  const sum =
    start && last && breakdown
      ? whatItComesTo({ kind, start, last, breakdown, suggested, hours, standard, roster, holidayMap, balance })
      : null;

  const pick = (iso: string) => {
    setSpan((s) => pickDay(s, iso));
    setTyped(null);
  };

  /** Upload, and hold the id until Send adopts it. */
  const pickCertificate = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    const res = await uploadFile(file, "medical_certificate");
    setUploading(false);
    if (!res.ok) return setError(res.error);
    setCert({ documentId: res.file.documentId, fileName: res.file.fileName });
  };

  const ready = !!start && !!last && hours > 0;
  const send = async () => {
    if (pending || uploading || !ready || !start || !last) return;
    setPending(true);
    setError(null);
    const res = await requestLeave({
      kind,
      startDate: start,
      endDate: last,
      hours,
      note: note.trim() || undefined,
      ...(cert ? { certificateDocumentId: cert.documentId } : {}),
    });
    setPending(false);
    if (!res.ok) return setError(res.error);
    onClose();
    router.refresh();
    const id = res.id;
    host?.toast(
      "Leave request sent",
      id
        ? async () => {
            await cancelLeave(id);
            router.refresh();
          }
        : undefined,
    );
  };

  const sendWord = dayAway ? "Send" : "Send request";

  return (
    <Dialog
      heading={meta.heading}
      width={dayAway ? 560 : 720}
      onClose={onClose}
      foot={
        <>
          <Button kind="second" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" disabled={pending || uploading || !ready} onClick={() => void send()}>
            {pending ? "Sending" : sendWord}
          </Button>
        </>
      }
    >
      <form
        className="mk-form"
        aria-label={meta.heading}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <p className="lv2-ask" aria-live="polite">
          <b>{step.lead}</b>
          {step.rest && <span>, {step.rest}</span>}
        </p>
        <RangeCalendar
          label={dayAway ? "Pick the days" : "Pick your days off"}
          today={today}
          months={dayAway ? 1 : 2}
          span={span}
          onPick={pick}
          min={min}
          max={max}
          holidays={holidayMap}
          workDays={roster}
        />
        {sum && (
          <div className="lv2-sum">
            <b>{sum.bold}</b>
            <span>{sum.why}</span>
          </div>
        )}
        <div className="lv2-fields">
          {/* filled from the roster; change it for a part day */}
          <Field label="Hours">
            <TextInput
              type="number"
              inputMode="decimal"
              min={0}
              step={0.25}
              placeholder={suggested > 0 ? String(suggested) : undefined}
              value={typed ?? (suggested > 0 ? String(suggested) : "")}
              onChange={(e) => setTyped(e.target.value)}
            />
          </Field>
          <Field label="Note">
            <TextInput placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        {wantsCert && (
          <div className="pt-field">
            <span className="pt-field-label">Medical certificate</span>
            <div className="mk-team-files">
              {cert && (
                <ul className="mk-team-list" aria-label="Medical certificate">
                  <li className="mk-team-file">
                    <span className="mk-team-file-text">
                      <span className="mk-team-file-name">{cert.fileName}</span>
                      <span className="mk-team-file-size">It goes with this request.</span>
                    </span>
                  </li>
                </ul>
              )}
              <div className="lv2-cert">
                <Button icon="upload" disabled={uploading || pending} onClick={() => certInput.current?.click()}>
                  {uploading ? "Uploading the certificate" : cert ? "Replace certificate" : "Attach certificate"}
                </Button>
                {!cert && <span className="lv2-cert-when">Add it now or later</span>}
              </div>
              <input
                ref={certInput}
                type="file"
                accept="image/*,application/pdf"
                hidden
                onChange={(e) => {
                  void pickCertificate(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        )}
        {error && (
          <p className="mk-team-wrong" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
