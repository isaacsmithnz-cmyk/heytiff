import { fmtRange, fmtTime } from "@/lib/integrations/sm8-booking-plan";
import { dayWord, isVisitPart, visitDay, visitStart, type VisitPart } from "./note-visit";

/* MOVING A BOOKING FROM TIFF — pure, on both sides of the wire.

   Isaac, 2 November 2026, his first test: "Move Lisa and Mossman, uh, my
   booking this afternoon to Friday, seven AM" booked a SECOND visit on the
   job the chip was on, and the real one, 6/40 Raglan St, Mosman, stayed put.
   The mock (https://claude.ai/artifact/GSEAXk33huxmx3LyPhMzL8, 10 November)
   and its calls:

   - she finds the booking he NAMES, among the bookings of the person whose
     it is (his own when he names nobody), never the chip's job;
   - one that fits: "Move ... from today 3:00 to 4:00 pm to Friday 7:00 to
     8:00 am?" with Move the visit / Not now; two or three that fit: each one
     to tap, and Neither; none: she says so and does nothing;
   - the visit keeps its length; only the named person's booking moves, even
     on a visit shared with others;
   - the move is the phone Schedule's own change of time (schedule-change's
     {do:"time"}: the new booking in first, then the old one off), with its
     gates, its refusals, and its Tell for someone else's booking;
   - Moved, with Undo; no new visit and no job note.

   TIME IS THE ACCOUNT'S WALL CLOCK, as text, as ServiceM8's mirror keeps
   it: "YYYY-MM-DD HH:MM:SS". */

export type ProposedMove = {
  /** Whose booking: their staff_profile id, or null for the speaker's own. */
  whoId: string | null;
  /** The person as the note said them, "" when nobody was named. */
  whoHint: string;
  /** How they named the booking: "Lisa in Mosman", "my 3pm". */
  words: string;
  /** The day it's on now, "YYYY-MM-DD", or "" when not said. */
  fromDay: string;
  /** Its start now, "HH:MM", or "" when not said. */
  fromStart: string;
  /** The part of the day it's in now, when no start was said. */
  fromPart: VisitPart;
  /** The day it goes to, or "" for the same day. */
  toDay: string;
  /** The start it goes to, or "" for the same start. */
  toStart: string;
};

/** At most this many moves come off one note. */
export const MOVES_MAX = 2;

/** At most this many bookings are offered to tap. */
export const MOVE_PICKS = 3;

/** One of the person's coming bookings, as the finder reads it. */
export type MoveBooking = {
  uuid: string;
  jobUuid: string;
  staffUuid: string;
  /** "Lisa", the person it's for */
  staffName: string;
  start: string;
  end: string;
  /** "6/40 Raglan St, Mosman", or "" */
  place: string;
  /** The job's number, client and address words, to match "Mosman" or "Lisa" against. */
  match: string;
};

/** The answers. */
export const MOVE_IT = "Move the visit";
export const NOT_NOW = "Not now";
export const NEITHER = "Neither";

const STAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/;
const pad = (n: number) => String(n).padStart(2, "0");

/** A move as the model wrote it, held to the visit lane's own grid. */
export function moveFields(row: Record<string, unknown>): Omit<ProposedMove, "whoId"> | null {
  const s = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const toDay = visitDay(row.to_day ?? row.toDay);
  const toStart = visitStart(row.to_start ?? row.toStart);
  /* somewhere to go, or there's nothing to move it to */
  if (!toDay && !toStart) return null;
  const fromPart = row.from_part ?? row.fromPart;
  return {
    whoHint: s(row.who_hint ?? row.whoHint),
    words: s(row.booking ?? row.words),
    fromDay: visitDay(row.from_day ?? row.fromDay),
    fromStart: visitStart(row.from_start ?? row.fromStart),
    fromPart: isVisitPart(fromPart) ? fromPart : "day",
    toDay,
    toStart,
  };
}

/** A stored move, read back. */
export function movesOfProposal(raw: unknown): ProposedMove[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((m) => {
    if (!m || typeof m !== "object") return [];
    const r = m as Record<string, unknown>;
    const f = moveFields(r);
    return f ? [{ ...f, whoId: typeof r.whoId === "string" && r.whoId ? r.whoId : null }] : [];
  });
}

/* ── which booking ───────────────────────────────────────────────────── */

/* Words that say WHEN or WHAT, never WHICH: a booking isn't told apart by
   "my booking this afternoon". */
const NOT_WHICH = new Set([
  "move", "moving", "my", "his", "her", "their", "the", "this", "that", "booking", "bookings", "visit", "visits", "job",
  "one", "today", "tomorrow", "tonight", "morning", "afternoon", "arvo", "evening", "next", "week", "monday", "tuesday",
  "wednesday", "thursday", "friday", "saturday", "sunday", "and", "with", "from", "for", "at", "in", "on", "to", "am", "pm",
]);

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !NOT_WHICH.has(w) && !/^\d{1,2}(?:am|pm)?$/.test(w));

const minuteOf = (stamp: string): number | null => {
  const m = STAMP.exec(stamp);
  return m ? Number(m[2]) * 60 + Number(m[3]) : null;
};
const dayOf = (stamp: string) => STAMP.exec(stamp)?.[1] ?? "";

/** How alike two spellings are: Mossman is Mosman. */
function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let slips = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++slips > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return slips + (a.length - i) + (b.length - j) <= 1;
}

/** The bookings that fit what was said, soonest first. The day and start,
    when said, must match; then the words that name a place, a client or a
    job number pick among what's left. Nothing said to tell them apart, and
    more than a handful: none, rather than a guess. */
export function bookingsThatFit(m: Pick<ProposedMove, "words" | "fromDay" | "fromStart" | "fromPart">, bookings: readonly MoveBooking[]): MoveBooking[] {
  let fit = [...bookings].sort((a, b) => a.start.localeCompare(b.start));
  if (m.fromDay) fit = fit.filter((b) => dayOf(b.start) === m.fromDay);
  if (m.fromStart) {
    const [h, mm] = m.fromStart.split(":").map(Number);
    const at = h! * 60 + mm!;
    /* "my 3pm" is 3 pm, or 3 in the morning said loosely: the clock decides */
    fit = fit.filter((b) => {
      const s = minuteOf(b.start);
      return s === at || (at < 12 * 60 && s === at + 12 * 60);
    });
  } else if (m.fromPart !== "day") {
    fit = fit.filter((b) => {
      const s = minuteOf(b.start) ?? 0;
      return m.fromPart === "morning" ? s < 12 * 60 : s >= 12 * 60;
    });
  }
  const said = wordsOf(m.words);
  if (said.length) {
    const scored = fit.map((b) => {
      const there = wordsOf(b.match);
      return { b, n: said.filter((w) => there.some((t) => near(w, t))).length };
    });
    const best = Math.max(0, ...scored.map((s) => s.n));
    if (best > 0) fit = scored.filter((s) => s.n === best).map((s) => s.b);
  }
  const told = !!(m.fromDay || m.fromStart || m.fromPart !== "day" || said.length);
  if (!told && fit.length > 1) return [];
  return fit;
}

/** Where it goes: the day and start said, the same length. Null when that's
    where it is already. */
export function moveTo(b: Pick<MoveBooking, "start" | "end">, m: Pick<ProposedMove, "toDay" | "toStart">): { start: string; end: string } | null {
  const s = STAMP.exec(b.start);
  const e = STAMP.exec(b.end);
  if (!s || !e) return null;
  const day = m.toDay || s[1]!;
  const at = m.toStart || `${s[2]}:${s[3]}`;
  const length = Math.max(15, Math.round((Date.parse(`${e[1]}T${e[2]}:${e[3]}:00Z`) - Date.parse(`${s[1]}T${s[2]}:${s[3]}:00Z`)) / 60_000));
  const startMs = Date.parse(`${day}T${at}:00Z`);
  if (!Number.isFinite(startMs)) return null;
  const end = new Date(startMs + length * 60_000);
  const stamp = (d: Date) => `${d.toISOString().slice(0, 10)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
  const start = `${day} ${at}:00`;
  if (start === `${s[1]} ${s[2]}:${s[3]}:00`) return null;
  return { start, end: stamp(end) };
}

/* ── what she says ───────────────────────────────────────────────────── */

/** "today 3:00 to 4:00 pm", "Friday 7:00 to 8:00 am". */
export function whenWords(start: string, end: string, today: string): string {
  const day = dayWord(dayOf(start), today);
  const range = dayOf(start) === dayOf(end) ? fmtRange(start, end) : fmtTime(start);
  return [day, range].filter(Boolean).join(" ");
}

/** "your visit at 6/40 Raglan St, Mosman", "Lisa's visit at …" */
function whose(b: MoveBooking, mine: boolean): string {
  const at = b.place ? ` at ${b.place}` : "";
  return mine ? `your visit${at}` : b.staffName ? `${b.staffName}'s visit${at}` : `the visit${at}`;
}

/** The one that fits, asked: "Move your visit at 6/40 Raglan St, Mosman
    from today 3:00 to 4:00 pm to Friday 7:00 to 8:00 am?" */
export function moveQuestion(b: MoveBooking, to: { start: string; end: string }, mine: boolean, today: string): string {
  return `Move ${whose(b, mine)} from ${whenWords(b.start, b.end, today)} to ${whenWords(to.start, to.end, today)}?`;
}

/** Two or three fit: "Which one goes to Friday 7:00 to 8:00 am?" */
export function whichQuestion(to: { start: string; end: string } | null, today: string, n: number): string {
  /* the start alone: each keeps its own length */
  const at = to ? [dayWord(dayOf(to.start), today), fmtTime(to.start)].filter(Boolean).join(" ") : "";
  return at ? `Which one goes to ${at}? ${n === 2 ? "Two" : "Three"} fit.` : "Which one?";
}

/** A booking to tap: "Today 3:00 to 4:00 pm, 6/40 Raglan St, Mosman". */
export function bookingLabel(b: MoveBooking, today: string): string {
  const w = whenWords(b.start, b.end, today);
  return [w ? w[0]!.toUpperCase() + w.slice(1) : "", b.place].filter(Boolean).join(", ");
}

/** None fits. */
export function noneFitLine(m: Pick<ProposedMove, "words">, mine: boolean, name: string): string {
  const whoseOnes = mine ? "your bookings" : name ? `${name}'s bookings` : "their bookings";
  const said = m.words.trim();
  return said
    ? `I couldn't find "${said}" in ${whoseOnes} for the next fortnight, so nothing's moved. Say its day or time, or open it on Schedule.`
    : `I couldn't tell which of ${whoseOnes} you meant, so nothing's moved. Say its day or time, or open it on Schedule.`;
}

/** Moved: "Moved. Your visit at 6/40 Raglan St, Mosman is Friday 7:00 to 8:00 am now." */
export function movedLine(b: MoveBooking, to: { start: string; end: string }, mine: boolean, today: string, waiting: boolean): string {
  const w = whose(b, mine);
  return `${waiting ? "Moving it." : "Moved."} ${w[0]!.toUpperCase() + w.slice(1)} is ${whenWords(to.start, to.end, today)} now${waiting ? ", once ServiceM8 has it" : ""}.`;
}

export const LEFT_LINE = "Left where it is.";

/** The answer to a move asked, from the words or the button: an option, or
    a plain yes when one booking is asked about, or a plain no. */
export function moveAnswer(ask: MoveAsk, words: string): MoveAsk["options"][number] | null {
  const w = words.trim().toLowerCase().replace(/[.!]+$/, "");
  const hit = ask.options.find((o) => o.label.toLowerCase() === w);
  if (hit) return hit;
  if (/^(?:no|nope|nah|not now|neither|leave it|don'?t|cancel|stop)\b/.test(w)) return { label: words, booking: null, to: null };
  const moving = ask.options.filter((o) => o.booking && o.to);
  if (moving.length === 1 && /^(?:yes|yep|yeah|yup|ok|okay|sure|do it|move it|go|please)\b/.test(w)) return moving[0]!;
  return null;
}

/** A self-reference, not a name: "me", "my". */
export const isSelf = (hint: string) => /^(?:me|my|mine|myself|i|i'm|im)$/i.test(hint.trim());

/* ── what's waiting, and what was moved ──────────────────────────────── */

/** A move asked about, kept on the note's proposal until it's answered. */
export type MoveAsk = {
  index: number;
  question: string;
  /** The answers offered, each with the booking it moves and where to. */
  options: { label: string; booking: MoveBooking | null; to: { start: string; end: string } | null }[];
};

export function moveAskOf(raw: unknown): MoveAsk | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const a = r.moveAsk as Record<string, unknown> | undefined;
  if (!a || typeof a !== "object" || !Number.isInteger(a.index) || !Array.isArray(a.options)) return null;
  const options = a.options.flatMap((o) => {
    if (!o || typeof o !== "object") return [];
    const x = o as Record<string, unknown>;
    if (typeof x.label !== "string") return [];
    const b = x.booking as MoveBooking | null;
    const to = x.to as { start: string; end: string } | null;
    const okBooking = !!b && typeof b.uuid === "string" && typeof b.start === "string" && typeof b.end === "string";
    const okTo = !!to && typeof to.start === "string" && typeof to.end === "string";
    return [{ label: x.label, booking: okBooking ? b : null, to: okTo ? to : null }];
  });
  return { index: a.index as number, question: typeof a.question === "string" ? a.question : "Which one?", options };
}

/** A booking Tiff moved, on the note's record, with what puts it back. */
export type MoveMade = {
  index: number;
  /** The booking as it was, and where it went */
  from: { uuid: string; start: string; end: string };
  to: { start: string; end: string };
  /** The schedule change that puts it back (schedule-change's Undo), when ServiceM8 said where the new one went */
  undo: { do: "time"; activity: string; start: string; end: string } | null;
  line: string;
  undone: boolean;
};

export function movesMadeOf(raw: unknown): MoveMade[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((m) => {
    if (!m || typeof m !== "object") return [];
    const r = m as Record<string, unknown>;
    const from = r.from as MoveMade["from"] | undefined;
    const to = r.to as MoveMade["to"] | undefined;
    if (!Number.isInteger(r.index) || !from || typeof from.uuid !== "string" || !to || typeof to.start !== "string") return [];
    const u = r.undo as Record<string, unknown> | null | undefined;
    const undo =
      u && u.do === "time" && typeof u.activity === "string" && u.activity && typeof u.start === "string" && typeof u.end === "string"
        ? { do: "time" as const, activity: u.activity, start: u.start, end: u.end }
        : null;
    return [{ index: r.index as number, from, to, undo, line: typeof r.line === "string" ? r.line : "", undone: r.undone === true }];
  });
}

/** Its moves still standing that Undo can put back. */
export const movedBack = (made: readonly MoveMade[]): MoveMade[] => made.filter((m) => !m.undone && !!m.undo);
