/**
 * @jest-environment node
 */

/* Leave on the ServiceM8 board — the pure decisions and the words. */

import {
  availabilityBody,
  boardName,
  isTheLeave,
  LEAVE_AVAILABILITY_TYPE,
  LEAVE_WORDS,
  leaveSpan,
  leaveSubject,
  parseLeaveSubject,
  realDay,
} from "../sm8-leave-plan";
import { dedupeKey, kindCount, sendRefusal, verdictFor, WRITE_WORDS, type Sm8WriteState } from "../sm8-write-plan";
import { SM8_WRITE_KIND_SCOPES } from "../providers";
import { BOOKING_WORDS } from "../sm8-booking-words";

describe("the board's name", () => {
  it("is Sick leave for personal leave and Leave for everything else (Isaac, 2026-09-28)", () => {
    expect(boardName("personal")).toBe("Sick leave");
    expect(boardName("annual")).toBe("Leave");
    expect(boardName("unpaid")).toBe("Leave");
    expect(boardName(null)).toBe("Leave");
  });

  it("goes as ServiceM8's one kind of staff leave, the one its own entries use", () => {
    expect(LEAVE_AVAILABILITY_TYPE).toBe("staff-annual-leave");
  });
});

describe("the span", () => {
  it("is the first day's start to the last day's end, as the business keys a whole day", () => {
    expect(leaveSpan("2026-10-05", "2026-10-09")).toEqual({ start: "2026-10-05 00:00:00", end: "2026-10-09 23:59:59" });
    expect(leaveSpan("2026-10-05", "2026-10-05")).toEqual({ start: "2026-10-05 00:00:00", end: "2026-10-05 23:59:59" });
  });

  it("refuses a day that isn't one, a span backwards, and one past a year", () => {
    expect(leaveSpan("2026-02-31", "2026-03-01")).toBeNull();
    expect(leaveSpan("2026-10-09", "2026-10-05")).toBeNull();
    expect(leaveSpan("2026-01-01", "2027-01-03")).toBeNull();
    expect(leaveSpan("2026-01-01", "2027-01-02")).not.toBeNull();
    expect(realDay("2028-02-29")).toBe(true);
    expect(realDay("2027-02-29")).toBe(false);
  });
});

describe("the request", () => {
  it("carries exactly seven fields, never active or source", () => {
    const body = availabilityBody({
      uuid: "u",
      staffUuid: "s",
      name: "Sick leave",
      start: "2026-10-05 00:00:00",
      end: "2026-10-05 23:59:59",
    });
    expect(body).toEqual({
      uuid: "u",
      regarding_object: "staff",
      regarding_object_uuid: "s",
      name: "Sick leave",
      availability_type: "staff-annual-leave",
      start_timestamp: "2026-10-05 00:00:00",
      end_timestamp: "2026-10-05 23:59:59",
    });
  });

  it("reads one back as the leave by its person and span, whatever the business renamed it", () => {
    const row = { leave_staff_uuid: "AB", leave_start: "2026-10-05 00:00:00", leave_end: "2026-10-05 23:59:59" };
    expect(isTheLeave({ regardingUuid: "ab", start: "2026-10-05 00:00:00", end: "2026-10-05 23:59:59" }, row)).toBe(true);
    expect(isTheLeave({ regardingUuid: "cd", start: "2026-10-05 00:00:00", end: "2026-10-05 23:59:59" }, row)).toBe(false);
    expect(isTheLeave({ regardingUuid: "ab", start: "2026-10-06 00:00:00", end: "2026-10-06 23:59:59" }, row)).toBe(false);
  });
});

describe("one row per thing", () => {
  it("names a request, a day off and a removal apart, and reads them back", () => {
    expect(leaveSubject.leave("r1")).toBe("leave:r1");
    expect(leaveSubject.dayOff("b1")).toBe("dayoff:b1");
    expect(leaveSubject.remove("w1")).toBe("remove:w1");
    expect(parseLeaveSubject("leave:r1")).toEqual({ via: "leave", id: "r1" });
    expect(parseLeaveSubject("dayoff:b1")).toEqual({ via: "dayoff", id: "b1" });
    expect(parseLeaveSubject("remove:w1")).toEqual({ via: "remove", createRowId: "w1" });
    expect(parseLeaveSubject("slot:x")).toBeNull();
    // no job: the key still tells two requests apart
    expect(dedupeKey("leave", null, "leave:r1")).not.toBe(dedupeKey("leave", null, "leave:r2"));
  });
});

describe("the kind", () => {
  it("needs manage_schedule alone — a permission bookings already ask for", () => {
    expect(SM8_WRITE_KIND_SCOPES.leave).toEqual(["manage_schedule"]);
  });

  it("copies WRITE_WORDS' two sentences exactly", () => {
    expect(LEAVE_WORDS.press.capped).toBe(WRITE_WORDS.paused);
    expect(LEAVE_WORDS.press.unreadable).toBe(WRITE_WORDS.settingsUnread);
  });

  it("counts among the kinds, and leaves every sentence without leave exactly as it was", () => {
    expect(kindCount({ attachment: 1, note: 0 })).toBe("1 file");
    expect(kindCount({ attachment: 1, note: 2, booking: 1 })).toBe("1 file, 2 notes and 1 booking");
    expect(kindCount({ attachment: 0, note: 0, leave: 1 })).toBe("1 leave entry");
    expect(kindCount({ attachment: 0, note: 0, booking: 2, leave: 3 })).toBe("2 bookings and 3 leave entries");
    expect(kindCount({ attachment: 1, note: 1, booking: 1, leave: 1 })).toBe("1 file, 1 note, 1 booking and 1 leave entry");
  });

  it("is refused in its own words", () => {
    const state = {
      readable: true,
      kinds: ["leave"],
      deployment: true,
      mode: "live",
      modeStored: "live",
      pausedReason: null,
      pausedAt: null,
      linked: true,
      connected: true,
      tenantId: "t",
      granted: [],
      refused: [],
      timezoneName: null,
      ownerKinds: [],
      ownerKindsRead: true,
    } as unknown as Sm8WriteState;
    expect(sendRefusal(state, "leave")).toBe(LEAVE_WORDS.press.kindOff);
    expect(sendRefusal({ ...state, ownerKinds: ["leave"] }, "leave")).toBe(LEAVE_WORDS.press.scope);
    expect(sendRefusal({ ...state, ownerKinds: ["leave"], granted: ["leave"] }, "leave")).toBeNull();
  });

  it("reads ServiceM8's answers as leave's: a scope 403 holds leave only, a 404 on a delete is off already", () => {
    const ctx = (op: "create" | "delete") => ({ now: 0, timezoneName: null, freeRetries: 0, kind: "leave" as const, op });
    const scope = verdictFor({ kind: "forbidden", scope: true }, 1, ctx("create"));
    expect(scope).toMatchObject({ status: "queued", blockKind: true, stop: false, error: LEAVE_WORDS.row.scopeHeld });
    expect(verdictFor({ kind: "forbidden", scope: false }, 1, ctx("create"))).toMatchObject({ status: "failed", error: LEAVE_WORDS.row.forbidden });
    expect(verdictFor({ kind: "rejected", status: 404 }, 1, ctx("delete"))).toMatchObject({ status: "sent" });
    expect(verdictFor({ kind: "rejected", status: 400 }, 1, ctx("create"))).toMatchObject({ status: "failed", error: LEAVE_WORDS.row.refused });
    // a 409 is never recorded sent unread
    expect(verdictFor({ kind: "exists" }, 1, ctx("create"))).toMatchObject({ status: "failed" });
    expect(verdictFor({ kind: "exists" }, 1, ctx("delete"))).toMatchObject({ status: "failed", error: LEAVE_WORDS.row.removeRefused });
  });

  it("says in manage_schedule's sentence what HeyTiff does with availability, and nothing more", () => {
    expect(BOOKING_WORDS.scope.schedule).toMatch(/adds staff leave only for leave approved here/);
    expect(BOOKING_WORDS.scope.schedule).not.toMatch(/never touches[^.]*availability/);
  });
});
