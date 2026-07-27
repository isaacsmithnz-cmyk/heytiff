import {
  blockDates,
  blockLabel,
  blockedDays,
  upcoming,
  validateBlock,
  type Unavailability,
} from "@/lib/timepay/availability";

/* Unavailability — a casual saying when they can't work.

   The thing these tests are really protecting is that this is a DECLARATION,
   not a request: there is no status to assert on, no reviewer and no approval,
   because a casual has no entitlement to spend and an approve step would imply
   the answer could be no. What is left to get right is the arithmetic and the
   one rule that matters — it has to point forward, or it tells nobody
   anything. */

const B = (from: string, to: string, id = "b"): Unavailability => ({
  id,
  staffId: "me",
  from,
  to,
});

const TODAY = "2026-07-10";

describe("what a block covers", () => {
  it("a single day is one day", () => {
    expect(blockDates(B("2026-07-20", "2026-07-20"))).toEqual(["2026-07-20"]);
  });

  it("a range is every day of it, inclusive at both ends", () => {
    expect(blockDates(B("2026-07-20", "2026-07-23"))).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
    ]);
  });

  it("maps every covered day back to its block, for marking up a week", () => {
    const map = blockedDays([B("2026-07-20", "2026-07-21", "a"), B("2026-08-01", "2026-08-01", "b")]);
    expect(map.get("2026-07-21")?.id).toBe("a");
    expect(map.get("2026-08-01")?.id).toBe("b");
    expect(map.has("2026-07-22")).toBe(false);
  });
});

describe("which blocks still say something", () => {
  it("keeps today's and everything after it", () => {
    const live = upcoming([B("2026-07-20", "2026-07-21"), B(TODAY, TODAY)], TODAY);
    expect(live).toHaveLength(2);
  });

  it("drops one that has run out — it says nothing about availability now", () => {
    const live = upcoming([B("2026-06-01", "2026-06-02"), B("2026-08-01", "2026-08-02")], TODAY);
    expect(live.map((b) => b.from)).toEqual(["2026-08-01"]);
  });

  it("keeps a block that STARTED in the past but hasn't finished", () => {
    const live = upcoming([B("2026-07-01", "2026-07-31")], TODAY);
    expect(live).toHaveLength(1);
  });

  it("orders them soonest first", () => {
    const live = upcoming([B("2026-09-01", "2026-09-02"), B("2026-08-01", "2026-08-02")], TODAY);
    expect(live.map((b) => b.from)).toEqual(["2026-08-01", "2026-09-01"]);
  });
});

describe("how a block reads", () => {
  it("a single day is just that day", () => {
    expect(blockLabel(B("2026-07-02", "2026-07-02"))).toBe("2 Jul");
  });

  it("a range inside one month names the month once", () => {
    expect(blockLabel(B("2026-07-02", "2026-07-05"))).toBe("2 – 5 Jul");
  });

  it("a range across two months names both", () => {
    expect(blockLabel(B("2026-07-30", "2026-08-02"))).toBe("30 Jul – 2 Aug");
  });
});

describe("what can be said", () => {
  it("accepts a forward range", () => {
    expect(validateBlock("2026-07-20", "2026-07-24", TODAY)).toEqual({ ok: true });
  });

  it("accepts today", () => {
    expect(validateBlock(TODAY, TODAY, TODAY).ok).toBe(true);
  });

  it("refuses a backwards range", () => {
    const r = validateBlock("2026-07-24", "2026-07-20", TODAY);
    expect(r.ok).toBe(false);
  });

  it("refuses one that's entirely in the past — nobody can act on it", () => {
    const r = validateBlock("2026-06-01", "2026-06-05", TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/past/);
  });

  it("refuses an empty range", () => {
    expect(validateBlock("", "", TODAY).ok).toBe(false);
  });

  it("refuses more than a year at a time", () => {
    expect(validateBlock("2026-07-20", "2028-07-20", TODAY).ok).toBe(false);
  });
});
