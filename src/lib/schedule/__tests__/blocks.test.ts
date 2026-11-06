import { blockSpan, blocksAsAway, blockWrong, boardNameOf, cleanWords, minutesOf, placeWrong, withBlocks } from "../blocks";
import { leaveSubject, parseLeaveSubject } from "@/lib/integrations/sm8-leave-plan";

/* Block out time (Isaac, 6 November 2026, "Build it" on the block out mock):
   what, where and how long; on a person's day it is time off like
   ServiceM8's own, and once ServiceM8 has its copy it is still drawn once. */

describe("a block's words", () => {
  it("trims what and where, and an empty where is none", () => {
    expect(cleanWords("  Supplier   meeting ", "  ")).toEqual({ what: "Supplier meeting", where: null });
    expect(cleanWords("Doctor", "Mona Vale")).toEqual({ what: "Doctor", where: "Mona Vale" });
  });

  it("asks for what it is, and a length on the quarter hour", () => {
    expect(blockWrong({ what: "", where: null, minutes: 60 })).toBe("Say what it is.");
    expect(blockWrong({ what: "x".repeat(41), where: null, minutes: 60 })).toMatch(/40 letters/);
    expect(blockWrong({ what: "Doctor", where: "y".repeat(61), minutes: 60 })).toMatch(/60 letters/);
    expect(blockWrong({ what: "Doctor", where: null, minutes: 50 })).toBe("Choose how long it is.");
    expect(blockWrong({ what: "Doctor", where: null, minutes: 90 })).toBeNull();
  });

  it("goes on a real day, on the quarter hour, ending by midnight", () => {
    expect(placeWrong({ day: "6 Nov", startMin: 900, minutes: 90 })).toBe("Choose the day.");
    expect(placeWrong({ day: "2026-11-06", startMin: 905, minutes: 90 })).toBe("Choose when it starts.");
    expect(placeWrong({ day: "2026-11-06", startMin: 23 * 60, minutes: 120 })).toBe("It has to end by midnight.");
    expect(placeWrong({ day: "2026-11-06", startMin: 900, minutes: 90 })).toBeNull();
  });

  it("reads a time of day", () => {
    expect(minutesOf("15:00")).toBe(900);
    expect(minutesOf("7:30")).toBe(450);
    expect(minutesOf("25:00")).toBeNull();
    expect(minutesOf(null)).toBeNull();
  });
});

describe("on a person's day", () => {
  it("covers its span on the business's clock, a block to midnight ending on the day's last second", () => {
    expect(blockSpan({ day: "2026-11-06", startMin: 900, minutes: 90 })).toEqual({ start: "2026-11-06 15:00:00", end: "2026-11-06 16:30:00" });
    expect(blockSpan({ day: "2026-11-06", startMin: 22 * 60, minutes: 120 })).toEqual({ start: "2026-11-06 22:00:00", end: "2026-11-06 23:59:59" });
  });

  it("goes to ServiceM8's board under what and where", () => {
    expect(boardNameOf({ what: "Doctor", where: "Mona Vale" })).toBe("Doctor, Mona Vale");
    expect(boardNameOf({ what: "TAFE", where: null })).toBe("TAFE");
  });

  it("is the Schedule's time off, and one waiting in Jobs is not", () => {
    const placed = { id: "b1", what: "Doctor", where: "Mona Vale", minutes: 90, staffUuid: "S1", day: "2026-11-06", startMin: 900 };
    const waiting = { id: "b2", what: "Supplier meeting", where: null, minutes: 120, staffUuid: null, day: null, startMin: null };
    expect(blocksAsAway([placed, waiting])).toEqual([
      { uuid: "block:b1", staffUuid: "S1", name: "Doctor", where: "Mona Vale", blockId: "b1", start: "2026-11-06 15:00:00", end: "2026-11-06 16:30:00" },
    ]);
  });

  it("is drawn once when ServiceM8's mirror has its copy, and ServiceM8's other time off stays", () => {
    const ours = blocksAsAway([{ id: "b1", what: "Doctor", where: null, minutes: 90, staffUuid: "s1", day: "2026-11-06", startMin: 900 }]);
    const mirror = [
      { uuid: "m1", staffUuid: "S1", name: "Doctor", start: "2026-11-06 15:00:00", end: "2026-11-06 16:30:00" },
      { uuid: "m2", staffUuid: "S1", name: "TAFE", start: "2026-11-06 08:00:00", end: "2026-11-06 12:00:00" },
    ];
    expect(withBlocks(mirror, ours).map((a) => a.uuid)).toEqual(["m2", "block:b1"]);
  });
});

describe("its copy on ServiceM8's board", () => {
  it("goes once per placing", () => {
    expect(leaveSubject.block("b1@1762400000000")).toBe("block:b1@1762400000000");
    expect(parseLeaveSubject("block:b1@1762400000000")).toEqual({ via: "block", id: "b1@1762400000000" });
  });
});
