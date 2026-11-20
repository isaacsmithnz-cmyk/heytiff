/**
 * @jest-environment node
 */

/* The day clock's safeties, on Isaac's real Thursday 19 November 2026 (on
   8:00 am, at 3479 12:30 to 12:56, home about 3:00 pm, nothing booked) and a
   night shift past midnight (booked 10:00 pm Thursday to 6:00 am Friday, on
   at 9:50 pm). Sydney is UTC+11 in November. */

import { isLeftOn, lastSeen, mayRestart, settlesNow, shiftEnd, sm8Wall, stopHoursOf, stopsAt } from "../day-stop";

const at = (s: string) => new Date(s).toISOString();
const ms = (s: string) => Date.parse(s);

const THU_ON = at("2026-11-19T08:00:00+11:00");
const NIGHT_ON = at("2026-11-19T21:50:00+11:00");

describe("the shift's end", () => {
  it("is eight hours after Clock on with nothing booked", () => {
    expect(shiftEnd({ onAt: THU_ON, bookingEnds: [], heldUntil: null })).toBe(at("2026-11-19T16:00:00+11:00"));
  });
  it("is the night booking's end, on the next date", () => {
    expect(shiftEnd({ onAt: NIGHT_ON, bookingEnds: [at("2026-11-20T06:00:00+11:00")], heldUntil: null })).toBe(at("2026-11-20T06:00:00+11:00"));
  });
  it("is the last of the shift's bookings", () => {
    expect(shiftEnd({ onAt: THU_ON, bookingEnds: [at("2026-11-19T10:00:00+11:00"), at("2026-11-19T12:00:00+11:00"), null], heldUntil: null })).toBe(at("2026-11-19T12:00:00+11:00"));
  });
  it("moves on to Still here's hold", () => {
    expect(shiftEnd({ onAt: THU_ON, bookingEnds: [], heldUntil: at("2026-11-19T18:30:00+11:00") })).toBe(at("2026-11-19T18:30:00+11:00"));
    expect(shiftEnd({ onAt: THU_ON, bookingEnds: [], heldUntil: at("2026-11-19T12:00:00+11:00") })).toBe(at("2026-11-19T16:00:00+11:00"));
  });
});

describe("the stop", () => {
  it("is fourteen hours after Clock on: Thursday's 10:00 pm, the night shift's 11:50 am", () => {
    expect(stopsAt({ onAt: THU_ON, hours: 14, heldUntil: null })).toBe(at("2026-11-19T22:00:00+11:00"));
    expect(stopsAt({ onAt: NIGHT_ON, hours: 14, heldUntil: null })).toBe(at("2026-11-20T11:50:00+11:00"));
  });
  it("waits for Still here", () => {
    expect(stopsAt({ onAt: THU_ON, hours: 14, heldUntil: at("2026-11-19T23:30:00+11:00") })).toBe(at("2026-11-19T23:30:00+11:00"));
  });
  it("takes the team's hours, within reason", () => {
    expect(stopHoursOf(12)).toBe(12);
    expect(stopHoursOf(undefined)).toBe(14);
    expect(stopHoursOf(3)).toBe(14);
    expect(stopHoursOf(14.5)).toBe(14);
  });
});

describe("a day left on", () => {
  const end = at("2026-11-19T16:00:00+11:00");
  it("is three hours past the end, by the clock: 7:00 pm on Thursday", () => {
    expect(isLeftOn(end, ms("2026-11-19T18:59:00+11:00"))).toBe(false);
    expect(isLeftOn(end, ms("2026-11-19T19:00:00+11:00"))).toBe(true);
  });
  it("isn't a night shift at 2:00 am, whatever the date", () => {
    expect(isLeftOn(at("2026-11-20T06:00:00+11:00"), ms("2026-11-20T02:00:00+11:00"))).toBe(false);
  });
});

describe("the last thing seen", () => {
  const base = {
    onAt: THU_ON,
    end: at("2026-11-19T16:00:00+11:00"),
    stop: at("2026-11-19T22:00:00+11:00"),
    now: ms("2026-11-19T22:00:00+11:00"),
    office: [],
  };
  const glebe = [{ inAt: at("2026-11-19T12:30:00+11:00"), outAt: at("2026-11-19T13:00:00+11:00") }];
  it("is getting home, 3:00 pm", () => {
    expect(lastSeen({ ...base, homeAt: at("2026-11-19T15:00:00+11:00"), stints: glebe })).toEqual({ at: at("2026-11-19T15:00:00+11:00"), what: "home" });
  });
  it("is the last check-out with no home on the card, 1:00 pm", () => {
    expect(lastSeen({ ...base, homeAt: null, stints: glebe })).toEqual({ at: at("2026-11-19T13:00:00+11:00"), what: "checkout" });
  });
  it("is the last check-out when a job came after getting home for lunch", () => {
    const later = [...glebe, { inAt: at("2026-11-19T13:30:00+11:00"), outAt: at("2026-11-19T15:30:00+11:00") }];
    expect(lastSeen({ ...base, homeAt: at("2026-11-19T13:10:00+11:00"), stints: later })).toEqual({ at: at("2026-11-19T15:30:00+11:00"), what: "checkout" });
  });
  it("is the end with nothing seen", () => {
    expect(lastSeen({ ...base, homeAt: null, stints: [] })).toEqual({ at: at("2026-11-19T16:00:00+11:00"), what: "end" });
  });
  it("is the end, at least, while still at a job when the phone stopped looking", () => {
    expect(lastSeen({ ...base, homeAt: null, stints: [{ inAt: at("2026-11-19T14:00:00+11:00"), outAt: null }] })).toEqual({ at: at("2026-11-19T16:00:00+11:00"), what: "end" });
  });
  it("is the night booking's end, 6:00 am", () => {
    expect(
      lastSeen({
        onAt: NIGHT_ON,
        end: at("2026-11-20T06:00:00+11:00"),
        stop: at("2026-11-20T11:50:00+11:00"),
        now: ms("2026-11-20T11:50:00+11:00"),
        homeAt: null,
        stints: [{ inAt: NIGHT_ON, outAt: null }],
        office: [],
      }),
    ).toEqual({ at: at("2026-11-20T06:00:00+11:00"), what: "end" });
  });
  it("is never after the stop or before Clock on", () => {
    const r = lastSeen({ ...base, end: at("2026-11-20T03:00:00+11:00"), homeAt: null, stints: [] });
    expect(r.at).toBe(base.stop);
  });
});

describe("Restart, and sending a stopped day on", () => {
  const stopped = at("2026-11-19T22:00:00+11:00");
  it("restarts for two hours, before it's sent", () => {
    expect(mayRestart(stopped, null, ms("2026-11-19T23:59:00+11:00"))).toBe(true);
    expect(mayRestart(stopped, null, ms("2026-11-20T00:01:00+11:00"))).toBe(false);
    expect(mayRestart(stopped, at("2026-11-19T22:30:00+11:00"), ms("2026-11-19T22:40:00+11:00"))).toBe(false);
  });
  it("is sent on once looked at, or once Restart's two hours are up", () => {
    expect(settlesNow({ stoppedAt: stopped, settledAt: null, seenAt: null, now: ms("2026-11-19T23:00:00+11:00") })).toBe(false);
    expect(settlesNow({ stoppedAt: stopped, settledAt: null, seenAt: at("2026-11-19T22:10:00+11:00"), now: ms("2026-11-19T22:10:00+11:00") })).toBe(true);
    expect(settlesNow({ stoppedAt: stopped, settledAt: null, seenAt: null, now: ms("2026-11-20T06:31:00+11:00") })).toBe(true);
    expect(settlesNow({ stoppedAt: stopped, settledAt: stopped, seenAt: null, now: ms("2026-11-20T06:31:00+11:00") })).toBe(false);
  });
});

it("writes the wall clock as ServiceM8 keeps it", () => {
  expect(sm8Wall("2026-11-19T21:50:00")).toBe("2026-11-19 21:50:00");
});
