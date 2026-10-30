import { MISS_STEP, categoryHue, clockOf, forwardedWhen, dayLabel, noteTitle, stepsFromTrace, threadWhen, viewOf, withConvState } from "../conversations";

/* The words and times Conversations shows (the board v2-board-conversations). */

const at = (y: number, mo: number, d: number, h = 10, mi = 42) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 10, 13, 10, 45); // a Tuesday

describe("times", () => {
  it("reads a clock time as the board does", () => {
    expect(clockOf(at(2026, 10, 13, 10, 42))).toBe("10:42 am");
    expect(clockOf(at(2026, 10, 13, 15, 5))).toBe("3:05 pm");
  });

  it("names a thread's time: today with its clock, yesterday, the weekday, then the date", () => {
    expect(threadWhen(at(2026, 10, 13, 8, 12), NOW)).toBe("Today 8:12 am");
    expect(threadWhen(at(2026, 10, 12), NOW)).toBe("Yesterday");
    expect(threadWhen(at(2026, 10, 9), NOW)).toBe("Friday");
    expect(threadWhen(at(2026, 9, 30), NOW)).toBe("30 September");
    expect(threadWhen(at(2025, 9, 30), NOW)).toBe("30 September 2025");
  });

  it("names a day's divider", () => {
    expect(dayLabel(at(2026, 10, 13), NOW)).toBe("Today");
    expect(dayLabel(at(2026, 10, 12), NOW)).toBe("Yesterday");
    expect(dayLabel(at(2026, 10, 10), NOW)).toBe("Saturday");
    expect(dayLabel(at(2026, 10, 2), NOW)).toBe("Friday 2 October");
  });
});

describe("her steps", () => {
  const trace = (hits: Partial<Record<"install" | "faults" | "specs" | "sops" | "field", [number, string | null]>>, winners: ("install" | "faults" | "specs" | "sops" | "field")[]) => ({
    t: "trace" as const,
    categories: Object.fromEntries(
      (["install", "faults", "specs", "sops", "field"] as const).map((k) => [k, { hits: hits[k]?.[0] ?? 0, topDoc: hits[k]?.[1] ?? null }]),
    ) as Record<"install" | "faults" | "specs" | "sops" | "field", { hits: number; topDoc: string | null }>,
    winners,
    terms: [],
  });

  it("are what the search reported: how much matched, and what she read first", () => {
    expect(stepsFromTrace(trace({ install: [3, "PEAD manual"], faults: [1, "Fault book"] }, ["install", "faults"]))).toEqual([
      "Searched your library: 4 matching passages",
      "Read PEAD manual",
      "Read Fault book",
    ]);
    expect(stepsFromTrace(trace({ install: [1, "PEAD manual"] }, ["install"]))[0]).toBe("Searched your library: 1 matching passage");
  });

  it("are nothing when nothing matched; the miss says that itself", () => {
    expect(stepsFromTrace(trace({}, []))).toEqual([]);
    expect(MISS_STEP).toMatch(/nothing in it covers this/);
  });
});

describe("the address and the rest", () => {
  it("writes the view and what is open, and leaves Inbox bare", () => {
    expect(withConvState("http://x/dashboard/conversations", { view: "inbox", open: null })).toBe("/dashboard/conversations");
    expect(withConvState("http://x/dashboard/conversations?view=chats", { view: "inbox", open: "email-1" })).toBe("/dashboard/conversations?open=email-1");
    expect(withConvState("http://x/dashboard/conversations", { view: "chats", open: "t-1" })).toBe("/dashboard/conversations?view=chats&open=t-1");
  });

  it("reads a view: the one named, else Chats for a chat it opens, else Inbox", () => {
    expect(viewOf("chats")).toBe("chats");
    expect(viewOf("inbox", "t-1")).toBe("inbox");
    expect(viewOf(undefined, "t-1")).toBe("chats");
    expect(viewOf(undefined, "email-6a3e5b78-0003-41de-bc30-08d2572017a0")).toBe("inbox");
    // Team and Only me went: an old address lands on Inbox
    expect(viewOf("team")).toBe("inbox");
    expect(viewOf("me")).toBe("inbox");
    expect(viewOf(undefined)).toBe("inbox");
  });

  it("says when an email came in as its row does", () => {
    const now = new Date(2026, 9, 30, 21, 0).getTime();
    expect(forwardedWhen(new Date(2026, 9, 30, 14, 12).getTime(), now)).toBe("at 2:12 pm");
    expect(forwardedWhen(new Date(2026, 9, 29, 19, 48).getTime(), now)).toBe("yesterday");
    expect(forwardedWhen(new Date(2026, 9, 27, 9, 0).getTime(), now)).toBe("on Tuesday");
    expect(forwardedWhen(new Date(2026, 9, 21, 9, 0).getTime(), now)).toBe("on 21 October");
  });

  it("snaps each kind of document to the eight, and no two to one", () => {
    const hues = (["install", "faults", "specs", "sops", "field"] as const).map(categoryHue);
    expect(new Set(hues).size).toBe(5);
    expect(hues).not.toContain("red");
  });

  it("titles a note by its first line", () => {
    expect(noteTitle("\n  Ring the wholesaler\nabout pricing")).toBe("Ring the wholesaler");
    expect(noteTitle("   ")).toBe("Note");
  });
});
