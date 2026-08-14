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
   line in the feature and a pure function is where a test can pin it. */

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
};

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
}): ScheduleDay {
  type Placed = ScheduleBlock & { staffUuid: string | null };
  const jobById = new Map(input.jobs.map((j) => [j.remoteId, j]));
  const staffById = new Map(input.staff.map((s) => [s.uuid, s.name]));
  const tracked = input.tracked ?? new Map<string, ScheduleTracked>();

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
  };
}
