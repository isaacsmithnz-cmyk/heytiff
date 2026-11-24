/**
 * @jest-environment node
 */

/* Your real day beside the bookings (bug 89): the gaps with nothing logged,
   the time you add to them, and what of it comes off the paid hours. Drawn on
   a day shaped like the one the bug was found on, 24 November 2026, with
   made-up jobs. */

import { blockOf, BLOCK_WORDS, gapsOf, offThePay } from "@/lib/mobile/day-blocks";

/* 24 November 2026 is daylight time in Sydney: +11:00 */
const at = (hm: string) => new Date(`2026-11-24T${hm}:00+11:00`).toISOString();
const span = (a: string, b: string | null) => ({ from: at(a), until: b ? at(b) : null });

describe("gapsOf", () => {
  const visits = [span("07:45", "08:49"), span("13:21", "13:52"), span("14:11", "14:44"), span("15:06", "15:21"), span("15:57", "16:53")];
  const office = [span("09:14", "10:24")];

  test("a stretch over half an hour with nothing on it is a gap, a shorter one isn't", () => {
    const gaps = gapsOf({ from: at("07:45"), until: at("16:53"), spans: [...visits, ...office] });
    expect(gaps).toEqual([{ from: at("10:24"), until: at("13:21"), minutes: 177 }, { from: at("15:21"), until: at("15:57"), minutes: 36 }]);
  });

  test("exactly half an hour isn't a gap", () => {
    expect(gapsOf({ from: at("08:00"), until: at("09:00"), spans: [span("08:30", "09:00")] })).toEqual([]);
  });

  test("the day's start before the first visit, and its end after the last, count too", () => {
    expect(gapsOf({ from: at("07:00"), until: at("12:00"), spans: [span("08:00", "09:00")] })).toEqual([
      { from: at("07:00"), until: at("08:00"), minutes: 60 },
      { from: at("09:00"), until: at("12:00"), minutes: 180 },
    ]);
  });

  test("a visit still on runs to the end, and spans that overlap or stick out are taken as one", () => {
    expect(gapsOf({ from: at("07:00"), until: at("12:00"), spans: [span("06:30", "08:00"), span("07:30", "08:15"), span("11:00", null)] })).toEqual([{ from: at("08:15"), until: at("11:00"), minutes: 165 }]);
  });

  test("time added fills the gap it's in", () => {
    const gaps = gapsOf({ from: at("07:45"), until: at("16:53"), spans: [...visits, ...office, span("10:24", "12:00"), span("12:00", "13:21")] });
    expect(gaps).toEqual([{ from: at("15:21"), until: at("15:57"), minutes: 36 }]);
  });

  test("a day that hasn't run has none", () => {
    expect(gapsOf({ from: at("08:00"), until: at("08:00"), spans: [] })).toEqual([]);
  });
});

describe("blockOf", () => {
  const day = { onAt: at("07:45"), until: at("16:53") };

  test("a kind it knows, inside the day", () => {
    expect(blockOf({ kind: "lunch", from: at("12:00"), until: at("12:30") }, day, [])).toEqual({ kind: "lunch", from: at("12:00"), until: at("12:30"), note: null });
  });

  test("words alone are Something else; Something else needs words", () => {
    expect(blockOf({ note: "  Picked up   the ute  ", from: at("12:00"), until: at("12:30") }, day, [])).toMatchObject({ kind: "other", note: "Picked up the ute" });
    expect(blockOf({ kind: "other", from: at("12:00"), until: at("12:30") }, day, [])).toEqual({ error: BLOCK_WORDS.noKind });
    expect(blockOf({ kind: "nap", from: at("12:00"), until: at("12:30") }, day, [])).toEqual({ error: BLOCK_WORDS.noKind });
  });

  test("outside the day, backwards, or over time already added is refused", () => {
    expect(blockOf({ kind: "admin", from: at("07:00"), until: at("08:00") }, day, [])).toEqual({ error: BLOCK_WORDS.outside });
    expect(blockOf({ kind: "admin", from: at("16:00"), until: at("17:30") }, day, [])).toEqual({ error: BLOCK_WORDS.outside });
    expect(blockOf({ kind: "admin", from: at("12:00"), until: at("11:00") }, day, [])).toEqual({ error: BLOCK_WORDS.backwards });
    expect(blockOf({ kind: "admin", from: "soon", until: at("11:00") }, day, [])).toEqual({ error: BLOCK_WORDS.noTime });
    expect(blockOf({ kind: "admin", from: at("12:00"), until: at("13:00") }, day, [{ from: at("12:30"), until: at("12:45") }])).toEqual({ error: BLOCK_WORDS.overlaps });
  });

  test("a minute's give either end is held to the day", () => {
    expect(blockOf({ kind: "admin", from: new Date(Date.parse(at("07:45")) - 30_000).toISOString(), until: at("08:00") }, day, [])).toMatchObject({ from: at("07:45") });
  });
});

describe("offThePay", () => {
  const paid = { from: at("07:45"), until: at("16:45") };
  const b = (kind: "lunch" | "unpaid" | "travel", a: string, z: string) => ({ kind, from: at(a), until: at(z) });

  test("with an unpaid 30-minute break, lunch is the break, and longer lunch comes off too", () => {
    const rules = { breakPaid: false, breakMinutes: 30 };
    expect(offThePay([], paid, rules)).toBe(30);
    expect(offThePay([b("lunch", "12:00", "12:20")], paid, rules)).toBe(30);
    expect(offThePay([b("lunch", "12:00", "12:45")], paid, rules)).toBe(45);
  });

  test("with a paid break, only lunch past it comes off", () => {
    const rules = { breakPaid: true, breakMinutes: 30 };
    expect(offThePay([b("lunch", "12:00", "12:30")], paid, rules)).toBe(0);
    expect(offThePay([b("lunch", "12:00", "13:00")], paid, rules)).toBe(30);
  });

  test("Unpaid comes off whole, the rest is paid, and only what's in the paid day counts", () => {
    const rules = { breakPaid: true, breakMinutes: 0 };
    expect(offThePay([b("unpaid", "13:00", "14:00"), b("travel", "10:00", "11:00")], paid, rules)).toBe(60);
    expect(offThePay([b("unpaid", "07:00", "08:00")], paid, rules)).toBe(15);
  });
});
