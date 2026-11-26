/* Free after ends at home time (bug 107): someone is free after their last
   booking only where their normal day runs on an hour or more past it. */

import { freeAfter } from "../free-after";

const DAY = "2026-11-26";
const at = (hhmm: string, d = DAY) => `${d} ${hhmm}:00`;
const NORMAL = { start: "7:00 AM", end: "3:00 PM" };

describe("freeAfter", () => {
  it("is free after the last booking where the day runs on an hour or more", () => {
    expect(freeAfter(DAY, [{ start: at("07:30"), end: at("09:00") }, { start: at("08:45"), end: at("11:30") }], NORMAL, 60)).toBe(at("11:30"));
    expect(freeAfter(DAY, [{ start: at("07:00"), end: at("14:00") }], NORMAL, 60)).toBe(at("14:00"));
  });

  it("isn't free where the bookings run to home time, near it, or past it", () => {
    expect(freeAfter(DAY, [{ start: at("13:30"), end: at("15:00") }], NORMAL, 60)).toBeNull();
    expect(freeAfter(DAY, [{ start: at("07:00"), end: at("14:30") }], NORMAL, 60)).toBeNull();
    expect(freeAfter(DAY, [{ start: at("12:00"), end: at("16:00") }], NORMAL, 60)).toBeNull();
    expect(freeAfter(DAY, [{ start: at("22:00"), end: at("01:00", "2026-11-27") }], NORMAL, 60)).toBeNull();
  });

  it("reads the person's own finish, not 3 pm", () => {
    expect(freeAfter(DAY, [{ start: at("07:00"), end: at("15:00") }], { start: "7:00 AM", end: "5:00 PM" }, 60)).toBe(at("15:00"));
  });

  it("counts the room from the start of the day where the booking ends before it", () => {
    expect(freeAfter(DAY, [{ start: at("06:00"), end: at("06:30") }], { start: "7:00 AM", end: "7:30 AM" }, 60)).toBeNull();
  });

  it("has nothing to say without bookings or a readable day", () => {
    expect(freeAfter(DAY, [], NORMAL, 60)).toBeNull();
    expect(freeAfter(DAY, [{ start: at("07:00"), end: at("09:00") }], { start: "", end: "" }, 60)).toBeNull();
  });
});
