/* Time off on the day — the pure half (leave to ServiceM8, part two).

   ServiceM8's Availability records, mirrored in sm8_availability: a
   person's leave, and the days the business is shut. Read off the live
   account on 2026-09-28, there are three types:

     staff-annual-leave   regarding a staff member: SICK, Holidays, TAFE,
                          CAR SERVICE, MICK GOLF — the `name` is the only
                          thing that says which
     public-holiday       regarding the account itself
     business-closed      regarding the account itself

   BLOCKED-OUT TIME, NEVER LEAVE. There is no sick type and no ledger behind
   these; a row says a person (or the business) is not available from one
   stamp to another, in the business's own word. Nothing here reads one back
   into HeyTiff as leave, and nothing here counts one as a kind of leave.

   TIME IS TEXT, as everywhere on the diary: the account's wall clock,
   'YYYY-MM-DD HH:MM:SS', compared as strings and read by slicing. A whole
   day is 00:00:00 to 23:59:59; a part day carries real times.

   A WARNING, NEVER A REFUSAL. The Book in panel says when a booking lands on
   someone's time off; it never stops the booking. The office may well know
   the golf is off. */

/** ServiceM8's types, verbatim. */
export const AVAILABILITY_TYPES = {
  staff: "staff-annual-leave",
  holiday: "public-holiday",
  closed: "business-closed",
} as const;

/** One mirror row, as the query hands it over: active rows only. */
export type AvailabilityRow = {
  uuid: string;
  regardingObject: string | null;
  regardingUuid: string | null;
  name: string | null;
  type: string | null;
  start: string | null;
  end: string | null;
};

/** A person's time off that touches the day. */
export type ScheduleAway = {
  uuid: string;
  staffUuid: string;
  /** What the business typed, trimmed; null where it typed nothing. */
  name: string | null;
  start: string;
  end: string;
};

/** The business shut for the day, or part of it. */
export type ScheduleClosed = {
  uuid: string;
  kind: "holiday" | "closed";
  name: string | null;
  start: string;
  end: string;
};

const STAMP = /^\d{4}-\d{2}-\d{2} (\d{2}):(\d{2}):\d{2}$/;
const DAY_MIN = 24 * 60;

/** The day after `dayISO`, as text. The one Date here reads a DAY, never
    a time, so no zone can move it. */
function nextDay(dayISO: string): string {
  const d = new Date(`${dayISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const low = (u: string | null | undefined) => (u ?? "").trim().toLowerCase();

/** Whether [start, end) touches [from, to). An end exactly on `from` does
    not: time off that ends at midnight is the day before's. */
export function overlaps(a: { start: string; end: string }, from: string, to: string): boolean {
  return a.start < to && a.end > from;
}

/** The rows that touch the day, sorted into people's time off and the
    business's own. A row with no readable span is left out — it can't be
    placed, and a guess is worse than nothing. A row about staff with no
    person named is left out too: it is nobody's lane. */
export function availabilityOnDay(
  rows: readonly AvailabilityRow[],
  dayISO: string
): { away: ScheduleAway[]; closed: ScheduleClosed[] } {
  const from = `${dayISO} 00:00:00`;
  const to = `${nextDay(dayISO)} 00:00:00`;
  const away: ScheduleAway[] = [];
  const closed: ScheduleClosed[] = [];
  for (const r of rows) {
    if (!r.start || !r.end || !STAMP.test(r.start) || !STAMP.test(r.end) || r.end <= r.start) continue;
    if (!overlaps({ start: r.start, end: r.end }, from, to)) continue;
    const name = r.name?.trim() || null;
    if (r.regardingObject === "staff") {
      if (!r.regardingUuid) continue;
      away.push({ uuid: r.uuid, staffUuid: r.regardingUuid, name, start: r.start, end: r.end });
    } else if (r.regardingObject === "vendor") {
      closed.push({
        uuid: r.uuid,
        kind: r.type === AVAILABILITY_TYPES.holiday ? "holiday" : "closed",
        name,
        start: r.start,
        end: r.end,
      });
    }
  }
  const byStart = (x: { start: string; uuid: string }, y: { start: string; uuid: string }) =>
    x.start.localeCompare(y.start) || x.uuid.localeCompare(y.uuid);
  return { away: away.sort(byStart), closed: closed.sort(byStart) };
}

/** Where time off sits on one day, in minutes past midnight: clipped to the
    day, so leave that began last week starts at 0 and leave that runs on
    ends at 1440. A stamp of 23:59 is the end of the day ServiceM8 writes for
    a whole one, and reads as 1440. */
export function awaySpanOnDay(
  a: { start: string; end: string },
  dayISO: string
): { startMin: number; endMin: number; whole: boolean } {
  const minutes = (stamp: string) => {
    const m = STAMP.exec(stamp);
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  };
  const startMin = a.start.slice(0, 10) < dayISO ? 0 : minutes(a.start);
  const endRaw = a.end.slice(0, 10) > dayISO ? DAY_MIN : minutes(a.end);
  const endMin = endRaw >= DAY_MIN - 1 ? DAY_MIN : Math.max(endRaw, startMin + 1);
  return { startMin, endMin, whole: startMin === 0 && endMin === DAY_MIN };
}

/** The word time off goes by: what the business typed, as typed. */
export function awayWord(a: { name: string | null }): string {
  return a.name ?? AWAY_WORDS.unnamed;
}

/** A person's time off that overlaps a slot (both 'YYYY-MM-DD HH:MM:SS'),
    by their ServiceM8 uuid in any case. */
export function awayInSlot<T extends { staffUuid: string; start: string; end: string }>(
  away: readonly T[],
  staffUuid: string,
  slot: { start: string; end: string }
): T[] {
  return away.filter((a) => low(a.staffUuid) === low(staffUuid) && overlaps(a, slot.start, slot.end));
}

/** The business's closures that overlap a slot. */
export function closedInSlot<T extends { start: string; end: string }>(
  closed: readonly T[],
  slot: { start: string; end: string }
): T[] {
  return closed.filter((c) => overlaps(c, slot.start, slot.end));
}

export const AWAY_WORDS = {
  /** Time off the business gave no name. */
  unnamed: "Time off",
  holiday: "Public holiday",
  closed: "Closed",
  /** The name column of a lane with nothing but time off. */
  allDay: "Off all day",
  partDay: "Off {start}–{end}",
};

/** "Public holiday" or "Closed": what a closure is, as a label. */
export function closedLabel(c: { kind: "holiday" | "closed" }): string {
  return c.kind === "holiday" ? AWAY_WORDS.holiday : AWAY_WORDS.closed;
}
