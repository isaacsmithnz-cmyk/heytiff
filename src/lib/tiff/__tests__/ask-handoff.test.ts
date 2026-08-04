import {
  ASK_HANDOFF_KEY,
  TITLE_CAP,
  askPrefill,
  consumeAskHandoff,
  writeAskHandoff,
} from "../ask-handoff";

/* The note a library row leaves for the composer.

   What these pin: the opener is a sentence somebody can finish, the document
   is named in it, and the note is read exactly once — a second read has to
   come back empty or a refresh would re-ask a question that was already
   asked. */

beforeEach(() => sessionStorage.clear());

describe("the opener", () => {
  it("names the document and leaves the caret mid-sentence", () => {
    expect(askPrefill("City Multi fault codes")).toBe("In “City Multi fault codes”, ");
  });

  it("keeps a long title readable rather than filling the composer with it", () => {
    const long = "Mitsubishi Electric ".repeat(12).trim();
    const prefill = askPrefill(long);

    expect(prefill.length).toBeLessThan(long.length);
    expect(prefill).toMatch(/…”, $/);
    expect(prefill.startsWith("In “Mitsubishi Electric")).toBe(true);
  });

  it("quotes a title right on the cap in full", () => {
    const exact = "x".repeat(TITLE_CAP);
    expect(askPrefill(exact)).toBe(`In “${exact}”, `);
    expect(askPrefill("y".repeat(TITLE_CAP + 1))).toContain("…");
  });

  it("flattens a title that carries line breaks", () => {
    expect(askPrefill("  City Multi\nfault codes\t ")).toBe("In “City Multi fault codes”, ");
  });

  it("has nothing to say about a document with no title", () => {
    expect(askPrefill("   ")).toBe("");
    expect(askPrefill(undefined as unknown as string)).toBe("");
  });
});

describe("leaving the note", () => {
  it("stores the opener under the one key the composer reads", () => {
    expect(writeAskHandoff("City Multi fault codes")).toBe(true);
    expect(sessionStorage.getItem(ASK_HANDOFF_KEY)).toBe("In “City Multi fault codes”, ");
  });

  it("writes nothing for a document with no title", () => {
    expect(writeAskHandoff("")).toBe(false);
    expect(sessionStorage.getItem(ASK_HANDOFF_KEY)).toBeNull();
  });
});

describe("reading the note", () => {
  it("hands it over once and tears it up", () => {
    writeAskHandoff("City Multi fault codes");

    expect(consumeAskHandoff()).toBe("In “City Multi fault codes”, ");
    expect(consumeAskHandoff()).toBeNull();
    expect(sessionStorage.getItem(ASK_HANDOFF_KEY)).toBeNull();
  });

  it("keeps the trailing space — the question continues from there", () => {
    writeAskHandoff("SOP-14 Warranty claims");
    expect(consumeAskHandoff()?.endsWith(", ")).toBe(true);
  });

  it("reads nothing when nothing was left", () => {
    expect(consumeAskHandoff()).toBeNull();
  });

  it("treats a whitespace-only note as no note, and still clears it", () => {
    sessionStorage.setItem(ASK_HANDOFF_KEY, "   ");
    expect(consumeAskHandoff()).toBeNull();
    expect(sessionStorage.getItem(ASK_HANDOFF_KEY)).toBeNull();
  });
});
