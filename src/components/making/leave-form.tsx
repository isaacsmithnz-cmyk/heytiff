"use client";

import { useContext, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Field, TextInput } from "@/components/parts/field";
import { Tray } from "@/components/parts/tabs";
import { DateField } from "@/components/ui/date-field";
import { WindowsContext } from "@/components/records/records-context";
import { cancelLeave, requestLeave } from "@/app/actions/leave";
import { uploadFile } from "@/lib/documents/upload-client";
import {
  certificateExpected,
  rangeBreakdown,
  suggestedHours,
  type BalanceView,
  type LeaveKind,
  type RangeBreakdown,
} from "@/lib/timepay/leave";
import { fmt } from "@/components/timepay/logic";

/* ASK FOR LEAVE (rules 51 and 52): your name › Leave › Ask for leave, as a
   dialog over your leave.

   Today's request, field for field: the type, the first and last day off,
   the hours, a note, and a medical certificate when the span wants one.
   The hours stay a number (decision 27); left empty, the span's own
   working days are what get booked, the suggestion its placeholder says,
   counted on your roster with the public holidays in it left out. The line
   under the form says what the span costs: its working days, the holidays
   it skips by name while there are two or fewer, and what you have
   available of that kind.

   The certificate is uploaded before the request exists and adopted when
   it is sent, and it never blocks sending: somebody booking a sick day
   usually hasn't seen a doctor yet. Everything is decided again by
   `requestLeave`: one live booking a day, and no more than you have.
   Sending keeps you on your leave, with a toast whose Undo withdraws the
   request (`cancelLeave`); a withdrawn request stays in your history as
   Cancelled, as one withdrawn from its row does. */

const KINDS = [
  { value: "annual", label: "Annual leave" },
  { value: "personal", label: "Personal or carer's" },
  { value: "unpaid", label: "Unpaid leave" },
] as const;

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
    parts.push(`${plural(b.holidays.length, "public holiday", "public holidays")} skipped${named}`);
  }
  return parts.join(", ");
}

export function LeaveForm({
  today,
  standard,
  balances,
  holidays,
  workDays,
  certAfterDays = null,
  onClose,
}: {
  today: string;
  /** a working day's hours, for the suggestion */
  standard: number;
  balances: BalanceView[];
  holidays: { date: string; name: string }[];
  /** the requester's own roster (Mon=0): suggestions count these days, the
      same days the timesheet will pay */
  workDays?: number[];
  /** the workspace's certificate threshold in working days, or null when it
      never asks (`certificateExpected`) */
  certAfterDays?: number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const host = useContext(WindowsContext);
  const fromId = useId();
  const toId = useId();
  const certInput = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<LeaveKind>("annual");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [cert, setCert] = useState<{ documentId: string; fileName: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const holidayMap = useMemo(() => new Map(holidays.map((h) => [h.date, h.name] as const)), [holidays]);
  const holidaySet = useMemo(() => new Set(holidayMap.keys()), [holidayMap]);
  const suggested = useMemo(
    () => suggestedHours(startDate, endDate, standard, holidaySet, workDays),
    [startDate, endDate, standard, holidaySet, workDays],
  );
  const breakdown = useMemo(() => rangeBreakdown(startDate, endDate, holidayMap, workDays), [startDate, endDate, holidayMap, workDays]);
  const effectiveHours = hours.trim() === "" ? suggested : Number(hours);
  /* Whether THIS span wants a certificate: one rule, shared with the
     approver and the timesheet, counting the working days the line prints. */
  const wantsCert = certificateExpected(kind, breakdown.working, certAfterDays);
  const balance = balances.find((b) => b.kind === kind);

  const setFrom = (iso: string) => {
    setStartDate(iso);
    if (iso && iso > endDate) setEndDate(iso);
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

  const send = async () => {
    if (pending || !(effectiveHours > 0)) return;
    setPending(true);
    setError(null);
    const res = await requestLeave({
      kind,
      startDate,
      endDate,
      hours: effectiveHours,
      note: note.trim() || undefined,
      ...(cert ? { certificateDocumentId: cert.documentId } : {}),
    });
    setPending(false);
    if (!res.ok) return setError(res.error);
    onClose();
    router.refresh();
    const id = res.id;
    host?.toast(
      "Leave requested",
      id
        ? async () => {
            await cancelLeave(id);
            router.refresh();
          }
        : undefined,
    );
  };

  return (
    <Dialog
      heading="Ask for leave"
      width={560}
      onClose={onClose}
      foot={
        <>
          <Button kind="second" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" disabled={pending || uploading || !(effectiveHours > 0)} onClick={() => void send()}>
            {pending ? "Sending the request" : "Send request"}
          </Button>
        </>
      }
    >
      <form
        className="mk-form"
        aria-label="Ask for leave"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="pt-field">
          <span className="pt-field-label">Type</span>
          <Tray ariaLabel="Type" options={KINDS} value={kind} onChange={setKind} />
        </div>
        <div className="mk-team-three">
          <Field label="From" id={fromId}>
            <DateField id={fromId} value={startDate || null} today={today} min={today} onChange={(iso) => setFrom(iso ?? "")} />
          </Field>
          <Field label="To" id={toId}>
            <DateField id={toId} value={endDate || null} today={today} min={startDate} onChange={(iso) => setEndDate(iso ?? "")} />
          </Field>
          {/* The placeholder IS the suggestion: leave it be and the span's
              own working days are what get booked. */}
          <Field label="Hours">
            <TextInput type="number" inputMode="decimal" placeholder={String(suggested)} value={hours} onChange={(e) => setHours(e.target.value)} />
          </Field>
        </div>
        <Field label="Note">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
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
              <Button icon="upload" disabled={uploading || pending} onClick={() => certInput.current?.click()}>
                {uploading ? "Uploading the certificate" : cert ? "Replace certificate" : "Attach certificate"}
              </Button>
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
        <p className="mk-team-line">
          {breakdownLine(breakdown)}
          {kind !== "unpaid" && balance ? `, ${fmt(balance.available)}h available` : ""}.
        </p>
        {error && (
          <p className="mk-team-wrong" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
