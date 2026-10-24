"use client";

import { useContext, useState } from "react";
import { Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Chooser, ChooserMany } from "@/components/parts/chooser";
import { Field } from "@/components/parts/field";
import { RangeCalendar, dayWords } from "@/components/parts/range-calendar";
import { TimeField } from "@/components/parts/time-field";
import { Tick } from "@/components/parts/tick";
import { StateWord } from "@/components/parts/state";
import { formatClock } from "@/components/ui/time-wheel";
import { parseClock } from "@/components/timepay/logic";
import { WindowsContext } from "@/components/records/records-context";
import { JobField, type FormJob } from "./job-field";
import { bookInFacts, useBookIn, type BookInSeed } from "./book-in";
import { takeBackBooking, type VerbView } from "@/app/actions/booking-sm8";
import { BOOKING_LENGTHS_MIN, BOOKING_WORDS, fmtLength } from "@/lib/integrations/sm8-booking-plan";
import { andWords, daysWords, lengthRange } from "@/lib/workboard/visit-words";

/* A JOB'S ADD › VISIT (rules 51, 52 and 54), its Visits section's Book a
   visit, and Home's To do Book in: one form wherever a visit is booked. It
   is Book in, the job card's panel (two-way phase 3), drawn as a dialog
   over the page you're on: the engine is ./book-in.

   BOOK A VISIT OVER SEVERAL DAYS (Isaac's mock of 25 October 2026, frame
   4b): who, as one chooser that takes several people; a run of days on
   Leave's calendar (the first press starts it, the second ends it, and a
   Saturday or Sunday inside it is left out unless pressed); the start each
   day and how long. Under them one line says what it comes to, "3 visits,
   Mon 9 to Wed 11 Nov, 7am to 3pm", with the people under it, and Book
   books a booking a person a day. ServiceM8 is read before Book is
   offered, and what it said follows as sentences, an overlap or time off
   warning in orange and never blocking. On a Quote, Make it a Work Order
   is ticked and goes with Book.

   The job is said under the title, as the mock draws it ("Job 2043, JT
   Construct"). Opened with no job, it asks for one first, by number,
   client or site, as Search finds it.

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
  return <BookVisit key={forJob.uuid} {...rest} seed={seed} job={forJob} />;
}

/** No job yet: the field to find one, and Book waiting on it. */
function NoJob({ onPick, onClose }: { onPick: (j: VisitJob) => void; onClose: () => void }) {
  return (
    <Dialog
      heading={HEADING}
      width={560}
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
}: Omit<VisitFormProps, "job"> & { job: VisitJob }) {
  const host = useContext(WindowsContext);
  const say = toast ?? host?.toast;
  const b = useBookIn({
    jobUuid: job.uuid,
    zone,
    seed,
    onDone: (verb, rowIds) => {
      onClose();
      onBooked?.(job.uuid, verb, rowIds);
      const n = new Set(b.rows.map((r) => r.day)).size;
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
  const { ctx, days, people } = b;
  const n = days.length;
  const facts = ctx ? bookInFacts(ctx, job.uuid, b.rows, b.staffName) : null;
  const who = (ctx?.staff ?? []).map((s) => ({ value: s.uuid, label: s.you ? BOOKING_WORDS.panel.you : s.name }));
  const lengths = BOOKING_LENGTHS_MIN.map((m) => ({ value: String(m), label: fmtLength(m) }));
  const names = people.map((u) => b.staffName(u) ?? BOOKING_WORDS.fill.person);
  const today = ctx?.today ?? null;
  const first = days[0] ?? null;
  const last = days[days.length - 1] ?? null;
  /* the step above the months: what the next press does */
  const run = !!b.span.start && !!b.span.end && b.span.end > b.span.start;
  const step = !b.span.start
    ? { lead: "Pick the first day" }
    : run
      ? { lead: daysWords(b.span.start, b.span.end!), rest: "press a day to start again" }
      : { lead: dayWords(b.span.start), rest: "press a later day for a run of days" };

  return (
    <Dialog
      heading={HEADING}
      width={560}
      onClose={onClose}
      foot={
        <>
          <Button kind="second" disabled={b.busy} onClick={onClose}>
            {BOOKING_WORDS.panel.cancel}
          </Button>
          <Button kind="main" disabled={!b.complete || b.busy} aria-busy={b.busy || undefined} onClick={b.book}>
            {b.busy ? (n > 1 ? `Booking ${n} visits` : "Booking the visit") : n > 1 ? `Book ${n} visits` : "Book visit"}
          </Button>
        </>
      }
    >
      <div className="mk-form">
        <p className="jv-dline">{job.label}</p>
        <Field label={BOOKING_WORDS.panel.who}>
          <ChooserMany options={who} value={people} placeholder={BOOKING_WORDS.panel.pickWho} disabled={!ctx} onChange={b.setPeople} />
        </Field>

        {today && (
          <>
            <p className="lv2-ask" aria-live="polite">
              <b>{step.lead}</b>
              {step.rest && <span>, {step.rest}</span>}
            </p>
            <RangeCalendar label="Pick the days" today={today} span={b.span} onPick={b.pick} min={today} also={b.weekends} />
          </>
        )}

        <div className="lv2-fields">
          <Field label="Start, each day">
            <TimeField
              value={toWheel(b.start)}
              step={15}
              onChange={(v) => {
                const hhmm = fromWheel(v);
                if (hhmm) b.setStart(hhmm);
              }}
            />
          </Field>
          <Field label={BOOKING_WORDS.panel.length}>
            <Chooser options={lengths} value={String(b.minutes)} onChange={(v) => b.setMinutes(Number(v))} />
          </Field>
        </div>
        {/* a day that runs past midnight is refused here, before anything
            is pressed: Book stays off until it ends on its own day */}
        {b.late && (
          <div className="mk-job-visiterr">
            <StateWord tone="wrong">{BOOKING_WORDS.press.crossesMidnight}</StateWord>
          </div>
        )}

        {first && last && people.length > 0 && !b.late && (
          <div className="lv2-sum">
            <b>{`${n} ${n === 1 ? "visit" : "visits"}, ${daysWords(first, last)}, ${lengthRange(b.start, b.minutes)}`}</b>
            <span>{n > 1 ? `${andWords(names)} on each.` : `${andWords(names)}.`}</span>
          </div>
        )}
        {b.tooMany && (
          <div className="mk-job-says">
            <StateWord tone="wrong">{BOOKING_WORDS.press.tooMany}</StateWord>
          </div>
        )}

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

        {ctx && (ctx.trial || ctx.hold || b.err) && (
          <div className="mk-job-facts">
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
