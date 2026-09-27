/* Sending ONE booking row to ServiceM8 — server only (two-way phase 3, PR B).

   sm8-writes' sendOne hands every `booking` row here, after its account
   check and under its claim, and records whatever Finish comes back. Only
   TYPES come from sm8-writes, so there is no import cycle. The rules are
   the spec's 2.7, in its order; the decisions a line reads are
   sm8-booking-plan's.

   A BOOKING GOES AS THE APP, never as a person: nothing here impersonates
   anyone, so there is no confirmDead, and a 403 is the booking's, not a
   person's.

   BEFORE ANY REQUEST, IN THIS ORDER (no ServiceM8 call but rule 0's read):
   0. A STATUS ROW THAT MAY HAVE LANDED (its last POST got no answer, or its
      send lapsed) is read live before anything can end it: a Work Order is
      sent with no request; a Quote clears the mark and the rules go on;
      anything else ends it as the job read says. Not in a trial run.
   1. A status row pressed more than a day ago fails `stale`.
   2. The account's zone (sm8-booking-zone): unknown waits; a create booked
      in another zone is cancelled.
   3. A STATUS ROW NEVER GOES ALONE: only while a create that depends on it
      could go right behind it — not taken back, queued or sending, in the
      zone, its person active, starting at least 10 minutes ahead, and not
      within 10 minutes of its own day-old limit. None, and it waits out the
      two minutes after its press for its creates, then is cancelled.
   4. The job, active in the mirror.
   5. A create's person, active in the mirror.
   6. A create's start, still ahead.
   7. A create's status row: sent, it goes; waiting, it waits; a trial, it
      is a trial too (a verb is tried as one); failed or cancelled, it
      doesn't go — in words that don't claim the job stayed a Quote when the
      status row's answer was lost.
   8. An Undo's create: waited out under a live claim, stopped if it could
      still go, and what of it may be in ServiceM8 worked out.
   9. A TRIAL RUN STOPS HERE.

   EVERY REQUEST CHECKS ITS ACCOUNT (tokenMismatch) before any read and
   again inside every function handed to withSm8Renewal, so a request after
   a renewal whose token is another account's is never made: a DELETE never
   meets another account's 404, which would read as gone.

   ONCE A POST HAS GONE THE ROW IS NEVER LET GO. A POST has gone once it
   got any answer but a 401, or none. A read after it that no longer fits
   the claim is a read that failed, and each op says what that means. A
   DIFFERENCE SEEN ON THE ONLY READ THAT COULD BE MADE IS NEVER A FAILED
   READ: the record answered, with other values.

   EVERY WRITE IS READ BACK, and only a second read about 2 s later (U23)
   can call it "not kept" or "not found". A booking that comes back at
   another time, or right after our POST on someone else, a job that comes
   back with more than its status changed, and a booking answered OK that
   two reads can't find (call 15) each finish with `guard`: the run
   switches Bookings off at once and stops.

   A DELETE ON A BOOKING ALREADY REMOVED MAY PUT IT BACK (the notes walk,
   2026-09-27: ServiceM8's DELETE of a note already out of it restored the
   note). So every target is read live before its DELETE, and one not there
   or inactive gets none; each DELETE is read back after; and a take-back
   REMEMBERS THE UUIDS ITS DELETE REACHED (on the delete row, in
   verify_uuids), so its sender never sends one of them a second DELETE by
   itself, whatever a read says later — a person's Try again, which reads
   first, is the only way another goes. Its targets are one each, whatever
   their case. A lost answer, a retry or a lapsed lease reads before any
   DELETE, at least a minute on.

   A BOOKING IS NEVER POSTED AGAIN UNDER A FRESH UUID: our own uuid found on
   another job is marked changed there, never re-posted, and no answer here
   is ever a dead record. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { withSm8Renewal, type Renewed } from "./sm8-renew";
import { sm8CallOf } from "./sm8-http";
import {
  deleteSm8Booking,
  postSm8Booking,
  postSm8JobStatus,
  readSm8Booking,
  readSm8Job,
  readSm8JobBookings,
  type Sm8BookingResult,
  type Sm8LiveActivity,
  type Sm8LiveJob,
  type Sm8ReadFailure,
} from "./sm8-write";
import { createCanStillGo, deleteTargets, leaseLive, mayHaveLanded, sameEditDate } from "./sm8-note-plan";
import { fillWords, NOTE_WORDS } from "./sm8-note-words";
import {
  BOOKING_READBACK_SEES_INACTIVE,
  BOOKING_REREAD_MS,
  BOOKING_STATUS_LEAD_MS,
  BOOKING_STATUS_WAIT_MS,
  BOOKING_TTL_MS,
  BOOKING_WORDS,
  isFuture,
  reasonOf,
  STATUS_KEPT_FIELDS,
} from "./sm8-booking-plan";
import { bookingZone } from "./sm8-booking-zone";
import {
  NOTE_READ_BY_MS,
  NOTE_SEND_BY_MS,
  verdictFor,
  verdictForAccountUnknown,
  verdictForCheckFailed,
  verdictForDisconnected,
  verdictForGuard,
  verdictForLetGo,
  verdictForRenewLate,
  verdictForRenewUnreachable,
  verdictForWaitingOn,
  WRITE_WORDS,
  type Sm8WriteOp,
  type Sm8WriteOutcome,
  type Sm8WriteState,
  type Sm8WriteStatus,
  type VerdictContext,
  type WriteVerdict,
} from "./sm8-write-plan";
import type { Sm8Access } from "./sm8-store";
import type { Finish, WriteRow } from "./sm8-writes";

const TABLE = "sm8_writes";

type Sent = { finish: Finish; access: Sm8Access | null };

/** The claim's clocks, and how the second read-back waits (a test hands in
    one that moves its clock). */
export type BookingClock = { claimedAt: number; clock: () => number; sleep?: (ms: number) => Promise<void> };

const done = (status: Sm8WriteStatus, error: string | null, extra: Partial<Finish> = {}): Finish => ({
  status,
  error,
  httpStatus: null,
  ...extra,
});

const fromVerdict = (v: WriteVerdict, httpStatus: number | null = null): Finish => ({
  status: v.status,
  error: v.error,
  httpStatus,
  verdict: v,
});

/** The file sender's tokenMismatch, for a booking: a token that isn't for
    the row's account carries nothing — cancelled when it names another
    account, held when it names none. Null when it fits. */
function tokenMismatch(row: Pick<WriteRow, "tenant_id">, access: Sm8Access): Finish | null {
  if (access.tenantId === row.tenant_id) return null;
  if (access.tenantId === null) return fromVerdict(verdictForAccountUnknown());
  return done("cancelled", WRITE_WORDS.otherAccount);
}

/** Two uuids, as ServiceM8 and the mirror may case them. */
const same = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The spellings a mirror row's uuid may carry: ours is minted lower case,
    and ServiceM8 has handed back what it was sent. */
const spellings = (u: string) => [...new Set([u, u.toLowerCase(), u.toUpperCase()])];

const UNAVAILABLE: Sm8WriteOutcome = { kind: "unavailable", status: null };

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A zone HeyTiff doesn't know: the row waits ten minutes, handed back — a
    status row too, before its alone rule, so a zone that is unreadable for
    a moment never cancels it. */
const ZONE_WAIT_MS = 10 * 60_000;

function zoneUnknown(): Finish {
  return fromVerdict({ ...verdictForCheckFailed("booking"), error: BOOKING_WORDS.row.zoneUnknown, retryAfterMs: ZONE_WAIT_MS });
}

/** What a renewal that didn't come back `ok` makes of the row. Null for
    `ok`: the caller reads the result. A booking passes no confirmDead, so
    `unconfirmed` never comes; if it did, it would be read as the grant's. */
function renewalFinish<T>(out: Renewed<T>, httpStatus: number | null): Finish | null {
  switch (out.verdict) {
    case "unreachable":
      return fromVerdict(verdictForRenewUnreachable(), httpStatus);
    case "gone":
      return fromVerdict(verdictForDisconnected(), httpStatus);
    case "late":
      return fromVerdict(verdictForRenewLate(), httpStatus);
    case "dead":
    case "unconfirmed":
      return fromVerdict(verdictFor({ kind: "unauthorized" }, 0), httpStatus);
    default:
      return null;
  }
}

/** Pressed longer ago than `ms`. A row with no press time is never old. */
function olderThan(iso: string | null | undefined, ms: number, now: number): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  return !Number.isNaN(at) && now - at > ms;
}

/** A booking's start moved on the wall clock by `minutes`, as text: the
    stamp read as a naive time and written back, never through the zone. */
export function shiftStamp(stamp: string, minutes: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(stamp);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + minutes * 60_000;
  return new Date(t).toISOString().slice(0, 19).replace("T", " ");
}

/** Recorded time, never a booking: a check-in, or time added by hand
    (P4: a row of its own, not scheduled). */
const isRecorded = (a: Sm8LiveActivity) => a.recorded === 1 || a.scheduled !== 1;

/** A row that is nothing: clearing recorded time in ServiceM8 leaves it
    active with its end on its start (P4's clean-up). An open check-in has
    no end yet, and is something. */
const zeroLength = (a: Sm8LiveActivity) => !!a.start && !!a.end && a.start === a.end;

/** THE OVERLAP RULE (U9, whichever answer it has): a check-in by the
    booking's person that starts from two hours before the booking to its
    end. The person and the window are the TARGET's, as read live — a
    booking a guard recorded on someone else, or at another time, is
    checked against whoever and whenever ServiceM8 holds it. Zero-length
    rows are nothing; time added by hand with no start (P4: it lands at
    00:00) counts, which only ever refuses. */
export function checkedIn(target: Sm8LiveActivity, activities: readonly Sm8LiveActivity[]): boolean {
  if (!target.start || !target.staffUuid) return false;
  const from = shiftStamp(target.start, -120);
  const to = target.end ?? target.start;
  if (!from) return false;
  return activities.some(
    (x) =>
      !same(x.uuid, target.uuid) &&
      same(x.staffUuid, target.staffUuid) &&
      isRecorded(x) &&
      !zeroLength(x) &&
      !!x.start &&
      x.start >= from &&
      x.start <= to
  );
}

/** The six guarded fields that differ between two reads of a job. */
function fieldsMoved(before: Sm8LiveJob, after: Sm8LiveJob): string[] {
  return STATUS_KEPT_FIELDS.filter((f) => (before.kept[f] ?? null) !== (after.kept[f] ?? null));
}

/** How a booking read back compares with what the row booked. */
type Compared = "equal" | "person" | "time";

function compare(a: Sm8LiveActivity, row: WriteRow): Compared {
  if (!same(a.staffUuid, row.booking_staff_uuid)) return "person";
  if (a.start !== (row.booking_start ?? null) || a.end !== (row.booking_end ?? null) || a.scheduled !== 1) return "time";
  return "equal";
}

export async function sendBookingRow(
  orgId: string,
  state: Sm8WriteState,
  row: WriteRow,
  attempts: number,
  access: Sm8Access | null,
  t: BookingClock
): Promise<Sent> {
  const op: Sm8WriteOp = row.op === "update" || row.op === "delete" ? row.op : "create";
  const out = await sendBooking(orgId, state, row, op, attempts, access, t);
  /* NEVER A FRESH UUID FOR A BOOKING. Nothing above answers with a dead
     record; if a verdict ever asked for one, the row fails as refused
     instead of going again under a new uuid (which could book twice). */
  if (out.finish.verdict?.freshUuid) {
    console.error(`[sm8] booking ${row.id} came back asking for a fresh uuid; failed instead`);
    const ctx: VerdictContext = { now: t.clock(), timezoneName: state.timezoneName, freeRetries: 0, kind: "booking", op };
    out.finish = { ...out.finish, ...fromVerdict(verdictFor({ kind: "rejected", status: 409 }, attempts, ctx), out.finish.httpStatus) };
  }
  return out;
}

async function sendBooking(
  orgId: string,
  state: Sm8WriteState,
  row: WriteRow,
  op: Sm8WriteOp,
  attempts: number,
  given: Sm8Access | null,
  t: BookingClock
): Promise<Sent> {
  let access = given;
  const ctx = (): VerdictContext => ({
    now: t.clock(),
    timezoneName: state.timezoneName,
    freeRetries: row.free_retries ?? 0,
    kind: "booking",
    op,
  });
  const elapsed = () => t.clock() - t.claimedAt;
  const readInTime = () => elapsed() < NOTE_READ_BY_MS;
  const sendInTime = () => elapsed() < NOTE_SEND_BY_MS;
  const letGo = (): Finish => fromVerdict(verdictForLetGo(row.free_retries ?? 0, "booking"));
  const checkFailed = (): Finish => fromVerdict(verdictForCheckFailed("booking"));
  const failedRead = (): Finish => fromVerdict(verdictFor(UNAVAILABLE, attempts, ctx()));
  const sleep = t.sleep ?? realSleep;
  const live = state.mode === "live" && access !== null ? access : null;
  if (!row.sm8_job_uuid) return { finish: done("cancelled", BOOKING_WORDS.row.jobGone), access };
  const jobUuid: string = row.sm8_job_uuid;

  /** One live read, the account asking, renewed once on a 401. BEFORE a
      write, a read that no longer fits the claim lets the row go; AFTER one
      (`after`), it is a read that failed, and the row is never let go. A
      Finish back is the read not made: the verdict it goes back with. */
  const readLive = async <C extends { ok: true } | Sm8ReadFailure>(
    fn: (a: Sm8Access) => Promise<C>,
    after = false
  ): Promise<{ got: Extract<C, { ok: true }> } | { finish: Finish }> => {
    if (!readInTime()) return { finish: after ? failedRead() : letGo() };
    const wrong = tokenMismatch(row, access!);
    if (wrong) return { finish: wrong };
    const got = await withSm8Renewal<{ c?: C; finish?: Finish }>(
      orgId,
      access!,
      async (a) => {
        const w = tokenMismatch(row, a);
        if (w) return { finish: w };
        return { c: await fn(a) };
      },
      (r) => !!r.c && !r.c.ok && (r.c as Sm8ReadFailure).unauthorized === true,
      { retry: readInTime }
    );
    access = got.access;
    const renewal = renewalFinish(got, null);
    if (renewal) return { finish: after && got.verdict === "late" ? failedRead() : renewal };
    if (got.result.finish) return { finish: got.result.finish };
    const c = got.result.c!;
    if (!c.ok) return { finish: fromVerdict(verdictFor((c as Sm8ReadFailure).limited ?? UNAVAILABLE, attempts, ctx())) };
    return { got: c as Extract<C, { ok: true }> };
  };

  /** The second read, about 2 s after the first (U23), made only while a
      read still fits. Null when it can't be made in time. */
  const readAgain = async <C extends { ok: true } | Sm8ReadFailure>(
    fn: (a: Sm8Access) => Promise<C>
  ): Promise<{ got: Extract<C, { ok: true }> } | { finish: Finish } | null> => {
    if (elapsed() + BOOKING_REREAD_MS >= NOTE_READ_BY_MS) return null;
    await sleep(BOOKING_REREAD_MS);
    if (!readInTime()) return null;
    return readLive(fn, true);
  };

  /** One request as the app, renewed once on a 401. `before` runs inside
      every attempt, after the account check, with that attempt's access; a
      Finish from it goes back without a request. */
  const writeApp = async (
    request: (a: Sm8Access) => Promise<Sm8BookingResult>,
    before?: (a: Sm8Access) => Promise<Finish | null>
  ): Promise<{ res: Sm8BookingResult } | { finish: Finish }> => {
    const got = await withSm8Renewal<{ res?: Sm8BookingResult; finish?: Finish }>(
      orgId,
      access!,
      async (a) => {
        const w = tokenMismatch(row, a);
        if (w) return { finish: w };
        const stop = before ? await before(a) : null;
        if (stop) return { finish: stop };
        return { res: await request(a) };
      },
      (r) => r.res?.outcome.kind === "unauthorized",
      { retry: sendInTime }
    );
    access = got.access;
    const renewal = renewalFinish(got, got.result.res?.status ?? null);
    if (renewal) return { finish: renewal };
    if (got.result.finish) return { finish: got.result.finish };
    return { res: got.result.res! };
  };

  const readJob = (after = false) => readLive((a) => readSm8Job(sm8CallOf(a, "write"), jobUuid), after);

  /* ── 0. a status row that may have landed: read the job before anything
     can end it ── */
  let jobRead: Sm8LiveJob | null = null;
  let ruledOut = false;
  if (op === "update" && mayHaveLanded(row) && live) {
    const r = await readJob();
    if ("finish" in r) return { finish: r.finish, access };
    const job = r.got.found ? r.got.job : null;
    const cleared: Partial<Finish> = { ownRuledOut: true, verifyUuids: [] };
    if (!job || job.active !== 1) return { finish: done("cancelled", BOOKING_WORDS.row.jobGone, cleared), access };
    if (job.status === "Work Order") return { finish: done("sent", null, { landedEditDate: job.editDate }), access };
    if (job.status !== "Quote") {
      return { finish: done("cancelled", fillWords(BOOKING_WORDS.row.jobNotBookable, { status: job.status ?? "closed" }), cleared), access };
    }
    /* still a Quote: nothing landed, and the mark goes whatever the row
       finishes as — unless a POST in this attempt loses its answer again */
    jobRead = job;
    ruledOut = true;
  }
  const kept: Partial<Finish> = ruledOut ? { ownRuledOut: true, verifyUuids: [] } : {};
  const end = (f: Finish): Sent => ({ finish: { ...f, ...kept }, access });

  /* ── 1. a status row's day-old rule ── */
  if (op === "update" && olderThan(row.pressed_at, BOOKING_TTL_MS, t.clock())) {
    return end(done("failed", BOOKING_WORDS.row.stale));
  }

  /* ── 2. the zone ── */
  const z = await bookingZone(orgId);
  if (z.zone === null) return end(z.why === "unread" ? checkFailed() : zoneUnknown());
  const zone = z.zone;
  if (op === "create" && row.booking_zone !== zone) return end(done("cancelled", BOOKING_WORDS.row.zoneChanged));

  /* ── 3. a status row never goes alone ── */
  if (op === "update") {
    const behind = await couldGoBehind(orgId, row, zone, t.clock(), true);
    if (behind === "failed") return end(checkFailed());
    if (behind === "none") {
      const now = t.clock();
      if (!olderThan(row.pressed_at, BOOKING_STATUS_WAIT_MS, now)) return end(fromVerdict(verdictForWaitingOn(now + 30_000, now)));
      return end(done("cancelled", BOOKING_WORDS.row.statusAlone));
    }
  }

  /* ── 4. the job, in the mirror ── */
  const mirrorJob = await readMirrorJob(orgId, jobUuid);
  if (mirrorJob === "failed") return end(checkFailed());
  if (!mirrorJob || mirrorJob.active !== 1) return end(done("cancelled", BOOKING_WORDS.row.jobGone));

  /* ── 5. a create's person ── */
  let person = "";
  if (op === "create") {
    const who = await readMirrorStaff(orgId, row.booking_staff_uuid ?? "");
    if (who === "failed") return end(checkFailed());
    person = who?.name ?? THE_PERSON;
    if (!who || who.active !== 1) return end(done("cancelled", fillWords(BOOKING_WORDS.row.techInactive, { name: person })));
  }

  /* ── 6. a create's start ── */
  if (op === "create" && !isFuture(row.booking_start, zone, t.clock())) return end(done("cancelled", BOOKING_WORDS.row.past));

  /* ── 7. a create's status row ── */
  if (op === "create" && row.depends_on) {
    const s = await readStatusRow(orgId, row.depends_on);
    if (s === "failed") return end(checkFailed());
    if (!s) return end(done("cancelled", BOOKING_WORDS.row.statusFirst));
    if (s.status === "queued" || s.status === "sending") {
      const now = t.clock();
      const until = Math.max(Date.parse(s.next_attempt_at ?? "") || 0, Date.parse(s.lease_until ?? "") || 0);
      return end(fromVerdict(verdictForWaitingOn(until, now)));
    }
    /* a verb is tried as one, whatever the mode is now */
    if (s.status === "trial") return end(done("trial", null));
    if (s.status !== "sent") {
      return end(done("cancelled", mayHaveLanded(s) ? BOOKING_WORDS.row.statusUnsure : BOOKING_WORDS.row.statusFirst));
    }
    /* a status change a guard recorded: Bookings is off, and nothing goes
       behind it */
    if (reasonOf(s.last_error) === "fieldsNotKept") {
      return end(done("cancelled", fillWords(BOOKING_WORDS.row.guardStopped, { number: mirrorJob.number ?? jobUuid.slice(0, 8) })));
    }
  }

  /* ── 8. an Undo's create ── */
  let targets: string[] = [];
  let undoCreate: CreateRead | null = null;
  if (op === "delete") {
    if (row.depends_on) {
      const settled = await settleCreate(orgId, row, t.clock);
      if ("finish" in settled) return end(settled.finish);
      targets = settled.targets;
      undoCreate = settled.create;
    } else if (row.target_uuid) {
      targets = [row.target_uuid];
    } else {
      return end(done("cancelled", NOTE_WORDS.row.nothingToTakeBack));
    }
  }

  /* ── 9. a trial run goes this far and no further ── */
  if (!live) return end(done("trial", null));
  access = live;

  if (op === "update") return end(await sendUpdate());
  if (op === "delete") return end(await sendDelete());
  return end(await sendCreate());

  /* ── a Quote made a Work Order ── */
  async function sendUpdate(): Promise<Finish> {
    /* 1. the job, live — rule 0's read when there was one */
    let job = jobRead;
    if (!job) {
      const r = await readJob();
      if ("finish" in r) return r.finish;
      job = r.got.found ? r.got.job : null;
    }
    if (!job || job.active !== 1) return done("cancelled", BOOKING_WORDS.row.jobGone);
    if (job.status === "Work Order") return done("sent", null, { landedEditDate: job.editDate });
    if (job.status !== "Quote") return done("cancelled", fillWords(BOOKING_WORDS.row.jobNotBookable, { status: job.status ?? "closed" }));
    if (!sameEditDate(job.editDate, row.seen_edit_date ?? null)) {
      /* our own last status change on this job left its edit time: that is
         as seen */
      const ours = await lastLandedStatus(orgId, jobUuid, row.id);
      if (ours === "failed") return checkFailed();
      if (!ours || !sameEditDate(job.editDate, ours)) return done("cancelled", BOOKING_WORDS.row.changed);
    }
    const seen = job;

    /* 2. the POST, with the last check inside every attempt */
    if (!sendInTime()) return letGo();
    const posted = await writeApp(
      (a) => postSm8JobStatus(sm8CallOf(a, "write"), jobUuid, "Work Order"),
      async () => {
        const c = await statusStillWanted(orgId, row, zone, t.clock());
        if (c === "go") return null;
        if (c === "taken_back") return done("cancelled", NOTE_WORDS.row.takenBackBeforeSent);
        if (c === "alone") return done("cancelled", BOOKING_WORDS.row.statusAlone);
        return checkFailed();
      }
    );
    if ("finish" in posted) return posted.finish;
    const { res } = posted;

    /* 3. a 2xx: read the job back */
    if (res.outcome.kind === "created") {
      /* the fields guard: the job IS a Work Order, so it is sent — and one
         that came back neither a Quote nor a Work Order failed, since it
         isn't one — and either way Bookings goes off */
      const guarded = (j: Sm8LiveJob): Finish => ({
        ...fromVerdict(verdictForGuard(j.status === "Work Order" ? "sent" : "failed", BOOKING_WORDS.row.fieldsNotKept), res.status),
        landedEditDate: j.editDate,
        guard: true,
      });
      const kept = (j: Sm8LiveJob) => j.status === "Work Order" && fieldsMoved(seen, j).length === 0;
      const first = await readJob(true);
      /* a read that failed: the 2xx stands */
      if ("finish" in first || !first.got.found) return done("sent", null, { httpStatus: res.status, landedEditDate: null });
      let after = first.got.job;
      if (!kept(after)) {
        /* a difference is read again about 2 s later (U23) */
        const again = await readAgain((a) => readSm8Job(sm8CallOf(a, "write"), jobUuid));
        const second = again && !("finish" in again) && again.got.found ? again.got.job : null;
        if (!second) {
          /* the second read couldn't be made. A Quote is never recorded
             sent: it goes back as a lost answer would, and rule 0 reads the
             job next time. A difference on the only read that could be made
             is never a failed read: it stays the fields guard. */
          if (after.status === "Quote") return { ...failedRead(), httpStatus: res.status, remote: res.remote, uploadLost: true };
          return guarded(after);
        }
        after = second;
        if (after.status === "Quote") return done("failed", BOOKING_WORDS.row.statusNotKept, { httpStatus: res.status });
        if (!kept(after)) return guarded(after);
      }
      logLoggedFields(jobUuid, seen, after);
      return done("sent", null, { httpStatus: res.status, landedEditDate: after.editDate });
    }

    /* 4. other answers */
    if (res.status === 404) return done("cancelled", BOOKING_WORDS.row.jobGone, { httpStatus: 404 });
    const v = verdictFor(res.outcome, attempts, ctx());
    /* no answer, a 408 or a 5xx: it may have made the job a Work Order */
    if (res.outcome.kind === "unavailable") return { ...fromVerdict(v, res.status), remote: res.remote, uploadLost: true };
    return { ...fromVerdict(v, res.status), remote: res.remote };
  }

  /* ── one booking ── */
  async function sendCreate(): Promise<Finish> {
    let verify = [...(row.verify_uuids ?? [])];
    const postUuid = row.remote_uuid;
    let ownRuledOut = false;
    let unsure = false;

    /* 1. READ BACK FIRST: our own uuid when an answer under it was lost,
       then each older uuid still waiting for its check */
    const toRead = [...(row.maybe_landed ? [row.remote_uuid] : []), ...verify.filter((u) => !same(u, row.remote_uuid))];
    for (const uuid of toRead) {
      const own = same(uuid, row.remote_uuid);
      const r = await readLive((a) => readSm8Booking(sm8CallOf(a, "write"), uuid));
      if ("finish" in r) return { ...r.finish, verifyUuids: verify };
      const c = r.got;
      if (c.found && same(c.activity.jobUuid, jobUuid)) {
        if (c.activity.active === 1) return landedEarlier(uuid, own, c.activity);
        /* inactive: somebody removed it */
        if (own) return done("cancelled", BOOKING_WORDS.row.bookingGone, { verifyUuids: verify });
        verify = verify.filter((u) => u !== uuid);
        continue;
      }
      if (c.found) {
        /* on another job. Ours there was moved in ServiceM8: marked changed
           there and never posted again under a fresh uuid. An older uuid
           there isn't this booking. */
        if (own) return done("sent", BOOKING_WORDS.row.movedThere, { remoteUuid: uuid, verifyUuids: [], landedEditDate: c.activity.editDate });
        verify = verify.filter((u) => u !== uuid);
        continue;
      }
      /* not there */
      if (!own) {
        verify = verify.filter((u) => u !== uuid);
        continue;
      }
      if (BOOKING_READBACK_SEES_INACTIVE) {
        ownRuledOut = true;
        continue;
      }
      /* "never landed" can't be told from "landed, and somebody removed
         it": nothing is posted, and a person decides */
      unsure = true;
    }
    const kept = { verifyUuids: verify, ownRuledOut };
    if (unsure) return done("failed", BOOKING_WORDS.row.bookingUnsure, kept);

    /* 2. THE DAY-OLD RULE, after the read-back: one found landed is sent */
    if (olderThan(row.pressed_at, BOOKING_TTL_MS, t.clock())) return done("failed", BOOKING_WORDS.row.stale, kept);

    /* 3. the pre-checks, both live */
    const j = await readJob();
    if ("finish" in j) return { ...j.finish, ...kept };
    const job = j.got.found ? j.got.job : null;
    if (!job || job.active !== 1) return done("cancelled", BOOKING_WORDS.row.jobGone, kept);
    if (job.status !== "Quote" && job.status !== "Work Order") {
      return done("cancelled", fillWords(BOOKING_WORDS.row.jobNotBookable, { status: job.status ?? "closed" }), kept);
    }
    const b = await readLive((a) => readSm8JobBookings(sm8CallOf(a, "write"), jobUuid));
    if ("finish" in b) return { ...b.finish, ...kept };
    const mine = b.got.activities.find((a) => same(a.uuid, postUuid));
    /* ours already there, though no answer was lost: it is the booking */
    if (mine) return landedEarlier(postUuid, true, mine);
    const taken = b.got.activities.some(
      (a) => a.scheduled === 1 && same(a.staffUuid, row.booking_staff_uuid) && a.start === (row.booking_start ?? null)
    );
    if (taken) return done("cancelled", fillWords(BOOKING_WORDS.row.slotTaken, { name: person }), kept);

    /* 4. THE POST, with the last check part of every attempt */
    if (!sendInTime()) return { ...letGo(), ...kept };
    let takenBack = false;
    const posted = await writeApp(
      (a) =>
        postSm8Booking(sm8CallOf(a, "write"), {
          uuid: postUuid,
          jobUuid,
          staffUuid: row.booking_staff_uuid ?? "",
          start: row.booking_start ?? "",
          end: row.booking_end ?? "",
        }),
      async () => {
        const c = await createStillWanted(orgId, row.id);
        if (c === "go") return null;
        if (c === "taken_back") {
          takenBack = true;
          return done("cancelled", NOTE_WORDS.row.takenBackBeforeSent, kept);
        }
        return { ...checkFailed(), ...kept };
      }
    );
    if ("finish" in posted) {
      if (takenBack) return posted.finish;
      return { ...posted.finish, ...kept };
    }
    const { res } = posted;
    const base = { ...kept, remote: res.remote, httpStatus: res.status };

    /* 5. a 2xx: FROM HERE THE ROW IS NEVER LET GO */
    if (res.outcome.kind === "created") {
      const theirs = res.recordUuid && !same(res.recordUuid, postUuid) ? res.recordUuid : null;
      const ours = await readBack(postUuid);
      if (ours.state === "failed") {
        /* the 2xx stands; a read that failed never makes "not found" */
        return done("sent", null, { ...base, landedEditDate: null, ...(theirs ? { remoteUuid: theirs, replacedUuids: [postUuid] } : {}) });
      }
      if (ours.state === "found") return landedNow(postUuid, ours, base);
      if (ours.state === "gone") return done("cancelled", BOOKING_WORDS.row.bookingGone, base);
      /* ours not found on two reads: ServiceM8 may have kept a uuid of its
         own (U1) */
      if (theirs) {
        const other = await readBack(theirs);
        if (other.state === "failed") {
          return done("sent", null, { ...base, landedEditDate: null, remoteUuid: theirs, replacedUuids: [postUuid] });
        }
        if (other.state === "found") {
          console.warn(`[sm8] booking kept under ServiceM8's own uuid (row ${row.id})`);
          return landedNow(theirs, other, { ...base, replacedUuids: [postUuid] });
        }
        if (other.state === "gone") return done("cancelled", BOOKING_WORDS.row.bookingGone, base);
      }
      /* NOT FOUND UNDER EITHER UUID, on two reads of each: unsure, the mark
         kept, the answer's uuid waiting for its check so a take-back names
         it — and Bookings off (call 15) */
      return {
        ...fromVerdict(verdictForGuard("failed", BOOKING_WORDS.row.bookingUnsure), res.status),
        ...base,
        uploadLost: true,
        verifyUuids: theirs ? [...new Set([...verify, theirs])] : verify,
        guard: true,
      };
    }

    /* 6. a 400 or a 409: is ours there after all? */
    if (res.status === 400 || res.status === 409) {
      const ours = await readBack(postUuid);
      if (ours.state === "failed") return { ...ours.why, ...base, uploadLost: true };
      if (ours.state === "found") return landedNow(postUuid, ours, base);
      if (ours.state === "gone") return done("cancelled", BOOKING_WORDS.row.bookingGone, base);
      return { ...fromVerdict(verdictFor(res.outcome, attempts, ctx()), res.status), ...base };
    }
    const v = verdictFor(res.outcome, attempts, ctx());
    /* no answer, a 408 or a 5xx: it may have landed */
    if (res.outcome.kind === "unavailable") return { ...fromVerdict(v, res.status), ...base, uploadLost: true };
    return { ...fromVerdict(v, res.status), ...base };
  }

  /** A booking of ours found landed by the read-back BEFORE a POST (step 1,
      after a lost answer): sent, and never posted again. This person, start
      and end: sent. Our own uuid with this person at another time: the
      time guard (a lost answer is no way round it). Anything else — another
      person, or an older attempt at other times — was changed in ServiceM8,
      or is an older attempt's: sent with the `movedThere` marker, no
      Undo. */
  async function landedEarlier(uuid: string, own: boolean, a: Sm8LiveActivity): Promise<Finish> {
    const sentAs = (extra: Partial<Finish>): Finish => done("sent", null, { remoteUuid: uuid, verifyUuids: [], ...extra });
    const how = compare(a, row);
    if (how === "equal") return sentAs({ landedEditDate: a.editDate });
    if (own && how === "time") {
      const again = await readAgain((x) => readSm8Booking(sm8CallOf(x, "write"), uuid));
      const second = again && !("finish" in again) && again.got.found ? again.got.activity : null;
      if (second && second.active === 1 && same(second.jobUuid, jobUuid) && compare(second, row) === "equal") {
        return sentAs({ landedEditDate: second.editDate });
      }
      const last = second ?? a;
      return {
        ...fromVerdict(verdictForGuard("sent", BOOKING_WORDS.row.timeNotKept)),
        remoteUuid: uuid,
        verifyUuids: [],
        landedEditDate: last.editDate,
        guard: true,
      };
    }
    return done("sent", BOOKING_WORDS.row.movedThere, { remoteUuid: uuid, verifyUuids: [], landedEditDate: a.editDate });
  }

  /** A booking found right after our own POST (or its 400 or 409): nobody
      can have moved it yet, so any difference is ServiceM8's, and trips a
      guard — `personNotKept` for another person or none, `timeNotKept`
      for other times or flag. It is recorded SENT under the uuid it was
      found under (it exists, so Undo can remove it), with the edit time the
      last read found. */
  function landedNow(uuid: string, found: Extract<ReadBack, { state: "found" }>, extra: Partial<Finish>): Finish {
    const remote = same(uuid, row.remote_uuid) ? {} : { remoteUuid: uuid };
    if (found.how === "equal") return done("sent", null, { ...extra, ...remote, landedEditDate: found.activity.editDate });
    const words = found.how === "person" ? BOOKING_WORDS.row.personNotKept : BOOKING_WORDS.row.timeNotKept;
    return {
      ...extra,
      ...fromVerdict(verdictForGuard("sent", words), extra.httpStatus ?? null),
      ...remote,
      landedEditDate: found.activity.editDate,
      guard: true,
    };
  }

  /** Our booking read back AFTER our POST, on two reads where the first
      doesn't settle it (U23): `found` on this job and active (with how it
      compares, a difference read twice or with no second read to make),
      `gone` on this job and inactive, `none` when neither read finds it on
      this job, and `failed` when a read couldn't be made — never "not
      found". */
  type ReadBack =
    | { state: "found"; activity: Sm8LiveActivity; how: Compared }
    | { state: "gone" }
    | { state: "none" }
    | { state: "failed"; why: Finish };

  async function readBack(uuid: string): Promise<ReadBack> {
    const read = (a: Sm8Access) => readSm8Booking(sm8CallOf(a, "write"), uuid);
    const classify = (c: { found: false } | { found: true; activity: Sm8LiveActivity }): ReadBack => {
      if (!c.found || !same(c.activity.jobUuid, jobUuid)) return { state: "none" };
      if (c.activity.active !== 1) return { state: "gone" };
      return { state: "found", activity: c.activity, how: compare(c.activity, row) };
    };
    const first = await readLive(read, true);
    if ("finish" in first) return { state: "failed", why: first.finish };
    const one = classify(first.got);
    if (one.state === "gone" || (one.state === "found" && one.how === "equal")) return one;
    const again = await readAgain(read);
    if (again === null) {
      /* the second read couldn't be made: a difference already seen stays
         (never a failed read); "not found" needs both reads */
      return one.state === "found" ? one : { state: "failed", why: failedRead() };
    }
    if ("finish" in again) return one.state === "found" ? one : { state: "failed", why: again.finish };
    const two = classify(again.got);
    /* found once and not the second time: it was there, as the first read
       found it */
    if (two.state === "none" && one.state === "found") return one;
    return two;
  }

  /* ── an Undo or a Clear ──

     FOR EACH TARGET, IN THIS ORDER — because a DELETE on a booking already
     out of ServiceM8 may put it back:
     1. READ IT LIVE. Not there, or there and inactive: out already, and no
        DELETE goes. A read that fails is never "out": the row goes back to
        the queue, and its next go reads first again. A target this
        take-back's DELETE already reached (remembered on the row) is only
        read, never sent a second DELETE by itself: out, it is out; still
        there on a second read, the row fails in words that say so.
     2 and 3. The checks an Undo or a Clear makes against what it read.
     4. THE OVERLAP RULE: no check-in by the booking's person in its window.
     5. THE DELETE, the account checked inside every attempt; the one after
        a token renewal reads again first.
     6. READ IT BACK: still there on a second read fails; a read that fails,
        or no longer fits the claim, counts as out — the DELETE answered.
     Between targets the row may let go (the next attempt reads every
     target again); after a DELETE in this attempt it waits the second
     read's time first. The DELETE's status is kept on the row. */
  async function sendDelete(): Promise<Finish> {
    const reached = new Set((row.verify_uuids ?? []).map((u) => u.toLowerCase()));
    let httpStatus: number | null = null;
    let deletedNow = false;
    let landedEditDate: string | null = null;
    const letGoHere = (): Finish => (deletedNow ? { ...letGo(), retryAfterMs: BOOKING_REREAD_MS } : letGo());
    const held = (f: Finish, targetUuid?: string): Finish => ({
      ...f,
      httpStatus: f.httpStatus ?? httpStatus,
      verifyUuids: [...reached],
      ...(targetUuid ? { targetUuid } : {}),
    });
    /* one target per record, whatever its case */
    const seen = new Set<string>();
    const unique = targets.filter((u) => (seen.has(u.toLowerCase()) ? false : (seen.add(u.toLowerCase()), true)));

    for (const [i, target] of unique.entries()) {
      /* 1 */
      if (!readInTime()) return held(letGoHere());
      const first = await readLive((a) => readSm8Booking(sm8CallOf(a, "write"), target));
      if ("finish" in first) return held(first.finish);
      if (!first.got.found || first.got.activity.active !== 1) {
        if (i === 0 && first.got.found) landedEditDate = first.got.activity.editDate;
        continue;
      }
      if (reached.has(target.toLowerCase())) {
        /* our DELETE reached it already: read again, never sent another */
        const again = await readAgain((a) => readSm8Booking(sm8CallOf(a, "write"), target));
        if (again === null) return held(letGoHere());
        if ("finish" in again) return held(again.finish);
        if (!again.got.found || again.got.activity.active !== 1) {
          if (i === 0 && again.got.found) landedEditDate = again.got.activity.editDate;
          continue;
        }
        return held(done("failed", BOOKING_WORDS.row.removeNotKept), target);
      }
      const booked = first.got.activity;

      /* 2 and 3 */
      const refused = undoCreate ? undoRefusal(undoCreate, booked) : await clearRefusal(booked);
      if (refused) return held(refused, target);

      /* 4 */
      const b = await readLive((a) => readSm8JobBookings(sm8CallOf(a, "write"), booked.jobUuid ?? jobUuid));
      if ("finish" in b) return held(b.finish);
      if (checkedIn(booked, b.got.activities)) return held(done("cancelled", BOOKING_WORDS.row.checkIn), target);

      /* 5 */
      if (!sendInTime()) return held(letGoHere());
      let outMeanwhile = false;
      let tries = 0;
      const sent = await writeApp(
        (a) => deleteSm8Booking(sm8CallOf(a, "write"), target),
        async (a) => {
          /* the first attempt goes on the read just made */
          if (tries++ === 0) return null;
          if (!readInTime()) return letGoHere();
          const again = await readSm8Booking(sm8CallOf(a, "write"), target).catch(() => ({ ok: false }) as Sm8ReadFailure);
          if (!again.ok) return fromVerdict(verdictFor(again.limited ?? UNAVAILABLE, attempts, ctx()));
          if (!again.found || again.activity.active !== 1) {
            outMeanwhile = true;
            return done("sent", null);
          }
          return sendInTime() ? null : letGoHere();
        }
      );
      if (outMeanwhile) continue;
      if ("finish" in sent) return held(sent.finish);
      const { res } = sent;
      httpStatus = res.status;

      /* 6: an answer that could mean it moved — a 2xx, a 404 or a 409 */
      if (res.outcome.kind === "created" || res.status === 404 || res.status === 409) {
        reached.add(target.toLowerCase());
        deletedNow = true;
        const after = await readLive((a) => readSm8Booking(sm8CallOf(a, "write"), target), true);
        /* the DELETE answered: a read that fails counts as out */
        if ("finish" in after || !after.got.found || after.got.activity.active !== 1) {
          if (i === 0 && !("finish" in after) && after.got.found) landedEditDate = after.got.activity.editDate;
          continue;
        }
        const again = await readAgain((a) => readSm8Booking(sm8CallOf(a, "write"), target));
        if (again === null || "finish" in again || !again.got.found || again.got.activity.active !== 1) {
          if (i === 0 && again && !("finish" in again) && again.got.found) landedEditDate = again.got.activity.editDate;
          continue;
        }
        /* still there: never another DELETE by itself */
        const words = res.status === 409 ? BOOKING_WORDS.row.removeRefused : BOOKING_WORDS.row.removeNotKept;
        return held(done("failed", words, { httpStatus: res.status, remote: res.remote }), target);
      }

      /* 7: any other answer goes by the verdict rules; a lost one (none, a
         408, a 5xx) goes back to the queue and reads first, a minute on */
      return held({ ...fromVerdict(verdictFor(res.outcome, attempts, ctx()), res.status), remote: res.remote });
    }
    return done("sent", null, { httpStatus, targetUuid: unique[0], landedEditDate, verifyUuids: [] });
  }

  /** An Undo's checks against the booking as read live (2.7 delete step 2).
      What was booked is compared — job, person, start and end — never its
      edit time alone (U21: the booked person opening it moves that). A
      booking a guard recorded compares its job and its edit time against
      the one the guard found, since what was booked can't be. A booking
      marked changed there is never taken out. Nothing under way or done,
      and no recorded time, is ever taken out. */
  function undoRefusal(create: CreateRead, a: Sm8LiveActivity): Finish | null {
    const reason = reasonOf(create.last_error);
    const changed = done("cancelled", BOOKING_WORDS.row.changedNoTakeBack);
    if (create.status === "sent" && reason === "movedThere") return changed;
    const guarded = create.status === "sent" && (reason === "timeNotKept" || reason === "personNotKept");
    if (guarded) {
      if (!same(a.jobUuid, create.sm8_job_uuid) || !sameEditDate(a.editDate, create.landed_edit_date ?? null)) return changed;
    } else if (
      !same(a.jobUuid, create.sm8_job_uuid) ||
      !same(a.staffUuid, create.booking_staff_uuid) ||
      a.start !== (create.booking_start ?? null) ||
      a.end !== (create.booking_end ?? null)
    ) {
      return changed;
    }
    if (!isFuture(a.start, zone, t.clock())) return done("cancelled", BOOKING_WORDS.row.notFuture);
    if (isRecorded(a)) return done("cancelled", BOOKING_WORDS.row.checkIn);
    return null;
  }

  /** A Clear's checks (2.7 delete step 3): the booking as read live, against
      the one its presser's confirm showed, and the job, read live, still
      finished. */
  async function clearRefusal(a: Sm8LiveActivity): Promise<Finish | null> {
    if (!same(a.jobUuid, row.sm8_job_uuid)) return done("cancelled", BOOKING_WORDS.row.notLeftover);
    if (isRecorded(a)) return done("cancelled", BOOKING_WORDS.row.checkIn);
    if (!isFuture(a.start, zone, t.clock())) return done("cancelled", BOOKING_WORDS.row.notFuture);
    if (!same(a.staffUuid, row.booking_staff_uuid) || a.start !== (row.booking_start ?? null) || a.end !== (row.booking_end ?? null)) {
      return done("cancelled", BOOKING_WORDS.row.changed);
    }
    const j = await readJob();
    if ("finish" in j) return j.finish;
    const status = j.got.found ? j.got.job.status : null;
    if (status !== "Completed" && status !== "Unsuccessful") return done("cancelled", BOOKING_WORDS.row.notLeftover);
    return null;
  }
}

/* ── the database reads a booking send makes ── */

/** Whoever it was booked for, when the mirror doesn't name them. */
const THE_PERSON = "The person booked";

async function readMirrorJob(orgId: string, jobUuid: string): Promise<{ active: number | null; number: string | null } | null | "failed"> {
  const { data, error } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, active, generated_job_id")
    .eq("org_id", orgId)
    .in("uuid", spellings(jobUuid));
  if (error) return "failed";
  const r = ((data ?? []) as { uuid: string; active: unknown; generated_job_id: unknown }[]).find((x) => same(x.uuid, jobUuid));
  if (!r) return null;
  const n = typeof r.generated_job_id === "string" && r.generated_job_id.trim() ? r.generated_job_id.trim() : null;
  return { active: typeof r.active === "number" ? r.active : Number(r.active), number: n };
}

async function readMirrorStaff(orgId: string, staffUuid: string): Promise<{ active: number | null; name: string | null } | null | "failed"> {
  if (!staffUuid) return null;
  const { data, error } = await supabaseAdmin
    .from("sm8_staff")
    .select("uuid, first, last, active")
    .eq("org_id", orgId)
    .in("uuid", spellings(staffUuid));
  if (error) return "failed";
  const r = ((data ?? []) as { uuid: string; first: unknown; last: unknown; active: unknown }[]).find((x) => same(x.uuid, staffUuid));
  if (!r) return null;
  const name = [r.first, r.last].filter((p): p is string => typeof p === "string" && !!p.trim()).join(" ").trim();
  return { active: typeof r.active === "number" ? r.active : Number(r.active), name: name || null };
}

type StatusRead = {
  id: string;
  status: string;
  next_attempt_at: string | null;
  lease_until: string | null;
  maybe_landed: boolean | null;
  verify_uuids: string[] | null;
  last_error: string | null;
};

async function readStatusRow(orgId: string, id: string): Promise<StatusRead | null | "failed"> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id, status, next_attempt_at, lease_until, maybe_landed, verify_uuids, last_error")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) return "failed";
  return (data as unknown as StatusRead | null) ?? null;
}

type BehindRead = {
  id: string;
  status: string;
  taken_back_at: string | null;
  booking_zone: string | null;
  booking_staff_uuid: string | null;
  booking_start: string | null;
  pressed_at: string | null;
};

/** A create that could go right behind its status row, as far as its own
    row says: not taken back, queued or sending, starting at least
    BOOKING_STATUS_LEAD_MS ahead, and pressed less than a day less that
    lead ago, so its own day-old rule can't stop it just after the status
    change. */
function behindByRow(c: BehindRead, zone: string, now: number): boolean {
  if (c.taken_back_at || (c.status !== "queued" && c.status !== "sending")) return false;
  if (!isFuture(c.booking_start, zone, now + BOOKING_STATUS_LEAD_MS)) return false;
  if (!c.pressed_at) return false;
  const pressed = Date.parse(c.pressed_at);
  return !Number.isNaN(pressed) && now - pressed < BOOKING_TTL_MS - BOOKING_STATUS_LEAD_MS;
}

/** THE ALONE RULE (2.7 rule 3): whether a create that depends on this
    status row could go right behind it — the row tests, and (`full`) its
    zone and its person active. A database read that fails is never "none
    can go" nor "one can". */
async function couldGoBehind(
  orgId: string,
  statusRow: Pick<WriteRow, "id">,
  zone: string,
  now: number,
  full: boolean
): Promise<"yes" | "none" | "failed"> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id, status, taken_back_at, booking_zone, booking_staff_uuid, booking_start, pressed_at")
    .eq("org_id", orgId)
    .eq("kind", "booking")
    .eq("op", "create")
    .eq("depends_on", statusRow.id);
  if (error) return "failed";
  const could = ((data ?? []) as BehindRead[]).filter((c) => behindByRow(c, zone, now) && (!full || c.booking_zone === zone));
  if (could.length === 0) return "none";
  if (!full) return "yes";
  const people = [...new Set(could.map((c) => c.booking_staff_uuid).filter((u): u is string => !!u))];
  if (people.length === 0) return "none";
  const { data: staff, error: staffError } = await supabaseAdmin
    .from("sm8_staff")
    .select("uuid, active")
    .eq("org_id", orgId)
    .in("uuid", people.flatMap(spellings));
  if (staffError) return "failed";
  const active = new Set(
    ((staff ?? []) as { uuid: string; active: unknown }[]).filter((s) => Number(s.active) === 1).map((s) => s.uuid.toLowerCase())
  );
  return could.some((c) => !!c.booking_staff_uuid && active.has(c.booking_staff_uuid.toLowerCase())) ? "yes" : "none";
}

/** Inside every status POST attempt: the row's own taken_back_at, then the
    alone rule's row tests again (no two-minute wait here: its creates were
    there when the rule let it through). This is what stops a Cancel booking
    that lands while the status row is being sent. The zone and the people
    were read by the alone rule moments before, and aren't read again. */
async function statusStillWanted(
  orgId: string,
  row: WriteRow,
  zone: string,
  now: number
): Promise<"go" | "taken_back" | "alone" | "check_failed"> {
  const { data, error } = await supabaseAdmin.from(TABLE).select("taken_back_at").eq("org_id", orgId).eq("id", row.id).maybeSingle();
  if (error || !data) return "check_failed";
  if ((data as { taken_back_at: string | null }).taken_back_at) return "taken_back";
  const behind = await couldGoBehind(orgId, row, zone, now, false);
  if (behind === "failed") return "check_failed";
  return behind === "yes" ? "go" : "alone";
}

/** Inside every create POST attempt: whether it was taken back. */
async function createStillWanted(orgId: string, id: string): Promise<"go" | "taken_back" | "check_failed"> {
  const { data, error } = await supabaseAdmin.from(TABLE).select("taken_back_at").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (error || !data) return "check_failed";
  return (data as { taken_back_at: string | null }).taken_back_at ? "taken_back" : "go";
}

/** The edit time our latest status change that went left on this job —
    accepted as "as seen". Null when there is none; "failed" when it
    couldn't be read. */
async function lastLandedStatus(orgId: string, jobUuid: string, exceptId: string): Promise<string | null | "failed"> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id, landed_edit_date, updated_at")
    .eq("org_id", orgId)
    .eq("kind", "booking")
    .eq("op", "update")
    .eq("sm8_job_uuid", jobUuid)
    .eq("status", "sent")
    .order("updated_at", { ascending: false })
    .limit(5);
  if (error) return "failed";
  const prior = ((data ?? []) as { id: string; landed_edit_date: string | null }[]).find((r) => r.id !== exceptId);
  return prior?.landed_edit_date ?? null;
}

/** The job's fields a change to Work Order may move, logged and never
    guarded: which of them moved, never what they hold. */
function logLoggedFields(jobUuid: string, before: Sm8LiveJob, after: Sm8LiveJob): void {
  const moved = (Object.keys(before.logged) as (keyof Sm8LiveJob["logged"])[]).filter((k) => before.logged[k] !== after.logged[k]);
  if (moved.length > 0) console.info(`[sm8] job ${jobUuid} made a Work Order; these moved with it: ${moved.join(", ")}`);
}

/* ── an Undo's create ── */

type CreateRead = {
  id: string;
  tenant_id: string;
  status: string;
  lease_until: string | null;
  remote_uuid: string;
  maybe_landed: boolean | null;
  verify_uuids: string[] | null;
  taken_back_at: string | null;
  attempts: number;
  last_error: string | null;
  landed_edit_date: string | null;
  sm8_job_uuid: string | null;
  booking_staff_uuid: string | null;
  booking_start: string | null;
  booking_end: string | null;
};

const CREATE_COLUMNS =
  "id, tenant_id, status, lease_until, remote_uuid, maybe_landed, verify_uuids, taken_back_at, attempts, last_error, landed_edit_date, sm8_job_uuid, booking_staff_uuid, booking_start, booking_end";

/** Rule 8: settled exactly as the note sender settles a take-back's create,
    without the presser check (the queue helper made it). Its account
    against the take-back's; a live claim waited out, never overtaken; a
    create that could still go stopped now; then what of it may be in
    ServiceM8. Nothing to take out ends it. */
async function settleCreate(
  orgId: string,
  row: WriteRow,
  clock: () => number
): Promise<{ targets: string[]; create: CreateRead } | { finish: Finish }> {
  for (let tries = 0; tries < 3; tries++) {
    const { data, error } = await supabaseAdmin.from(TABLE).select(CREATE_COLUMNS).eq("org_id", orgId).eq("id", row.depends_on!).maybeSingle();
    if (error) return { finish: fromVerdict(verdictForCheckFailed("booking")) };
    const create = (data as unknown as CreateRead | null) ?? null;
    if (!create) return { finish: done("cancelled", NOTE_WORDS.row.nothingToTakeBack) };
    /* THE ACCOUNT: a take-back queued after a switch carries the account
       connected now, while its booking is in the old one */
    if (create.tenant_id !== row.tenant_id) return { finish: done("cancelled", WRITE_WORDS.otherAccount) };

    const now = clock();
    if (leaseLive(create, now)) {
      /* its sender checks for this take-back inside every attempt */
      return { finish: fromVerdict(verdictForWaitingOn(Date.parse(create.lease_until!), now)) };
    }
    let settled = create;
    if (createCanStillGo(create, now)) {
      const iso = new Date(now).toISOString();
      const patch: Record<string, unknown> = {
        status: "cancelled",
        last_error: NOTE_WORDS.row.takenBackBeforeSent,
        lease_until: null,
        claim_id: null,
        updated_at: iso,
      };
      if (!create.taken_back_at) patch.taken_back_at = iso;
      let q = supabaseAdmin.from(TABLE).update(patch).eq("org_id", orgId).eq("id", create.id).eq("status", create.status);
      if (create.status === "sending") q = q.lt("lease_until", iso);
      if (!create.taken_back_at) q = q.is("taken_back_at", null);
      const { data: hit, error: stopError } = await q.select("id");
      if (stopError) return { finish: fromVerdict(verdictForCheckFailed("booking")) };
      /* a miss: a sender claimed it, or the run cancelled it — read it again */
      if ((hit ?? []).length === 0) continue;
      settled = { ...create, status: "cancelled" };
    }
    /* one target per record, whatever its case */
    const seen = new Set<string>();
    const targets = deleteTargets(settled).filter((u) => (seen.has(u.toLowerCase()) ? false : (seen.add(u.toLowerCase()), true)));
    return targets.length > 0 ? { targets, create: settled } : { finish: done("cancelled", NOTE_WORDS.row.nothingToTakeBack) };
  }
  /* it kept moving under us: try again shortly */
  return { finish: fromVerdict(verdictForCheckFailed("booking")) };
}
