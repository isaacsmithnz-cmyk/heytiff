"use server";

/* QUEUEING A BOOKING FOR SERVICEM8 — the one door (two-way phase 3, PR B).

   PR C's actions (Book in, Undo, Clear, Try again) call these, and nothing
   else queues a booking row: a test holds that only this file passes
   `kind: "booking"` to the queue (sm8-press.test). Each helper takes a
   PRESS (lib/integrations/sm8-press) — a browser's copy of one is a plain
   object, and isSm8Press refuses it — and the write state its caller read.
   Nothing the browser sends decides the zone or a uuid, and what it saw
   (an edit time, a booking) is only ever compared: the sender reads
   ServiceM8 live again before anything goes (sm8-booking-send).

   THE RULES, whichever door a person pressed:
   - ONE ROW PER THING (the spec's Decision 5): a booking per job, person
     and start; a status change per version of the job; an Undo per create;
     a Clear per activity. A row that no longer stands GIVES ITS SLOT BACK
     (its subject gains ":was:<id>"), and never before: a booking on its
     way, one standing in ServiceM8, one being taken out, and one a guard
     recorded at another time or on someone else all hold theirs.
   - A VERB IS ONE PRESS'S ROWS, and the hourly cap never splits one: no
     booking goes without the status change its presser ticked, and no
     status change this press made waits alone behind a cap.
   - ONLY WHOEVER BOOKED IT TAKES IT BACK (Decision 5). A re-press by
     someone else makes a row theirs.
   - A STATUS CHANGE THAT MAY HAVE LANDED IS NEVER CLOSED HERE: the sender
     reads the job first.
   - A BOOKING THE MIRROR SHOWS REMOVED IS NEVER SENT A DELETE: ServiceM8's
     DELETE of a record already removed may put it back (the notes walk,
     2026-09-27), so a take-back of one settles with nothing queued.
   - ONE DELETE PER BOOKING, AND NEVER ONE SOONER. A take-back or a Clear
     already on its way is left as it is — a second press of it changes
     nothing, since one brought forward could meet a DELETE whose answer
     was lost and put the booking back — and an Undo and a Clear of the
     same booking are never on their way together: the second press is
     answered `taking_out`. The sender holds the same rule for what gets
     past a press (sm8-booking-send).
   - A PRESS DECIDES ON ALL OF WHAT WE SENT AND TOOK OUT, OR NOTHING: an
     overlay that couldn't be read whole queues nothing. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { isSm8Press, type Sm8Press } from "@/lib/integrations/sm8-press";
import { enqueueSm8Writes, stopCreateRow, type Sm8WriteToQueue } from "@/lib/integrations/sm8-writes";
import { dedupeKey, offersSend, sendHold, type Sm8WriteState } from "@/lib/integrations/sm8-write-plan";
import { createCanStillGo, deleteTargets, leaseLive, mayHaveLanded, planNeedsSm8, sameEditDate, undoPlan } from "@/lib/integrations/sm8-note-plan";
import {
  BOOKING_STATUS_LEAD_MS,
  BOOKING_STATUS_WAIT_MS,
  BOOKING_WORDS,
  bookingLine,
  bookingSubject,
  clearLine,
  isFuture,
  isLeftover,
  localNow,
  parseBookingSubject,
  reasonOf,
  wallTimeExists,
  type BookingMirrorIn,
} from "@/lib/integrations/sm8-booking-plan";
import { bookingZone } from "@/lib/integrations/sm8-booking-zone";
import {
  readBookingOverlayStrict,
  readDeletesOn,
  readMirrorBookings,
  type DeleteOn,
  type MirrorBooking,
} from "@/lib/integrations/sm8-booking-overlay";

/** Why a press queued nothing. Each is answered in `press.*` words by the
    action (PR C): already_booked is sameSlot, kept_other keptOtherFirst,
    taking_out takingOut, in_flight inFlight, not_yours notYours, changed
    changed (or changedNoUndo on a take-back), not_future notFuture,
    not_leftover notLeftover, check_in checkIn, past past, too_soon tooSoon,
    zone_unknown zoneUnknown, clocks_forward clocksForward (PR C's: a wall
    time the clocks skip that day), capped capped, unreadable unreadable,
    not_offered the kind's own refusal, and no_row and unqueued unqueued. */
export type BookingRefusal =
  | "unqueued"
  | "unreadable"
  | "not_offered"
  | "capped"
  | "already_booked"
  | "kept_other"
  | "taking_out"
  | "in_flight"
  | "no_row"
  | "not_yours"
  | "changed"
  | "not_future"
  | "not_leftover"
  | "check_in"
  | "past"
  | "too_soon"
  | "zone_unknown"
  | "clocks_forward";

export type BookInSlot = { staffUuid: string; start: string; end: string };

export type BookInResult =
  /** `already`: the slots (their subjects) already on their way; `takingOut`:
      one whose re-press met an Undo that landed first. */
  | { ok: true; rowIds: string[]; statusRowId: string | null; already: string[]; takingOut?: string[] }
  | { ok: false; refusal: BookingRefusal; slot?: BookInSlot; lookAgain?: true };

export type TakeBackResult =
  | { ok: true; plan: "nothing" | "cancelled" | "deleting" | "already"; rowIds: string[] }
  /** `presser`: whose it is (a staff card), for notYours's name */
  | { ok: false; refusal: BookingRefusal; presser?: string | null };

export type ClearResult = { ok: true; rowIds: string[] } | { ok: false; refusal: BookingRefusal };

export type RetryResult =
  | { ok: true; rowIds: string[] }
  | { ok: false; refusal: BookingRefusal; lookAgain?: true; slot?: BookInSlot; presser?: string | null };

const WRITES = "sm8_writes";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/;
const EDIT_STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** A booking row as these helpers read it. */
type BookingRow = {
  id: string;
  op: string;
  status: string;
  subject: string;
  tenant_id: string;
  sm8_job_uuid: string | null;
  remote_uuid: string;
  replaced_uuids: string[] | null;
  maybe_landed: boolean | null;
  verify_uuids: string[] | null;
  taken_back_at: string | null;
  last_error: string | null;
  attempts: number;
  lease_until: string | null;
  depends_on: string | null;
  target_uuid: string | null;
  verb_id: string | null;
  booking_staff_uuid: string | null;
  booking_start: string | null;
  booking_end: string | null;
  booking_zone: string | null;
  landed_edit_date: string | null;
  seen_edit_date: string | null;
  requested_by: string | null;
  requested_by_user: string | null;
};

const ROW_COLUMNS =
  "id, op, status, subject, tenant_id, sm8_job_uuid, remote_uuid, replaced_uuids, maybe_landed, verify_uuids, taken_back_at, last_error, attempts, lease_until, depends_on, target_uuid, verb_id, booking_staff_uuid, booking_start, booking_end, booking_zone, landed_edit_date, seen_edit_date, requested_by, requested_by_user";

const same = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The spellings a mirror row's uuid may carry. */
const spellings = (u: string) => [...new Set([u, u.toLowerCase(), u.toUpperCase()])];

async function readRow(orgId: string, id: string): Promise<BookingRow | null | "failed"> {
  if (!UUID.test(id)) return null;
  const { data, error } = await supabaseAdmin.from(WRITES).select(ROW_COLUMNS).eq("org_id", orgId).eq("kind", "booking").eq("id", id).maybeSingle();
  if (error) return "failed";
  return (data as unknown as BookingRow | null) ?? null;
}

async function readByKeys(orgId: string, keys: readonly string[]): Promise<Map<string, BookingRow> | null> {
  if (keys.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from(WRITES)
    .select(`${ROW_COLUMNS}, dedupe_key`)
    .eq("org_id", orgId)
    .in("dedupe_key", [...keys]);
  if (error) return null;
  return new Map(((data ?? []) as unknown as (BookingRow & { dedupe_key: string })[]).map((r) => [r.dedupe_key, r]));
}

/** A create's take-back (its Undo's delete row), if one was queued. */
async function readTakeBack(orgId: string, createId: string): Promise<BookingRow | null | "failed"> {
  const { data, error } = await supabaseAdmin
    .from(WRITES)
    .select(ROW_COLUMNS)
    .eq("org_id", orgId)
    .eq("kind", "booking")
    .eq("op", "delete")
    .eq("depends_on", createId)
    .limit(1)
    .maybeSingle();
  if (error) return "failed";
  return (data as unknown as BookingRow | null) ?? null;
}

/** A row gives its slot back: its subject gains ":was:<id>" (and the key
    generated from it moves with it), on the status and subject it was read
    in. False on a miss: another press released it first, or it moved. */
async function release(orgId: string, row: BookingRow): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from(WRITES)
    .update({ subject: `${row.subject}:was:${row.id}` })
    .eq("org_id", orgId)
    .eq("id", row.id)
    .eq("status", row.status)
    .eq("subject", row.subject)
    .select("id");
  if (error) {
    console.error(`[sm8] couldn't give booking row ${row.id}'s slot back for org ${orgId}:`, error);
    return false;
  }
  return (data ?? []).length > 0;
}

/** Something of a create may be in ServiceM8: it is going, it went, or an
    answer under it was lost. */
const mayBeThere = (c: BookingRow) => c.status === "sending" || c.status === "sent" || mayHaveLanded(c);

/** A take-back or a Clear on its way: queued, or being sent. */
const onItsWay = (d: Pick<DeleteOn, "status">) => d.status === "queued" || d.status === "sending";

/** A sent create a guard recorded at another time or on someone else. */
const guarded = (c: BookingRow) => {
  const r = reasonOf(c.last_error);
  return c.status === "sent" && (r === "timeNotKept" || r === "personNotKept");
};

/** A mirror row as bookingLine reads it. */
const mirrorIn = (m: MirrorBooking | undefined): BookingMirrorIn | null =>
  m ? { active: m.active, jobUuid: m.jobUuid, staffUuid: m.staffUuid, start: m.start, end: m.end, editDate: m.editDate } : null;

/* ── the slot rules (the spec's 2.3 step 2) ── */

type SlotFate =
  | { fate: "new" }
  | { fate: "repress" }
  | { fate: "already" }
  | { fate: "release"; row: BookingRow }
  | { fate: "refuse"; refusal: "already_booked" | "kept_other" | "taking_out" };

/** What one slot's existing create makes of a new press on the slot.
    `mirror` and `gone` are the mirror's copy of these creates' bookings and
    the overlay's removed uuids; `sentNotMirrored` the ids of our sent
    creates the mirror doesn't hold yet. */
async function slotFate(
  orgId: string,
  row: BookingRow | undefined,
  jobUuid: string,
  mirror: Map<string, MirrorBooking>,
  gone: ReadonlySet<string>,
  sentNotMirrored: ReadonlySet<string>
): Promise<SlotFate | "failed"> {
  if (!row) return { fate: "new" };
  const m = mirror.get(row.remote_uuid.toLowerCase());
  const removed = (!!m && Number(m.active) !== 1) || gone.has(row.remote_uuid.toLowerCase());
  /* standing: in the mirror, active, as booked; or sent and not mirrored yet */
  const standing = () =>
    m
      ? Number(m.active) === 1 &&
        same(m.jobUuid, jobUuid) &&
        same(m.staffUuid, row.booking_staff_uuid) &&
        m.start === row.booking_start &&
        !gone.has(row.remote_uuid.toLowerCase())
      : sentNotMirrored.has(row.id);

  /* TAKEN BACK: its slot comes back only once the take-back settled */
  if (row.taken_back_at) {
    if (removed) return { fate: "release", row };
    const takeBack = await readTakeBack(orgId, row.id);
    if (takeBack === "failed") return "failed";
    if (!takeBack) return mayBeThere(row) ? { fate: "refuse", refusal: "taking_out" } : { fate: "release", row };
    if (takeBack.status === "sent") return { fate: "release", row };
    const why = reasonOf(takeBack.last_error);
    if (takeBack.status === "cancelled" && why === "nothingToTakeBack") return { fate: "release", row };
    /* ended for good: the mirror decides */
    if (takeBack.status === "cancelled" && (why === "changedNoTakeBack" || why === "checkIn" || why === "notFuture")) {
      return standing() ? { fate: "refuse", refusal: "already_booked" } : { fate: "release", row };
    }
    return { fate: "refuse", refusal: "taking_out" };
  }
  if (row.status === "queued" || row.status === "sending") return { fate: "already" };
  if (row.status === "failed" || row.status === "cancelled" || row.status === "trial") {
    /* somebody removed it in ServiceM8: the slot is booked fresh */
    if (row.status === "cancelled" && reasonOf(row.last_error) === "bookingGone") return { fate: "release", row };
    return { fate: "repress" };
  }
  /* sent */
  if (guarded(row)) {
    /* it stands at another time or on someone else: it holds the slot until
       it is out of ServiceM8, or a second booking would go beside it */
    return removed ? { fate: "release", row } : { fate: "refuse", refusal: "kept_other" };
  }
  return standing() ? { fate: "refuse", refusal: "already_booked" } : { fate: "release", row };
}

/* ── Book in ── */

/** Book one job in, as the person pressing: one row per person and time,
    after the job's status change when the press ticked Make it a Work
    Order (`status`, with the job's edit time the panel read). The action
    (PR C) has checked the shape, the zone and the times; this checks them
    again, cheaply, because a row is the thing that goes. */
export async function queueBookIn(
  press: Sm8Press,
  state: Sm8WriteState,
  input: {
    jobUuid: string;
    verbId: string;
    zone: string;
    status: { seenEditDate: string } | null;
    slots: readonly BookInSlot[];
  }
): Promise<BookInResult> {
  if (!isSm8Press(press)) {
    console.error("[sm8] refused to queue a booking that nobody pressed for (no press, or a stale one)");
    return { ok: false, refusal: "unqueued" };
  }
  const orgId = press.orgId;
  const { jobUuid: given, verbId, zone, status } = input ?? ({} as never);
  const slots = Array.isArray(input?.slots) ? input.slots : [];
  if (
    typeof given !== "string" ||
    !UUID.test(given) ||
    typeof verbId !== "string" ||
    !UUID.test(verbId) ||
    typeof zone !== "string" ||
    !zone ||
    slots.length === 0 ||
    slots.length > 8 ||
    slots.some((s) => !UUID.test(s?.staffUuid ?? "") || !STAMP.test(s?.start ?? "") || !STAMP.test(s?.end ?? "")) ||
    (status && !EDIT_STAMP.test(status.seenEditDate ?? ""))
  ) {
    return { ok: false, refusal: "unqueued" };
  }
  /* ONE SPELLING OF A JOB: its rows, and so their keys, carry it lower case */
  const jobUuid = given.toLowerCase();

  /* THE TIMES ARE REAL ONES in the zone the panel read: a zone Intl doesn't
     know books nothing, and a start or an end the clocks skip that day (the
     hour they go forward) doesn't happen */
  if (localNow(zone, Date.now()) === null) return { ok: false, refusal: "zone_unknown" };
  const skipped = slots.find((s) => !wallTimeExists(s.start, zone) || !wallTimeExists(s.end, zone));
  if (skipped) return { ok: false, refusal: "clocks_forward", slot: skipped };

  /* 1. readable and offered */
  if (!state.readable) return { ok: false, refusal: "unreadable" };
  if (!offersSend(state, "booking")) return { ok: false, refusal: "not_offered" };

  /* 2. the slots, each against the create under its key */
  const subjects = slots.map((s) => bookingSubject.slot(s.staffUuid, s.start));
  const keys = subjects.map((s) => dedupeKey("booking", jobUuid, s));
  const found = await readByKeys(orgId, keys);
  if (!found) return { ok: false, refusal: "unqueued" };
  const existing = [...found.values()];
  /* what we sent and took out, whole or not at all — read only when a
     slot holds a row for it to decide */
  const overlay =
    existing.length > 0
      ? await readBookingOverlayStrict(orgId, state, { jobUuids: [jobUuid], uuids: existing.map((r) => r.remote_uuid), rows: false })
      : { gone: new Set<string>(), sentNotMirrored: [], rows: [] };
  if (!overlay) return { ok: false, refusal: "unqueued" };
  const mirror = existing.length > 0 ? await readMirrorBookings(orgId, existing.map((r) => r.remote_uuid)) : new Map<string, MirrorBooking>();
  if (!mirror) return { ok: false, refusal: "unqueued" };
  const snm = new Set(overlay.sentNotMirrored.map((s) => s.rowId));

  const fates: SlotFate[] = [];
  for (const [i, key] of keys.entries()) {
    const f = await slotFate(orgId, found.get(key), jobUuid, mirror, overlay.gone, snm);
    if (f === "failed") return { ok: false, refusal: "unqueued" };
    /* one slot refused refuses the press: nothing is queued */
    if (f.fate === "refuse") return { ok: false, refusal: f.refusal, slot: slots[i] };
    fates.push(f);
  }

  /* slots released give their key back; a miss is read again, once */
  for (const [i, f] of fates.entries()) {
    if (f.fate !== "release") continue;
    if (await release(orgId, f.row)) {
      fates[i] = { fate: "new" };
      continue;
    }
    const again = await readByKeys(orgId, [keys[i]]);
    if (!again) return { ok: false, refusal: "unqueued" };
    const next = await slotFate(orgId, again.get(keys[i]), jobUuid, mirror, overlay.gone, snm);
    if (next === "failed" || next.fate === "release") return { ok: false, refusal: "unqueued" };
    if (next.fate === "refuse") return { ok: false, refusal: next.refusal, slot: slots[i] };
    fates[i] = next;
  }
  const already = subjects.filter((_, i) => fates[i].fate === "already");
  const toQueue = slots.map((s, i) => ({ s, subject: subjects[i] })).filter((_, i) => fates[i].fate !== "already");

  /* nothing left to queue: no status row either */
  if (toQueue.length === 0) return { ok: true, rowIds: [], statusRowId: null, already };

  /* 3. the status row, first */
  let statusRowId: string | null = null;
  let statusPressedHere = false;
  const rowIds: string[] = [];
  if (status) {
    const subject = bookingSubject.status(status.seenEditDate);
    const key = dedupeKey("booking", jobUuid, subject);
    const there = await readByKeys(orgId, [key]);
    if (!there) return { ok: false, refusal: "unqueued" };
    const old = there.get(key);
    if (old?.taken_back_at) {
      /* taken back, it can never go again: its key is given back and a fresh
         one is made — unless it is still being sent */
      if (old.status === "sending" && leaseLive(old, Date.now())) return { ok: false, refusal: "in_flight" };
      if (!(await release(orgId, old))) {
        const again = await readByKeys(orgId, [key]);
        const now = again?.get(key);
        if (!again || (now && now.taken_back_at)) return { ok: false, refusal: "unqueued" };
      }
    }
    const queued = await enqueueSm8Writes(press, state, [
      {
        kind: "booking",
        op: "update",
        jobUuid,
        subject,
        payload: { name: BOOKING_WORDS.label.status },
        ref: subject,
        targetUuid: jobUuid,
        statusFrom: "Quote",
        statusTo: "Work Order",
        seenEditDate: status.seenEditDate,
        verbId,
      },
    ]);
    if (!queued) return { ok: false, refusal: "unqueued" };
    if (queued.capped) return { ok: false, refusal: "capped" };
    const made = await readByKeys(orgId, [key]);
    const row = made?.get(key);
    /* the bookings never go without the status change the person ticked */
    if (!row) return { ok: false, refusal: "unqueued" };
    statusRowId = row.id;
    statusPressedHere = queued.ids.includes(row.id);
    if (statusPressedHere) rowIds.push(row.id);
  }

  /* 4. the creates, in one call */
  const writes: Sm8WriteToQueue[] = toQueue.map(({ s, subject }) => ({
    kind: "booking",
    op: "create",
    jobUuid,
    subject,
    payload: { name: BOOKING_WORDS.label.create },
    ref: subject,
    dependsOn: statusRowId ?? undefined,
    staffUuid: s.staffUuid,
    start: s.start,
    end: s.end,
    zone,
    verbId,
  }));
  const queued = await enqueueSm8Writes(press, state, writes);

  /* 5. THE CAP NEVER SPLITS A VERB: the status row this press made or
     re-pressed doesn't wait alone */
  if (!queued || queued.capped) {
    if (statusRowId && statusPressedHere) await stopLoneStatusRow(orgId, statusRowId, verbId);
    return { ok: false, refusal: queued?.capped ? "capped" : "unqueued" };
  }
  rowIds.push(...queued.ids);

  /* a re-press that met an Undo landing first is taking out, never "already" */
  const takingOut: string[] = [];
  for (const ref of queued.already) {
    const i = subjects.indexOf(ref);
    if (i < 0 || fates[i].fate !== "repress") {
      already.push(ref);
      continue;
    }
    const now = await readByKeys(orgId, [keys[i]]);
    const r = now?.get(keys[i]);
    if (r?.taken_back_at) takingOut.push(ref);
    else already.push(ref);
  }
  if (takingOut.length > 0 && queued.ids.length === 0) {
    /* nothing of this press is on its way: a status row it made doesn't
       wait alone, as behind a cap */
    if (statusRowId && statusPressedHere) await stopLoneStatusRow(orgId, statusRowId, verbId);
    const i = subjects.indexOf(takingOut[0]);
    return { ok: false, refusal: "taking_out", slot: slots[i] };
  }
  return takingOut.length > 0
    ? { ok: true, rowIds, statusRowId, already, takingOut }
    : { ok: true, rowIds, statusRowId, already };
}

/** The cap stopped a verb's creates: its status row, made or re-pressed by
    this press, is taken back and cancelled — unless another press's
    booking already depends on it, or it may have landed (the sender reads
    the job first, and nothing here closes it unread). */
async function stopLoneStatusRow(orgId: string, statusRowId: string, verbId: string): Promise<void> {
  const row = await readRow(orgId, statusRowId);
  if (!row || row === "failed" || mayHaveLanded(row)) return;
  const { data, error } = await supabaseAdmin
    .from(WRITES)
    .select("id, verb_id, taken_back_at")
    .eq("org_id", orgId)
    .eq("kind", "booking")
    .eq("op", "create")
    .eq("depends_on", statusRowId);
  if (error) return;
  const others = ((data ?? []) as { verb_id: string | null; taken_back_at: string | null }[]).some(
    (c) => !c.taken_back_at && c.verb_id !== verbId
  );
  if (others) return;
  await stopCreateRow(orgId, row, Date.now(), ROW_COLUMNS);
}

/* ── Undo ── */

/** Take one of our bookings back, as whoever booked it. Stopped before it
    goes if it hasn't; taken out of ServiceM8 if it may be there. Every step
    is safe to run again, and a failed or cancelled take-back is pressed
    again under the same subject (Try again). */
export async function queueBookingTakeBack(
  press: Sm8Press,
  state: Sm8WriteState,
  input: { createRowId: string }
): Promise<TakeBackResult> {
  if (!isSm8Press(press)) {
    console.error("[sm8] refused a booking take-back that nobody pressed for (no press, or a stale one)");
    return { ok: false, refusal: "unqueued" };
  }
  const orgId = press.orgId;
  const id = typeof input?.createRowId === "string" ? input.createRowId.trim() : "";

  /* 1. the row: this workspace's booking create */
  const read = await readRow(orgId, id);
  if (read === "failed") return { ok: false, refusal: "unqueued" };
  if (!read || read.op !== "create") return { ok: false, refusal: "no_row" };
  const create = read;

  /* 2. WHO, FIRST: whoever pressed it, and nobody else; nothing changes */
  if ((create.requested_by_user ?? null) !== press.userId) {
    return { ok: false, refusal: "not_yours", presser: create.requested_by };
  }
  const now = Date.now();

  /* 2b. ITS TAKE-BACK ALREADY ON ITS WAY: a second press changes nothing —
     one brought forward could meet its lost DELETE's booking before a read
     shows it out, and put it back */
  const going = await readTakeBack(orgId, create.id);
  if (going === "failed") return { ok: false, refusal: "unqueued" };
  if (going && onItsWay(going)) return { ok: true, plan: "already", rowIds: [] };

  /* the mirror's copy, when the booking may be there */
  const mirror = mayBeThere(create) ? await readMirrorBookings(orgId, [create.remote_uuid]) : new Map<string, MirrorBooking>();
  if (!mirror) return { ok: false, refusal: "unqueued" };
  const m = mirror.get(create.remote_uuid.toLowerCase());
  const removedThere = !!m && Number(m.active) !== 1;

  /* 3. changed in ServiceM8: someone moved it, and it is theirs now */
  if (create.status === "sent" && !removedThere) {
    const reason = reasonOf(create.last_error);
    if (reason === "movedThere") return { ok: false, refusal: "changed" };
    if (m) {
      const moved = guarded(create)
        ? !same(m.jobUuid, create.sm8_job_uuid) || !sameEditDate(m.editDate, create.landed_edit_date)
        : !same(m.jobUuid, create.sm8_job_uuid) ||
          !same(m.staffUuid, create.booking_staff_uuid) ||
          m.start !== create.booking_start ||
          m.end !== create.booking_end;
      if (moved) return { ok: false, refusal: "changed" };
    }
  }

  /* 3b. started: never taken out once under way. One that can't have
     landed is still stopped, whatever its start: that removes nothing. A
     zone HeyTiff doesn't know says nothing here — the sender asks again,
     with the zone, before anything goes. */
  if (!removedThere && mayBeThere(create)) {
    const z = await bookingZone(orgId);
    const start = m?.start ?? create.booking_start;
    if (z.zone && start && !isFuture(start, z.zone, now)) return { ok: false, refusal: "not_future" };
  }

  /* 3c. A CLEAR OF IT ON ITS WAY: one DELETE per booking, so this waits
     for that, and nothing changes */
  if (mayBeThere(create)) {
    const others = await readDeletesOn(orgId, [create.remote_uuid, ...(create.replaced_uuids ?? []), ...(create.verify_uuids ?? [])]);
    if (!others) return { ok: false, refusal: "unqueued" };
    if (others.some((d) => d.via === "clear" && onItsWay(d))) return { ok: false, refusal: "taking_out" };
  }

  /* 4. stop it: closed whatever its status, cancelled if it could still go */
  const wasGoing = createCanStillGo(create, now);
  const stopped = await stopCreateRow(orgId, create, now, ROW_COLUMNS);
  const plan: "nothing" | "cancelled" = wasGoing && stopped.status === "cancelled" ? "cancelled" : "nothing";

  /* 5. its status row, if nothing can go behind it now */
  if (stopped.depends_on) await closeStatusRowIfAlone(orgId, stopped.depends_on, now);

  /* 6. the delete, when something of it may be in ServiceM8 */
  if (!planNeedsSm8(undoPlan(stopped, Date.now()))) return { ok: true, plan, rowIds: [] };
  /* ServiceM8 shows every uuid of it removed already: settled, and no
     DELETE goes — one on a booking already removed may put it back */
  const seen = new Set<string>();
  const targets = deleteTargets(stopped).filter((u) => (seen.has(u.toLowerCase()) ? false : (seen.add(u.toLowerCase()), true)));
  const shown = await readMirrorBookings(orgId, targets);
  if (shown && targets.length > 0 && targets.every((u) => { const r = shown.get(u.toLowerCase()); return !!r && Number(r.active) !== 1; })) {
    return { ok: true, plan, rowIds: [] };
  }
  if (!state.readable) return { ok: false, refusal: "unreadable" };
  if (!offersSend(state, "booking")) return { ok: false, refusal: "not_offered" };
  const queued = await enqueueSm8Writes(press, state, [
    {
      kind: "booking",
      op: "delete",
      jobUuid: stopped.sm8_job_uuid?.toLowerCase() ?? null,
      subject: bookingSubject.undo(stopped.id),
      payload: { name: BOOKING_WORDS.label.undo },
      ref: stopped.id,
      dependsOn: stopped.id,
      verbId: stopped.verb_id ?? undefined,
    },
  ]);
  if (!queued) return { ok: false, refusal: "unqueued" };
  if (queued.capped) return { ok: false, refusal: "capped" };
  return { ok: true, plan: queued.ids.length > 0 ? "deleting" : "already", rowIds: queued.ids };
}

/** A take-back's step 5: the status row a create depended on is closed and
    cancelled when none of the creates behind it can still go — unless it is
    being sent under a live claim, has gone, or MAY HAVE LANDED (the sender
    reads the job first; closed unread, ServiceM8 could hold a Work Order
    the card never mentions). */
async function closeStatusRowIfAlone(orgId: string, statusRowId: string, now: number): Promise<void> {
  const row = await readRow(orgId, statusRowId);
  if (!row || row === "failed" || row.op !== "update" || row.taken_back_at) return;
  if (mayHaveLanded(row) || !createCanStillGo(row, now)) return;
  const { data, error } = await supabaseAdmin
    .from(WRITES)
    .select("id, status, taken_back_at")
    .eq("org_id", orgId)
    .eq("kind", "booking")
    .eq("op", "create")
    .eq("depends_on", statusRowId);
  if (error) return;
  const canGo = ((data ?? []) as { status: string; taken_back_at: string | null }[]).some(
    (c) => !c.taken_back_at && (c.status === "queued" || c.status === "sending")
  );
  if (canGo) return;
  await stopCreateRow(orgId, row, now, ROW_COLUMNS);
}

/* ── Clear ── */

/** Clear a leftover booking — a future booking on a job that is Completed
    or Unsuccessful (isLeftover) — as the mirror has it now. What the
    confirm showed (`seen`) is only compared; the row keeps the mirror's
    copy. There is no Undo on a Clear. */
export async function queueClear(
  press: Sm8Press,
  state: Sm8WriteState,
  input: { jobUuid: string; activityUuid: string; seen: { staffUuid: string; start: string }; verbId: string }
): Promise<ClearResult> {
  if (!isSm8Press(press)) {
    console.error("[sm8] refused a Clear that nobody pressed for (no press, or a stale one)");
    return { ok: false, refusal: "unqueued" };
  }
  const orgId = press.orgId;
  const { jobUuid: given, activityUuid, seen, verbId } = input ?? ({} as never);
  if (!UUID.test(given ?? "") || !UUID.test(activityUuid ?? "") || !UUID.test(verbId ?? "")) {
    return { ok: false, refusal: "unqueued" };
  }
  const jobUuid = given.toLowerCase();

  /* 1. offered */
  if (!state.readable) return { ok: false, refusal: "unreadable" };
  if (!offersSend(state, "booking")) return { ok: false, refusal: "not_offered" };

  /* 1b. ONE DELETE PER BOOKING: this Clear already on its way changes
     nothing (one brought forward could meet its lost DELETE's booking
     before a read shows it out, and put it back), and an Undo of it on its
     way is left to go alone */
  const others = await readDeletesOn(orgId, [activityUuid]);
  if (!others) return { ok: false, refusal: "unqueued" };
  if (others.some((d) => d.via === "clear" && onItsWay(d))) return { ok: true, rowIds: [] };
  if (others.some((d) => d.via === "undo" && onItsWay(d))) return { ok: false, refusal: "taking_out" };

  /* 2. the mirror's booking, and its job */
  const mirror = await readMirrorBookings(orgId, [activityUuid]);
  if (!mirror) return { ok: false, refusal: "unqueued" };
  const m = mirror.get(activityUuid.toLowerCase());
  if (!m || !same(m.jobUuid, jobUuid)) return { ok: false, refusal: "not_leftover" };
  if (Number(m.scheduled) !== 1) return { ok: false, refusal: "check_in" };
  /* its job, whatever case the mirror spells it in */
  const jobOf = (m.jobUuid ?? jobUuid).toLowerCase();
  const { data: jobs, error: jobError } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, status, active")
    .eq("org_id", orgId)
    .in("uuid", spellings(jobOf));
  if (jobError) return { ok: false, refusal: "unqueued" };
  const job = ((jobs ?? []) as { uuid: string; status: string | null; active: unknown }[]).find((j) => same(j.uuid, jobOf));
  const jobStatus = job && Number(job.active) === 1 ? (job.status ?? null) : null;
  const z = await bookingZone(orgId);
  if (z.zone === null) return { ok: false, refusal: z.why === "unread" ? "unqueued" : "zone_unknown" };
  const now = Date.now();
  const booking = { scheduled: m.scheduled, active: m.active, start: m.start, end: m.end, staffUuid: m.staffUuid };
  if (!isLeftover(booking, jobStatus, z.zone, now)) {
    /* a leftover in every way but that it has started */
    const futureless = isLeftover(booking, jobStatus, z.zone, 0);
    return { ok: false, refusal: futureless ? "not_future" : "not_leftover" };
  }
  if (!same(m.staffUuid, seen?.staffUuid) || m.start !== seen?.start) return { ok: false, refusal: "changed" };

  /* 3. queue it, as the mirror has it */
  const queued = await enqueueSm8Writes(press, state, [
    {
      kind: "booking",
      op: "delete",
      jobUuid: jobOf,
      subject: bookingSubject.clear(m.uuid),
      payload: { name: BOOKING_WORDS.label.clear },
      ref: m.uuid,
      targetUuid: m.uuid,
      staffUuid: m.staffUuid ?? undefined,
      start: m.start ?? undefined,
      end: m.end ?? undefined,
      verbId,
    },
  ]);
  if (!queued) return { ok: false, refusal: "unqueued" };
  if (queued.capped) return { ok: false, refusal: "capped" };
  return { ok: true, rowIds: queued.ids };
}

/* ── Try again ── */

/** The one door for Try again on a line (try_again, and a take-back's
    take_out_again). Book again and Look again open the panel instead. A
    row whose line, read now, offers this person no Try again is refused
    `changed`, and so is one that gave its slot back: a newer row holds it. */
export async function queueBookingRetry(press: Sm8Press, state: Sm8WriteState, input: { rowId: string }): Promise<RetryResult> {
  if (!isSm8Press(press)) {
    console.error("[sm8] refused a booking retry that nobody pressed for (no press, or a stale one)");
    return { ok: false, refusal: "unqueued" };
  }
  const orgId = press.orgId;
  const id = typeof input?.rowId === "string" ? input.rowId.trim() : "";
  const read = await readRow(orgId, id);
  if (read === "failed") return { ok: false, refusal: "unqueued" };
  if (!read) return { ok: false, refusal: "changed" };
  const row = read;
  const subject = parseBookingSubject(row.subject);
  if (!subject || subject.released) return { ok: false, refusal: "changed" };
  const hold = state.readable ? sendHold(state, "booking") : null;
  const offered = offersSend(state, "booking");

  /* a take-back's Try again is its create's take-back, with all its rules */
  if (row.op === "delete" && row.depends_on) {
    const create = await readRow(orgId, row.depends_on);
    if (!create || create === "failed") return { ok: false, refusal: "changed" };
    const line = await lineOf(orgId, create, state, press);
    if (!line.acts.includes("take_out_again")) return { ok: false, refusal: "changed" };
    return queueBookingTakeBack(press, state, { createRowId: create.id });
  }

  /* a Clear goes again with the booking as the mirror has it now, checked
     against the booking as its last press saw it */
  if (row.op === "delete") {
    const line = clearLine(row, hold);
    if (!line?.acts.includes("try_again")) return { ok: false, refusal: "changed" };
    if (!row.sm8_job_uuid || !row.target_uuid || !row.booking_staff_uuid || !row.booking_start || !row.verb_id) {
      return { ok: false, refusal: "changed" };
    }
    return queueClear(press, state, {
      jobUuid: row.sm8_job_uuid,
      activityUuid: row.target_uuid,
      seen: { staffUuid: row.booking_staff_uuid, start: row.booking_start },
      verbId: row.verb_id,
    });
  }

  /* a status line has no door of its own: its bookings carry them */
  if (row.op !== "create") return { ok: false, refusal: "changed" };
  const line = await lineOf(orgId, row, state, press);
  if (line.acts.includes("take_out_again")) return queueBookingTakeBack(press, state, { createRowId: row.id });
  /* a line that offers Look again instead (its status row was taken back, or
     a re-press would meet the same thing) sends the card there */
  if (!line.acts.includes("try_again")) {
    return line.acts.includes("look_again") ? { ok: false, refusal: "changed", lookAgain: true } : { ok: false, refusal: "changed" };
  }
  if (!offered) return { ok: false, refusal: "not_offered" };
  if (!row.sm8_job_uuid || !row.booking_staff_uuid || !row.booking_start || !row.booking_end || !row.booking_zone || !row.verb_id) {
    return { ok: false, refusal: "changed" };
  }

  /* its start still ahead, in the zone it was booked in */
  const now = Date.now();
  if (!isFuture(row.booking_start, row.booking_zone, now)) return { ok: false, refusal: "past" };

  /* its status row: taken back, a fresh one needs a fresh edit time (Look
     again); failed or cancelled, it goes again first, and the booking must
     start far enough ahead for it */
  let status: { seenEditDate: string } | null = null;
  if (row.depends_on) {
    const s = await readRow(orgId, row.depends_on);
    if (s === "failed") return { ok: false, refusal: "unqueued" };
    if (!s || s.taken_back_at || !s.seen_edit_date) return { ok: false, refusal: "changed", lookAgain: true };
    /* exactly that far ahead counts, as at the press (C-5) */
    if (
      (s.status === "failed" || s.status === "cancelled") &&
      !isFuture(row.booking_start, row.booking_zone, now + BOOKING_STATUS_LEAD_MS + BOOKING_STATUS_WAIT_MS - 1)
    ) {
      return { ok: false, refusal: "too_soon", lookAgain: true };
    }
    status = { seenEditDate: s.seen_edit_date };
  }
  const again = await queueBookIn(press, state, {
    jobUuid: row.sm8_job_uuid,
    verbId: row.verb_id,
    zone: row.booking_zone,
    status,
    slots: [{ staffUuid: row.booking_staff_uuid, start: row.booking_start, end: row.booking_end }],
  });
  if (!again.ok) return again;
  return { ok: true, rowIds: again.rowIds };
}

/** A create's line, read now, as this press sees it. */
async function lineOf(orgId: string, create: BookingRow, state: Sm8WriteState, press: Sm8Press) {
  const [statusRow, takeBack, mirror, z] = await Promise.all([
    create.depends_on ? readRow(orgId, create.depends_on) : Promise.resolve(null),
    readTakeBack(orgId, create.id),
    readMirrorBookings(orgId, [create.remote_uuid]),
    bookingZone(orgId),
  ]);
  return bookingLine({
    create,
    statusRow: statusRow && statusRow !== "failed" ? statusRow : null,
    takeBack: takeBack && takeBack !== "failed" ? takeBack : null,
    hold: state.readable ? sendHold(state, "booking") : null,
    offered: offersSend(state, "booking"),
    trial: state.mode === "trial",
    viewerIsPresser: (create.requested_by_user ?? null) === press.userId,
    mirror: mirrorIn(mirror?.get(create.remote_uuid.toLowerCase())),
    now: Date.now(),
    zone: z.zone,
  });
}
