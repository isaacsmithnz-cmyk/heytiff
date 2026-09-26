/* THE CALENDAR'S READER — server only.

   One line typed into the Calendar's box and sorted, or said to its Tiff
   button, read into what goes on the calendar: a title, a day, a time, a
   place, who it is for, whether it is a shutdown, and whether it repeats
   ("the first Thursday of the month"). The model READS; it never counts. A
   repeat comes back as a rule and ./repeat counts its dates, so "every first
   Thursday" lands on the same eleven days whatever the model thinks August
   holds.

   THE SAME CALL AS THE NOTE ROUTER'S (lib/workboard/note-brain), at LOW
   effort, as the other small readings are (note-english, job-summary): the
   judgement is shallow — a title, a day, a time — and the maths is not the
   model's. `output_config.format` guarantees the shape; `shapeLine` decides
   what is true: a day that is not a day, a time that is not a time, a repeat
   ./repeat cannot count, all become nothing rather than a guess.

   NOTHING HERE WRITES. The action (app/actions/calendar `fileCalendarLine`)
   puts the rows in. Never throws: a failed read keeps the words, which the
   modal files as said. */

import Anthropic from "@anthropic-ai/sdk";
import { RECORD_IN_ENGLISH } from "@/lib/lang/policy";
import { dayName, toDay } from "./days";
import { WHICH_DAY, type CalendarLine } from "./line";
import { readRepeatRule } from "./repeat";

const MODEL = "claude-opus-5";
/* Thinking shares this budget with the answer, which is a dozen short fields. */
const MAX_TOKENS = 8_000;

const str = { type: "string" } as const;

/** Exported for the test that pins what reaches the model. Structured outputs
    take no optional fields, so nothing is "" and never missing. */
export const LINE_SCHEMA = {
  type: "object",
  properties: {
    title: str,
    title_in_sentence: str,
    kind: { type: "string", enum: ["event", "shutdown"] },
    day: str,
    last_day: str,
    time: str,
    end_time: str,
    repeat: { type: "string", enum: ["none", "week", "fortnight", "month"] },
    repeat_day: { type: "string", enum: ["", "mon", "tue", "wed", "thu", "fri", "sat", "sun"] },
    repeat_nth: { type: "string", enum: ["", "first", "second", "third", "fourth", "last"] },
    where: str,
    who: str,
  },
  required: [
    "title",
    "title_in_sentence",
    "kind",
    "day",
    "last_day",
    "time",
    "end_time",
    "repeat",
    "repeat_day",
    "repeat_nth",
    "where",
    "who",
  ],
  additionalProperties: false,
} as const;

/** What the reader knows besides the words: the day, and where the calendar ends. */
export type LineContext = { today: string; windowEnd: string };

/** What the reader is told it is. Pure, so the words are pinned without a call. */
export function linePrompt(ctx: LineContext): string {
  const today = toDay(ctx.today);
  const weekday = Number.isNaN(today) ? "" : `${FULL_DAY[dayName(today)]} `;
  return [
    "You read one line someone typed or said into the company calendar of an",
    "Australian HVAC business, and say what goes on the calendar. The line was",
    "typed quickly or spoken aloud, so expect fragments and transcription slips.",
    "",
    RECORD_IN_ENGLISH,
    "",
    `Today is ${weekday}${ctx.today}. Resolve relative days against it: tomorrow,`,
    "Monday, next Friday, the 8th, 3 Oct. A weekday on its own is the next one",
    `to come. The calendar runs to ${ctx.windowEnd}.`,
    "",
    "- title: what the thing is, in sentence case, the way a calendar shows it:",
    "  'Toolbox talk', 'Daikin VRV training', 'Christmas party'. No day, time,",
    "  place or repeat in it.",
    "- title_in_sentence: the same title as it reads in the middle of a",
    "  sentence: 'toolbox talk', 'Daikin VRV training', 'Christmas party'.",
    "  Lower-case only the words that are not names.",
    "- kind: 'shutdown' when the business is closed for it (a shutdown, the",
    "  Christmas break, closed for the day); otherwise 'event'.",
    "- day: the day it happens, or the first day of something that runs over",
    "  several days, as YYYY-MM-DD. For a repeat, the day it starts from only",
    "  when the line says ('from November'). Leave it empty when the line",
    "  names no day you can work out; never invent one.",
    "- last_day: the last day of something that runs over several days, as",
    "  YYYY-MM-DD; otherwise empty.",
    "- time and end_time: 24-hour HH:MM when the line says a time. A time",
    "  without am or pm is a working day's: 6:45 is 06:45, 3:30 is 15:30.",
    "  Empty otherwise. A shutdown has none.",
    "- repeat: 'week' (every Tuesday), 'fortnight' (every second Tuesday),",
    "  'month' (the first Thursday of the month, the last Friday of the",
    "  month), or 'none'. Only a repeat the line says.",
    "- repeat_day: the weekday it repeats on, 'mon' to 'sun'; '' when it does",
    "  not repeat.",
    "- repeat_nth: for a monthly repeat, which one in the month: 'first',",
    "  'second', 'third', 'fourth' or 'last'; '' otherwise.",
    "- where: the place, when the line names one ('the yard'); otherwise ''.",
    "- who: who it is for, when the line says ('everyone', 'the installers');",
    "  otherwise ''.",
  ].join("\n");
}

const FULL_DAY: Record<string, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

/** What the reader is sent: the line, and each answer to "Which day?". */
export function lineContent(text: string, answers: readonly string[] = []): string {
  const parts = [`Line:\n${text.trim()}`];
  for (const a of answers) parts.push(`You asked: ${WHICH_DAY}\nThey answered: ${a.trim()}`);
  if (answers.length) parts.push("Read the line again with what they answered.");
  return parts.join("\n\n");
}

/* ── the shaping ── */

/** The table's ceilings (docs/migrations/calendar_events.sql). */
const TITLE_MAX = 120;
const WHERE_MAX = 120;
const WHO_MAX = 80;

const text = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max).trim() : "";

const isoDay = (v: unknown): string | null => {
  const s = text(v, 10);
  return s && !Number.isNaN(toDay(s)) ? s : null;
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const clock = (v: unknown): string | null => {
  const s = text(v, 5);
  return HHMM.test(s) ? s : null;
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** What the model said, made true or made nothing. Null when there is no
    title: a line with nothing to call the event is not one. Pure. */
export function shapeLine(raw: unknown): CalendarLine | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = text(o.title, TITLE_MAX);
  if (!title) return null;
  const inSentence = text(o.title_in_sentence, TITLE_MAX);
  const kind = o.kind === "shutdown" ? "shutdown" : "event";
  const day = isoDay(o.day);
  const last = isoDay(o.last_day);
  const repeat = kind === "event" && o.repeat !== "none"
    ? readRepeatRule({ every: o.repeat, day: o.repeat_day, nth: o.repeat_nth })
    : null;
  /* A shutdown closes the day and has no hours (the table refuses them); an
     end needs a start and must come after it. A repeat is one day at a time. */
  const time = kind === "shutdown" ? null : clock(o.time);
  const end = time ? clock(o.end_time) : null;
  return {
    title,
    /* The same words, only their capitals may differ. */
    titleInSentence: inSentence && norm(inSentence) === norm(title) ? inSentence : title,
    kind,
    day,
    lastDay: !repeat && day && last && last > day ? last : null,
    time,
    endTime: end && end > time! ? end : null,
    repeat,
    where: text(o.where, WHERE_MAX) || null,
    who: text(o.who, WHO_MAX) || null,
  };
}

/* ── the call ── */

export type LineRead = { ok: true; line: CalendarLine } | { ok: false; error: string };

const NO_KEY = "Sorting for the calendar isn't switched on yet.";
const FAILED = "That line couldn't be read just now.";

function reasonFor(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return NO_KEY;
  if (err instanceof Anthropic.RateLimitError) return "Too busy right now.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the reader.";
  return FAILED;
}

/** Read one line, with each answer to "Which day?" since. Never throws. */
export async function readCalendarLine(
  line: string,
  ctx: LineContext,
  answers: readonly string[] = [],
): Promise<LineRead> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: NO_KEY };
  const said = line.trim();
  if (!said) return { ok: false, error: "There was nothing in that line." };

  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: LINE_SCHEMA },
      },
      system: linePrompt(ctx),
      messages: [{ role: "user", content: lineContent(said, answers) }],
    });
    /* A refusal is a content outcome: the words are kept, nothing is filed. */
    if (response.stop_reason === "refusal") return { ok: false, error: FAILED };
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return { ok: false, error: FAILED };
    const shaped = shapeLine(JSON.parse(block.text));
    return shaped ? { ok: true, line: shaped } : { ok: false, error: FAILED };
  } catch (err) {
    return { ok: false, error: reasonFor(err) };
  }
}
