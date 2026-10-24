import { dayWords, weekdayIndex } from "@/components/parts/range-calendar";

/* A VISIT IN WORDS, as the job page's Visits and Book a visit say it
   (Isaac's mock of 25 October 2026): "7am to 3pm", "Thu 5 Nov, 7am to
   3pm", "3 visits, Mon 9 to Wed 11 Nov". Every time is the account's wall
   clock as text ("HH:MM", or a naive "YYYY-MM-DD HH:MM:SS" stamp), never a
   Date, so nothing here reads a clock or a zone. Pure. */

const CLOCK = /(?:^|\s)(\d{2}):(\d{2})(?::\d{2})?$/;

/** "7am", "7:30am", "12pm", from "07:00" or a stamp; "" for anything else. */
export function clockWord(t: string | null | undefined): string {
  const hit = CLOCK.exec((t ?? "").trim());
  if (!hit) return "";
  const h = Number(hit[1]);
  if (h > 23) return "";
  const m = hit[2] === "00" ? "" : `:${hit[2]}`;
  return `${h % 12 === 0 ? 12 : h % 12}${m}${h < 12 ? "am" : "pm"}`;
}

/** "7am to 3pm" for a start and end on one day; the start alone without one. */
export function rangeWords(start: string, end: string | null | undefined): string {
  const a = clockWord(start);
  const b = end && end.slice(0, 10) === start.slice(0, 10) ? clockWord(end) : "";
  return b ? `${a} to ${b}` : a;
}

/** "07:00" and 480 minutes as "7am to 3pm"; the start alone past midnight. */
export function lengthRange(hhmm: string, minutes: number): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return "";
  const to = Number(m[1]) * 60 + Number(m[2]) + minutes;
  if (to >= 24 * 60) return clockWord(hhmm);
  return `${clockWord(hhmm)} to ${clockWord(`${String(Math.floor(to / 60)).padStart(2, "0")}:${String(to % 60).padStart(2, "0")}`)}`;
}

/** A booking's date block: "Thu", "5", "Nov". */
export function dateBlock(day: string): { weekday: string; date: string; month: string } {
  const [weekday = "", date = "", month = ""] = dayWords(day.slice(0, 10)).split(" ");
  return { weekday, date, month };
}

/** "Mon 9 to Wed 11 Nov", "Fri 30 Oct to Tue 3 Nov", or one day's "Thu 5 Nov". */
export function daysWords(first: string, last: string): string {
  if (last <= first) return dayWords(first);
  const a = dateBlock(first);
  const b = dayWords(last);
  return a.month === dateBlock(last).month && first.slice(0, 4) === last.slice(0, 4) ? `${a.weekday} ${a.date} to ${b}` : `${dayWords(first)} to ${b}`;
}

/** "Louis Jones", "Louis Jones and Leonardo Martins", "A, B and C". */
export function andWords(words: readonly string[]): string {
  return words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** A run of days to book: every Monday to Friday from its first day to its
    last, and a Saturday or Sunday only when it was pressed (its first or
    last day, or one pressed inside the run). */
export function runDays(first: string | null, last: string | null, weekends: readonly string[]): string[] {
  if (!first) return [];
  const end = last && last > first ? last : first;
  const out: string[] = [];
  for (let t = utc(first); t <= utc(end); t += DAY_MS) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (weekdayIndex(d) < 5 || d === first || d === end || weekends.includes(d)) out.push(d);
  }
  return out;
}
