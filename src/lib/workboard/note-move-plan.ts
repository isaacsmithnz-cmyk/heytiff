import type { ProposedVisit } from "./note-visit";

/* TIFF MOVES A BOOKING (Isaac, 2 November 2026: "Move ... my booking this
   afternoon to Friday, seven AM" booked a second visit on the job the chip
   was on, and the real one stayed put; mock of 10 November 2026,
   https://claude.ai/artifact/GSEAXk33huxmx3LyPhMzL8; "Start at 1 and work
   through", 13 November 2026).

   She finds the booking that was named among the person's own coming
   bookings, never the chip's job just because it's open: the job's number,
   its client's or street's words (a near spelling counts, "Mossman" is
   Mosman), the day said (today, tomorrow, a weekday that isn't the one it's
   going to) and the part of the day. One that fits is asked about, Move the
   visit or Not now; two or three that fit equally are offered to tap, with
   Neither; none, and she says so and does nothing. The visit keeps its
   length; with no time said it keeps its time, on the new day.

   Pure: the bookings come in, the picks and the words go out
   (note-move reads them and presses). */

export type MoveBooking = {
  /** the ServiceM8 job activity */
  activity: string;
  staffUuid: string;
  jobUuid: string;
  number: string;
  client: string;
  /** the street line */
  where: string;
  /** naive local "YYYY-MM-DD HH:MM:SS" */
  start: string;
  end: string | null;
};

export type MoveTo = Pick<ProposedVisit, "day" | "start" | "part">;

/** The answers she offers, and the one that takes a move back. */
export const MOVE_IT = "Move the visit";
export const NOT_NOW = "Not now";
export const NEITHER = "Neither";
export const PUT_BACK = "Put it back";
export const MOVE_LEFT = "Left as it is.";
export const MOVE_NONE = "I can't find a booking of yours coming up to move. Open it on Schedule and change it there.";

/** How many bookings that fit equally are offered. */
export const MOVE_OFFERS = 3;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** words of a client or a street that name nothing on their own */
const STOP = new Set(["the", "and", "pty", "ltd", "limited", "street", "road", "avenue", "crescent", "drive", "place", "lane", "parade", "highway", "close", "court", "unit", "level", "group", "services", "construction", "constructions"]);

const pad = (n: number) => String(n).padStart(2, "0");
const wordsOf = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** One letter in, out or changed, for words of five letters or more. */
function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const dayNum = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;
export const shiftDay = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const minuteOf = (stamp: string) => Number(stamp.slice(11, 13)) * 60 + Number(stamp.slice(14, 16));

/** How well a booking fits what was said: 0 is no sign at all. */
export function moveScore(said: string, b: MoveBooking, opts: { today: string; chipJob: string | null; toDay: string }): number {
  const heard = wordsOf(said);
  const has = (w: string) => heard.includes(w);
  let score = 0;
  if (b.number && has(b.number.toLowerCase())) score += 6;
  const named = [...new Set(wordsOf(`${b.client} ${b.where}`).filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)))];
  score += 3 * Math.min(2, named.filter((w) => heard.some((h) => near(h, w))).length);
  const day = b.start.slice(0, 10);
  if ((has("today") || has("tonight")) && day === opts.today) score += 2;
  if (has("tomorrow") && day === shiftDay(opts.today, 1)) score += 2;
  const toWeekday = opts.toDay ? weekdayOf(opts.toDay) : -1;
  WEEKDAYS.forEach((w, i) => {
    if (i !== toWeekday && has(w) && weekdayOf(day) === i && dayNum(day) - dayNum(opts.today) < 7) score += 2;
  });
  const hour = minuteOf(b.start) / 60;
  if (has("morning") && hour < 12) score += 1;
  if ((has("afternoon") || has("arvo")) && hour >= 12) score += 1;
  if (opts.chipJob && b.jobUuid.toLowerCase() === opts.chipJob.toLowerCase()) score += 1;
  return score;
}

/** The booking, or the few, that what was said names. */
export function pickMoves(said: string, bookings: readonly MoveBooking[], opts: { today: string; chipJob: string | null; toDay: string }): MoveBooking[] {
  const coming = [...bookings].filter((b) => b.start.slice(0, 10) >= opts.today).sort((a, b) => a.start.localeCompare(b.start));
  if (coming.length <= 1) return coming;
  const scored = coming.map((b) => ({ b, s: moveScore(said, b, opts) }));
  const top = Math.max(...scored.map((x) => x.s));
  if (top === 0) return coming.slice(0, MOVE_OFFERS);
  return scored
    .filter((x) => x.s === top)
    .slice(0, MOVE_OFFERS)
    .map((x) => x.b);
}

/** Where it goes: the day said (or its own), the time said (or a part's
    start, or its own), its own length. Null past midnight. */
export function moveSlot(b: MoveBooking, to: MoveTo): { start: string; end: string } | null {
  const day = to.day || b.start.slice(0, 10);
  const from = minuteOf(b.start);
  const length = b.end ? Math.max(15, minuteOf(b.end) - from + (b.end.slice(0, 10) > b.start.slice(0, 10) ? 1440 : 0)) : 60;
  const at = to.start ? Number(to.start.slice(0, 2)) * 60 + Number(to.start.slice(3, 5)) : to.part === "morning" ? 7 * 60 : to.part === "afternoon" ? 12 * 60 : from;
  const until = at + length;
  if (until > 24 * 60 - 1) return null;
  const stamp = (m: number) => `${day} ${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`;
  return { start: stamp(at), end: stamp(until) };
}

const clock = (m: number) => {
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 || 12}:${pad(m % 60)}`;
};
const half = (m: number) => (Math.floor(m / 60) % 24 < 12 ? "am" : "pm");

/** "3:00 to 4:00 pm", "11:30 am to 1:00 pm". */
export function spanWords(start: string, end: string | null): string {
  const a = minuteOf(start);
  if (!end) return `${clock(a)} ${half(a)}`;
  const b = minuteOf(end);
  return half(a) === half(b) ? `${clock(a)} to ${clock(b)} ${half(b)}` : `${clock(a)} ${half(a)} to ${clock(b)} ${half(b)}`;
}

/** "today", "tomorrow", "Fri 14 Nov". */
export function dayWords(day: string, today: string): string {
  if (day === today) return "today";
  if (day === shiftDay(today, 1)) return "tomorrow";
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "3488, Raglan St, today 3:00 to 4:00 pm": a booking as a button says it. */
export function bookingWords(b: MoveBooking, today: string): string {
  return [b.number, b.where || b.client, `${dayWords(b.start.slice(0, 10), today)} ${spanWords(b.start, b.end)}`].filter(Boolean).join(", ");
}

/** "Move 3488, Raglan St, today 3:00 to 4:00 pm, to Fri 14 Nov 7:00 to 8:00 am?" */
export function moveQuestion(b: MoveBooking, slot: { start: string; end: string }, today: string, whose: string | null): string {
  const to = `${dayWords(slot.start.slice(0, 10), today)} ${spanWords(slot.start, slot.end)}`;
  return `Move ${whose ? `${whose}'s ` : ""}${bookingWords(b, today)}, to ${to}?`;
}

/** "Which visit, to Fri 14 Nov 7:00 am?": two or three that fit. */
export function whichQuestion(to: MoveTo, today: string): string {
  const when = [to.day ? dayWords(to.day, today) : "", to.start ? spanWords(`0000-00-00 ${to.start}:00`, null) : ""].filter(Boolean).join(" ");
  return when ? `Which visit, to ${when}?` : "Which visit?";
}

/** What's kept on the note while she asks: each booking she offered, where
    it would go, and the person it's for. */
export type MoveAsk = {
  offers: { label: string; booking: MoveBooking; slot: { start: string; end: string } }[];
  /** the person moved, when it isn't the speaker: they're told */
  tell: boolean;
  /** once moved: the change that puts it back */
  undo?: unknown;
};

/** A stored move ask, read back and checked. */
export function moveAskOf(proposal: unknown): MoveAsk | null {
  const raw = proposal && typeof proposal === "object" ? (proposal as Record<string, unknown>).moveAsk : null;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const offers = Array.isArray(r.offers)
    ? r.offers.flatMap((o) => {
        const x = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
        const b = (x.booking && typeof x.booking === "object" ? x.booking : null) as MoveBooking | null;
        const s = (x.slot && typeof x.slot === "object" ? x.slot : null) as { start: string; end: string } | null;
        return typeof x.label === "string" && b && typeof b.activity === "string" && s && typeof s.start === "string" && typeof s.end === "string" ? [{ label: x.label, booking: b, slot: s }] : [];
      })
    : [];
  if (!offers.length && !r.undo) return null;
  return { offers, tell: r.tell === true, ...(r.undo ? { undo: r.undo } : {}) };
}

/** Which offer an answer picks: Move the visit picks the one; a label its own. Null for Not now, Neither, or words that pick nothing. */
export function pickedOffer(ask: MoveAsk, answer: string): MoveAsk["offers"][number] | null {
  const a = answer.trim().toLowerCase();
  if (!a || a === NOT_NOW.toLowerCase() || a === NEITHER.toLowerCase()) return null;
  if (ask.offers.length === 1 && (a === MOVE_IT.toLowerCase() || /^(yes|yep|yeah|ok|okay|do it|move it)\b/.test(a))) return ask.offers[0]!;
  return ask.offers.find((o) => o.label.toLowerCase() === a) ?? null;
}
