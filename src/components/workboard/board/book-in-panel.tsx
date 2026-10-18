"use client";

import { useEffect, useRef } from "react";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { VerbView } from "@/app/actions/booking-sm8";
import {
  BOOKING_WORDS,
  bookingActWord,
  fmtRange,
  fmtTime,
  type BookingAct,
  type BookingState,
} from "@/lib/integrations/sm8-booking-plan";
import { fillWords } from "@/lib/integrations/sm8-note-words";
import { StateLine } from "./state-line";

/* A BOOKING'S LINES ON THE VISITS FACE (two-way phase 3, PR D): each
   booking as a line, where our press of it stands with its doors, and a
   leftover's Clear asked in place. Book in itself is the Visit form now
   (components/making/visit-form, its engine making/book-in), a dialog over
   the page you're on; a line's Look again and Book again open that form.

   Every word is BOOKING_WORDS'. */

/* ── a booking's line on the Visits face ── */

/** Whether any line on the card is on its way: the card polls while one is. */
const WAITING: ReadonlySet<string> = new Set([
  "line.sending",
  "line.waitingWhy",
  "line.takingOut",
  "line.statusSending",
  "line.clearing",
  "line.clearWaiting",
]);

export function bookingsWaiting(verbs: readonly VerbView[] | null, lines: Record<string, BookingState>): boolean {
  const on = (s: BookingState | null | undefined) => !!s?.key && WAITING.has(s.key);
  if (Object.values(lines).some(on)) return true;
  return (verbs ?? []).some((v) => on(v.status?.state) || v.bookings.some((b) => on(b.state)));
}

/** One booking as a line of the list: its day and time, and who. */
export function BookingEntryLine({
  start,
  end,
  name,
  title,
  startOnly = false,
}: {
  start: string;
  end: string | null;
  name: string | null;
  title?: string | null;
  /** A leftover says its start alone ("Tue 6 Oct, 9:00 am"). */
  startOnly?: boolean;
}) {
  const when = !startOnly && end ? fmtRange(start, end) : fmtTime(start);
  return (
    <div className="wb2-mline">
      <b>{`${fmtAuWeekdayDayMonth(start)}, ${when}`}</b>
      <em>
        {name ?? BOOKING_WORDS.fill.person}
        {name && title && <i className="wb2-jcrole">{`, ${title}`}</i>}
      </em>
    </div>
  );
}

/** A line's state in its colour and its doors, each a word (law 25).
    Open in ServiceM8 is a link; Look again and Book again open the Visit
    form, and are left off where it can't open. */
export function BookingStateLine({
  state,
  sm8Url,
  busy,
  canPanel,
  onAct,
}: {
  state: BookingState;
  sm8Url: string | null;
  busy: boolean;
  canPanel: boolean;
  onAct: (act: BookingAct) => void;
}) {
  const acts = state.acts.filter(
    (a) => (a !== "open_in_sm8" || !!sm8Url) && ((a !== "look_again" && a !== "book_again") || canPanel)
  );
  if (!state.text && acts.length === 0) return null;
  return (
    <div className="wb2-jcattsave">
      {state.text && (
        <span className="wb2-evmeta">
          <StateLine as="span" line={{ word: state.text, tone: state.tone }} />
        </span>
      )}
      {acts.map((a) =>
        a === "open_in_sm8" ? (
          <a key={a} className="wb2-evdoor" href={sm8Url ?? undefined} target="_blank" rel="noreferrer">
            {bookingActWord(a)}
          </a>
        ) : (
          <button key={a} type="button" className="wb2-evdoor" disabled={busy} onClick={() => onAct(a)}>
            {bookingActWord(a)}
          </button>
        )
      )}
    </div>
  );
}

/** Clearing a leftover, asked in place: the booking, the job and that it
    can't be put back (DECISIONS 4), with the focus on Keep, so a second
    Enter backs out. */
export function ClearConfirm({
  name,
  start,
  number,
  status,
  busy,
  onClear,
  onKeep,
}: {
  name: string | null;
  start: string;
  number: string | null;
  status: string | null;
  busy: boolean;
  onClear: () => void;
  onKeep: () => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keep.current?.focus();
  }, []);
  const question = fillWords(BOOKING_WORDS.home.clearConfirm, {
    name: name ?? BOOKING_WORDS.fill.person,
    day: fmtAuWeekdayDayMonth(start),
    start: fmtTime(start),
    number,
    status: status ?? BOOKING_WORDS.fill.status,
  });
  /* phrasing all through: it stands in a crew row's line on the Schedule as
     well as on the card. The question is a <small>, not a span, so the
     crew list's own rule for its spans (the time, 14px in ink) never
     reaches it: it keeps the quiet line's dress in both places */
  return (
    <span role="group" aria-label={question}>
      <small className="wb2-evmeta">{question}</small>
      <span className="wb2-jcattsave">
        <button type="button" className="pbtn ghost sm dan" disabled={busy} onClick={onClear}>
          {BOOKING_WORDS.door.clearBooking}
        </button>
        <button type="button" className="pbtn ghost sm" ref={keep} disabled={busy} onClick={onKeep}>
          {BOOKING_WORDS.door.keep}
        </button>
      </span>
    </span>
  );
}

/** A leftover's words: the job is finished in ServiceM8, and the booking is
    still there. */
export function leftoverWords(jobStatus: string | null): string {
  return jobStatus === "Unsuccessful" ? BOOKING_WORDS.line.leftoverUnsuccessful : BOOKING_WORDS.line.leftover;
}
