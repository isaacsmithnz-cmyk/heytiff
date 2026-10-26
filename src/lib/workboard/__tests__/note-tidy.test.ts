import { factsKept, jobNoteWords, knownMentionsOnly, numbersIn } from "../note-tidy";

/* The one note on a job: Tiff's tidy of what was said, kept only when every
   figure said survives it, its mentions the roster's own handles. The
   words are job 2935's, as a tech might say them on site. */

const SAID =
  "Um, so for Stanmore on Monday, the kitchen head's actually going on the wall above the fridge, not the, uh, the window side like the quote said. And the pipe run to bed three is about 14 metres, so we'll need another 15 metre coil of quarter half. Get David to grab that from Reece on Friday. Oh, and the outdoor's going down the side path on the 600 brackets.";
const TIDIED =
  "Kitchen head goes on the wall above the fridge, not the window side as quoted.\n\nPipe run to Bed 3 is about 14 m, so we need another 15 m coil of 1/4 + 1/2. @davidhann please grab it from Reece on Friday.\n\nOutdoor unit goes down the side path on the 600 brackets.";
const HANDLES = new Set(["davidhann", "michaeldiamond"]);

describe("the figures said", () => {
  it("are read as written", () => {
    expect(numbersIn(SAID)).toEqual(["14", "15", "600"]);
    expect(numbersIn("1.5 kW at 7:30, 3/4 pipe")).toEqual(["1.5", "7", "30", "3/4"]);
  });

  it("are all kept by a good tidy, which may add the ones it wrote out", () => {
    expect(factsKept(SAID, TIDIED)).toBe(true);
  });

  it("aren't kept when one is changed or dropped", () => {
    expect(factsKept(SAID, TIDIED.replace("14 m", "41 m"))).toBe(false);
    expect(factsKept(SAID, TIDIED.replace(" on the 600 brackets", ""))).toBe(false);
  });

  it("count: said twice, kept twice", () => {
    expect(factsKept("two 600 brackets and a 600 stand", "A 600 bracket and stand")).toBe(false);
    expect(factsKept("two 600 brackets and a 600 stand", "Two 600 brackets and a 600 stand")).toBe(true);
  });
});

describe("a mention", () => {
  it("stays when ServiceM8 knows the handle, even before a full stop", () => {
    expect(knownMentionsOnly("Grab it, @davidhann.", HANDLES)).toBe("Grab it, @davidhann.");
  });

  it("loses its @ when ServiceM8 doesn't", () => {
    expect(knownMentionsOnly("@davo grab it", HANDLES)).toBe("davo grab it");
  });

  it("isn't an email address", () => {
    expect(knownMentionsOnly("send it to susie@peterson.com", HANDLES)).toBe("send it to susie@peterson.com");
  });
});

describe("the words a note on a job keeps", () => {
  it("are Tiff's tidy when it keeps every figure", () => {
    expect(jobNoteWords(SAID, TIDIED, HANDLES)).toBe(TIDIED);
  });

  it("are the words as said when the tidy lost a figure, or said nothing", () => {
    expect(jobNoteWords(SAID, TIDIED.replace("15 m", "50 m"), HANDLES)).toBe(SAID);
    expect(jobNoteWords(SAID, "   ", HANDLES)).toBe(SAID);
  });

  it("carry only handles ServiceM8 knows", () => {
    expect(jobNoteWords("ring the client", "@isaac ring the client", HANDLES)).toBe("isaac ring the client");
  });
});
