import { BOOKING_LENGTHS_MIN, BOOKING_STEP_MIN, fmtRange, fmtTime, slotOf } from "@/lib/integrations/sm8-booking-plan";

/* A VISIT FROM A JOB'S CONVERSATION — pure, on both sides of the wire.

   v2 step 6, slice B. "…and book commissioning for Friday arvo" said in a
   job's conversation books a visit. The router reads it into the `visits`
   lane (note-brain); this file holds what a visit is, what Tiff asks when
   it has no clear time, and what the conversation shows once it is made.

   DECISION 13 (6-revisions.md): in a job's conversation notes, tasks and
   costs just happen; a visit with no clear time is asked first. So a visit
   with a day and a clock time books at once, through Book in's own gate
   (note-visit-book), and one with only "Friday arvo" asks "which time?",
   offering the crew's free starts that day and "Another time". The
   question is the note's own (`clarify` and a Tiff turn), the same one
   "Who should do this?" uses; an answer is a reply, and a tap is a reply
   in the words its button showed.

   TIME IS THE ACCOUNT'S WALL CLOCK, as text, as Book in keeps it: a day
   "YYYY-MM-DD" and a start "HH:MM" on its 15-minute grid. */

/** The part of a day a visit was asked for, when no clock time was said. */
export const VISIT_PARTS = ["morning", "afternoon", "day"] as const;
export type VisitPart = (typeof VISIT_PARTS)[number];
export const isVisitPart = (v: unknown): v is VisitPart => (VISIT_PARTS as readonly unknown[]).includes(v);

/** At most this many visits come off one note. */
export const VISITS_MAX = 3;

/** A visit nobody said the length of is Book in's default length. */
export const VISIT_MINUTES = 120;

/** "Arvo" starts after lunch, as the router's own vague-time table has it
    (note-brain's whenBlock: "afternoon, this arvo, after lunch -> 13:00");
    the morning ends at noon. */
const NOON = 12 * 60;
const AFTER_LUNCH = 13 * 60;

/** The answer that asks for a time instead of taking one offered. */
export const ANOTHER_TIME = "Another time";

/** How many of the crew's free starts a question offers, before "Another
    time": three tap answers in all. */
export const FREE_STARTS = 2;

export type ProposedVisit = {
  /** What they'll do there, in the record's language: "commissioning". */
  work: string;
  /** Resolved staff_profile id, or null when nobody could be matched. */
  assigneeId: string | null;
  /** The person as the note said them. */
  assigneeHint: string;
  /** "YYYY-MM-DD", or "" when no day was said. */
  day: string;
  /** "HH:MM" on the 15-minute grid when a clock time was said, else "". */
  start: string;
  /** The part of the day asked for, read only when there is no start. */
  part: VisitPart;
  /** The length said, one of Book in's lengths; 0 when none was said. */
  minutes: number;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const minOf = (t: string): number | null => {
  const m = HHMM.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** A day as the model wrote it: a real "YYYY-MM-DD", or "". */
export const visitDay = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  /* a real calendar day: 31 February is none (Book in's own test) */
  return ISO_DAY.test(s) && slotOf(s, "00:00", BOOKING_STEP_MIN) ? s : "";
};

/** A start as the model wrote it, on Book in's grid: "14:10" is "14:15",
    and anything that is not a 24-hour clock is no start at all. */
export const visitStart = (v: unknown): string => {
  const m = minOf(typeof v === "string" ? v.trim() : "");
  if (m === null) return "";
  const on = Math.round(m / BOOKING_STEP_MIN) * BOOKING_STEP_MIN;
  return on >= 24 * 60 ? "" : hhmm(on);
};

/** A length as the model wrote it: the nearest length Book in offers, or
    0 when none was said (or it isn't a number). */
export const visitMinutes = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return 0;
  return BOOKING_LENGTHS_MIN.reduce((best, m) => (Math.abs(m - v) < Math.abs(best - v) ? m : best), BOOKING_LENGTHS_MIN[0] as number);
};

/** How long a visit books for. */
export const lengthOf = (v: Pick<ProposedVisit, "minutes">): number => v.minutes || VISIT_MINUTES;

/** Whether a visit can be booked as it stands: a day and a clock time. */
export const clearTime = (v: Pick<ProposedVisit, "day" | "start">): boolean => !!v.day && !!v.start;

/** "Commissioning", from "commissioning". */
export const workTitle = (work: string): string => {
  const w = work.trim();
  return w ? w[0]!.toUpperCase() + w.slice(1) : "Visit";
};

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const weekday = (day: string) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "long" }).format(new Date(`${day}T00:00:00Z`));

/** "Friday 16 October". */
export function longDay(day: string): string {
  if (!ISO_DAY.test(day)) return "";
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })
    .format(new Date(`${day}T00:00:00Z`))
    .replace(",", "");
}

/** The day as it is said in a sentence: "today", "tomorrow", "Friday" in
    the week ahead, "Friday 23 October" past it. "" for no day. */
export function dayWord(day: string, today: string): string {
  if (!ISO_DAY.test(day)) return "";
  const n = ISO_DAY.test(today) ? daysBetween(today, day) : -1;
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n > 1 && n < 7) return weekday(day);
  return longDay(day);
}

/** "on Friday", "today", "tomorrow", "on Friday 23 October". */
const onDay = (day: string, today: string): string => {
  const w = dayWord(day, today);
  return w === "today" || w === "tomorrow" || !w ? w : `on ${w}`;
};

/* ── the crew's free starts ──────────────────────────────────────────── */

/** A booking or time off, as the account's wall clock has it. */
export type BusySpan = { start: string | null; end: string | null };

/** Minutes into `day` a stamp falls ("YYYY-MM-DD HH:MM:SS"): before the
    day is 0, after it a whole day. Null for a stamp that isn't one. */
function minuteIn(day: string, stamp: string | null): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec((stamp ?? "").trim());
  if (!m) return null;
  if (m[1]! < day) return 0;
  if (m[1]! > day) return 24 * 60;
  return Number(m[2]) * 60 + Number(m[3]);
}

const upToGrid = (min: number) => Math.ceil(min / BOOKING_STEP_MIN) * BOOKING_STEP_MIN;

/** The window a part of the day means, on this person's working day. */
export function windowOf(part: VisitPart, dayStart: string, dayEnd: string): { from: number; to: number } {
  const start = minOf(dayStart) ?? 7 * 60;
  const end = minOf(dayEnd) ?? 15 * 60;
  if (part === "morning") return { from: start, to: Math.max(start, NOON) };
  if (part === "afternoon") return { from: Math.max(start, AFTER_LUNCH), to: end };
  return { from: start, to: end };
}

/** THE STARTS A PERSON IS FREE AT, that part of that day: each a whole
    visit long inside their working day, clear of everything they already
    have on (bookings, time off, the business shut), after now when the day
    is today, and not overlapping one another — so "2:00 pm" and "3:30 pm"
    for a 90-minute visit. The first `limit` of them, earliest first. */
export function freeStarts(input: {
  day: string;
  part: VisitPart;
  minutes: number;
  dayStart: string;
  dayEnd: string;
  busy: readonly BusySpan[];
  /** Now on the account's clock, "YYYY-MM-DD HH:MM:SS", or null. */
  now: string | null;
  limit?: number;
}): string[] {
  const { day, part, minutes } = input;
  const limit = input.limit ?? FREE_STARTS;
  if (!ISO_DAY.test(day) || minutes <= 0) return [];
  const { from, to } = windowOf(part, input.dayStart, input.dayEnd);
  const spans = input.busy
    .map((b) => ({ a: minuteIn(day, b.start), b: minuteIn(day, b.end) }))
    .filter((s): s is { a: number; b: number } => s.a !== null && s.b !== null && s.b > s.a);
  const nowMin = input.now?.startsWith(day) ? minuteIn(day, input.now) : input.now && input.now.slice(0, 10) > day ? 24 * 60 : null;
  const out: string[] = [];
  let t = upToGrid(Math.max(from, nowMin !== null ? nowMin + 1 : 0));
  while (out.length < limit && t + minutes <= to && t + minutes < 24 * 60) {
    const clash = spans.find((s) => s.a < t + minutes && s.b > t);
    if (clash) {
      t = upToGrid(clash.b);
      continue;
    }
    if (slotOf(day, hhmm(t), minutes)) out.push(hhmm(t));
    t += minutes;
  }
  return out;
}

/* ── the question, and an answer to it ───────────────────────────────── */

/** "Commissioning on Friday: which time? Lyle's free at both." The answers
    are the free starts as Book in's panel writes a time, and "Another
    time". `read` false: the person's day couldn't be read, so nothing is
    claimed about it. */
export function visitQuestion(input: {
  work: string;
  day: string;
  today: string;
  name: string;
  part: VisitPart;
  starts: readonly string[];
  read: boolean;
}): { question: string; options: string[] } {
  const head = `${workTitle(input.work)} ${onDay(input.day, input.today)}`.trim();
  const ask = `${head}: which time?`;
  const name = input.name.trim() || "They";
  const when = input.part === "day" ? "day" : input.part;
  const free = !input.read
    ? ""
    : input.starts.length >= 2
      ? ` ${name}'s free at ${input.starts.length === 2 ? "both" : "each"}.`
      : input.starts.length === 1
        ? ` ${name}'s free at ${fmtTime(input.starts[0]!)}.`
        : ` ${name} has nothing free that ${when}.`;
  return { question: `${ask}${free}`, options: [...input.starts.map(fmtTime), ANOTHER_TIME] };
}

/** "Which day and time?" — a visit with no day has no starts to offer. */
export function visitDayQuestion(work: string): { question: string; options: string[] } {
  return { question: `${workTitle(work)}: which day and time?`, options: [] };
}

/** What time an answer names, "HH:MM" on the grid, or null: a tapped
    "2:00 pm", or typed "2pm", "2.30", "14:30". A bare hour from 1 to 6 is
    the afternoon, as a tradesperson says "at two". Off the 15-minute grid
    is no time: Book in couldn't take it. */
export function startFromWords(words: string): string | null {
  const m = /^\s*(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*$/i.exec(words);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const half = m[3]?.toLowerCase().replace(/\./g, "");
  if (min > 59 || min % BOOKING_STEP_MIN !== 0) return null;
  if (half) {
    if (h < 1 || h > 12) return null;
    if (half === "pm" && h !== 12) h += 12;
    if (half === "am" && h === 12) h = 0;
  } else if (!m[2] || h < 13) {
    if (h > 23) return null;
    if (h >= 1 && h <= 6) h += 12;
  }
  return h > 23 ? null : hhmm(h * 60 + min);
}

/* ── what a visit became ─────────────────────────────────────────────── */

/** How a visit was made:
      booked    through Book in, to ServiceM8;
      trial     through Book in while sending is a trial run: queued and
                checked, nothing went;
      heytiff   bookings don't go to ServiceM8 here (or the person isn't
                linked to anyone in it), so it is a task at that time for
                the person, in HeyTiff only;
      task      the speaker may not book (or there is no job to book on),
                so it is a task for them: "Book commissioning Friday". */
export const VISIT_HOWS = ["booked", "trial", "heytiff", "task"] as const;
export type VisitHow = (typeof VISIT_HOWS)[number];

/** A visit a note made, as `workboard_notes.applied.visits` records it:
    enough to draw its card and for Undo to take it back. */
export type VisitMade = {
  /** Its place in the stored proposal's `visits`. */
  index: number;
  how: VisitHow;
  work: string;
  /** The person going (the speaker, for a `task`). */
  staffId: string | null;
  /** Their first name, as the card says it. */
  name: string;
  day: string;
  start: string;
  minutes: number;
  /** The ServiceM8 job it is booked on. */
  jobUuid: string | null;
  /** Book in's rows (`sm8_writes`), what Undo takes back. */
  rowIds: string[];
  /** The task it is, for `heytiff` and `task`. */
  taskId: string | null;
  /** Taken back by its own Undo. */
  undone: boolean;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The column's `visits`, shaped: anything that is not one we wrote is
    dropped. */
export function visitsOf(raw: unknown): VisitMade[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x): VisitMade[] => {
    if (!x || typeof x !== "object") return [];
    const r = x as Record<string, unknown>;
    if (!Number.isInteger(r.index) || !(VISIT_HOWS as readonly unknown[]).includes(r.how)) return [];
    return [
      {
        index: r.index as number,
        how: r.how as VisitHow,
        work: str(r.work),
        staffId: str(r.staffId) || null,
        name: str(r.name),
        day: str(r.day),
        start: str(r.start),
        minutes: typeof r.minutes === "number" ? r.minutes : 0,
        jobUuid: str(r.jobUuid) || null,
        rowIds: Array.isArray(r.rowIds) ? r.rowIds.filter((s): s is string => typeof s === "string" && !!s) : [],
        taskId: str(r.taskId) || null,
        undone: r.undone === true,
      },
    ];
  });
}

/** The title a visit's task wears when the speaker can't book it:
    "Book commissioning Friday". */
export function bookTaskTitle(v: Pick<ProposedVisit, "work" | "day">, today: string): string {
  const day = dayWord(v.day, today);
  return ["Book", v.work.trim() || "the visit", day].filter(Boolean).join(" ");
}

/** "Lyle, Friday afternoon, 2 h": what that task says about the visit. */
export function bookTaskDetail(v: ProposedVisit, name: string, today: string): string {
  const day = dayWord(v.day, today);
  const when = v.start ? fmtTime(v.start) : v.part === "day" ? "" : v.part;
  const length = v.minutes ? `${v.minutes % 60 === 0 ? `${v.minutes / 60} h` : `${v.minutes} min`}` : "";
  return [name, [day, when].filter(Boolean).join(" "), length].filter(Boolean).join(", ");
}

/** The card the conversation draws for a visit made. */
export type VisitCard = {
  index: number;
  how: VisitHow;
  /** "Commissioning"; "Book commissioning Friday" for a `task`. */
  title: string;
  /** "Lyle, Friday 16 October, 2:00 to 4:00 pm". */
  line: string;
  /** Said under it where it isn't a plain booking. */
  aside: string;
  /** Its own Undo is offered. */
  undo: boolean;
};

export const VISIT_ASIDE = {
  trial: "Trial run. Nothing went to ServiceM8.",
  heytiff: "In HeyTiff only.",
} as const;

/** The cards, one per visit still standing, in the order they were said. */
export function visitCards(made: readonly VisitMade[], today: string): VisitCard[] {
  return made
    .filter((v) => !v.undone)
    .sort((a, b) => a.index - b.index)
    .map((v) => {
      const range = v.start ? fmtRange(`${v.day} ${v.start}:00`, endOf(v)) : "";
      const line = [v.name, longDay(v.day), range].filter(Boolean).join(", ");
      return {
        index: v.index,
        how: v.how,
        title: v.how === "task" ? bookTaskTitle(v, today) : workTitle(v.work),
        line,
        aside: v.how === "trial" ? VISIT_ASIDE.trial : v.how === "heytiff" ? VISIT_ASIDE.heytiff : "",
        undo: v.rowIds.length > 0 || !!v.taskId,
      };
    });
}

/** A visit's end on the wall clock, "YYYY-MM-DD HH:MM:SS". */
export function endOf(v: Pick<VisitMade, "day" | "start" | "minutes">): string {
  return slotOf(v.day, v.start, v.minutes || VISIT_MINUTES)?.end ?? "";
}

/* ── what Tiff says ──────────────────────────────────────────────────── */

/** Her line for a visit made, in the record's language like her other
    server lines ("Who should do this: …?"). Her own `say` is the line that
    follows the speaker's language. */
export function visitDoneLine(v: VisitMade, why: VisitWhy | null, today: string): string {
  const card = visitCards([{ ...v, undone: false }], today)[0]!;
  switch (v.how) {
    case "booked":
      return `Booked: ${card.title.toLowerCase()}, ${card.line}.`;
    case "trial":
      return `Booked: ${card.title.toLowerCase()}, ${card.line}. ${VISIT_ASIDE.trial}`;
    case "heytiff":
      return `${card.title} is in HeyTiff only: ${card.line}. ${why === "not_linked" ? `${v.name || "They"} isn't linked to anyone in ServiceM8.` : "Bookings don't go to ServiceM8 here."}`;
    case "task":
      return `${why === "no_job" ? "A visit needs a ServiceM8 job" : "You can't book visits"}, so I've made it a task: ${card.title}.`;
  }
}

/** Why a visit went the way it did, where that is worth saying. */
export type VisitWhy = "off" | "not_linked" | "no_right" | "no_job";

/** Her line when Book in refused it: its own words. */
export const visitRefusedLine = (work: string, error: string): string =>
  `${workTitle(work)} wasn't booked. ${error.trim()}`;

/** Her line when its own Undo took it back. */
export const visitUndoneLine = (v: Pick<VisitMade, "work" | "how">): string =>
  v.how === "booked" || v.how === "trial" ? `${workTitle(v.work)} booking taken back.` : `${workTitle(v.work)} taken back.`;

/** Her line when an answer names no time she can book. */
export const WHAT_TIME = "What time? Say it like 2:30 pm.";
