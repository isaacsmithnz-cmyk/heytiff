import {
  HHMM,
  hhmm,
  lateness,
  remindAtFrom,
  snoozeUntil,
  toHHMM,
} from "@/lib/dashboard/reminders";

/* ── WHEN A REMINDER ACTUALLY GOES OFF ──

   Isaac dictated "remind me to do that on Monday morning" and got a task dated
   the right Monday with the word "morning" thrown away — `tasks.due_date` is a
   DATE and there was nowhere to put a time. This is the arithmetic that fixed
   it, and the reason it is tested this hard is that its failure mode is an hour
   or a day out, which looks like nothing in a screenshot and looks like a
   broken promise to the person who missed the thing.

   THE ZONE IS NOT A DETAIL. "Monday 6:30" is not an instant; it is one instant
   in Sydney and a different one in Perth, and the server runs in neither. The
   expected values below were derived independently — by formatting candidate
   instants back through Intl in each zone — rather than by reading them off
   this module's own output, which would only have proved it agrees with
   itself. */

const SYD = "Australia/Sydney";

/** What a zone's clock reads at a given instant — the independent check. */
const wallClock = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

describe("reading a time of day", () => {
  it("takes every clock format the app can produce", () => {
    // the wheel's format, the model's format, and the two Time & Pay tolerates
    expect(toHHMM("6:30 AM")).toBe("06:30");
    expect(toHHMM("06:30")).toBe("06:30");
    expect(toHHMM("3:00 PM")).toBe("15:00");
    expect(toHHMM("0630")).toBe("06:30");
  });

  it("answers '' for anything it cannot read, rather than guessing", () => {
    for (const junk of ["", "   ", "half seven", "25:00", "soon", null, undefined])
      expect(toHHMM(junk)).toBe("");
  });

  it("round-trips midnight and noon, which are where 12-hour clocks go wrong", () => {
    expect(toHHMM("12:00 AM")).toBe("00:00");
    expect(toHHMM("12:00 PM")).toBe("12:00");
    expect(hhmm(0)).toBe("00:00");
    expect(hhmm(12 * 60)).toBe("12:00");
    expect(hhmm(23 * 60 + 59)).toBe("23:59");
  });

  it("only calls a canonical 24-hour clock a time", () => {
    expect(HHMM.test("06:30")).toBe(true);
    expect(HHMM.test("23:59")).toBe(true);
    // the shapes a model reaches for when it is improvising
    for (const bad of ["6:30", "24:00", "06:60", "6:30 AM", "0630", ""])
      expect(HHMM.test(bad)).toBe(false);
  });
});

describe("composing the instant", () => {
  it("puts Monday 6:30 in Sydney where Sydney's clock says it is", () => {
    // August is AEST, UTC+10
    expect(remindAtFrom("2026-08-24", "06:30", SYD)).toBe("2026-08-23T20:30:00.000Z");
  });

  it("puts the same wall clock somewhere else in Perth", () => {
    // Perth is UTC+8 and never moves, so the same 6:30 is two hours later
    expect(remindAtFrom("2026-08-24", "06:30", "Australia/Perth")).toBe(
      "2026-08-23T22:30:00.000Z",
    );
  });

  it("gets the offset right on either side of a daylight-saving change", () => {
    // Sydney goes +10 → +11 on 2026-10-04
    expect(remindAtFrom("2026-10-03", "06:30", SYD)).toBe("2026-10-02T20:30:00.000Z"); // AEST
    expect(remindAtFrom("2026-10-05", "06:30", SYD)).toBe("2026-10-04T19:30:00.000Z"); // AEDT
  });

  it("is right ON the changeover day itself, where one pass is an hour out", () => {
    /* THE CASE THAT JUSTIFIES THE SECOND PASS, and it took a mutation test to
       find: taking the offset in force at the UTC READING of a wall clock is
       correct almost everywhere, because that reading is ten or eleven hours
       from the real instant and the offset is the same at both. It stops being
       the same in the small hours of the two days a year the clocks move — and
       the error is silent and exactly one hour.

       Removing the second pass leaves every other assertion in this file
       green, which is why these two are here and why they are written as the
       WALL CLOCK asked for rather than as an instant: an instant literal would
       have been read off the implementation and agreed with whatever it did. */
    expect(wallClock(remindAtFrom("2026-10-04", "01:30", SYD)!, SYD)) // spring forward
      .toBe("2026-10-04, 01:30");
    expect(wallClock(remindAtFrom("2026-04-05", "01:30", SYD)!, SYD)) // fall back
      .toBe("2026-04-05, 01:30");
  });

  it("always lands on the wall clock it was asked for, whatever the zone", () => {
    /* The property, rather than four more literals: whatever instant comes
       back, reading it in that zone must show the day and time requested. */
    for (const tz of [SYD, "Australia/Perth", "Australia/Adelaide", "Pacific/Auckland"])
      for (const day of ["2026-01-15", "2026-04-05", "2026-10-04", "2026-12-31"]) {
        const at = remindAtFrom(day, "06:30", tz)!;
        expect(wallClock(at, tz)).toBe(`${day}, 06:30`);
      }
  });

  it("is null unless it has BOTH a day and a time", () => {
    // an ordinary task, which is the overwhelming majority of them
    expect(remindAtFrom("2026-08-24", "", SYD)).toBeNull();
    expect(remindAtFrom("2026-08-24", null, SYD)).toBeNull();
    expect(remindAtFrom(null, "06:30", SYD)).toBeNull();
    expect(remindAtFrom("", "06:30", SYD)).toBeNull();
    // and never invents one out of a malformed day
    expect(remindAtFrom("24/08/2026", "06:30", SYD)).toBeNull();
    expect(remindAtFrom("2026-8-24", "06:30", SYD)).toBeNull();
  });

  it("falls back to the AU anchor rather than throwing on a bad zone", () => {
    /* A misspelt timezone arriving from an upstream account must not stop a
       reminder being set — the same tolerance `todayInZone` takes. */
    expect(remindAtFrom("2026-08-24", "06:30", "Mars/Olympus")).toBe(
      remindAtFrom("2026-08-24", "06:30", SYD),
    );
    expect(remindAtFrom("2026-08-24", "06:30", null)).toBe(
      remindAtFrom("2026-08-24", "06:30", SYD),
    );
  });
});

describe("putting one off", () => {
  // a Monday, 09:15 Sydney time
  const monday = new Date("2026-08-24T09:15:00+10:00");

  it("an hour is an hour from now, not an hour past some rounded time", () => {
    expect(snoozeUntil("hour", "06:30", SYD, monday)).toBe(
      new Date(monday.getTime() + 60 * 60_000).toISOString(),
    );
  });

  it("tomorrow is tomorrow at the start of THIS person's day", () => {
    const at = snoozeUntil("tomorrow", "06:30", SYD, monday);
    expect(wallClock(at, SYD)).toBe("2026-08-25, 06:30");
  });

  it("honours an early starter's own hours rather than an idea of morning", () => {
    // the whole reason the day start is threaded through instead of hardcoded
    expect(wallClock(snoozeUntil("tomorrow", "05:00", SYD, monday), SYD)).toBe(
      "2026-08-25, 05:00",
    );
  });

  it("next week is the COMING Monday — and on a Monday that is seven days off", () => {
    /* "Next week" pressed on a Monday morning must not mean "in fifteen
       minutes". `(8 - dow) % 7 || 7` is what makes today never the answer. */
    expect(wallClock(snoozeUntil("week", "06:30", SYD, monday), SYD)).toBe("2026-08-31, 06:30");

    const friday = new Date("2026-08-28T16:00:00+10:00");
    expect(wallClock(snoozeUntil("week", "06:30", SYD, friday), SYD)).toBe("2026-08-31, 06:30");

    const sunday = new Date("2026-08-30T19:00:00+10:00");
    expect(wallClock(snoozeUntil("week", "06:30", SYD, sunday), SYD)).toBe("2026-08-31, 06:30");
  });

  it("never lands in the past, whichever day it is pressed on", () => {
    /* The one property that makes these three presets safe to offer: a snooze
       that resolves to a moment already gone is a reminder that fires again
       immediately, which reads as a broken button. */
    for (let d = 0; d < 7; d++) {
      const now = new Date(`2026-08-${24 + d}T13:00:00+10:00`);
      for (const preset of ["hour", "tomorrow", "week"] as const)
        expect(new Date(snoozeUntil(preset, "06:30", SYD, now)).getTime()).toBeGreaterThan(
          now.getTime(),
        );
    }
  });
});

describe("how late it is", () => {
  const at = "2026-08-24T00:00:00.000Z";
  const after = (mins: number) => new Date(Date.parse(at) + mins * 60_000);

  it("rounds down, so it never claims more lateness than there is", () => {
    expect(lateness(at, after(0))).toBe("now");
    expect(lateness(at, after(1.5))).toBe("now");
    expect(lateness(at, after(20))).toBe("20 minutes ago");
    expect(lateness(at, after(60))).toBe("an hour ago");
    expect(lateness(at, after(179))).toBe("2 hours ago");
    expect(lateness(at, after(60 * 25))).toBe("yesterday");
    expect(lateness(at, after(60 * 24 * 3))).toBe("3 days ago");
  });
});
