"use client";

import { useContext, useState } from "react";
import { Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { TimeField } from "@/components/parts/time-field";
import { Tick } from "@/components/parts/tick";
import { StateWord } from "@/components/parts/state";
import { DateField } from "@/components/ui/date-field";
import { formatClock } from "@/components/ui/time-wheel";
import { parseClock } from "@/components/timepay/logic";
import { WindowsContext } from "@/components/records/records-context";
import { JobField, type FormJob } from "./job-field";
import { bookInConfirm, bookInFacts, crossesMidnight, useBookIn, type BookInSeed } from "./book-in";
import { takeBackBooking, type VerbView } from "@/app/actions/booking-sm8";
import { BOOKING_LENGTHS_MIN, BOOKING_WORDS, BOOKINGS_PER_PRESS, fmtLength } from "@/lib/integrations/sm8-booking-plan";

/* A JOB'S ADD › VISIT (rules 51, 52 and 54), its Visits section's Book in,
   and Home's To do Book in: one form wherever a visit is booked. It is
   Book in, the job card's panel (two-way phase 3), drawn as a dialog over
   the page you're on: the engine is ./book-in, lifted out of that panel
   unchanged. Who, day, start and how long, a row a booking, up to eight;
   ServiceM8 is read before Book is offered, and what it said follows the
   rows as sentences, an overlap or time off warning in orange and never
   blocking. On a Quote, Make it a Work Order is ticked and goes with Book.

   The job is a field (rule 51), filled in from the door that opened it,
   clearable, and found again by number, client or site, as Search finds
   it. A new job is read afresh: its rows start over.

   The start is the wheel (rule 34) on the quarter hour, the grid ServiceM8
   is booked on (BOOKING_STEP_MIN), so every time it offers books.

   Booking keeps you where you were, with a toast whose Undo takes the
   bookings back out of ServiceM8 (takeBackBooking, the line's own Undo). */

export type VisitJob = FormJob;

/** "Job 3209, Richards Building, North Narrabeen", as Search names a job. */
export const visitJobLabel = (j: { number: string | null; clientName: string | null; suburb: string | null }) =>
  [j.number ? `Job ${j.number}` : "Job", j.clientName, j.suburb].filter(Boolean).join(", ");

const HEADING = "Book a visit";

/** "07:30" on the wheel, "7:30 AM". */
function toWheel(hhmm: string): string {
  const h = Number(hhmm.slice(0, 2));
  const m = Number(hhmm.slice(3, 5));
  return formatClock({ hour: ((h + 11) % 12) + 1, minute: m, meridiem: h < 12 ? "AM" : "PM" });
}

/** The wheel's "7:30 AM" as the engine's "07:30". */
function fromWheel(v: string): string | null {
  const mins = parseClock(v);
  if (mins == null) return null;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

export type VisitFormProps = {
  /** The job, filled in from the door; null asks for one. */
  job: VisitJob | null;
  /** The account's zone as the door last knew it: the day asked about first. */
  zone?: string | null;
  /** A booking to fill the first row from (Look again, Book again). */
  seed?: BookInSeed | null;
  onClose: () => void;
  /** Book went, for this job: the press's lines and the rows it queued. */
  onBooked?: (jobUuid: string, verb: VerbView, rowIds: string[]) => void;
  /** Undo took them back out. */
  onUndone?: (jobUuid: string) => void;
  /** Where the toast goes; the frame's own when the door has none. */
  toast?: (text: string, undo?: () => void | Promise<void>) => void;
};

export function VisitForm({ job, ...rest }: VisitFormProps) {
  const [forJob, setForJob] = useState<VisitJob | null>(job);
  /* the seed is the opening job's booking: a job picked here starts clean */
  const seed = forJob && job && forJob.uuid === job.uuid ? rest.seed : null;
  if (!forJob) return <NoJob onPick={setForJob} onClose={rest.onClose} />;
  return <BookVisit key={forJob.uuid} {...rest} seed={seed} job={forJob} onClear={() => setForJob(null)} />;
}

/** No job yet: the field to find one, and Book waiting on it. */
function NoJob({ onPick, onClose }: { onPick: (j: VisitJob) => void; onClose: () => void }) {
  return (
    <Dialog
      heading={HEADING}
      width={720}
      onClose={onClose}
      foot={
        <>
          <Button kind="second" onClick={onClose}>
            {BOOKING_WORDS.panel.cancel}
          </Button>
          <Button kind="main" disabled>
            Book visit
          </Button>
        </>
      }
    >
      <div className="mk-form">
        <JobField job={null} onChange={(j) => j && onPick(j)} placeholder="Find a job" />
      </div>
    </Dialog>
  );
}

function BookVisit({
  job,
  zone = null,
  seed,
  onClose,
  onBooked,
  onUndone,
  toast,
  onClear,
}: Omit<VisitFormProps, "job"> & { job: VisitJob; onClear: () => void }) {
  const host = useContext(WindowsContext);
  const say = toast ?? host?.toast;
  const b = useBookIn({
    jobUuid: job.uuid,
    zone,
    seed,
    onDone: (verb, rowIds) => {
      onClose();
      onBooked?.(job.uuid, verb, rowIds);
      const n = rowIds.length;
      say?.(n > 1 ? `${n} visits booked` : "Visit booked", async () => {
        for (const rowId of rowIds) {
          const back = await takeBackBooking({ jobUuid: job.uuid, rowId }).catch(() => null);
          if (!back?.ok) {
            say(back?.error ?? BOOKING_WORDS.press.unqueued);
            break;
          }
        }
        onUndone?.(job.uuid);
      });
    },
  });
  const { rows, ctx } = b;
  const many = rows.length > 1;
  const facts = ctx ? bookInFacts(ctx, job.uuid, rows, b.staffName) : null;
  const who = (ctx?.staff ?? []).map((s) => ({ value: s.uuid, label: s.you ? BOOKING_WORDS.panel.you : s.name }));
  const lengths = BOOKING_LENGTHS_MIN.map((m) => ({ value: String(m), label: fmtLength(m) }));

  return (
    <Dialog
      heading={HEADING}
      width={720}
      onClose={onClose}
      foot={
        <>
          <Button kind="second" disabled={b.busy} onClick={onClose}>
            {BOOKING_WORDS.panel.cancel}
          </Button>
          <Button kind="main" disabled={!b.complete || b.busy} aria-busy={b.busy || undefined} onClick={b.book}>
            {b.busy ? (many ? `Booking ${rows.length} visits` : "Booking the visit") : many ? `Book ${rows.length} visits` : "Book visit"}
          </Button>
        </>
      }
    >
      <div className="mk-form">
        <JobField job={job} onChange={(j) => !j && onClear()} />

        <div className="mk-job-visits" role="group" aria-label="Visits">
          <div className="mk-job-visitrow mk-job-visithead" aria-hidden="true">
            <span className="pt-field-label">{BOOKING_WORDS.panel.who}</span>
            <span className="pt-field-label">{BOOKING_WORDS.panel.day}</span>
            <span className="pt-field-label">{BOOKING_WORDS.panel.start}</span>
            <span className="pt-field-label">{BOOKING_WORDS.panel.length}</span>
          </div>
          {rows.map((r, i) => (
            <div className="mk-job-visitrow" key={r.id}>
              <Chooser
                aria-label={BOOKING_WORDS.panel.who}
                options={who}
                value={r.staffUuid || null}
                placeholder={BOOKING_WORDS.panel.pickWho}
                disabled={!ctx}
                onChange={(v) => b.setRow(r.id, { staffUuid: v })}
              />
              <DateField value={r.day || null} onChange={(iso) => b.setRow(r.id, { day: iso ?? "" })} today={ctx?.today} aria-label={BOOKING_WORDS.panel.day} />
              <TimeField
                label={BOOKING_WORDS.panel.start}
                value={toWheel(r.start)}
                step={15}
                onChange={(v) => {
                  const hhmm = fromWheel(v);
                  if (hhmm) b.setRow(r.id, { start: hhmm });
                }}
              />
              <Chooser aria-label={BOOKING_WORDS.panel.length} options={lengths} value={String(r.minutes)} onChange={(v) => b.setRow(r.id, { minutes: Number(v) })} />
              {i > 0 ? (
                <Button kind="quiet" onClick={() => b.removeRow(r.id)}>
                  {BOOKING_WORDS.panel.remove}
                </Button>
              ) : (
                <span />
              )}
              {/* a row that runs past midnight is refused here, before
                  anything is pressed: Book stays off until it ends on its
                  own day */}
              {crossesMidnight(r) && (
                <div className="mk-job-visiterr">
                  <StateWord tone="wrong">{BOOKING_WORDS.press.crossesMidnight}</StateWord>
                </div>
              )}
            </div>
          ))}
          {rows.length < BOOKINGS_PER_PRESS && (
            <div>
              <Button kind="second" icon="plus" onClick={b.addRow}>
                {BOOKING_WORDS.panel.addAnother}
              </Button>
            </div>
          )}
        </div>

        {(!ctx || facts) && (
          <div className="mk-job-facts">
            {!ctx && !b.readErr && <div>{BOOKING_WORDS.panel.checking}</div>}
            {b.readErr && (
              <div className="mk-job-says">
                <StateWord tone="wrong">{b.readErr}</StateWord>
                <Button kind="second" size={32} onClick={b.tryReadAgain}>
                  {BOOKING_WORDS.door.tryAgain}
                </Button>
              </div>
            )}
            {facts?.already && <div>{facts.already}</div>}
            {facts?.days.map((d) => (
              <div key={d.key}>{d.text}</div>
            ))}
            {facts?.clashes.map((c) => (
              <div key={c}>
                <StateWord tone="look">{c}</StateWord>
              </div>
            ))}
            {facts?.zone && <div>{facts.zone}</div>}
          </div>
        )}

        {ctx && b.quote && (
          <div className="mk-job-facts">
            <Tick label={BOOKING_WORDS.panel.makeWorkOrder} checked={b.makeWorkOrder} onChange={b.setMakeWorkOrder} />
            <div>{b.makeWorkOrder ? BOOKING_WORDS.panel.quoteBecomes : BOOKING_WORDS.panel.quoteStays}</div>
          </div>
        )}

        {ctx && (b.complete || ctx.trial || ctx.hold || b.err) && (
          <div className="mk-job-facts">
            {b.complete && <div>{bookInConfirm(rows, b.staffName)}</div>}
            {ctx.trial && <div>{BOOKING_WORDS.panel.trial}</div>}
            {ctx.hold === "paused" && <div>{BOOKING_WORDS.panel.heldPaused}</div>}
            {ctx.hold === "reconnect" && <div>{BOOKING_WORDS.panel.heldReconnect}</div>}
            {b.err && (
              <div className="mk-job-says">
                <StateWord tone="wrong">{b.err.text}</StateWord>
                {b.err.lookAgain && (
                  <Button kind="second" size={32} onClick={b.lookAgain}>
                    {BOOKING_WORDS.door.lookAgain}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
