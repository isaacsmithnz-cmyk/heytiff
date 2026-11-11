/* How a visit ended, in the words the job note's first line carries (the mock
   https://claude.ai/artifact/ESTib5qakLMfgTXmUW9vCy, 11 November 2026), from
   the real jobs it was drawn on. */

import { endingOf, endingWords, withEnding } from "../visit-ending-plan";

test("each answer in the words the office reads first", () => {
  expect(endingWords(endingOf({ answer: "finished" })!)).toBe("Finished");
  expect(endingWords(endingOf({ answer: "finished", detail: { quoteToo: true, quoteWords: "3 x 10” round white diffusers" } })!)).toBe("Finished, and a quote to build");
  expect(endingWords(endingOf({ answer: "coming_back", detail: { waiting: "parts", needed: "2 WiFi modules" } })!)).toBe("Coming back, waiting on parts");
  expect(endingWords(endingOf({ answer: "coming_back", detail: { waiting: "access" } })!)).toBe("Coming back, no access");
  expect(endingWords(endingOf({ answer: "coming_back", detail: { booked: "Thursday 7:00" } })!)).toBe("Coming back, booked Thursday 7:00");
  expect(endingWords(endingOf({ answer: "quote_first", detail: { quoteWho: "Luke" } })!)).toBe("Quote needed first");
  expect(endingWords(endingOf({ answer: "cant", detail: { reason: "unsafe" } })!)).toBe("Can’t go ahead, unsafe");
  expect(endingWords(endingOf({ answer: "coming_back", detail: { waiting: "more_time" }, charge: { kind: "none", reason: "site_meeting" } })!)).toBe(
    "Coming back, more time needed · No charge, site meeting",
  );
});

test("an answer missing what it needs isn't one", () => {
  expect(endingOf({ answer: "coming_back" })).toBeNull();
  expect(endingOf({ answer: "cant" })).toBeNull();
  expect(endingOf({ answer: "done" })).toBeNull();
  expect(endingOf(null)).toBeNull();
  /* a no charge with no reason is the job's charge */
  expect(endingOf({ answer: "finished", charge: { kind: "none" } })!.charge).toEqual({ kind: "job" });
});

test("what an answer keeps is only what it asks", () => {
  expect(endingOf({ answer: "finished", detail: { waiting: "parts", reason: "unsafe" } })!.detail).toEqual({ quoteToo: false });
  expect(endingOf({ answer: "coming_back", detail: { waiting: "access", needed: "modules" } })!.detail).toEqual({ waiting: "access" });
});

test("the ending goes into the note's first line, any earlier one taken out", () => {
  const note = "Isaac, 8:45 to 2:45 · 4 photos\n\nGot the unit up and running.";
  expect(withEnding(note, "Finished")).toBe("Isaac, 8:45 to 2:45 · 4 photos · Finished\n\nGot the unit up and running.");
  expect(withEnding("Isaac, 8:45 to 2:45 · 4 photos · Coming back, no access\n\nWords.", "Finished")).toBe("Isaac, 8:45 to 2:45 · 4 photos · Finished\n\nWords.");
  expect(withEnding("Isaac, 7:45 to 8:15 · Finished · No charge, site meeting", "Coming back, no access")).toBe("Isaac, 7:45 to 8:15 · Coming back, no access");
  expect(withEnding("Isaac, 7:45 to 8:15", "Finished · No charge, site meeting")).toBe("Isaac, 7:45 to 8:15 · Finished · No charge, site meeting");
});
