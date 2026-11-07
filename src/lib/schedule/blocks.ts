/* BLOCK OUT TIME, the pure half (Isaac, 6 November 2026, "Build it" on
   https://claude.ai/artifact/9BSz3k2q6MYZbb7Ua7PhUL, option B, and the
   phone's New, Block out time).

   A block is a stretch of someone's day that isn't a job: what it is, where,
   and how long. Made in the Schedule's Jobs panel it waits in its own group
   at the top of Jobs, with no one and no day, until it's dragged onto a row
   like a job; made on the phone it goes straight onto a person's day. Placed,
   it is time off on the Schedule like ServiceM8's own staff leave, drawn as
   a booking's card with a clock in its box, and it warns a booking dropped
   over it as time off does: it never refuses one.

   TIME IS THE SCHEDULE'S: minutes past midnight on the business's wall
   clock, and the day as 'YYYY-MM-DD' text. */

import type { ScheduleAway } from "@/lib/workboard/away";

export const BLOCK_WHAT_MAX = 40;
export const BLOCK_WHERE_MAX = 60;
/** How long a block can be, as the Jobs panel offers a booking's length. */
export const BLOCK_LENGTHS_MIN = [30, 60, 90, 120, 180, 240, 360, 480] as const;
const STEP = 15;

/** A block as it is kept: placed, or waiting in Jobs. */
export type ScheduleBlock = {
  id: string;
  what: string;
  where: string | null;
  minutes: number;
  /** placed: all three set; in Jobs: all null */
  staffUuid: string | null;
  day: string | null;
  startMin: number | null;
};

/** A block waiting in the Jobs panel. */
export type PileBlock = { id: string; what: string; where: string | null; minutes: number };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** What and where, as kept: trimmed, the where null when empty. */
export function cleanWords(what: unknown, where: unknown): { what: string; where: string | null } {
  return {
    what: typeof what === "string" ? what.trim().replace(/\s+/g, " ") : "",
    where: typeof where === "string" && where.trim() ? where.trim().replace(/\s+/g, " ") : null,
  };
}

/** Why a block can't be made, in words, or null when it can. */
export function blockWrong(b: { what: string; where: string | null; minutes: number }): string | null {
  if (!b.what) return "Say what it is.";
  if (b.what.length > BLOCK_WHAT_MAX) return `Keep what it is to ${BLOCK_WHAT_MAX} letters.`;
  if (b.where && b.where.length > BLOCK_WHERE_MAX) return `Keep where to ${BLOCK_WHERE_MAX} letters.`;
  if (!Number.isInteger(b.minutes) || b.minutes < STEP || b.minutes > 24 * 60 || b.minutes % STEP !== 0) return "Choose how long it is.";
  return null;
}

/** Why a block can't go on a day at a time, or null when it can: a real
    day, a start on the quarter hour, and an end by midnight. */
export function placeWrong(p: { day: string; startMin: number; minutes: number }): string | null {
  if (!DAY.test(p.day)) return "Choose the day.";
  if (!Number.isInteger(p.startMin) || p.startMin < 0 || p.startMin % STEP !== 0) return "Choose when it starts.";
  if (p.startMin + p.minutes > 24 * 60) return "It has to end by midnight.";
  return null;
}

/** "HH:MM" to minutes past midnight, or null. */
export function minutesOf(t: unknown): number | null {
  const m = typeof t === "string" ? /^(\d{1,2}):(\d{2})$/.exec(t.trim()) : null;
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** The span a placed block covers, as ServiceM8 keeps time off. */
export function blockSpan(b: { day: string; startMin: number; minutes: number }): { start: string; end: string } {
  const end = b.startMin + b.minutes;
  return {
    start: `${b.day} ${HHMM(b.startMin)}:00`,
    /* a block to midnight ends on the day's last second, as ServiceM8 keeps a whole day */
    end: end >= 24 * 60 ? `${b.day} 23:59:59` : `${b.day} ${HHMM(end)}:00`,
  };
}

/** The name it goes to ServiceM8's board under: what, and where. */
export function boardNameOf(b: { what: string; where: string | null }): string {
  return b.where ? `${b.what}, ${b.where}` : b.what;
}

/** Placed blocks as the Schedule's time off. */
export function blocksAsAway(blocks: readonly ScheduleBlock[]): ScheduleAway[] {
  return blocks.flatMap((b) =>
    b.staffUuid && b.day && b.startMin !== null
      ? [{ uuid: `block:${b.id}`, staffUuid: b.staffUuid, name: b.what, where: b.where, blockId: b.id, ...blockSpan({ day: b.day, startMin: b.startMin, minutes: b.minutes }) }]
      : [],
  );
}

const low = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** ServiceM8's time off with the day's blocks laid in. A block that has
    reached ServiceM8 comes back in its mirror as the same person and span:
    that copy says nothing more, and the block is drawn once. */
export function withBlocks(away: readonly ScheduleAway[], blocks: readonly ScheduleAway[]): ScheduleAway[] {
  const ours = new Set(blocks.map((b) => `${low(b.staffUuid)}|${b.start}|${b.end}`));
  return [...away.filter((a) => a.blockId || !ours.has(`${low(a.staffUuid)}|${a.start}|${a.end}`)), ...blocks];
}
