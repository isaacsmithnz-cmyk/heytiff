import {
  ASK_HANDOFF_KEY,
  CODE_CAP,
  TITLE_CAP,
  askPrefill,
  consumeAskHandoff,
  faultCodePrefill,
  writeAskScope,
  writeAskText,
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

/* The Fault Finder's version of the same note. A diagnosis that lands on a
   code is the one place these trees can't answer, so the code travels here
   instead of the walk ending at "read the service manual". */
describe("the opener a fault code leaves", () => {
  it("asks the question the tech was about to ask, in their words", () => {
    expect(faultCodePrefill("E5")).toBe(
      "The unit is showing “E5”. What does that fault code mean, and what causes it? "
    );
  });

  it("carries a blink pattern as naturally as a code", () => {
    expect(faultCodePrefill("3 flashes then a pause")).toContain("“3 flashes then a pause”");
  });

  it("keeps the trailing space — the brand and model go on the end", () => {
    expect(faultCodePrefill("E5").endsWith("? ")).toBe(true);
  });

  it("says the words that route the search at the far end", () => {
    expect(faultCodePrefill("U0")).toContain("fault code");
  });

  it("flattens and trims what was typed", () => {
    expect(faultCodePrefill("  E5\ton a\n 12kW  ducted ")).toContain("“E5 on a 12kW ducted”");
  });

  it("caps a description that has stopped being a code", () => {
    const long = "flashing ".repeat(20).trim();
    const prefill = faultCodePrefill(long);
    expect(prefill).toContain("…”");
    expect(prefill.length).toBeLessThan(long.length + 60);
    expect(faultCodePrefill("x".repeat(CODE_CAP))).toContain(`“${"x".repeat(CODE_CAP)}”`);
  });

  it("has nothing to ask when nothing was typed", () => {
    expect(faultCodePrefill("   ")).toBe("");
    expect(writeAskText(faultCodePrefill(""))).toBe(false);
    expect(sessionStorage.getItem(ASK_HANDOFF_KEY)).toBeNull();
  });

  it("lands in the same box the library rows use, and is read once", () => {
    expect(writeAskText(faultCodePrefill("E5"))).toBe(true);
    // words, not a document: the Fault Finder knows the question, not the manual
    expect(consumeAskHandoff().text).toContain("“E5”");
    expect(consumeAskHandoff()).toEqual({ text: null, doc: null });
  });
});

describe("leaving the note", () => {
  /* IT CARRIES THE DOCUMENT NOW, not a sentence about it. The opener typed
     `In “City Multi fault codes”, ` into the composer and the search that
     followed read the whole library — so the choice of document was words in
     a box, and words in a box filter nothing. */
  it("leaves the document itself", () => {
    expect(writeAskScope({ docId: "d-1", title: "City Multi fault codes" })).toBe(true);
    expect(JSON.parse(sessionStorage.getItem(ASK_HANDOFF_KEY) ?? "{}")).toEqual({
      doc: { docId: "d-1", title: "City Multi fault codes" },
    });
  });

  it("writes nothing without a document to name", () => {
    expect(writeAskScope({ docId: "", title: "City Multi fault codes" })).toBe(false);
    expect(sessionStorage.getItem(ASK_HANDOFF_KEY)).toBeNull();
  });

  it("still leaves plain words for the Fault Finder", () => {
    expect(writeAskText(faultCodePrefill("E5"))).toBe(true);
    expect(sessionStorage.getItem(ASK_HANDOFF_KEY)).toContain("“E5”");
  });
});

describe("reading the note", () => {
  it("hands the document over once and tears it up", () => {
    writeAskScope({ docId: "d-1", title: "City Multi fault codes" });

    expect(consumeAskHandoff()).toEqual({
      text: null,
      doc: { docId: "d-1", title: "City Multi fault codes" },
    });
    expect(consumeAskHandoff()).toEqual({ text: null, doc: null });
    expect(sessionStorage.getItem(ASK_HANDOFF_KEY)).toBeNull();
  });

  /* The Fault Finder's note is WORDS, and always was: the code it just
     diagnosed, written as a question. A note that isn't JSON is that kind —
     which also covers one left by a tab still running the older bundle. */
  it("hands plain words back as words, trailing space and all", () => {
    writeAskText("The unit is showing “E5”. What does that fault code mean, and what causes it? ");
    const note = consumeAskHandoff();
    expect(note.doc).toBeNull();
    expect(note.text?.endsWith("? ")).toBe(true);
  });

  it("reads nothing when nothing was left", () => {
    expect(consumeAskHandoff()).toEqual({ text: null, doc: null });
  });

  it("treats a whitespace-only note as no note, and still clears it", () => {
    sessionStorage.setItem(ASK_HANDOFF_KEY, "   ");
    expect(consumeAskHandoff()).toEqual({ text: null, doc: null });
    expect(sessionStorage.getItem(ASK_HANDOFF_KEY)).toBeNull();
  });

  it("treats a note with no document id as no note", () => {
    sessionStorage.setItem(ASK_HANDOFF_KEY, JSON.stringify({ doc: { title: "No id" } }));
    expect(consumeAskHandoff()).toEqual({ text: null, doc: null });
  });

  it("survives a note that isn't the JSON it looks like", () => {
    sessionStorage.setItem(ASK_HANDOFF_KEY, "{not json");
    expect(consumeAskHandoff()).toEqual({ text: null, doc: null });
  });
});
