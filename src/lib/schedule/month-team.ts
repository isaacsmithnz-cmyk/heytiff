/* THE MONTH'S TEAM (Isaac, 24 October 2026: "You can have team as a section
   or a filter. On the calendar, that would show staff days off, holidays.
   Public holidays. And events"; "the event gets put in the calendar"). One
   day of the month as the Team filter says it: the public holiday by name,
   who's off and why in the business's own words (part days with their
   hours), and the events on it. Pure: the page query reads the rows. */

import { awaySpanOnDay, type ScheduleAway, type ScheduleClosed } from "@/lib/workboard/away";
import type { CalendarEventRow, NoticeEventRow } from "@/lib/calendar/items";
import { WORK_END, WORK_START, clockWord } from "./board";

export type TeamOff = {
  staffUuid: string;
  name: string;
  /** What the business typed ("Holidays", "TAFE"); null where it typed nothing. */
  why: string | null;
  /** A part day's hours, "7 to 9"; null for the whole day. */
  part: string | null;
  /** Minutes of the working day it takes. */
  minutes: number;
};

export type TeamEvent = { id: string; title: string; when: string | null; where: string | null };

export type TeamDay = {
  dayISO: string;
  /** The public holiday's name, or "Closed" for another shut day; null when open. */
  holiday: string | null;
  off: TeamOff[];
  events: TeamEvent[];
};

const HHMM = /^(\d{1,2}):(\d{2})/;
/** "07:00" or "07:00:00" → "7 am"; anything else, nothing. */
export function timeWord(t: string | null | undefined): string | null {
  const m = HHMM.exec(t ?? "");
  return m ? clockWord(Number(m[1]) * 60 + Number(m[2]), true) : null;
}

export function teamDay(input: {
  dayISO: string;
  away: readonly ScheduleAway[];
  closed: readonly ScheduleClosed[];
  /** ServiceM8 staff uuid (lower case) → the person's name */
  names: ReadonlyMap<string, string>;
  events: readonly CalendarEventRow[];
  notices: readonly NoticeEventRow[];
}): TeamDay {
  const { dayISO } = input;
  const shut = input.closed[0];
  const holiday = shut ? (shut.kind === "holiday" ? shut.name || "Public holiday" : shut.name || "Closed") : null;

  /* a person once a day: the whole day wins over a part of it, then the
     first said (ServiceM8 holds "HOLIDAYS" and "HOLIDAY" twice for one day) */
  const byStaff = new Map<string, TeamOff>();
  for (const a of input.away) {
    const key = a.staffUuid.toLowerCase();
    const span = awaySpanOnDay(a, dayISO);
    const from = Math.max(span.startMin, WORK_START);
    const to = Math.min(span.endMin, WORK_END);
    const minutes = span.whole ? WORK_END - WORK_START : Math.max(0, to - from);
    const off: TeamOff = {
      staffUuid: a.staffUuid,
      name: input.names.get(key) ?? "Someone",
      why: a.name,
      part: span.whole ? null : `${clockWord(span.startMin)} to ${clockWord(span.endMin)}`,
      minutes,
    };
    const had = byStaff.get(key);
    if (!had || (had.part && !off.part)) byStaff.set(key, off);
  }
  const off = [...byStaff.values()].sort((a, b) => Number(!!a.part) - Number(!!b.part) || a.name.localeCompare(b.name));

  const events: TeamEvent[] = [
    ...input.events
      .filter((e) => e.startsOn <= dayISO && e.endsOn >= dayISO)
      .map((e) => ({ id: `event:${e.id}`, title: e.title, when: e.startsOn === dayISO ? timeWord(e.startsAt) : null, where: e.location })),
    ...input.notices.filter((n) => n.date === dayISO).map((n) => ({ id: `notice:${n.id}`, title: n.title, when: timeWord(n.time), where: n.location })),
  ];
  return { dayISO, holiday, off, events };
}
