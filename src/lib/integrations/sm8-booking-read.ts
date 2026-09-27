/* Reading for a booking — server only (two-way phase 3, PR C).

   Two reads, and neither writes anything anywhere.

   THE LIVE READS BEFORE A PRESS (readBookingContext). Before the Book in
   panel offers Book in, HeyTiff asks ServiceM8 itself, never the mirror:
   - the job: its status, whether it is active, its edit time and the six
     fields a status change guards (job.json, uuid eq, read_jobs). Required;
   - the job's own bookings: every active activity on it, a booking or
     recorded time (jobactivity.json, job_uuid eq and active eq 1,
     read_schedule). Required, and the whole list or a read that failed:
     past three pages it is the latter (sm8-write's readSm8JobBookings, the
     sender's own read);
   - each day a row is on: everything that overlaps it, for everyone
     (jobactivity.json, active eq 1, start_date lt the next day and
     end_date gt the day). ADVICE ONLY (U12): a day that couldn't be read is
     null, and Book in stays allowed. Up to three pages, and eight days.
   One panel open is three calls; each more day is one more. Every one goes
   through the one door (fetchSm8Page, then sm8Request) on lane `read` —
   the account's one counter, with a read's patience and its floor
   (sm8-meter) — and a 401 is renewed once (withSm8Renewal). A failure
   comes back in sm8-read's sentences, never in ServiceM8's words. Every
   scope used is one HeyTiff already holds. A job ServiceM8 hasn't got, or
   can't book, is answered after its one read: nothing more is spent on it.
   Rows are shaped as the mirror shapes them (the sender's own shaper), and
   a row with no length — what clearing recorded time leaves behind (P4) —
   counts as nothing, so it is left out.

   WHAT OUR ROWS SAY (readBookingLines). The job card's lines, for the card's
   poll and a press's answer: each press on the job as one VERB — a status
   change said once, above the bookings that depend on it, then each
   booking and each Clear with its line (sm8-booking-plan's bookingLine,
   statusLine and clearLine) — and, by booking, the line a booking that
   still stands carries on its own entry of the Visits face. Read from the
   overlay (HeyTiff's rows over the mirror, for the account connected now)
   and the mirror's copy of each booking. Every door is the presser's,
   except Open in ServiceM8. Nothing is read unless the deployment allows
   bookings (the overlay's own rule).

   THE ZONE is sm8-booking-zone's, re-exported: the account's own, and no
   fallback. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { sm8CallOf, type Sm8Call } from "./sm8-http";
import { BUSY, BUSY_DAY, fetchSm8Page, noAccess, renewalEnded, UNAVAILABLE } from "./sm8-read";
import { withSm8Renewal } from "./sm8-renew";
import { sm8AccessResult } from "./sm8-store";
import { readSm8Job, readSm8JobBookings, shapeLiveActivity, type Sm8LiveActivity, type Sm8LiveJob, type Sm8ReadFailure } from "./sm8-write";
import { readBookingOverlay, readMirrorBookings, type BookingOverlayRow, type MirrorBooking } from "./sm8-booking-overlay";
import {
  BOOKINGS_PER_PRESS,
  bookingLine,
  clearLine,
  lineDrawnAt,
  localNow,
  statusLine,
  type BookingMirrorIn,
  type BookingState,
} from "./sm8-booking-plan";
import { bookingZone } from "./sm8-booking-zone";
import { offersSend, sendHold, type Sm8WriteState } from "./sm8-write-plan";
import type { ReadResult } from "./xero-read";

export { bookingZone, knownZone, type BookingZone } from "./sm8-booking-zone";

/* ── the live reads before a press ── */

/** The job as ServiceM8 has it now (sm8-write's read of it). */
export type LiveJob = Sm8LiveJob;

/** One activity as ServiceM8 has it now, shaped as the mirror shapes one
    (textOrNull, dateOrNull, intOrNull), with whether it was recorded. */
export type LiveActivity = Sm8LiveActivity;

export type BookingContext = {
  /** Null: ServiceM8 hasn't got it. */
  job: LiveJob | null;
  /** Every active activity on the job, bookings and recorded time alike.
      Empty for a job that is gone or can't be booked (not read). */
  bookings: LiveActivity[];
  /** Each day asked, "YYYY-MM-DD": everything that overlaps it, for
      everyone. Null: that day couldn't be read. */
  days: Record<string, LiveActivity[] | null>;
  /** When it was read (ISO). */
  readAt: string;
};

/** The statuses a job can be booked in. */
const BOOKABLE = new Set(["Quote", "Work Order"]);

/** A day's read gives up past this many pages (a thousand rows each). */
const DAY_PAGES = 3;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day, "YYYY-MM-DD": 31 February is none. */
function realDay(d: string): boolean {
  const m = DAY_RE.exec(d);
  if (!m) return false;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).toISOString().slice(0, 10) === d;
}

/** The calendar day after `d`, as text: a wall-clock date, never an instant. */
function dayAfter(d: string): string {
  const m = DAY_RE.exec(d)!;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1)).toISOString().slice(0, 10);
}

/** The days to read: real ones, each once, eight at most. */
function daysToRead(days: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const d of days) {
    if (typeof d !== "string" || !realDay(d) || out.includes(d)) continue;
    out.push(d);
    if (out.length === BOOKINGS_PER_PRESS) break;
  }
  return out;
}

/** A row with no length: recorded time cleared in ServiceM8 stays active,
    its end on its start (P4). It overlaps nothing and books nothing. */
const noLength = (a: LiveActivity) => !!a.start && !!a.end && a.end <= a.start;

/** A read's failure, in sm8-read's words: the account's call limit had no
    room (for the day, or for now), or ServiceM8 couldn't be reached. */
function failed(f: Sm8ReadFailure): string {
  const l = f.limited;
  if (!l) return UNAVAILABLE;
  return l.limit === "day" || (l.limit === "ours" && l.day) ? BUSY_DAY : BUSY;
}

const refused = (r: { ok: boolean; unauthorized?: boolean }) => !r.ok && !!r.unauthorized;

/** One day's activities for everyone, or null when the day couldn't be read
    whole; "unauthorized" for a 401, so the renewal can try once more. */
async function readDay(call: Sm8Call, day: string): Promise<LiveActivity[] | null | "unauthorized"> {
  const filter = `active eq 1 and start_date lt '${dayAfter(day)} 00:00:00' and end_date gt '${day} 00:00:00'`;
  const found: LiveActivity[] = [];
  let cursor = "-1";
  for (let pages = 0; pages < DAY_PAGES; pages++) {
    const page = await fetchSm8Page(call, "jobactivity.json", { cursor, filter });
    if (!page.ok) return page.failure === "unauthorized" ? "unauthorized" : null;
    for (const r of page.rows) {
      const a = shapeLiveActivity(r);
      if (a && !noLength(a)) found.push(a);
    }
    if (!page.nextCursor) return found;
    cursor = page.nextCursor;
  }
  console.error(`[sm8] the bookings on ${day} passed ${DAY_PAGES} pages — read as a day that couldn't be read`);
  return null;
}

/** What ServiceM8 has now for a Book in on `jobUuid`, on `days`. The job,
    then its bookings, then each day, in that order and one at a time, each
    carrying on with the access the last one renewed. */
export async function readBookingContext(
  orgId: string,
  jobUuid: string,
  days: readonly unknown[],
  now: number = Date.now()
): Promise<ReadResult<BookingContext>> {
  const got = await sm8AccessResult(orgId);
  if (!got.ok) return { ok: false, error: noAccess(got) };
  const readAt = new Date(now).toISOString();

  /* the job: required */
  const jobRead = await withSm8Renewal(orgId, got.access, (a) => readSm8Job(sm8CallOf(a, "read"), jobUuid), refused);
  const jobEnded = renewalEnded(jobRead.verdict);
  if (jobEnded) return { ok: false, error: jobEnded };
  if (!jobRead.result.ok) return { ok: false, error: failed(jobRead.result) };
  const job = jobRead.result.found ? jobRead.result.job : null;
  if (!job || job.active !== 1 || !BOOKABLE.has(job.status ?? "")) return { ok: true, data: { job, bookings: [], days: {}, readAt } };

  /* its bookings: required, whole */
  const listRead = await withSm8Renewal(orgId, jobRead.access, (a) => readSm8JobBookings(sm8CallOf(a, "read"), jobUuid), refused);
  const listEnded = renewalEnded(listRead.verdict);
  if (listEnded) return { ok: false, error: listEnded };
  if (!listRead.result.ok) return { ok: false, error: failed(listRead.result) };
  const bookings = listRead.result.activities.filter((a) => !noLength(a));

  /* each day: advice. A renewal that ends the grant ends the days too: the
     rest would only meet it again */
  const byDay: Record<string, LiveActivity[] | null> = {};
  let access = listRead.access;
  let stopped = false;
  for (const day of daysToRead(days)) {
    if (stopped) {
      byDay[day] = null;
      continue;
    }
    const dayRead = await withSm8Renewal(orgId, access, (a) => readDay(sm8CallOf(a, "read"), day), (r) => r === "unauthorized");
    access = dayRead.access;
    stopped = renewalEnded(dayRead.verdict) !== null;
    const r = dayRead.result;
    byDay[day] = stopped || r === "unauthorized" ? null : r;
  }
  return { ok: true, data: { job, bookings, days: byDay, readAt } };
}

/* ── what our rows say ── */

/** One booking of a press — or one Clear — with its line. */
export type VerbLine = {
  /** The row a door names: the booking's create (Undo, Cancel booking and
      Try again all name it), or the Clear's own row. */
  rowId: string;
  op: "create" | "clear";
  /** The booking in ServiceM8, lower case: ours for a create, the leftover
      for a Clear. */
  uuid: string;
  staffUuid: string | null;
  /** Their name in ServiceM8, "First Last"; null when the mirror has none. */
  name: string | null;
  /** As it was pressed: the account's wall clock. */
  start: string | null;
  end: string | null;
  state: BookingState;
  /** This read found the booking on the Visits face's list — the mirror's
      scheduled, active bookings from today on, less the ones we removed,
      plus the ones we sent that the mirror doesn't hold yet — with a line
      a standing booking carries on its own entry (lineDrawnAt): `lines`
      has it by uuid, and a card whose list holds that entry draws it there
      and not here. A card whose list doesn't hold it yet (loaded before the
      press) draws it here. */
  standing: boolean;
};

/** One press on the job, as the card draws it above its list: a status
    change said once, then its bookings. A status change two presses share
    (the same edit time seen) is one verb, holding both presses' bookings. */
export type VerbView = {
  /** The press that made it: its status change's first press, or the
      press of its bookings (a Clear's, its confirm's). */
  verbId: string;
  /** Every press whose rows are in it. */
  presses: string[];
  /** When its newest row was made (ISO): the card draws the newest first. */
  at: string;
  status: { rowId: string; state: BookingState } | null;
  /** In start order. */
  bookings: VerbLine[];
};

export type BookingLines = {
  /** Newest first. Only verbs with something to say. */
  verbs: VerbView[];
  /** By booking uuid, lower case: the line on each of our bookings that
      stands, drawn on its entry. */
  lines: Record<string, BookingState>;
  /** The job's bookings we removed, lower case: the card hides an entry of
      its list that is one of these. */
  gone: string[];
  /** The job's queued bookings behind a status change that has gone, when
      every one of them is untried: what the card's poll may send. */
  untried: string[];
};

/** A booking uuid, compared whatever its case. */
const low = (u: string | null | undefined) => (u ?? "").trim().toLowerCase();

/** Uuids per `in` filter, as the overlay reads them. */
const CHUNK = 50;
const chunks = <T>(xs: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
};
/** The spellings a mirror row's uuid may carry. */
const spellings = (u: string) => [...new Set([u, u.toLowerCase(), u.toUpperCase()])];

const fullName = (first: unknown, last: unknown): string | null => {
  const name = [first, last].filter((p): p is string => typeof p === "string" && !!p.trim()).map((p) => p.trim()).join(" ");
  return name || null;
};

/** Each of these ServiceM8 people's names, by lower-case uuid. A read that
    fails names nobody, logged: a line then says no name, never a wrong one. */
export async function sm8StaffNames(orgId: string, uuids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const wanted = [...new Set(uuids.map(low).filter(Boolean))];
  for (const part of chunks(wanted)) {
    const { data, error } = await supabaseAdmin
      .from("sm8_staff")
      .select("uuid, first, last")
      .eq("org_id", orgId)
      .in("uuid", part.flatMap(spellings));
    if (error) {
      console.error(`[sm8] couldn't read the names of org ${orgId}'s ServiceM8 people:`, error);
      return names;
    }
    for (const r of (data ?? []) as { uuid: string; first: unknown; last: unknown }[]) {
      const name = fullName(r.first, r.last);
      if (name) names.set(low(r.uuid), name);
    }
  }
  return names;
}

const mirrorIn = (m: MirrorBooking | undefined): BookingMirrorIn | null =>
  m ? { active: m.active, jobUuid: m.jobUuid, staffUuid: m.staffUuid, start: m.start, end: m.end, editDate: m.editDate } : null;

/** The job's lines as `viewerUserId` sees them: their doors on their own
    rows, and none on anyone else's but Open in ServiceM8. */
export async function readBookingLines(
  orgId: string,
  state: Sm8WriteState,
  jobUuid: string,
  viewerUserId: string,
  now: number = Date.now()
): Promise<BookingLines> {
  const overlay = await readBookingOverlay(orgId, state, { jobUuids: [jobUuid] }, now);
  const rows = overlay.rows.filter((r) => low(r.sm8_job_uuid) === low(jobUuid));
  if (rows.length === 0) return { verbs: [], lines: {}, gone: [], untried: [] };

  const creates = rows.filter((r) => r.op === "create");
  const clears = rows.filter((r) => r.op === "delete" && !r.depends_on);
  const statusRows = new Map(rows.filter((r) => r.op === "update").map((r) => [r.id, r]));
  const takeBacks = new Map(rows.filter((r) => r.op === "delete" && !!r.depends_on).map((r) => [r.depends_on as string, r]));

  const [mirrorRead, z, names] = await Promise.all([
    readMirrorBookings(orgId, [...creates.map((c) => c.remote_uuid), ...clears.map((c) => c.target_uuid ?? "")]),
    bookingZone(orgId),
    sm8StaffNames(orgId, [...creates, ...clears].map((r) => r.booking_staff_uuid)),
  ]);
  /* a mirror that couldn't be read is taken as holding nothing yet (logged
     where it failed): the next poll reads it again */
  const mirror = mirrorRead ?? new Map<string, MirrorBooking>();
  const zone = z.zone;
  const today = zone ? (localNow(zone, now)?.slice(0, 10) ?? null) : null;
  const hold = state.readable ? sendHold(state, "booking") : null;
  const offered = offersSend(state, "booking");
  const trial = state.mode === "trial";
  const notMirrored = new Set(overlay.sentNotMirrored.map((s) => s.rowId));
  const presser = (r: BookingOverlayRow) => (r.requested_by_user ?? null) === viewerUserId;

  /** On the Visits face's list: the mirror's scheduled, active booking on
      this job from today on, not one we removed; or sent, not mirrored yet. */
  const stands = (rowId: string, uuid: string): boolean => {
    const m = mirror.get(low(uuid));
    if (!m) return notMirrored.has(rowId);
    return (
      m.active === 1 &&
      m.scheduled === 1 &&
      low(m.jobUuid) === low(jobUuid) &&
      !overlay.gone.has(low(uuid)) &&
      (!today || (m.start ?? "") >= today)
    );
  };

  type Group = { verbId: string; presses: Set<string>; at: string; status: VerbView["status"]; bookings: VerbLine[] };
  const groups = new Map<string, Group>();
  const groupOf = (key: string, verbId: string): Group => {
    let g = groups.get(key);
    if (!g) {
      g = { verbId, presses: new Set(), at: "", status: null, bookings: [] };
      groups.set(key, g);
    }
    return g;
  };
  const touch = (g: Group, r: BookingOverlayRow) => {
    if (r.verb_id) g.presses.add(r.verb_id);
    if (r.created_at > g.at) g.at = r.created_at;
  };

  const lines: Record<string, BookingState> = {};
  for (const c of creates) {
    const s = c.depends_on ? (statusRows.get(c.depends_on) ?? null) : null;
    const said = bookingLine({
      create: c,
      statusRow: s,
      takeBack: takeBacks.get(c.id) ?? null,
      hold,
      offered,
      trial,
      viewerIsPresser: presser(c),
      mirror: mirrorIn(mirror.get(low(c.remote_uuid))),
      now,
      zone,
    });
    const g = s ? groupOf(`status:${s.id}`, s.verb_id ?? c.verb_id ?? c.id) : groupOf(`verb:${c.verb_id ?? c.id}`, c.verb_id ?? c.id);
    touch(g, c);
    if (!said.key) continue;
    const onEntry = stands(c.id, c.remote_uuid) && lineDrawnAt(said, true) === "entry";
    if (onEntry) lines[low(c.remote_uuid)] = said;
    g.bookings.push({
      rowId: c.id,
      op: "create",
      uuid: low(c.remote_uuid),
      staffUuid: c.booking_staff_uuid,
      name: names.get(low(c.booking_staff_uuid)) ?? null,
      start: c.booking_start,
      end: c.booking_end,
      state: said,
      standing: onEntry,
    });
  }

  /* each status change once, above the bookings that depend on it */
  for (const s of statusRows.values()) {
    const behind = creates
      .filter((c) => c.depends_on === s.id)
      .map((c) => ({ create: c, takeBack: takeBacks.get(c.id) ?? null, mirror: mirrorIn(mirror.get(low(c.remote_uuid))) }));
    const said = statusLine(s, behind, hold);
    const g = groupOf(`status:${s.id}`, s.verb_id ?? s.id);
    touch(g, s);
    if (said) g.status = { rowId: s.id, state: said };
  }

  for (const r of clears) {
    const said = clearLine(r, hold);
    const g = groupOf(`verb:${r.verb_id ?? r.id}`, r.verb_id ?? r.id);
    touch(g, r);
    if (!said) continue;
    g.bookings.push({
      rowId: r.id,
      op: "clear",
      uuid: low(r.target_uuid),
      staffUuid: r.booking_staff_uuid,
      name: names.get(low(r.booking_staff_uuid)) ?? null,
      start: r.booking_start,
      end: r.booking_end,
      /* a Clear's doors are its presser's too */
      state: presser(r) ? said : { ...said, acts: said.acts.filter((a) => a === "open_in_sm8") },
      standing: false,
    });
  }

  const verbs: VerbView[] = [...groups.values()]
    .filter((g) => g.status || g.bookings.length > 0)
    .map((g) => ({
      verbId: g.verbId,
      presses: [...g.presses],
      at: g.at,
      status: g.status,
      bookings: g.bookings.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "") || (a.name ?? "").localeCompare(b.name ?? "")),
    }))
    .sort((a, b) => b.at.localeCompare(a.at));

  /* the bookings of this job we removed: its creates' uuids and its Clears'
     targets that the overlay counts gone */
  const ours = new Set<string>();
  for (const c of creates) for (const u of [c.remote_uuid, ...(c.replaced_uuids ?? [])]) if (u) ours.add(low(u));
  for (const r of clears) if (r.target_uuid) ours.add(low(r.target_uuid));
  const gone = [...overlay.gone].filter((u) => ours.has(u)).sort();

  /* the poll's to send: the queued bookings behind a status change that has
     gone, while every one of them is untried */
  const untried: string[] = [];
  for (const s of statusRows.values()) {
    if (s.status !== "sent") continue;
    const waiting = creates.filter((c) => c.depends_on === s.id && c.status === "queued" && !c.taken_back_at);
    if (waiting.length > 0 && waiting.every((c) => c.attempts === 0)) untried.push(...waiting.map((c) => c.id));
  }

  return { verbs, lines, gone, untried };
}
