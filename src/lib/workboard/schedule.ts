/* The Schedule tab's pure half — every decision that can be wrong in an
   interesting way, kept out of the query and the component so jest can hold
   it still (the all-jobs.ts / all-jobs-query.ts split, applied to the day
   board).

   TIME IS TEXT. Every stamp here is ServiceM8's naive local wall-clock string
   ('YYYY-MM-DD HH:MM:SS' in the account's zone), and it is read by SLICING,
   never by parsing into a Date — a UTC server reading "07:00:00" as UTC would
   shift every block ten hours sideways. The one exception in this family,
   sm8MinutesBetween, gets away with Date.UTC because the fake zone cancels
   out of a difference; a position on a rail has nothing to cancel against.

   ONLY DISPATCHED BOOKINGS ARE LAID OUT. `activity_was_scheduled = 1` is a
   booking; `= 0` is recorded time on site (the job sheet already sums those
   as timeOnSite). The two OVERLAP in the live account — a tech booked
   8:00–9:00 records 8:09–9:25 against the same job — so drawing both would
   show one person in two places at once. This filter is re-applied here even
   though the query also asks for it, because it is the single most important
   line in the feature and a pure function is where a test can pin it.

   RECORDED TIME STILL GETS A VOTE, THOUGH — as a yes/no, never as a shape.
   `onSite` says whether anyone has clocked on against this exact booking, and
   the rail draws that as filled-or-hollow. Nothing extra is laid out, so the
   paragraph above still holds: one person, one place. The distinction it buys
   is the one the board could not make before — a job nobody has started looks
   identical to one running perfectly, because ServiceM8's status sits at
   `Work Order` for both.

   AND IT IS OFF FOR ACCOUNTS THAT DON'T CLOCK ON. Plenty of crews never
   record time at all; they mark a job complete and move on. For them every
   block on the day would go hollow, which is a screenful of alarm about
   nothing. `tracksTime` is false when a day holds no recorded time whatever,
   and the component leaves every block filled. The signal only exists where
   there is something to compare against. */

import type { AllJobsMirrorJob } from "./all-jobs";

export type ScheduleActivity = {
  uuid: string;
  jobUuid: string | null;
  staffUuid: string | null;
  /** Naive local 'YYYY-MM-DD HH:MM:SS'. */
  start: string;
  end: string | null;
  wasScheduled: number | null;
};

export type ScheduleStaff = { uuid: string; name: string };

/** Why a block is blue: the job was promoted onto one of our boards.
    OWNERSHIP OUTRANKS CATEGORY on the colour axis — a block is either pool
    work (tinted by its ServiceM8 category) or board work (the tracked blue
    the All jobs rows' chip already taught), never both. */
export type ScheduleTracked = { kind: "project" | "visit"; label: string };

export type ScheduleBlock = {
  /** The activity uuid — unique even when one job books one person twice. */
  key: string;
  /** The job uuid, which is what the sheet opens on. */
  remoteId: string;
  jobNumber: string | null;
  clientName: string | null;
  suburb: string | null;
  /** Verbatim ServiceM8 status — 'Quote' | 'Work Order' | 'Completed' |
      'Unsuccessful' — read by the component for the mute/ring/dash. */
  status: string | null;
  categoryName: string | null;
  categoryColour: string | null;
  tracked: ScheduleTracked | null;
  /** Has anyone clocked on against this booking — this job, this person —
      today? A duration is deliberately NOT carried: the moment this becomes a
      number, something wants to draw it, and drawing it is what the
      `wasScheduled` filter exists to prevent. */
  onSite: boolean;
  /** Where this booking sits relative to the job being closed off.

      SERVICEM8 HAS NO PER-BOOKING STATUS — only per-job. Completing a job for
      the day therefore reads as "complete" on every booking that job draws,
      including ones still sitting on days that have not happened yet, and the
      crew turn up to a job the office thinks is finished. The account sees
      this in ServiceM8 itself; the rail is not going to repeat it.

      `completionDate` is what separates the two. A booking on or before the
      day the job was closed genuinely happened — "done". One after it did not,
      and is still on somebody's run — "stale", which is a thing to fix rather
      than a thing to grey out. */
  closure: "open" | "done" | "stale";
  /** Minutes past midnight on the rail. endMin is always > startMin: a
      zero or reversed span still has to draw something clickable, so it
      becomes 30 minutes; a booking that crosses midnight is clamped to the
      day's end rather than wrapping into nonsense. */
  startMin: number;
  endMin: number;
  start: string;
  end: string | null;
};

export type ScheduleLane = {
  /** "" for the unassigned lane. */
  staffUuid: string;
  name: string;
  blocks: ScheduleBlock[];
  /** Blocks stacked into sub-rows: overlaps go DOWN, never on top of each
      other. Row count is the lane's height. */
  rows: ScheduleBlock[][];
  /** Booked minutes — the load the admin balances a day with. */
  minutes: number;
};

export type ScheduleDay = {
  lanes: ScheduleLane[];
  /** Rail bounds in minutes, hour-aligned. 6am–6pm unless real blocks push
      it wider; never wider than the day itself. */
  railStart: number;
  railEnd: number;
  totalBookings: number;
  totalMinutes: number;
  jobCount: number;
  /** Did anyone record any time at all on this day? False for an account that
      doesn't clock on, and the filled/hollow reading stays off when it is. */
  tracksTime: boolean;
};

/** The key that pairs a booking with recorded time: the same job AND the same
    person. Time recorded by somebody else against the job says nothing about
    whether THIS booking was started, which is the question being asked. The
    unassigned lane keys on an empty staff, so it still matches itself. */
export function onSiteKey(jobUuid: string, staffUuid: string | null): string {
  return `${jobUuid}|${staffUuid ?? ""}`;
}

/** '2026-08-14 07:00:00' → '2026-08-14'. Slicing, never a Date — the reason is
    stamped at the top of this file. */
function dayOfNaive(stamp: string | null | undefined): string | null {
  return typeof stamp === "string" && stamp.length >= 10 ? stamp.slice(0, 10) : null;
}

/** What the name column says about one person, before you look at the rail.

    "on"   — something of theirs has recorded time. They are out there, or have
             been; the day is under way.
    "wait" — they still have open work and none of it has been started, but
             nothing is overdue either. Their day has not begun.
    "late" — an open booking's start has gone with nothing recorded against it.
             The one that wants doing something about, so it outranks the rest.
    null   — nothing to claim. Every booking is closed off and none recorded
             time, which is a person this reading has no opinion about.

    `overdueBefore` is the minute past which an unstarted booking counts as
    late: the browser's clock on today, the whole day on a day already gone,
    and NULL when the clock cannot be trusted — a viewer whose own date
    disagrees with the board's, exactly as the now line handles it. No mark
    beats one that is hours wrong. */
export function lanePresence(
  blocks: Pick<ScheduleBlock, "onSite" | "closure" | "status" | "startMin">[],
  overdueBefore: number | null
): "on" | "wait" | "late" | null {
  const open = blocks.filter((b) => b.closure !== "done" && b.status !== "Unsuccessful");
  if (
    overdueBefore !== null &&
    open.some((b) => !b.onSite && b.startMin < overdueBefore)
  ) {
    return "late";
  }
  // green only where something actually recorded time — never as a fallback
  if (blocks.some((b) => b.onSite)) return "on";
  return open.length > 0 ? "wait" : null;
}

/**
 * Whether one booking is covered by the job's completion, or is left over
 * after it. See `ScheduleBlock["closure"]`.
 *
 * NO COMPLETION DATE MEANS "DONE", not "stale". The rail cannot prove a
 * booking is left over without a day to compare against, and calling live work
 * stale is the more expensive mistake of the two — it puts a warning on a job
 * somebody is about to drive to.
 */
export function closureOf(
  status: string | null | undefined,
  completionDate: string | null | undefined,
  bookingStart: string
): "open" | "done" | "stale" {
  if (status !== "Completed") return "open";
  const closedOn = dayOfNaive(completionDate);
  const bookedOn = dayOfNaive(bookingStart);
  if (!closedOn || !bookedOn) return "done";
  return bookedOn > closedOn ? "stale" : "done";
}

/** The default drawn window: 6am to 6pm. */
const RAIL_DEFAULT_START = 6 * 60;
const RAIL_DEFAULT_END = 18 * 60;
const DAY_MIN = 24 * 60;
/** What a span that cannot be read still draws as. */
const FALLBACK_SPAN_MIN = 30;

const STAMP_RE = /^\d{4}-\d{2}-\d{2} (\d{2}):(\d{2}):\d{2}$/;

/** "2026-08-11 07:30:00" → 450. Slicing, never a Date — see the header. */
export function minutesOfNaive(stamp: string | null | undefined): number | null {
  if (typeof stamp !== "string") return null;
  const m = STAMP_RE.exec(stamp);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 450 → "7:30am"; whole hours drop the minutes ("7am"). Noon is 12pm. */
export function clockLabel(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

/** 450 → "7h30"; whole hours drop the minutes ("8h"). The lane's load. */
export function fmtHoursShort(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** The drawn window: the 6am–6pm default, WIDENED to whole hours to fit real
    blocks, never narrowed, never past the day's own edges. */
export function railBoundsOf(blocks: { startMin: number; endMin: number }[]): {
  start: number;
  end: number;
} {
  let start = RAIL_DEFAULT_START;
  let end = RAIL_DEFAULT_END;
  for (const b of blocks) {
    if (b.startMin < start) start = Math.floor(b.startMin / 60) * 60;
    if (b.endMin > end) end = Math.ceil(b.endMin / 60) * 60;
  }
  return { start: Math.max(0, start), end: Math.min(DAY_MIN, end) };
}

/** Greedy first-fit stacking: each block takes the first sub-row whose last
    block has already ended. Correct only over start-sorted input, which
    layoutScheduleDay guarantees. */
export function stackLane(blocks: ScheduleBlock[]): ScheduleBlock[][] {
  const rows: ScheduleBlock[][] = [];
  for (const b of blocks) {
    const row = rows.find((r) => r[r.length - 1].endMin <= b.startMin);
    if (row) row.push(b);
    else rows.push([b]);
  }
  return rows;
}

/** One day, laid out. Staff and job names arrive joined; this function only
    decides — which rows draw, where, in whose lane, wearing what. */
export function layoutScheduleDay(input: {
  activities: ScheduleActivity[];
  staff: ScheduleStaff[];
  jobs: AllJobsMirrorJob[];
  /** ServiceM8 job uuid → the board that owns it, when one does. */
  tracked?: Map<string, ScheduleTracked>;
  /** `onSiteKey` values for every job+person pair with recorded time today. */
  onSite?: ReadonlySet<string>;
}): ScheduleDay {
  type Placed = ScheduleBlock & { staffUuid: string | null };
  const jobById = new Map(input.jobs.map((j) => [j.remoteId, j]));
  const staffById = new Map(input.staff.map((s) => [s.uuid, s.name]));
  const tracked = input.tracked ?? new Map<string, ScheduleTracked>();
  const onSite = input.onSite ?? new Set<string>();

  const blocks: Placed[] = [];
  for (const a of input.activities) {
    if (a.wasScheduled !== 1) continue;
    const startMin = minutesOfNaive(a.start);
    if (startMin === null || !a.jobUuid) continue;

    /* An end on a LATER day clamps to midnight — the block says "runs past
       the day" by touching the edge rather than wrapping to a smaller number
       that would draw it ending mid-morning. */
    const sameDay = a.end !== null && a.end.slice(0, 10) === a.start.slice(0, 10);
    const rawEnd = sameDay ? minutesOfNaive(a.end) : a.end !== null ? DAY_MIN : null;
    const endMin =
      rawEnd !== null && rawEnd > startMin
        ? Math.min(rawEnd, DAY_MIN)
        : Math.min(startMin + FALLBACK_SPAN_MIN, DAY_MIN);

    const job = jobById.get(a.jobUuid);
    blocks.push({
      key: a.uuid,
      remoteId: a.jobUuid,
      jobNumber: job?.jobNumber ?? null,
      clientName: job?.clientName ?? null,
      suburb: job?.suburb ?? null,
      status: job?.status ?? null,
      categoryName: job?.categoryName ?? null,
      categoryColour: job?.categoryColour ?? null,
      tracked: tracked.get(a.jobUuid) ?? null,
      onSite: onSite.has(onSiteKey(a.jobUuid, a.staffUuid)),
      closure: closureOf(job?.status, job?.completionDate, a.start),
      startMin,
      endMin,
      start: a.start,
      end: a.end,
      staffUuid: a.staffUuid,
    });
  }
  blocks.sort((x, y) => x.startMin - y.startMin || x.key.localeCompare(y.key));

  /* One lane per person the mirror can NAME. A null staff_uuid, or a uuid
     the staff mirror doesn't hold, lands in the unassigned lane — said, not
     dropped: a booking nobody owns is exactly the kind a dispatcher needs
     shown. */
  const byStaff = new Map<string, ScheduleBlock[]>();
  const unassigned: ScheduleBlock[] = [];
  for (const b of blocks) {
    const name = b.staffUuid ? staffById.get(b.staffUuid) : undefined;
    if (b.staffUuid && name !== undefined) {
      const list = byStaff.get(b.staffUuid) ?? [];
      list.push(b);
      byStaff.set(b.staffUuid, list);
    } else {
      unassigned.push(b);
    }
  }

  const lanes: ScheduleLane[] = [...byStaff.entries()].map(([uuid, bs]) => ({
    staffUuid: uuid,
    name: staffById.get(uuid) ?? "",
    blocks: bs,
    rows: stackLane(bs),
    minutes: bs.reduce((s, b) => s + (b.endMin - b.startMin), 0),
  }));
  /* The person who started first is the top row; ties break on name so the
     order never wobbles between renders. */
  lanes.sort(
    (a, b) => a.blocks[0].startMin - b.blocks[0].startMin || a.name.localeCompare(b.name)
  );
  if (unassigned.length > 0) {
    lanes.push({
      staffUuid: "",
      name: "Nobody named",
      blocks: unassigned,
      rows: stackLane(unassigned),
      minutes: unassigned.reduce((s, b) => s + (b.endMin - b.startMin), 0),
    });
  }

  const rail = railBoundsOf(blocks);
  return {
    lanes,
    railStart: rail.start,
    railEnd: rail.end,
    totalBookings: blocks.length,
    totalMinutes: blocks.reduce((s, b) => s + (b.endMin - b.startMin), 0),
    jobCount: new Set(blocks.map((b) => b.remoteId)).size,
    /* Not `onSite.size > 0` — that set is the whole day's recorded time, and
       a booking on ANOTHER day could put entries in it. What matters is
       whether anything landed on a booking actually drawn here: if none did,
       either nobody has started yet or this account doesn't clock on, and
       neither is a reason to hollow out the board. */
    tracksTime: blocks.some((b) => b.onSite),
  };
}
