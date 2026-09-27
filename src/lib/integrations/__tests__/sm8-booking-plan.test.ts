/**
 * @jest-environment node
 */

/* Bookings to ServiceM8 — the pure decisions (two-way phase 3, PR A): the
   subjects a booking row goes under (A-5), a booking's slot on the wall
   clock (A-6), the account's clock and what a leftover is (A-7), and what
   every booking's line, its status change's line and a Clear's line say,
   with where each is drawn (A-8). */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BOOKING_CONTEXT_TTL_MS,
  BOOKING_LENGTHS_MIN,
  BOOKING_PRESS_BUDGET_MS,
  BOOKING_READBACK_SEES_INACTIVE,
  BOOKING_REREAD_MS,
  BOOKING_STATUS_LEAD_MS,
  BOOKING_STATUS_WAIT_MS,
  BOOKING_STEP_MIN,
  BOOKING_TTL_MS,
  BOOKING_WORDS,
  bookingActWord,
  bookingLine,
  BOOKINGS_OPEN_TO_MANAGERS,
  BOOKINGS_PER_PRESS,
  bookingSubject,
  clearLine,
  fmtRange,
  fmtTime,
  isFuture,
  isLeftover,
  lineDrawnAt,
  localNow,
  parseBookingSubject,
  placeName,
  rangeParts,
  reasonOf,
  reasonsMatching,
  slotOf,
  STATUS_KEPT_FIELDS,
  statusLine,
  type BookingAct,
  type BookingLineIn,
  type BookingReasonKey,
  type BookingRowIn,
  type BookingState,
  type StatusRowIn,
} from "../sm8-booking-plan";
import { fillWords, NOTE_WORDS } from "../sm8-note-words";
import { dedupeKey, WRITE_WORDS } from "../sm8-write-plan";

const W = BOOKING_WORDS;
const SYDNEY = "Australia/Sydney";
const PERTH = "Australia/Perth";
const JOB = "a0c2c09a-6f3c-4907-adfa-2149d061251b";
const LUKE = "3edd29df-0000-4000-8000-00000000beef";
const ISAAC = "985a32ef-398b-489f-882a-20fe666a5ebb";

/* ── A-5: subjects ── */

describe("a booking row's subject", () => {
  it("round-trips every kind of subject, with no space in any", () => {
    const slot = bookingSubject.slot(LUKE.toUpperCase(), "2026-10-06 09:00:00");
    expect(slot).toBe(`slot:${LUKE}:2026-10-06T09:00`);
    expect(parseBookingSubject(slot)).toEqual({ via: "slot", staffUuid: LUKE, start: "2026-10-06 09:00:00", released: false });
    const status = bookingSubject.status("2026-09-26 22:05:45");
    expect(status).toBe("status:wo:2026-09-26T22:05:45");
    expect(parseBookingSubject(status)).toEqual({ via: "status", seenEditDate: "2026-09-26 22:05:45", released: false });
    expect(parseBookingSubject(bookingSubject.undo("row-1"))).toEqual({ via: "undo", createRowId: "row-1", released: false });
    expect(parseBookingSubject(bookingSubject.clear("act-1"))).toEqual({ via: "clear", activityUuid: "act-1", released: false });
    for (const s of [slot, status, bookingSubject.undo("row-1"), bookingSubject.clear("act-1")]) expect(s).not.toMatch(/\s/);
    // not a booking's
    expect(parseBookingSubject("document:d1")).toBeNull();
    expect(parseBookingSubject("jobnote:n1")).toBeNull();
  });

  it("reads a released subject (`:was:<id>`) as released, whatever it was", () => {
    const slot = bookingSubject.slot(LUKE, "2026-10-06 09:00:00");
    expect(parseBookingSubject(`${slot}:was:row-7`)).toEqual({
      via: "slot",
      staffUuid: LUKE,
      start: "2026-10-06 09:00:00",
      released: true,
    });
    expect(parseBookingSubject(`${bookingSubject.status("2026-09-26 22:05:45")}:was:row-8`)).toMatchObject({
      via: "status",
      seenEditDate: "2026-09-26 22:05:45",
      released: true,
    });
  });

  it("keys a slot as the generated column does: one live booking per job, person and start", () => {
    const slot = bookingSubject.slot(LUKE, "2026-10-06 09:00:00");
    expect(dedupeKey("booking", JOB, slot)).toBe(`booking:${JOB}:slot:${LUKE}:2026-10-06T09:00`);
    const sql = readFileSync(join(process.cwd(), "docs/migrations/sm8_writes_safety.sql"), "utf8");
    expect(sql).toContain("generated always as (kind || ':' || coalesce(sm8_job_uuid, '') || ':' || subject) stored");
    // the same person at the same start on the same job is the same key, however cased
    expect(bookingSubject.slot(LUKE.toUpperCase(), "2026-10-06 09:00:00")).toBe(slot);
  });
});

/* ── A-6: a booking's slot ── */

describe("a booking's slot on the wall clock", () => {
  it("starts only on the 15-minute grid", () => {
    expect(slotOf("2026-10-06", "09:00", 60)).toEqual({ start: "2026-10-06 09:00:00", end: "2026-10-06 10:00:00" });
    expect(slotOf("2026-10-06", "09:15", 60)?.start).toBe("2026-10-06 09:15:00");
    for (const off of ["09:05", "09:10", "09:20", "09:59"]) expect(slotOf("2026-10-06", off, 60)).toBeNull();
    for (const junk of ["9:00", "24:00", "09:60", "0900", ""]) expect(slotOf("2026-10-06", junk, 60)).toBeNull();
  });

  it("ends every length the panel offers after its start, and takes no length off the grid", () => {
    expect(BOOKING_LENGTHS_MIN).toEqual([30, 60, 90, 120, 180, 240, 360, 480]);
    const ends = BOOKING_LENGTHS_MIN.map((m) => slotOf("2026-10-06", "07:00", m)?.end);
    expect(ends).toEqual([
      "2026-10-06 07:30:00",
      "2026-10-06 08:00:00",
      "2026-10-06 08:30:00",
      "2026-10-06 09:00:00",
      "2026-10-06 10:00:00",
      "2026-10-06 11:00:00",
      "2026-10-06 13:00:00",
      "2026-10-06 15:00:00",
    ]);
    for (const bad of [0, -30, 20, 45.5]) expect(slotOf("2026-10-06", "07:00", bad)).toBeNull();
  });

  it("(F) adds on the wall clock as text, across the hour and noon: 12:45 and 30 minutes is 13:15", () => {
    expect(slotOf("2026-10-06", "12:45", 30)).toEqual({ start: "2026-10-06 12:45:00", end: "2026-10-06 13:15:00" });
    // the day Sydney's clocks go forward is still a plain day of text
    expect(slotOf("2026-10-04", "01:45", 60)).toEqual({ start: "2026-10-04 01:45:00", end: "2026-10-04 02:45:00" });
  });

  it("(F) refuses a booking that would end at or after midnight: it ends on the day it starts", () => {
    expect(slotOf("2026-10-06", "23:00", 60)).toBeNull();
    expect(slotOf("2026-10-06", "23:30", 30)).toBeNull();
    expect(slotOf("2026-10-06", "22:00", 480)).toBeNull();
    expect(slotOf("2026-10-06", "23:15", 30)).toEqual({ start: "2026-10-06 23:15:00", end: "2026-10-06 23:45:00" });
  });

  it("refuses a day that isn't one", () => {
    expect(slotOf("2026-02-31", "09:00", 60)).toBeNull();
    expect(slotOf("06/10/2026", "09:00", 60)).toBeNull();
  });
});

/* ── A-7: the account's clock, and leftovers ── */

describe("the account's clock", () => {
  it("reads now on the account's wall clock, Perth's and Sydney's, across Sydney's daylight saving", () => {
    expect(localNow(SYDNEY, Date.parse("2026-10-03T12:30:00Z"))).toBe("2026-10-03 22:30:00");
    expect(localNow(PERTH, Date.parse("2026-10-03T12:30:00Z"))).toBe("2026-10-03 20:30:00");
    // 2 am on Sunday 4 October doesn't happen in Sydney: 16:00 UTC is 3 am, +11
    expect(localNow(SYDNEY, Date.parse("2026-10-03T15:59:00Z"))).toBe("2026-10-04 01:59:00");
    expect(localNow(SYDNEY, Date.parse("2026-10-03T16:00:00Z"))).toBe("2026-10-04 03:00:00");
    expect(localNow(PERTH, Date.parse("2026-10-03T16:00:00Z"))).toBe("2026-10-04 00:00:00");
  });

  it("(F) knows no zone it isn't told: no Sydney fallback, and nothing is in the future in it", () => {
    const now = Date.parse("2026-10-03T12:30:00Z");
    for (const zone of [null, "", "Mars/Base"]) {
      expect(localNow(zone, now)).toBeNull();
      expect(isFuture("2099-01-01 09:00:00", zone, now)).toBe(false);
    }
  });

  it("(F) a Perth evening is not a Sydney tomorrow", () => {
    // 22:30 in Perth on Saturday is 00:30 on Sunday in Sydney
    const now = Date.parse("2026-10-03T14:30:00Z");
    expect(isFuture("2026-10-03 23:00:00", PERTH, now)).toBe(true);
    expect(isFuture("2026-10-03 23:00:00", SYDNEY, now)).toBe(false);
    // and after the clocks go forward, Sydney's 2:30 am is already behind 3:30 am
    const later = Date.parse("2026-10-03T16:30:00Z");
    expect(isFuture("2026-10-04 03:00:00", SYDNEY, later)).toBe(false);
    expect(isFuture("2026-10-04 04:00:00", SYDNEY, later)).toBe(true);
    expect(isFuture("2026-10-04 01:00:00", PERTH, later)).toBe(true);
  });

  it("compares to the second, as fixed-width text, and takes nothing that isn't a stamp", () => {
    const now = Date.parse("2026-10-05T23:00:00Z"); // 10:00:00 in Sydney
    expect(isFuture("2026-10-06 10:00:00", SYDNEY, now)).toBe(false);
    expect(isFuture("2026-10-06 10:00:01", SYDNEY, now)).toBe(true);
    for (const junk of [null, "", "2026-10-06T10:30:00", "2026-10-06 10:30"]) expect(isFuture(junk, SYDNEY, now)).toBe(false);
  });
});

describe("a leftover", () => {
  const NOW = Date.parse("2026-10-05T23:00:00Z"); // Tuesday 10:00 am in Sydney
  const booking = (over: Partial<Parameters<typeof isLeftover>[0]> = {}) => ({
    scheduled: 1,
    active: 1,
    start: "2026-10-06 14:00:00",
    end: "2026-10-06 16:00:00",
    staffUuid: LUKE,
    ...over,
  });

  it("(F) is a future, scheduled, active booking with a person and an end, on a Completed or Unsuccessful job", () => {
    expect(isLeftover(booking(), "Completed", SYDNEY, NOW)).toBe(true);
    expect(isLeftover(booking(), "Unsuccessful", SYDNEY, NOW)).toBe(true);
    for (const status of ["Quote", "Work Order", null]) expect(isLeftover(booking(), status, SYDNEY, NOW)).toBe(false);
    expect(isLeftover(booking({ scheduled: 0 }), "Completed", SYDNEY, NOW)).toBe(false);
    expect(isLeftover(booking({ active: 0 }), "Completed", SYDNEY, NOW)).toBe(false);
    expect(isLeftover(booking({ staffUuid: null }), "Completed", SYDNEY, NOW)).toBe(false);
    expect(isLeftover(booking({ end: null }), "Completed", SYDNEY, NOW)).toBe(false);
    expect(isLeftover(booking({ start: "2026-10-06 09:00:00" }), "Completed", SYDNEY, NOW)).toBe(false);
  });

  it("(F) holds for a booking later today on a job completed this morning — by the clock, not the day", () => {
    expect(isLeftover(booking({ start: "2026-10-06 10:15:00", end: "2026-10-06 11:15:00" }), "Completed", SYDNEY, NOW)).toBe(true);
  });

  it("is never recorded time, even the zero-length row clearing it leaves (P4)", () => {
    const cleared = booking({ scheduled: 0, start: "2026-10-06 14:00:00", end: "2026-10-06 14:00:00" });
    expect(isLeftover(cleared, "Completed", SYDNEY, NOW)).toBe(false);
  });

  it("is never one in a zone HeyTiff doesn't know", () => {
    expect(isLeftover(booking(), "Completed", null, NOW)).toBe(false);
  });

  it("reads the mirror's flags as it keeps them, numbers or strings", () => {
    expect(isLeftover(booking({ scheduled: "1", active: "1" }), "Completed", SYDNEY, NOW)).toBe(true);
  });
});

describe("the words a time is said in", () => {
  it("names the account's city from its zone", () => {
    expect(placeName(SYDNEY)).toBe("Sydney");
    expect(placeName("America/Los_Angeles")).toBe("Los Angeles");
    expect(placeName("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
  });

  it("says a time, and a range with the meridiem once where the two share it", () => {
    expect(fmtTime("09:00")).toBe("9:00 am");
    expect(fmtTime("2026-10-06 00:15:00")).toBe("12:15 am");
    expect(fmtTime("2026-10-06 12:00:00")).toBe("12:00 pm");
    expect(fmtRange("2026-10-06 09:00:00", "2026-10-06 11:00:00")).toBe("9:00 to 11:00 am");
    expect(fmtRange("2026-10-06 11:00:00", "2026-10-06 13:00:00")).toBe("11:00 am to 1:00 pm");
    expect(fmtRange("2026-10-06 20:00:00", "2026-10-06 21:30:00")).toBe("8:00 to 9:30 pm");
    expect(rangeParts("2026-10-06 09:00:00", "2026-10-06 11:00:00")).toEqual({ start: "9:00", end: "11:00 am" });
  });
});

/* ── A-8: the lines ── */

const NOW = Date.parse("2026-10-05T23:00:00Z"); // Tuesday 6 October, 10:00 am in Sydney

const createRow = (over: Partial<BookingRowIn> = {}): BookingRowIn => ({
  id: "c1",
  status: "queued",
  remote_uuid: "u-own",
  maybe_landed: false,
  verify_uuids: [],
  taken_back_at: null,
  last_error: null,
  attempts: 0,
  sm8_job_uuid: JOB,
  booking_staff_uuid: LUKE,
  booking_start: "2026-10-06 14:00:00",
  booking_end: "2026-10-06 16:00:00",
  landed_edit_date: null,
  ...over,
});

const statusRow = (over: Partial<StatusRowIn> = {}): StatusRowIn => ({
  status: "sent",
  last_error: null,
  taken_back_at: null,
  maybe_landed: false,
  verify_uuids: [],
  ...over,
});

const mirrorOf = (over: Partial<NonNullable<BookingLineIn["mirror"]>> = {}): NonNullable<BookingLineIn["mirror"]> => ({
  active: 1,
  jobUuid: JOB,
  staffUuid: LUKE,
  start: "2026-10-06 14:00:00",
  end: "2026-10-06 16:00:00",
  editDate: "2026-10-05 16:00:00",
  ...over,
});

const lineOf = (create: Partial<BookingRowIn> = {}, over: Partial<BookingLineIn> = {}): BookingState =>
  bookingLine({
    create: createRow(create),
    statusRow: null,
    takeBack: null,
    hold: null,
    offered: true,
    trial: false,
    viewerIsPresser: true,
    mirror: null,
    now: NOW,
    zone: SYDNEY,
    ...over,
  });

const NONE = { key: null, text: null, tone: null, acts: [] };

/* the reasons as the sender stores them: filled */
const filled = {
  slotTaken: fillWords(W.row.slotTaken, { name: "Luke Ingold" }),
  techInactive: fillWords(W.row.techInactive, { name: "Luke Ingold" }),
  jobNotBookable: fillWords(W.row.jobNotBookable, { status: "Completed" }),
  guardStopped: fillWords(W.row.guardStopped, { number: "3370" }),
};

describe("a booking's line, case by case", () => {
  it("1–4: its take-back", () => {
    // 1: queued behind a hold
    expect(lineOf({ status: "sent", taken_back_at: "t" }, { takeBack: { status: "queued", last_error: null }, hold: "paused" })).toEqual({
      key: "line.stillIn",
      text: "Still in ServiceM8. Sending is paused.",
      tone: "warn",
      acts: [],
    });
    // 2: queued or sending
    for (const st of ["queued", "sending"]) {
      expect(lineOf({ status: "sent", taken_back_at: "t" }, { takeBack: { status: st, last_error: null } })).toEqual({
        key: "line.takingOut",
        text: "Taking it out of ServiceM8…",
        tone: null,
        acts: [],
      });
    }
    // 3: failed, a trial, or cancelled for any other reason
    expect(lineOf({ status: "sent", taken_back_at: "t" }, { takeBack: { status: "failed", last_error: W.row.removeRefused } })).toEqual({
      key: "line.stillIn",
      text: `Still in ServiceM8. ${W.row.removeRefused}`,
      tone: "bad",
      acts: ["take_out_again"],
    });
    expect(lineOf({ status: "sent", taken_back_at: "t" }, { takeBack: { status: "trial", last_error: null } })).toMatchObject({
      text: "Still in ServiceM8. Sending is a trial run.",
      tone: "bad",
      acts: ["take_out_again"],
    });
    expect(lineOf({ status: "sent", taken_back_at: "t" }, { takeBack: { status: "cancelled", last_error: W.row.switchedOff } })).toMatchObject({
      tone: "bad",
      acts: ["take_out_again"],
    });
    // 4: sent, or nothing to take back
    expect(lineOf({ status: "sent", taken_back_at: "t" }, { takeBack: { status: "sent", last_error: null } })).toEqual(NONE);
    expect(
      lineOf({ status: "cancelled", taken_back_at: "t" }, { takeBack: { status: "cancelled", last_error: NOTE_WORDS.row.nothingToTakeBack } })
    ).toEqual(NONE);
  });

  it("(F) 3: a take-back that met something a re-press would meet again has no door and no tone", () => {
    for (const reason of [W.row.changedNoTakeBack, W.row.checkIn, W.row.notFuture]) {
      expect(lineOf({ status: "sent", taken_back_at: "t" }, { takeBack: { status: "cancelled", last_error: reason } })).toEqual({
        key: "line.stillIn",
        text: `Still in ServiceM8. ${reason}`,
        tone: null,
        acts: [],
      });
    }
  });

  it("(F) 5: taken back with no take-back row reads the live hold, and never a stored refusal", () => {
    const sent = { status: "sent", taken_back_at: "t" };
    expect(lineOf(sent)).toEqual({
      key: "line.stillIn",
      text: "Still in ServiceM8. HeyTiff hasn't taken it out yet.",
      tone: "bad",
      acts: ["take_out_again"],
    });
    expect(lineOf(sent, { hold: "off" }).text).toBe("Still in ServiceM8. Sending bookings is switched off.");
    expect(lineOf(sent, { hold: "reconnect" }).text).toBe("Still in ServiceM8. ServiceM8 needs reconnecting.");
    expect(lineOf(sent, { offered: false }).text).toBe(
      "Still in ServiceM8. Sending to ServiceM8 is off, or ServiceM8 isn't connected."
    );
    // a lost answer is "may be there" too, whatever the status
    expect(lineOf({ status: "cancelled", taken_back_at: "t", maybe_landed: true }).key).toBe("line.stillIn");
    expect(lineOf({ status: "failed", taken_back_at: "t", verify_uuids: ["u-old"] }).key).toBe("line.stillIn");
  });

  it("6: taken back with nothing of it there reads nothing", () => {
    expect(lineOf({ status: "cancelled", taken_back_at: "t", last_error: NOTE_WORDS.row.takenBackBeforeSent })).toEqual(NONE);
    expect(lineOf({ status: "queued", taken_back_at: "t" })).toEqual(NONE);
  });

  it("7: someone removed it in ServiceM8", () => {
    expect(lineOf({ status: "cancelled", last_error: W.row.bookingGone })).toEqual({
      key: "line.removedThere",
      text: "Removed in ServiceM8",
      tone: null,
      acts: [],
    });
  });

  it("8–12: on its way, with Cancel booking", () => {
    // 8
    expect(lineOf({}, { hold: "paused" })).toEqual({
      key: "line.waitingWhy",
      text: "Not booked yet. Sending is paused.",
      tone: null,
      acts: ["cancel"],
    });
    expect(lineOf({}, { hold: "reconnect" }).text).toBe("Not booked yet. ServiceM8 needs reconnecting.");
    // 9
    for (const st of ["queued", "sending"]) {
      expect(lineOf({}, { statusRow: statusRow({ status: st }) })).toEqual({
        key: "line.waitingWhy",
        text: "Not booked yet. It goes once the job is a Work Order.",
        tone: null,
        acts: ["cancel"],
      });
    }
    // 10
    expect(lineOf({ last_error: W.row.zoneUnknown })).toEqual({
      key: "line.waitingWhy",
      text: `Not booked yet. ${W.row.zoneUnknown}`,
      tone: "warn",
      acts: ["cancel"],
    });
    // 11
    expect(lineOf({ attempts: 1 })).toEqual({
      key: "line.waitingWhy",
      text: "Not booked yet. Trying again shortly.",
      tone: "warn",
      acts: ["cancel"],
    });
    // 12, a status row sent ahead of it included
    expect(lineOf({}, { statusRow: statusRow() })).toEqual({ key: "line.sending", text: "Booking in ServiceM8…", tone: null, acts: ["cancel"] });
    expect(lineOf({ status: "sending", attempts: 1 }).key).toBe("line.sending");
  });

  it("(F) 13: kept at another time or on someone else offers Undo and Open, never Try again or Book again", () => {
    const kept = { status: "sent", last_error: W.row.timeNotKept, landed_edit_date: "2026-10-05 16:00:00" };
    expect(lineOf(kept)).toEqual({
      key: "line.keptOther",
      text: "Booked in ServiceM8 at another time. HeyTiff switched bookings off.",
      tone: "bad",
      acts: ["undo", "open_in_sm8"],
    });
    // the mirror has it, on our job, at the edit time the guard found: still 13
    expect(lineOf(kept, { mirror: mirrorOf({ start: "2026-10-06 15:00:00", end: "2026-10-06 17:00:00" }) }).key).toBe("line.keptOther");
    // someone changed it since (its edit time moved): 15, no Undo
    expect(lineOf(kept, { mirror: mirrorOf({ editDate: "2026-10-05 18:30:00" }) })).toEqual({
      key: "line.changedThere",
      text: "Changed in ServiceM8",
      tone: null,
      acts: [],
    });
    // once started, it is a visit now: 16
    expect(lineOf({ ...kept, booking_start: "2026-10-06 09:00:00", booking_end: "2026-10-06 11:00:00" })).toEqual(NONE);
    expect(lineOf(kept, { mirror: mirrorOf({ start: "2026-10-06 08:00:00" }) })).toEqual(NONE);
  });

  it("(F) 13: on someone else reads keptOtherPerson, and compares only its job and edit time with the mirror", () => {
    const kept = { status: "sent", last_error: W.row.personNotKept, landed_edit_date: "2026-10-05 16:00:00" };
    const onIsaac = mirrorOf({ staffUuid: ISAAC });
    expect(lineOf(kept, { mirror: onIsaac })).toEqual({
      key: "line.keptOtherPerson",
      text: "Booked in ServiceM8 on someone else. HeyTiff switched bookings off.",
      tone: "bad",
      acts: ["undo", "open_in_sm8"],
    });
    // another job is a change
    expect(lineOf(kept, { mirror: mirrorOf({ staffUuid: ISAAC, jobUuid: "another-job" }) }).key).toBe("line.changedThere");
  });

  it("14: sent, and removed in ServiceM8 since", () => {
    expect(lineOf({ status: "sent" }, { mirror: mirrorOf({ active: 0 }) })).toEqual({
      key: "line.removedThere",
      text: "Removed in ServiceM8",
      tone: null,
      acts: [],
    });
  });

  it("(F) 15: changed in ServiceM8 — its job, person, start or end, never its edit time alone — has no Undo", () => {
    for (const moved of [{ start: "2026-10-06 14:30:00" }, { end: "2026-10-06 17:00:00" }, { staffUuid: ISAAC }, { jobUuid: "another-job" }]) {
      expect(lineOf({ status: "sent" }, { mirror: mirrorOf(moved) })).toEqual({
        key: "line.changedThere",
        text: "Changed in ServiceM8",
        tone: null,
        acts: [],
      });
    }
    // the booked person opened it (U21): the edit time moved, nothing booked did
    expect(lineOf({ status: "sent" }, { mirror: mirrorOf({ editDate: "2026-10-06 07:12:00" }) }).key).toBe("line.sent");
    // a uuid the mirror cases differently is the same booking
    expect(lineOf({ status: "sent" }, { mirror: mirrorOf({ staffUuid: LUKE.toUpperCase() }) }).key).toBe("line.sent");
  });

  it("(F) 15: from the movedThere marker alone, with no mirror row", () => {
    expect(lineOf({ status: "sent", last_error: W.row.movedThere })).toEqual({
      key: "line.changedThere",
      text: "Changed in ServiceM8",
      tone: null,
      acts: [],
    });
  });

  it("16–17: sent", () => {
    expect(lineOf({ status: "sent" })).toEqual({ key: "line.sent", text: "Booked in ServiceM8", tone: "ok", acts: ["undo", "open_in_sm8"] });
    expect(lineOf({ status: "sent" }, { mirror: mirrorOf() }).key).toBe("line.sent");
    // started: nothing to say
    expect(lineOf({ status: "sent", booking_start: "2026-10-06 10:00:00", booking_end: "2026-10-06 12:00:00" })).toEqual(NONE);
    // a zone it doesn't know can't say it started: the line keeps its words, and the press checks again
    expect(lineOf({ status: "sent", booking_start: "2026-10-06 09:00:00" }, { zone: null }).key).toBe("line.sent");
  });

  it("(F) 18: unsure is never Not booked", () => {
    for (const create of [
      { status: "failed", maybe_landed: true, last_error: W.row.bookingUnsure },
      { status: "cancelled", maybe_landed: true, last_error: W.row.switchedOff },
      { status: "cancelled", verify_uuids: ["u-old"], last_error: W.row.statusFirst },
      { status: "trial", maybe_landed: true },
    ]) {
      const line = lineOf(create);
      expect(line).toEqual({
        key: "line.unsure",
        text: "HeyTiff can't tell whether this booking reached ServiceM8. Look there before you book it again.",
        tone: "bad",
        acts: ["open_in_sm8", "book_again", "cancel"],
      });
      expect(line.text).not.toMatch(/^Not booked/);
    }
  });

  it("(F) 19: a booking its status change stopped follows the status row's own reason", () => {
    const first = { status: "cancelled", last_error: W.row.statusFirst };
    const status = (last_error: string | null, over: Partial<StatusRowIn> = {}) =>
      lineOf(first, { statusRow: statusRow({ status: "cancelled", last_error, ...over }) });
    expect(status(W.row.statusRefused)).toEqual({
      key: "line.notSent",
      text: `Not booked. ${W.row.statusFirst}`,
      tone: "bad",
      acts: ["try_again"],
    });
    for (const reason of [W.row.statusAlone, W.row.changed, filled.jobNotBookable, W.row.stale]) {
      expect(status(reason).acts).toEqual(["look_again"]);
    }
    expect(status(W.row.jobGone).acts).toEqual([]);
    // a status row taken back needs a fresh edit time: Look again
    expect(status(NOTE_WORDS.row.takenBackBeforeSent, { taken_back_at: "t" }).acts).toEqual(["look_again"]);
    // its answer lost: Look again, and the words say so
    expect(lineOf({ status: "cancelled", last_error: W.row.statusUnsure })).toEqual({
      key: "line.notSent",
      text: `Not booked. ${W.row.statusUnsure}`,
      tone: "bad",
      acts: ["look_again"],
    });
  });

  it("(F) 20: a reason a re-press would meet again offers Look again, and a job that's gone no door", () => {
    for (const reason of [W.row.changed, filled.slotTaken, filled.jobNotBookable, W.row.zoneChanged, W.row.past, filled.techInactive]) {
      expect(lineOf({ status: "cancelled", last_error: reason })).toEqual({
        key: "line.notSent",
        text: `Not booked. ${reason}`,
        tone: null,
        acts: ["look_again"],
      });
    }
    expect(lineOf({ status: "cancelled", last_error: W.row.jobGone })).toEqual({
      key: "line.notSent",
      text: `Not booked. ${W.row.jobGone}`,
      tone: null,
      acts: [],
    });
  });

  it("21–22: failed", () => {
    expect(lineOf({ status: "failed", last_error: W.row.stale })).toEqual({
      key: "line.notSent",
      text: `Not booked. ${W.row.stale}`,
      tone: null,
      acts: ["book_again"],
    });
    expect(lineOf({ status: "failed", last_error: W.row.refused })).toEqual({
      key: "line.notSent",
      text: "Not booked. ServiceM8 refused the booking.",
      tone: "bad",
      acts: ["try_again", "cancel"],
    });
    expect(lineOf({ status: "failed", last_error: null }).text).toBe("Not booked.");
  });

  it("23: a trial offers Book again only once sending is On", () => {
    expect(lineOf({ status: "trial" })).toEqual({ key: "line.trial", text: "Trial run, not booked", tone: null, acts: ["book_again", "cancel"] });
    expect(lineOf({ status: "trial" }, { trial: true }).acts).toEqual(["cancel"]);
    expect(lineOf({ status: "trial" }, { offered: false }).acts).toEqual(["cancel"]);
  });

  it("24: cancelled for any other reason offers Try again", () => {
    for (const reason of [W.row.switchedOff, filled.guardStopped, WRITE_WORDS.disconnected, WRITE_WORDS.switchedOff]) {
      expect(lineOf({ status: "cancelled", last_error: reason })).toEqual({
        key: "line.notSent",
        text: `Not booked. ${reason}`,
        tone: null,
        acts: ["try_again"],
      });
    }
  });

  it("(F) gives every door to the presser alone, except Open in ServiceM8", () => {
    const other = { viewerIsPresser: false };
    const cases: [Partial<BookingRowIn>, Partial<BookingLineIn>][] = [
      [{}, {}],
      [{ status: "sent" }, {}],
      [{ status: "sent", last_error: W.row.timeNotKept }, {}],
      [{ status: "sent", taken_back_at: "t" }, {}],
      [{ status: "sent", taken_back_at: "t" }, { takeBack: { status: "failed", last_error: W.row.removeRefused } }],
      [{ status: "failed", maybe_landed: true }, {}],
      [{ status: "failed", last_error: W.row.refused }, {}],
      [{ status: "failed", last_error: W.row.stale }, {}],
      [{ status: "cancelled", last_error: W.row.statusFirst }, { statusRow: statusRow({ status: "failed" }) }],
      [{ status: "cancelled", last_error: W.row.changed }, {}],
      [{ status: "cancelled", last_error: W.row.switchedOff }, {}],
      [{ status: "trial" }, {}],
    ];
    for (const [create, over] of cases) {
      expect(lineOf(create, { ...over, ...other }).acts.filter((a) => a !== "open_in_sm8")).toEqual([]);
      expect(lineOf(create, over).acts.length).toBeGreaterThan(0);
    }
    expect(lineOf({ status: "sent" }, other).acts).toEqual(["open_in_sm8"]);
  });

  it("fills every placeholder it says, in every case", () => {
    const all: BookingState[] = [
      lineOf({}, { hold: "paused" }),
      lineOf({ last_error: filled.slotTaken }),
      lineOf({ status: "cancelled", last_error: filled.techInactive }),
      lineOf({ status: "sent", taken_back_at: "t" }, { takeBack: { status: "failed", last_error: null } }),
      lineOf({ status: "sent", taken_back_at: "t" }),
      lineOf({ status: "cancelled", last_error: null }),
    ];
    for (const s of all) expect(s.text).not.toMatch(/\{\w+\}/);
  });
});

/* ServiceM8's DELETE of a record already deleted RESTORES it (the notes
   walk, 2026-09-27). So a booking the mirror shows removed is never handed
   a door that could take it out again: taken back, it has settled; never
   taken back, it reads as removed there. */
describe("a booking the mirror shows removed", () => {
  const gone = mirrorOf({ active: 0 });

  it("(F) taken back, it has settled: no line and no door, whatever its take-back row says", () => {
    const takenBack = { status: "sent", taken_back_at: "t" };
    for (const takeBack of [
      { status: "failed", last_error: W.row.removeRefused }, // 3
      { status: "trial", last_error: null }, // 3
      { status: "cancelled", last_error: W.row.switchedOff }, // 3
      { status: "cancelled", last_error: W.row.changedNoTakeBack }, // 3, no door already
      { status: "queued", last_error: null }, // 1 and 2
      { status: "sending", last_error: null }, // 2
    ]) {
      expect(lineOf(takenBack, { takeBack, mirror: gone, hold: "paused" })).toEqual(NONE);
    }
    // 5: no take-back row, and it may be there by its own row: the mirror says it isn't
    expect(lineOf(takenBack, { mirror: gone })).toEqual(NONE);
    expect(lineOf({ status: "cancelled", taken_back_at: "t", maybe_landed: true }, { mirror: gone })).toEqual(NONE);
    // with the mirror showing it standing, the same rows still offer their Try again
    expect(lineOf(takenBack, { mirror: mirrorOf() }).acts).toEqual(["take_out_again"]);
    expect(lineOf(takenBack, { takeBack: { status: "failed", last_error: W.row.removeRefused }, mirror: mirrorOf() }).acts).toEqual([
      "take_out_again",
    ]);
  });

  it("(F) never taken back, it reads as removed there, with no door — sent or not", () => {
    const removedThere = { key: "line.removedThere", text: "Removed in ServiceM8", tone: null, acts: [] };
    // an answer lost, the booking landed, and someone removed it: the sender will read it back so (bookingGone)
    expect(lineOf({ status: "failed", maybe_landed: true, last_error: W.row.bookingUnsure }, { mirror: gone })).toEqual(removedThere);
    expect(lineOf({ status: "queued", maybe_landed: true, attempts: 1, last_error: WRITE_WORDS.unreachable }, { mirror: gone })).toEqual(
      removedThere
    );
    // sent: case 14, a guard's booking included
    expect(lineOf({ status: "sent" }, { mirror: gone })).toEqual(removedThere);
    expect(lineOf({ status: "sent", last_error: W.row.timeNotKept, landed_edit_date: "2026-10-05 16:00:00" }, { mirror: gone })).toEqual(
      removedThere
    );
  });

  it("(F) no case offers a door that could take out a booking the mirror shows removed", () => {
    const takesOut = new Set<BookingAct>(["undo", "cancel", "take_out_again"]);
    const takeBacks: (BookingLineIn["takeBack"])[] = [
      null,
      ...["queued", "sending", "sent", "failed", "trial"].map((status) => ({ status, last_error: null })),
      { status: "cancelled", last_error: W.row.switchedOff },
      { status: "cancelled", last_error: W.row.changedNoTakeBack },
    ];
    const errors = [
      null,
      W.row.timeNotKept,
      W.row.personNotKept,
      W.row.movedThere,
      W.row.statusFirst,
      W.row.refused,
      W.row.stale,
      W.row.bookingUnsure,
      W.row.switchedOff,
      WRITE_WORDS.unreachable,
    ];
    let lines = 0;
    let openDoorsWhenStanding = 0;
    for (const status of ["queued", "sending", "sent", "failed", "cancelled", "trial"]) {
      for (const taken_back_at of [null, "t"]) {
        for (const maybe_landed of [false, true]) {
          for (const takeBack of takeBacks) {
            for (const last_error of errors) {
              for (const hold of [null, "paused"] as const) {
                const create = { status, taken_back_at, maybe_landed, last_error, attempts: 1, landed_edit_date: "2026-10-05 16:00:00" };
                const doors = lineOf(create, { takeBack, hold, mirror: gone }).acts.filter((a) => takesOut.has(a));
                expect([create, takeBack, doors]).toEqual([create, takeBack, []]);
                lines += 1;
                // the same rows, the booking standing: the sweep can see these doors
                if (lineOf(create, { takeBack, hold, mirror: mirrorOf() }).acts.some((a) => takesOut.has(a))) openDoorsWhenStanding += 1;
              }
            }
          }
        }
      }
    }
    expect(lines).toBeGreaterThan(2000);
    expect(openDoorsWhenStanding).toBeGreaterThan(100);
  });

  it("(F) counts as taken back and settled under a status change that went", () => {
    const create = createRow({ status: "sent", taken_back_at: "t" });
    const failedTakeBack = { status: "failed", last_error: W.row.removeRefused };
    // the take-back didn't finish, but the booking is out of ServiceM8
    expect(statusLine(statusRow(), [{ create, takeBack: failedTakeBack, mirror: gone }], null)?.key).toBe("line.takenBack");
    // standing, it stays "Made a Work Order" until the take-back settles
    expect(statusLine(statusRow(), [{ create, takeBack: failedTakeBack, mirror: mirrorOf() }], null)?.key).toBe("line.statusSent");
    expect(statusLine(statusRow(), [{ create, takeBack: failedTakeBack }], null)?.key).toBe("line.statusSent");
  });
});

describe("a door's word", () => {
  it("says Try again for a take-back's Try again too", () => {
    expect(bookingActWord("take_out_again")).toBe("Try again");
    expect(bookingActWord("try_again")).toBe("Try again");
    expect(bookingActWord("cancel")).toBe("Cancel booking");
    expect(bookingActWord("undo")).toBe("Undo");
    expect(bookingActWord("look_again")).toBe("Look again");
    expect(bookingActWord("book_again")).toBe("Book again");
    expect(bookingActWord("open_in_sm8")).toBe("Open in ServiceM8");
  });
});

describe("where a line is drawn", () => {
  it("(F) a standing booking carries its own state and its take-back's on its entry, drawn once", () => {
    const takeBack = (st: string, last_error: string | null = null) => ({ takeBack: { status: st, last_error } });
    const onEntry = [
      lineOf({ status: "sent", taken_back_at: "t" }, { ...takeBack("queued"), hold: "paused" }), // 1
      lineOf({ status: "sent", taken_back_at: "t" }, takeBack("sending")), // 2
      lineOf({ status: "sent", taken_back_at: "t" }, takeBack("failed", W.row.removeRefused)), // 3
      lineOf({ status: "sent", taken_back_at: "t" }), // 5
      lineOf({ status: "sent", last_error: W.row.timeNotKept }), // 13
      lineOf({ status: "sent" }, { mirror: mirrorOf({ start: "2026-10-06 14:30:00" }) }), // 15
      lineOf({ status: "sent" }), // 17
    ];
    for (const s of onEntry) {
      expect(lineDrawnAt(s, true)).toBe("entry");
      // a booking that doesn't stand (a guard's before the sync, say) is drawn above the list
      expect(lineDrawnAt(s, false)).toBe("above");
    }
  });

  it("everything else is drawn above the list, and nothing is drawn for no line", () => {
    for (const s of [
      lineOf({}),
      lineOf({ status: "cancelled", last_error: W.row.bookingGone }),
      lineOf({ status: "sent" }, { mirror: mirrorOf({ active: 0 }) }),
      lineOf({ status: "failed", maybe_landed: true }),
      lineOf({ status: "trial" }),
    ]) {
      expect(lineDrawnAt(s, true)).toBe("above");
    }
    expect(lineDrawnAt(lineOf({ status: "sent", taken_back_at: "t" }, { takeBack: { status: "sent", last_error: null } }), true)).toBeNull();
  });
});

describe("a stored reason", () => {
  const rowKeys = Object.keys(W.row) as (keyof typeof W.row)[];
  const fillAll = (t: string) => fillWords(t, { name: "Luke Ingold", status: "Completed", number: "3370" });

  it("(F) is recognised by its template, filled and unfilled", () => {
    for (const key of rowKeys) {
      expect(reasonOf(W.row[key])).toBe(key);
      expect(reasonOf(fillAll(W.row[key]))).toBe(key);
    }
    expect(reasonOf(NOTE_WORDS.row.takenBackBeforeSent)).toBe("takenBackBeforeSent");
    expect(reasonOf(NOTE_WORDS.row.nothingToTakeBack)).toBe("nothingToTakeBack");
    for (const k of ["reauth", "billing", "slowDown", "dailyLimit", "paced", "paused", "unreachable", "gaveUp", "noJob", "otherAccount", "accountUnknown", "disconnected"] as const) {
      expect(reasonOf(WRITE_WORDS[k])).toBe(k);
    }
    expect(reasonOf(null)).toBeNull();
    expect(reasonOf("Something else entirely.")).toBeNull();
  });

  it("(F) knows the owner's whole Off apart from Bookings Off", () => {
    expect(reasonOf(WRITE_WORDS.switchedOff)).toBe("sendingSwitchedOff");
    expect(reasonOf(W.row.switchedOff)).toBe("switchedOff");
    // either is a cancel for another reason: Try again
    for (const reason of [WRITE_WORDS.switchedOff, W.row.switchedOff]) {
      expect(lineOf({ status: "cancelled", last_error: reason }).acts).toEqual(["try_again"]);
    }
  });

  it("(F) no filled sentence matches two templates", () => {
    const sentences: [BookingReasonKey, string][] = [
      ...rowKeys.map((k) => [k, fillAll(W.row[k])] as [BookingReasonKey, string]),
      ["takenBackBeforeSent", NOTE_WORDS.row.takenBackBeforeSent],
      ["nothingToTakeBack", NOTE_WORDS.row.nothingToTakeBack],
      ["sendingSwitchedOff", WRITE_WORDS.switchedOff],
    ];
    for (const [key, sentence] of sentences) expect(reasonsMatching(sentence)).toEqual([key]);
  });
});

describe("a status change's line", () => {
  const create = (over: Partial<BookingRowIn> = {}) => createRow({ status: "sent", ...over });

  it("says it once: going, went, or went and changed more than the status", () => {
    expect(statusLine(statusRow({ status: "queued" }), [], null)).toEqual({
      key: "line.statusSending",
      text: "Making it a Work Order in ServiceM8…",
      tone: null,
      acts: [],
    });
    expect(statusLine(statusRow(), [{ create: create(), takeBack: null }], null)).toEqual({
      key: "line.statusSent",
      text: "Made a Work Order in ServiceM8",
      tone: "ok",
      acts: [],
    });
    expect(statusLine(statusRow({ last_error: W.row.fieldsNotKept }), [], null)).toEqual({
      key: "line.statusSent",
      text: "Made a Work Order in ServiceM8. ServiceM8 changed more than the status on this job. HeyTiff switched bookings off.",
      tone: "bad",
      acts: [],
    });
  });

  it("(F) says Taken back only once every booking behind it is taken back and settled", () => {
    const taken = create({ taken_back_at: "t" });
    const takenBack = { key: "line.takenBack", text: "Taken back. The job stays a Work Order in ServiceM8.", tone: null, acts: [] };
    expect(statusLine(statusRow(), [{ create: taken, takeBack: { status: "sent", last_error: null } }], null)).toEqual(takenBack);
    // one stopped before anything of it could land settles too (case 6)
    const stopped = createRow({ status: "cancelled", taken_back_at: "t", last_error: NOTE_WORDS.row.takenBackBeforeSent });
    expect(
      statusLine(
        statusRow(),
        [
          { create: taken, takeBack: { status: "sent", last_error: null } },
          { create: stopped, takeBack: null },
        ],
        null
      )
    ).toEqual(takenBack);
    // while a take-back is still going, or after one failed: plain "Made a Work Order"
    for (const st of ["queued", "sending", "failed"]) {
      expect(statusLine(statusRow(), [{ create: taken, takeBack: { status: st, last_error: null } }], null)?.key).toBe("line.statusSent");
    }
    // one booking behind it not taken back: half the verb stands
    expect(
      statusLine(
        statusRow(),
        [
          { create: taken, takeBack: { status: "sent", last_error: null } },
          { create: create(), takeBack: null },
        ],
        null
      )?.key
    ).toBe("line.statusSent");
    // and with no booking behind it at all
    expect(statusLine(statusRow(), [], null)?.key).toBe("line.statusSent");
  });

  it("(F) is never silent on a change that may be in ServiceM8", () => {
    const unsure = { key: "line.statusUnsure", text: "It may have been made a Work Order in ServiceM8. Look there.", tone: null, acts: [] };
    expect(statusLine(statusRow({ status: "cancelled", maybe_landed: true, last_error: W.row.switchedOff }), [], null)).toEqual(unsure);
    expect(statusLine(statusRow({ status: "failed", maybe_landed: true, last_error: WRITE_WORDS.gaveUp }), [], null)).toEqual(unsure);
    // a re-press moved the mark into verify_uuids
    expect(statusLine(statusRow({ status: "failed", verify_uuids: ["u-old"] }), [], null)).toEqual(unsure);
    expect(statusLine(statusRow({ status: "trial", maybe_landed: true }), [], null)).toEqual(unsure);
  });

  it("stays a Quote when none of its bookings could go, and says nothing when taken back before anything went", () => {
    expect(statusLine(statusRow({ status: "cancelled", last_error: W.row.statusAlone }), [], null)).toEqual({
      key: "line.statusStays",
      text: "Still a Quote in ServiceM8.",
      tone: null,
      acts: [],
    });
    expect(
      statusLine(statusRow({ status: "cancelled", taken_back_at: "t", last_error: NOTE_WORDS.row.takenBackBeforeSent }), [], null)
    ).toBeNull();
    expect(statusLine(statusRow({ status: "trial" }), [], null)).toBeNull();
  });

  it("says why it didn't go, the doors being on its bookings", () => {
    expect(statusLine(statusRow({ status: "failed", last_error: W.row.statusRefused }), [], null)).toEqual({
      key: "line.statusNotSent",
      text: "Not made a Work Order. ServiceM8 refused the change to Work Order.",
      tone: "bad",
      acts: [],
    });
    expect(statusLine(statusRow({ status: "cancelled", last_error: filled.jobNotBookable }), [], null)?.text).toBe(
      "Not made a Work Order. The job is Completed in ServiceM8 now. Look again."
    );
  });
});

describe("a Clear's line", () => {
  const clear = (over: Partial<BookingRowIn> = {}) => createRow({ id: "d1", ...over });

  it("says it's waiting, and why, then clearing, and nothing once sent", () => {
    expect(clearLine(clear(), "paused")).toEqual({ key: "line.clearWaiting", text: "Not cleared yet. Sending is paused.", tone: null, acts: [] });
    expect(clearLine(clear({ last_error: WRITE_WORDS.unreachable }), null)).toMatchObject({
      text: `Not cleared yet. ${WRITE_WORDS.unreachable}`,
      tone: "warn",
    });
    expect(clearLine(clear({ attempts: 2 }), null)?.text).toBe("Not cleared yet. Trying again shortly.");
    expect(clearLine(clear(), null)).toEqual({ key: "line.clearing", text: "Clearing it in ServiceM8…", tone: null, acts: [] });
    expect(clearLine(clear({ status: "sending" }), null)?.key).toBe("line.clearing");
    expect(clearLine(clear({ status: "sent" }), null)).toBeNull();
    expect(clearLine(clear({ status: "trial" }), null)).toEqual({ key: "line.clearTrial", text: "Trial run, not cleared", tone: null, acts: [] });
  });

  it("(F) offers no door where a re-press would meet the same thing, Look again where it moved, and Try again otherwise", () => {
    for (const reason of [W.row.notFuture, W.row.checkIn]) {
      expect(clearLine(clear({ status: "cancelled", last_error: reason }), null)).toEqual({
        key: "line.notCleared",
        text: `Not cleared. ${reason}`,
        tone: null,
        acts: [],
      });
    }
    for (const reason of [W.row.changed, W.row.notLeftover]) {
      expect(clearLine(clear({ status: "cancelled", last_error: reason }), null)).toMatchObject({ tone: null, acts: ["look_again"] });
    }
    expect(clearLine(clear({ status: "failed", last_error: W.row.removeRefused }), null)).toEqual({
      key: "line.notCleared",
      text: `Not cleared. ${W.row.removeRefused}`,
      tone: "bad",
      acts: ["try_again"],
    });
  });
});

describe("the switches and the clocks", () => {
  it("keeps both walk switches off until the walk says so", () => {
    expect(BOOKINGS_OPEN_TO_MANAGERS).toBe(false);
    expect(BOOKING_READBACK_SEES_INACTIVE).toBe(false);
  });

  it("holds the numbers the spec sets", () => {
    expect(BOOKING_STEP_MIN).toBe(15);
    expect(BOOKINGS_PER_PRESS).toBe(8);
    expect(BOOKING_TTL_MS).toBe(86_400_000);
    expect(BOOKING_STATUS_LEAD_MS).toBe(600_000);
    expect(BOOKING_STATUS_WAIT_MS).toBe(120_000);
    // a press with Make it a Work Order wants 12 minutes
    expect(BOOKING_STATUS_LEAD_MS + BOOKING_STATUS_WAIT_MS).toBe(12 * 60_000);
    expect(BOOKING_CONTEXT_TTL_MS).toBe(600_000);
    expect(BOOKING_PRESS_BUDGET_MS).toBe(8_000);
    expect(BOOKING_REREAD_MS).toBe(2_000);
    expect([...STATUS_KEPT_FIELDS]).toEqual([
      "company_uuid",
      "job_address",
      "job_description",
      "category_uuid",
      "purchase_order_number",
      "generated_job_id",
    ]);
  });
});
