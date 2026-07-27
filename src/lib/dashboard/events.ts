import { daysUntil, fmtAuWeekdayDateLong } from "@/lib/au-dates";
import { daysDuration } from "@/lib/format/duration";
import { tallyPoll, type PollResult } from "./polls";

/* Events on the noticeboard, and who's coming.

   AN RSVP IS A POLL WITH THE ANSWERS ALREADY WRITTEN. Going / Maybe / Can't —
   one answer each, changeable, and everyone can see who said what. Rather than
   build a second voting mechanism, this shapes the RSVPs into the poll's own
   result type, so the board renders both through one component and the sharing,
   ordering and "who picked this" rules are decided in exactly one place. That
   is the only direction the dependency runs: polls knows nothing about events.

   THE TIME IS LOCAL, DELIBERATELY. An event at 7am is at 7am — a plain date
   plus "HH:MM", never a timestamptz. The moment belongs to the yard, and
   round-tripping it through UTC only creates a way for a phone in another
   state to show the wrong hour. */

export type RsvpAnswer = "yes" | "maybe" | "no";

/* Order matters: this is the order the answers appear, and "Going" first is
   the question the poster is actually asking. */
export const RSVP_ANSWERS: readonly RsvpAnswer[] = ["yes", "maybe", "no"];

export const RSVP_LABEL: Record<RsvpAnswer, string> = {
  yes: "Going",
  maybe: "Maybe",
  no: "Can't make it",
};

/** Narrow an untrusted answer, or null if it isn't one. Unlike a notice kind
    there is no sensible default — an unreadable RSVP is simply no RSVP. */
export function asRsvpAnswer(value: unknown): RsvpAnswer | null {
  return RSVP_ANSWERS.includes(value as RsvpAnswer) ? (value as RsvpAnswer) : null;
}

export type RsvpRow = {
  staffId: string;
  staffName: string;
  answer: RsvpAnswer;
};

export type EventDetail = {
  /** ISO yyyy-mm-dd. An event always has one. */
  date: string;
  /** "HH:MM" in 24h, or null for an all-day / time-to-be-confirmed event. */
  time: string | null;
  location: string | null;
  /** The RSVPs, in the poll's own shape so one component renders both. */
  rsvp: PollResult;
};

/** RSVPs as a poll result: three fixed answers, one pick each. */
export function tallyRsvp(rows: readonly RsvpRow[], viewerStaffId: string | null): PollResult {
  return tallyPoll({
    options: RSVP_ANSWERS.map((a, i) => ({ id: a, label: RSVP_LABEL[a], position: i })),
    votes: rows.map((r) => ({ optionId: r.answer, staffId: r.staffId, staffName: r.staffName })),
    multi: false,
    viewerStaffId,
  });
}

/* The one-line headcount — "3 going · 1 maybe". Silent about the answers
   nobody gave, because "0 maybe" is noise, and silent entirely until somebody
   has replied. */
export function rsvpSummary(rsvp: PollResult): string | null {
  const count = (id: RsvpAnswer) => rsvp.options.find((o) => o.id === id)?.votes ?? 0;
  const parts: string[] = [];
  if (count("yes") > 0) parts.push(`${count("yes")} going`);
  if (count("maybe") > 0) parts.push(`${count("maybe")} maybe`);
  if (count("no") > 0) parts.push(`${count("no")} can't`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export type EventWhen = {
  /** "Friday 25 July" */
  day: string;
  /** "7:00am", or null when no time was set. */
  time: string | null;
  /** "Today" / "Tomorrow" / "In 3 days", or null when it's further off or past. */
  soon: string | null;
  /** True once the day has been and gone. */
  past: boolean;
};

/** How an event's date and time read on the board. */
export function eventWhen(date: string, time: string | null, today: string): EventWhen {
  const days = daysUntil(date, today);
  return {
    day: fmtAuWeekdayDateLong(date),
    time: fmtTime(time),
    /* Today and Tomorrow keep their capitals — they're the whole phrase here,
       not a quantity. Anything else borrows the shared adaptive wording, so a
       date on the board counts down in the same words as one on a chip. */
    soon:
      days === 0
        ? "Today"
        : days === 1
          ? "Tomorrow"
          : days > 1 && days <= 7
            ? `In ${daysDuration(days).label}`
            : null,
    past: days < 0,
  };
}

/** "07:00" → "7:00am". Null in, null out. */
export function fmtTime(time: string | null): string | null {
  if (!time) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const suffix = h < 12 ? "am" : "pm";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m[2]}${suffix}`;
}

/** True when a typed time is one we can store — the DB has the same CHECK. */
export function isEventTime(time: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(time);
}
