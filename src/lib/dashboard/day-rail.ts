/* THE DAY'S FACTS — what "Your day" draws, before it draws it.

   Home's day answers "where should I be", and the honest answer is not just
   ServiceM8's bookings: the Hilux going in for its 60,000km service at 7:30
   owns that morning exactly as much as a job does. So the day carries two
   kinds of thing — bookings from the mirror, and the viewer's own tasks that
   name an hour. The bar lays them out (./day-bar); this file decides what
   is on it and what it may say.

   WHAT EARNS A PLACE. A booking always. A task only when it has a clock time
   — `tasks.remind_at`, which by construction shares its `due_date` (see
   docs/migrations/task_reminders.sql). A task merely due *today* stays on
   the Tasks tab: a due date is a day, not an hour, and dropping every loose
   to-do onto 5pm would say something the data never said.

   The old Home drew this day twice over — a rail down a column, then a band
   of pills across the top — and the geometry of both lived here. It went
   with the old Home (2026-09-26); the day bar measures its own. */

import { clockLabel } from "@/lib/workboard/schedule";
import type { RemindKind } from "./reminders";

/** The zone every ServiceM8 stamp is already written in. Matches
    `todayInZone`'s fallback so an account with no vendor row still lands
    somewhere sane rather than on the server's clock. */
const FALLBACK_TZ = "Australia/Sydney";

/** Midnight, as the schedule writes it. `layoutScheduleDay` clamps a booking
    that ends on a later day to this rather than wrapping it to a smaller
    number, so an end AT it means "runs past the day" — which is why two of the
    labels below have to treat it differently from every other end. */
const DAY_MIN = 24 * 60;

/** A task that named an hour, already resolved into the workspace's zone. */
export type RailTask = {
  id: string;
  title: string;
  /** Minutes past midnight, in the workspace's zone. */
  atMin: number;
  /** Whether `atMin` is when to DO it or when it must be DONE.

      The rail draws the two differently because they are opposite
      instructions at the same coordinate: an `at` row is a thing to be doing
      then, and a `by` row is the moment you have run out — which is why it
      wears the warning colour and says the word. See `remindKindOf`. */
  kind: RemindKind;
  /** The clock has gone past `atMin` and the task is still open. For a `by`
      row that means the deadline was MISSED, which is a stronger statement
      than an `at` row being late — but it is the same arithmetic, and the
      difference is said by `kind` rather than by a second flag. */
  overdue: boolean;
};

/** Both parts of a timestamp as the workspace reads them. One formatter call
    answers "which day" and "what time", which is the only way to ask that is
    correct across a DST boundary — the two questions must agree. */
export function zonedParts(
  iso: string | null | undefined,
  tz: string | null | undefined,
): { day: string; min: number } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || FALLBACK_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const at = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const hour = at("hour");
    if (!hour) return null;
    /* en-CA renders midnight as "24" in some ICU versions and "00" in others.
       Both mean the same instant; only one of them is a number of hours. */
    const h = Number(hour) % 24;
    return { day: `${at("year")}-${at("month")}-${at("day")}`, min: h * 60 + Number(at("minute")) };
  } catch {
    return null;
  }
}

/** Minutes past midnight right now, in the workspace's zone. */
export function nowMinInZone(tz: string | null | undefined, now: Date = new Date()): number | null {
  return zonedParts(now.toISOString(), tz)?.min ?? null;
}

/** "7–3pm" · "8–10am" · "9:15–2:45pm" — a booking's span, written on the card
    because the card does not draw it.

    EVERY ROW ON THE OLD RAIL WAS THE SAME HEIGHT, which is what kept a day
    readable as a sequence instead of a column of tall empty boxes — but it
    meant a job from seven to three looked exactly like a half-hour call, and
    the length was only ever in the row's hover title, which a phone does not
    have and a glance does not wait for.
    Isaac, 2026-09-01: *"just have the card at seven AM and just write down
    seven to three PM on the card"*. So the card says it.

    THE MERIDIEM IS SPOKEN ONCE, AT THE END — his own example is "seven till
    three PM", which is how the span is said out loud, and "7am–3pm" is how a
    form asks for it. It stays unambiguous because a booking runs forwards and
    inside one day: "7–3pm" cannot mean seven in the evening without running
    backwards. A span of twelve hours or more is the case where that stops
    being true, so it keeps both halves.

    MIDNIGHT IS THE OTHER CASE, and it is the one the "inside one day" argument
    does not cover. An end of 12am is the only end whose half is EARLIER than
    every start that can reach it, so the trailing meridiem carries backwards
    as a lie rather than as the answer: a callout booked at one in the
    afternoon and running past twelve came out "1–12am", which reads as one in
    the MORNING and is the same booking twelve hours wrong. It is not a corner
    case either — `layoutScheduleDay` clamps every booking that ends on a later
    day to midnight, so any after-lunch job that runs over lands here, and the
    twelve-hour rule above cannot catch it because those spans are short.
    Midnight keeps both halves and says "1pm–12am". */
export function railSpanLabel(startMin: number, endMin: number): string {
  const from = clockLabel(startMin);
  /* Nothing to span. The board clamps a zero or reversed booking to thirty
     minutes before it ever reaches here, so this is belt and braces. */
  if (endMin <= startMin) return from;
  const to = clockLabel(endMin);
  if (endMin - startMin >= 12 * 60 || endMin >= DAY_MIN) return `${from}–${to}`;
  return `${from.replace(/[ap]m$/, "")}–${to}`;
}

/** What the rail is missing, when it is missing something. Bookings arrive
    through ServiceM8 and the workboard; timed tasks do not, so a rail can be
    complete or short of one layer. `null` is the complete day. */
export type RailMissing = "workboard" | "link" | null;

/** Does the rail get to say the day is clear?

    ONLY WHEN IT HAS EVERYTHING. Short of a layer, an empty column is a fact
    about what could be read rather than a fact about the day, and "you are
    free until Tuesday" is the one wrong answer that looks exactly like a
    right one.

    IT IS A FUNCTION BECAUSE TWO PLACES ONCE ASKED IT and went out of step:
    the old rail wrote the condition out a second time as
    `placed.length === 0`, which is the same thing only while a layer is
    present. One predicate, however many ask it. */
export function railSaysEmpty(itemCount: number, missing: RailMissing): boolean {
  return itemCount === 0 && missing === null;
}

/** Which layer the day is short of — lifted here from the old Home's band
    for the day bar.

    A WORKSPACE WITHOUT SERVICEM8 IS SHORT OF NOTHING. There are no bookings
    anywhere for it to miss, so its day is complete with its timed tasks
    alone, and "nobody in ServiceM8 is linked to your account yet" would be a
    sentence about a product it does not use. The band asked only `enabled`
    and `linked`, which was right for the one workspace that has always had
    ServiceM8 and wrong for every one that has not. `connected` goes first
    for that reason: without it, the other two questions have no answer. */
export function railMissing(rail: { enabled: boolean; linked: boolean; connected: boolean }): RailMissing {
  if (!rail.connected) return null;
  if (!rail.enabled) return "workboard";
  return rail.linked ? null : "link";
}

/** Today's tasks that named an hour, in the workspace's zone.

    `remindAt` is the only time-bearing column on a task, and its day is
    `due_date` by construction — so a task is on the rail when its reminder
    lands on the rail's day, and where the reminder points is where it goes. */
export function railTasksOf(
  tasks: readonly {
    id: string;
    title: string;
    remindAt: string | null;
    remindKind?: RemindKind;
    dueDate: string | null;
    status: string;
  }[],
  dayISO: string,
  tz: string | null | undefined,
  nowMin: number | null,
): RailTask[] {
  const out: RailTask[] = [];
  for (const t of tasks) {
    if (t.status !== "open") continue;
    const at = zonedParts(t.remindAt, tz);
    if (!at || at.day !== dayISO) continue;
    out.push({
      id: t.id,
      title: t.title,
      atMin: at.min,
      kind: t.remindKind ?? "at",
      overdue: nowMin !== null && at.min < nowMin,
    });
  }
  return out.sort((a, b) => a.atMin - b.atMin || a.id.localeCompare(b.id));
}

/** THE VIEWER'S OWN LANE of the board's laid-out day, in time order — a
    lane already IS a person's day, so "just mine" is a filter on the
    board's own answer rather than a second way of deciding who owns a
    booking. An unknown viewer has no lane and keeps nothing (see
    page-data's `linked`). */
export function viewerLaneBlocks<B extends { startMin: number; key: string }>(
  lanes: readonly { staffUuid: string; blocks: readonly B[] }[],
  mineUuid: string | null
): B[] {
  return lanes
    .filter((lane) => mineUuid !== null && lane.staffUuid === mineUuid)
    .flatMap((lane) => lane.blocks)
    .sort((a, b) => a.startMin - b.startMin || a.key.localeCompare(b.key));
}

/** The mirror rows behind the day's cards, and only those. The day's
    payload carries every job booked on the day, but a job in somebody else's
    lane is not on this bar and must not ride to the browser with it. In the
    order the blocks are drawn, once each. */
export function jobsOnRail<J extends { remoteId: string }>(
  blocks: readonly { remoteId: string }[],
  jobs: readonly J[]
): J[] {
  const byId = new Map(jobs.map((j) => [j.remoteId, j]));
  const out: J[] = [];
  for (const b of blocks) {
    const j = byId.get(b.remoteId);
    if (j && !out.includes(j)) out.push(j);
  }
  return out;
}

/** A per-job record cut down to the jobs on the viewer's own day — the
    `jobsOnRail` rule for a record. The day's payload knows every job booked
    on it; the ones in somebody else's lane are not on this bar and do not
    ride to the browser with it. */
export function railWhereOf<V>(
  blocks: readonly { remoteId: string }[],
  byJob: Readonly<Record<string, V>>
): Record<string, V> {
  const out: Record<string, V> = {};
  for (const b of blocks) {
    if (Object.prototype.hasOwnProperty.call(byJob, b.remoteId)) out[b.remoteId] = byJob[b.remoteId];
  }
  return out;
}

/** Who else is on each of the viewer's jobs today, by first name — the
    panel's "With Luke". Read off the board's own lanes, so "booked on it"
    means exactly what the Schedule tab draws.

    Everyone else booked on the SAME JOB on this day counts, whether or not
    their hours meet yours: a two-man install where one arrives after lunch
    is still a job you are on together. The viewer is left out (`mineUuid`),
    and so is the unassigned lane — "Nobody named" is not a person.

    One name per person, in lane order (whoever started first). A first name
    two of them share would say one person twice, so those two keep their
    whole names. A job nobody else is on has no entry: the panel leaves With
    out rather than saying "Solo". */
export function railCrewOf(
  lanes: readonly { staffUuid: string; name: string; blocks: readonly { remoteId: string }[] }[],
  blocks: readonly { remoteId: string }[],
  mineUuid: string | null
): Record<string, string[]> {
  const jobs = [...new Set(blocks.map((b) => b.remoteId))];
  const people = new Map<string, { uuid: string; name: string }[]>(jobs.map((j) => [j, []]));
  for (const lane of lanes) {
    const name = lane.name.trim();
    if (lane.staffUuid === "" || lane.staffUuid === mineUuid || !name) continue;
    for (const b of lane.blocks) {
      const list = people.get(b.remoteId);
      if (list && !list.some((p) => p.uuid === lane.staffUuid)) list.push({ uuid: lane.staffUuid, name });
    }
  }
  const out: Record<string, string[]> = {};
  for (const job of jobs) {
    const list = people.get(job)!;
    if (list.length === 0) continue;
    const firsts = list.map((p) => p.name.split(/\s+/)[0]);
    out[job] = list.map((p, i) => (firsts.filter((f) => f === firsts[i]).length > 1 ? p.name : firsts[i]));
  }
  return out;
}
