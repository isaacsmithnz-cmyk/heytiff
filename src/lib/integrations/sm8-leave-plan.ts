/* Leave on the ServiceM8 board — the decisions, pure (leave to ServiceM8).

   Approved leave in HeyTiff goes onto the person's day on ServiceM8's
   dispatch board as ServiceM8's own staff leave: an Availability record
   (availability.json), the thing ServiceM8's "Add staff leave" makes. Read
   off the live account on 2026-09-28, every one of the business's own
   entries has this shape, and these are the only values HeyTiff sends:

     regarding_object       "staff"
     regarding_object_uuid  the person's ServiceM8 staff uuid
     availability_type      "staff-annual-leave" — ServiceM8's one kind of
                            staff leave; sick days typed by hand use it too
     name                   "Sick leave" or "Leave" (LEAVE_WORDS.board)
     start_timestamp        the first day, "YYYY-MM-DD 00:00:00"
     end_timestamp          the last day,  "YYYY-MM-DD 23:59:59"
     uuid                   ours, chosen when the row was queued

   Whole days, always: HeyTiff's leave is a span of days, and a whole day
   on the board is exactly how the business keys one in (00:00:00 to
   23:59:59, on its own wall clock). The dates are the account's wall
   clock as text and are never converted: a day is a day.

   ONE ROW PER THING (sm8_writes' dedupe_key):
     leave:<leave_requests.id>       the approved request, once
     dayoff:<staff_unavailability.id> a casual's day off, once
     remove:<the create row's id>    taking either off the board, once
   Leave is approved once and cancelled once (a decision is final), and a
   day off is a new row each time it goes up, so nothing here is ever
   released for a second go under the same subject. */

import { LEAVE_WORDS } from "./sm8-leave-words";

export { LEAVE_WORDS };

/** ServiceM8's one kind of staff leave. */
export const LEAVE_AVAILABILITY_TYPE = "staff-annual-leave";

/** What an availability is about: a staff member. */
export const LEAVE_REGARDING = "staff";

/** The longest span a leave request may be (validSpan in actions/leave). */
export const LEAVE_MAX_DAYS = 366;

/** A leave stamp as it goes: the wall clock, to the second. */
export const LEAVE_STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** Where a leave row comes from: a request, or a casual's day off. */
export type LeaveSource = "leave" | "dayoff";

export const leaveSubject = {
  leave: (requestId: string) => `leave:${requestId}`,
  dayOff: (blockId: string) => `dayoff:${blockId}`,
  remove: (createRowId: string) => `remove:${createRowId}`,
};

export type ParsedLeaveSubject =
  | { via: "leave"; id: string }
  | { via: "dayoff"; id: string }
  | { via: "remove"; createRowId: string };

export function parseLeaveSubject(s: string): ParsedLeaveSubject | null {
  const m = /^(leave|dayoff|remove):(\S+)$/.exec(s);
  if (!m) return null;
  if (m[1] === "remove") return { via: "remove", createRowId: m[2] };
  return { via: m[1] as LeaveSource, id: m[2] };
}

/** The name leave goes onto the board under. Personal leave is sick leave
    on the board (Isaac, 2026-09-28); every other kind, and a day off, is
    Leave. */
export function boardName(kind: string | null | undefined): string {
  return kind === "personal" ? LEAVE_WORDS.board.sick : LEAVE_WORDS.board.leave;
}

/** A real calendar day, "YYYY-MM-DD": 31 February is refused, not rolled
    on. */
export function realDay(day: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** The board's span for leave from `from` to `to`, both days inclusive:
    the first day's start and the last day's end, as ServiceM8 keeps a
    whole day. Null for a day that isn't one, a span that ends before it
    starts, or one longer than LEAVE_MAX_DAYS. */
export function leaveSpan(from: string, to: string): { start: string; end: string } | null {
  if (!realDay(from) || !realDay(to) || to < from) return null;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days > LEAVE_MAX_DAYS) return null;
  return { start: `${from} 00:00:00`, end: `${to} 23:59:59` };
}

/** The request body an availability goes with: exactly these seven fields,
    and never `active`, `source` or anything else. */
export function availabilityBody(a: { uuid: string; staffUuid: string; name: string; start: string; end: string }) {
  return {
    uuid: a.uuid,
    regarding_object: LEAVE_REGARDING,
    regarding_object_uuid: a.staffUuid,
    name: a.name,
    availability_type: LEAVE_AVAILABILITY_TYPE,
    start_timestamp: a.start,
    end_timestamp: a.end,
  };
}

/** An availability as HeyTiff reads it live. */
export type Sm8LiveAvailability = {
  uuid: string;
  regardingUuid: string | null;
  name: string | null;
  type: string | null;
  start: string | null;
  end: string | null;
  active: number | null;
  editDate: string | null;
};

const same = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether a record read back is the leave a row sent: the person and the
    span. The name is the business's to change on the board; a different
    one is still this leave. */
export function isTheLeave(
  a: Pick<Sm8LiveAvailability, "regardingUuid" | "start" | "end">,
  row: { leave_staff_uuid?: string | null; leave_start?: string | null; leave_end?: string | null }
): boolean {
  return same(a.regardingUuid, row.leave_staff_uuid) && a.start === (row.leave_start ?? null) && a.end === (row.leave_end ?? null);
}
