import { dayWords, isSiteNoteKind, likelyCodeLines } from "../site-notes";

/* Old ServiceM8 notes as the crew wrote them, the codes changed. */

describe("a likely code in an old note", () => {
  it.each([
    "Lockbox 4821",
    "Gate Code 7340",
    "Gate Code: 7340",
    "4821 is lockbox",
    "Lockbox code: 482",
    "Lock box code 4821",
    "Access code for unit 6 is 4821 lockbox",
    "Key 1234",
    "box code 1234",
    "7340# is job code",
    "Lockbox inside the switchboard",
    "Parking access via rear lane behind property for one car",
  ])("takes %j", (note) => {
    expect(likelyCodeLines(note)).toBe(note);
  });

  it("takes a short note over two lines as one", () => {
    expect(likelyCodeLines("Pin Code:\n4821")).toBe("Pin Code: 4821");
  });

  it("takes only the lines of a note that hold the code", () => {
    expect(likelyCodeLines("lockbox at front door 4821\nkeeping unit on site.\nremove indoor only to reinstall later.")).toBe(
      "lockbox at front door 4821",
    );
  });

  it.each([
    "Still faulty, error code 51, I spoke with Mick",
    "Parking in shopping centre $12.50 paid with Micks credit card",
    "Install access panel then jobs finished",
    "Bed 2 (3rd room)\n\nGrille size - 250x1000 skinny/skinny\n\nAccess pannel - 450x450",
    "Outdoor: RXYQ10PAY1 (Serial E123456)\nRefrigerant: R410a",
    "Outdoor: PUZ-M140VKA-A\nIndoor: PEA-M140HAA <H>",
    "Repaired flares on outdoor unit. Added 300g R410a",
    "Service code: FDC140KXEN6/M",
    "Door is 820mm wide",
    "Return air from the door way 300mm centre.",
    "Key: 1234567890123",
    "",
  ])("passes over %j", (note) => {
    expect(likelyCodeLines(note)).toBeNull();
  });

  it("passes over a long report that names a way in but holds no code", () => {
    const report = `There are no keys available to access the building's plant room.\n${"The outdoor unit is running well. ".repeat(12)}`;
    expect(likelyCodeLines(report)).toBeNull();
  });
});

it("says a day without this year's year", () => {
  expect(dayWords("2026-11-09", "2026-11-14")).toBe("9 Nov");
  expect(dayWords("2025-02-02", "2026-11-14")).toBe("2 Feb 2025");
  expect(dayWords("", "2026-11-14")).toBe("");
});

it("knows the three kinds", () => {
  expect(["access", "issue", "other", "parking"].map(isSiteNoteKind)).toEqual([true, true, true, false]);
});
