import {
  ALSO_MATCHED_NOTE,
  CARD_MS,
  DRAW_MS,
  FADE_MS,
  FOUND_HERE_NOTE,
  IDLE_VIZ,
  NOTHING_NOTE,
  PULSE_MS,
  SEARCHING_NOTE,
  cardNote,
  cardState,
  lanePulse,
  lineState,
  overlayVisible,
  reduceViz,
  topDocFor,
  type ResearchViz,
  type VizEvent,
} from "../research-viz";
import { KB_CATEGORIES, type KbCategory } from "../files";

/* The choreography of a research question, without a single coordinate.

   What these pin is the honesty of the thing: a shelf only lights when the
   server said it contributed, a count only appears when a count arrived, and
   every path OUT of a search — a miss, an error, a second question — takes the
   rail with it rather than leaving something lit under a new answer. */

const run = (...events: VizEvent[]): ResearchViz =>
  events.reduce(reduceViz, IDLE_VIZ);

const trace = (
  winners: KbCategory[],
  hits: Partial<Record<KbCategory, number>>,
  topDocs?: Partial<Record<KbCategory, string | null>>
): VizEvent => ({ t: "trace", winners, hits, topDocs });

/** Every shelf's line class, so a whole moment can be asserted at once. */
const lines = (s: ResearchViz) =>
  Object.fromEntries(KB_CATEGORIES.map((c) => [c, lineState(s, c)]));

const cards = (s: ResearchViz) =>
  Object.fromEntries(KB_CATEGORIES.map((c) => [c, cardState(s, c)]));

const notes = (s: ResearchViz) =>
  Object.fromEntries(KB_CATEGORIES.map((c) => [c, cardNote(s, c)]));

/* ── nothing asked ───────────────────────────────────────────────────────── */

describe("at rest", () => {
  it("draws no overlay and leaves every shelf alone", () => {
    expect(overlayVisible(IDLE_VIZ)).toBe(false);
    expect(lines(IDLE_VIZ)).toEqual({
      install: "off",
      faults: "off",
      specs: "off",
      sops: "off",
      field: "off",
    });
    expect(cards(IDLE_VIZ)).toEqual({
      install: "idle",
      faults: "idle",
      specs: "idle",
      sops: "idle",
      field: "idle",
    });
    // null means "the document count stands"
    expect(notes(IDLE_VIZ)).toEqual({ install: null, faults: null, specs: null, sops: null, field: null });
  });
});

/* ── the question goes out ───────────────────────────────────────────────── */

describe("submitting a research question", () => {
  const searching = run({ t: "submit" });

  it("sends a line to every shelf and says so under each one", () => {
    expect(searching.phase).toBe("searching");
    expect(overlayVisible(searching)).toBe(true);
    expect(lines(searching)).toEqual({
      install: "draw",
      faults: "draw",
      specs: "draw",
      sops: "draw",
      field: "draw",
    });
    expect(cards(searching)).toEqual({
      install: "searching",
      faults: "searching",
      specs: "searching",
      sops: "searching",
      field: "searching",
    });
    expect(notes(searching)).toEqual({
      install: SEARCHING_NOTE,
      faults: SEARCHING_NOTE,
      specs: SEARCHING_NOTE,
      sops: SEARCHING_NOTE,
      field: SEARCHING_NOTE,
    });
  });

  it("pulses outbound on every lane, and only while the search is out", () => {
    for (const cat of KB_CATEGORIES) expect(lanePulse(searching, cat)).toBe("out");
    expect(lanePulse(IDLE_VIZ, "faults")).toBe("off");
    // traced sits between the two pulses: the lookup is answered, the words
    // haven't started — nothing is in motion, so nothing pulses
    expect(lanePulse(run({ t: "submit" }, trace(["faults"], { faults: 3 })), "faults")).toBe("off");
    expect(lanePulse(run({ t: "submit" }, { t: "miss" }), "faults")).toBe("off");
  });

  it("claims no counts before any have arrived", () => {
    expect(searching.hits).toBeNull();
    expect(searching.winners).toEqual([]);
  });

  it("starts over on a second question, dropping the first one's trace", () => {
    const again = run({ t: "submit" }, trace(["faults"], { faults: 3 }), { t: "submit" });
    expect(again).toEqual({
      phase: "searching",
      hits: null,
      topDocs: null,
      winners: [],
      missed: false,
    });
  });
});

/* ── what came back ──────────────────────────────────────────────────────── */

describe("when the trace lands", () => {
  const traced = run(
    { t: "submit" },
    trace(["faults"], { faults: 5, install: 2, specs: 0, sops: 0 })
  );

  it("lights the winner, tints a hit, and dims the empty lines", () => {
    expect(traced.phase).toBe("traced");
    expect(lines(traced)).toEqual({
      install: "hit",
      faults: "lit",
      specs: "dim",
      sops: "dim",
      field: "dim",
    });
  });

  it("separates 'searched and found' from 'searched and empty' on the cards", () => {
    expect(cards(traced)).toEqual({
      install: "hit",
      faults: "winner",
      specs: "dim",
      sops: "dim",
      field: "dim",
    });
  });

  it("replaces each count with what that shelf actually held — never a tally", () => {
    expect(notes(traced)).toEqual({
      install: ALSO_MATCHED_NOTE,
      faults: FOUND_HERE_NOTE,
      specs: NOTHING_NOTE,
      sops: NOTHING_NOTE,
      field: NOTHING_NOTE,
    });
  });

  /* "56 matches" was retrieval's own bookkeeping on a card a person reads —
     nothing a tech can act on, and it cost the winner's title its room. One
     hit and a hundred say the same words now. */
  it("says the same thing at one match and a hundred", () => {
    const s = run({ t: "submit" }, trace(["sops"], { sops: 1, faults: 100 }));
    expect(cardNote(s, "sops")).toBe(FOUND_HERE_NOTE);
    expect(cardNote(s, "faults")).toBe(ALSO_MATCHED_NOTE);
  });

  it("lights every winning shelf when the answer spans two", () => {
    const both = run({ t: "submit" }, trace(["faults", "specs"], { faults: 4, specs: 2 }));
    expect(cardState(both, "faults")).toBe("winner");
    expect(cardState(both, "specs")).toBe("winner");
    expect(lineState(both, "specs")).toBe("lit");
  });

  /* A shelf that contributed nothing cannot be where the answer came from —
     honouring it would light a card whose own microline reads "—". */
  it("refuses a winner that has no hits", () => {
    const bogus = run({ t: "submit" }, trace(["sops"], { faults: 3 }));
    expect(bogus.winners).toEqual([]);
    expect(cardState(bogus, "sops")).toBe("dim");
  });

  it("keeps the server's ranking and drops a repeat", () => {
    const dupes = run(
      { t: "submit" },
      trace(["specs", "faults", "specs"], { specs: 2, faults: 9 })
    );
    expect(dupes.winners).toEqual(["specs", "faults"]);
  });

  it("reads a count it cannot trust as zero rather than lighting up on it", () => {
    const junk = run({ t: "submit" }, {
      t: "trace",
      winners: ["faults"],
      hits: { faults: Number.NaN, install: -4, specs: 2.7 } as Partial<Record<KbCategory, number>>,
    });
    expect(junk.hits).toEqual({ install: 0, faults: 0, specs: 2, sops: 0, field: 0 });
    expect(cardState(junk, "faults")).toBe("dim");
  });

  it("ignores a category the four shelves don't have", () => {
    const alien = run({ t: "submit" }, {
      t: "trace",
      winners: ["gremlins" as KbCategory],
      hits: { gremlins: 9 } as Partial<Record<KbCategory, number>>,
    });
    expect(alien.winners).toEqual([]);
    expect(alien.hits).toEqual({ install: 0, faults: 0, specs: 0, sops: 0, field: 0 });
  });
});

/* ── the shelf the answer came from names the document ───────────────────── */

describe("the winner's document", () => {
  const docs = { faults: "City Multi fault codes", install: "PUZ install manual" };
  const traced = run({ t: "submit" }, trace(["faults"], { faults: 5, install: 2 }, docs));

  it("puts the best-ranked document's name under the winner, and nothing else", () => {
    expect(cardNote(traced, "faults")).toBe("City Multi fault codes");
  });

  /* A title under every shelf turns the rail into a second results list. The
     winner is the one whose document the citation is about to be checked
     against. */
  it("leaves a hit shelf saying only that it matched", () => {
    expect(cardNote(traced, "install")).toBe(ALSO_MATCHED_NOTE);
    expect(topDocFor(traced, "install")).toBe("PUZ install manual");
  });

  it("keeps naming it once the answer has landed", () => {
    const settled = run(
      { t: "submit" },
      trace(["faults"], { faults: 5, install: 2 }, docs),
      { t: "firstDelta" },
      { t: "done" }
    );
    expect(cardNote(settled, "faults")).toBe("City Multi fault codes");
    expect(cardNote(settled, "install")).toBeNull();
  });

  it("names one per winning shelf when the answer spans two", () => {
    const both = run(
      { t: "submit" },
      trace(["faults", "specs"], { faults: 4, specs: 2 }, {
        faults: "City Multi fault codes",
        specs: "PUZ-ZM datasheet",
      })
    );
    expect(cardNote(both, "faults")).toBe("City Multi fault codes");
    expect(cardNote(both, "specs")).toBe("PUZ-ZM datasheet");
  });

  /* Retrieval hands over what it has. Without a title the winner still owns
     its moment rather than sitting under an empty microline. */
  it("still claims the answer when the trace named no document", () => {
    expect(cardNote(run({ t: "submit" }, trace(["faults"], { faults: 5 })), "faults")).toBe(
      FOUND_HERE_NOTE
    );
    const blank = run({ t: "submit" }, trace(["faults"], { faults: 5 }, { faults: "   " }));
    expect(cardNote(blank, "faults")).toBe(FOUND_HERE_NOTE);
    const wrong = run({ t: "submit" }, trace(["faults"], { faults: 5 }, {
      faults: 12 as unknown as string,
    }));
    expect(cardNote(wrong, "faults")).toBe(FOUND_HERE_NOTE);
  });

  it("flattens a title that arrives with line breaks in it", () => {
    const messy = run({ t: "submit" }, trace(["sops"], { sops: 1 }, {
      sops: " Warranty\nclaims  SOP ",
    }));
    expect(cardNote(messy, "sops")).toBe("Warranty claims SOP");
  });

  /* Naming a document on a shelf the search found nothing in would be naming
     something it never read. */
  it("drops a title on a shelf with no hits", () => {
    const empty = run({ t: "submit" }, trace(["faults"], { faults: 3 }, {
      specs: "PUZ-ZM datasheet",
    }));
    expect(empty.topDocs).toEqual({
      install: null,
      faults: null,
      specs: null,
      sops: null,
      field: null,
    });
    expect(cardNote(empty, "specs")).toBe(NOTHING_NOTE);
  });

  it("forgets the titles the moment the search is started over or missed", () => {
    expect(run({ t: "submit" }, trace(["faults"], { faults: 3 }, docs), { t: "submit" }).topDocs)
      .toBeNull();
    expect(run({ t: "submit" }, trace(["faults"], { faults: 3 }, docs), { t: "miss" }).topDocs)
      .toBeNull();
    expect(IDLE_VIZ.topDocs).toBeNull();
  });
});

/* ── the answer being written ────────────────────────────────────────────── */

describe("while the answer streams", () => {
  const answering = run(
    { t: "submit" },
    trace(["faults"], { faults: 5, install: 2 }),
    { t: "firstDelta" }
  );

  it("holds the winner lit and everything else down", () => {
    expect(answering.phase).toBe("answering");
    expect(cards(answering)).toEqual({
      install: "hit",
      faults: "winner",
      specs: "dim",
      sops: "dim",
      field: "dim",
    });
    expect(lines(answering)).toEqual({
      install: "hit",
      faults: "lit",
      specs: "dim",
      sops: "dim",
      field: "dim",
    });
  });

  /* The outbound pulse narrated the wait; this one narrates the writing. It
     runs the other way, and only on the lane the answer is coming from. */
  it("pulses back along the winner's lane, and nowhere else", () => {
    expect(lanePulse(answering, "faults")).toBe("back");
    expect(lanePulse(answering, "install")).toBe("off");
    expect(lanePulse(answering, "specs")).toBe("off");
  });

  /* Retrieval always reports before a word is written. If the words start
     first, "still looking" is the truthful thing on screen. */
  it("leaves the rail searching when a delta beats the trace", () => {
    const early = run({ t: "submit" }, { t: "firstDelta" });
    expect(early.phase).toBe("searching");
    expect(cardState(early, "faults")).toBe("searching");
  });

  it("takes a late trace without rewinding to traced", () => {
    const late = run({ t: "submit" }, trace([], {}), { t: "firstDelta" }, trace(["sops"], { sops: 2 }));
    expect(late.phase).toBe("answering");
    expect(cardState(late, "sops")).toBe("winner");
  });
});

/* ── the library had nothing ─────────────────────────────────────────────── */

describe("a miss", () => {
  const missed = run({ t: "submit" }, { t: "miss" });

  it("takes every line out and puts every shelf back", () => {
    expect(missed.missed).toBe(true);
    expect(lines(missed)).toEqual({
      install: "fade",
      faults: "fade",
      specs: "fade",
      sops: "fade",
      field: "fade",
    });
    expect(cards(missed)).toEqual({
      install: "idle",
      faults: "idle",
      specs: "idle",
      sops: "idle",
      field: "idle",
    });
    // the banner above the answer is the story; the rail claims nothing
    expect(notes(missed)).toEqual({ install: null, faults: null, specs: null, sops: null, field: null });
  });

  it("lights nothing when the general-knowledge answer that follows streams", () => {
    const after = reduceViz(missed, { t: "firstDelta" });
    expect(after).toEqual(missed);
    expect(cards(after)).toEqual({
      install: "idle",
      faults: "idle",
      specs: "idle",
      sops: "idle",
      field: "idle",
    });
  });

  it("stays a miss when that answer finishes", () => {
    expect(reduceViz(missed, { t: "done" })).toEqual(missed);
  });

  it("clears a trace that had already lit something", () => {
    const late = run({ t: "submit" }, trace(["faults"], { faults: 3 }), { t: "miss" });
    expect(late.hits).toBeNull();
    expect(late.winners).toEqual([]);
    expect(cardState(late, "faults")).toBe("idle");
  });
});

/* ── the answer lands ────────────────────────────────────────────────────── */

describe("once the answer is finished", () => {
  const settled = run(
    { t: "submit" },
    trace(["faults"], { faults: 5, install: 2 }),
    { t: "firstDelta" },
    { t: "done" }
  );

  it("keeps the winner's thread faintly and fades every other line", () => {
    expect(settled.phase).toBe("settled");
    expect(overlayVisible(settled)).toBe(true);
    expect(lines(settled)).toEqual({
      install: "fade",
      faults: "kept",
      specs: "fade",
      sops: "fade",
      field: "fade",
    });
    // the card keeps its ring and note; the line keeps residue, not motion
    expect(lanePulse(settled, "faults")).toBe("off");
  });

  /* The rail goes back to being the way into the library — except the shelf
     the answer came from, which stays lit beside the source chips. */
  it("leaves the winner lit and relaxes everything else", () => {
    expect(cards(settled)).toEqual({
      install: "idle",
      faults: "winner",
      specs: "idle",
      sops: "idle",
      field: "idle",
    });
    expect(notes(settled)).toEqual({
      install: null,
      faults: FOUND_HERE_NOTE,
      specs: null,
      sops: null,
      field: null,
    });
  });

  it("finishes a search that never reported without lighting anything", () => {
    const quiet = run({ t: "submit" }, { t: "done" });
    expect(quiet.phase).toBe("settled");
    expect(cards(quiet)).toEqual({
      install: "idle",
      faults: "idle",
      specs: "idle",
      sops: "idle",
      field: "idle",
    });
  });

  it("does not relight when a stray trace arrives afterwards", () => {
    expect(reduceViz(settled, trace(["sops"], { sops: 9 }))).toEqual(settled);
    expect(reduceViz(settled, { t: "miss" })).toEqual(settled);
    expect(reduceViz(settled, { t: "done" })).toEqual(settled);
  });
});

/* ── everything that takes the rail away ─────────────────────────────────── */

describe("clearing the rail", () => {
  const lit = run({ t: "submit" }, trace(["faults"], { faults: 5 }), { t: "firstDelta" });

  it("wipes it on an error, from any moment of the search", () => {
    expect(reduceViz(lit, { t: "error" })).toEqual(IDLE_VIZ);
    expect(reduceViz(run({ t: "submit" }), { t: "error" })).toEqual(IDLE_VIZ);
    expect(reduceViz(reduceViz(lit, { t: "done" }), { t: "error" })).toEqual(IDLE_VIZ);
  });

  it("wipes it on a reset — a new question, a thread switch, a general send", () => {
    expect(reduceViz(lit, { t: "reset" })).toEqual(IDLE_VIZ);
    expect(reduceViz(IDLE_VIZ, { t: "reset" })).toEqual(IDLE_VIZ);
  });

  it("ignores events that only mean something mid-question", () => {
    for (const event of [trace(["faults"], { faults: 2 }), { t: "miss" } as const, { t: "firstDelta" } as const, { t: "done" } as const]) {
      expect(reduceViz(IDLE_VIZ, event)).toEqual(IDLE_VIZ);
    }
  });

  it("never mutates the state it was handed", () => {
    const before = run({ t: "submit" }, trace(["faults"], { faults: 5 }));
    const snapshot = JSON.parse(JSON.stringify(before));
    reduceViz(before, { t: "done" });
    reduceViz(before, { t: "reset" });
    expect(before).toEqual(snapshot);
  });
});

/* ── the durations the stylesheet and this file have to agree on ─────────── */

describe("timings", () => {
  it("names every duration the animation uses, so nothing is a magic number", () => {
    expect(DRAW_MS).toBe(450);
    expect(PULSE_MS).toBe(1500);
    expect(FADE_MS).toBe(600);
    expect(CARD_MS).toBe(250);
  });

  it("lets a line finish drawing before it can be faded out", () => {
    expect(DRAW_MS).toBeLessThan(FADE_MS + DRAW_MS);
    expect(CARD_MS).toBeLessThan(DRAW_MS);
  });
});
