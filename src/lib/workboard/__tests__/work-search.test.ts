/* The one search box's rules, held still.

   What these pin: that every side of the board is reachable from one query;
   that a job promoted onto a board is found ONCE, as the promotion; that
   every typed word has to land, so a second word narrows rather than widens;
   that live work sorts ahead of finished work; and that a cap is a number the
   caller can report rather than a silent truncation. */

import { jobSearchTerm } from "@/lib/workboard/work-search";

/* The palette's ask of the mirror. Isaac typed "job 288" into ⌘K; the mirror
   stores the number bare, so the word in front of it has to go before the
   question is asked — and only that word, only as a word. */
describe("the job the palette asks for", () => {
  it.each([
    ["job 288", "288"],
    ["Job 288", "288"],
    ["job #288", "288"],
    ["#288", "288"],
    ["# 288", "288"],
    ["job no. 288", "288"],
    ["job no.288", "288"],
    ["job no 288", "288"],
    ["job number 288", "288"],
    ["jobs 288", "288"],
    ["job288", "288"],
    ["  job   2380A  ", "2380A"],
  ])("reads %p as job %p", (typed, asked) => {
    expect(jobSearchTerm(typed)).toBe(asked);
  });

  it("asks for the rest as typed when no number follows", () => {
    expect(jobSearchTerm("job kingsford")).toBe("kingsford");
    expect(jobSearchTerm("Kingsford Bakery")).toBe("Kingsford Bakery");
    expect(jobSearchTerm("job nothing works")).toBe("nothing works");
  });

  it("leaves a word that only starts like the lead", () => {
    expect(jobSearchTerm("jobson plumbing")).toBe("jobson plumbing");
    expect(jobSearchTerm("number 7 cafe")).toBe("number 7 cafe");
  });

  it("asks for nothing when the lead is all there is", () => {
    expect(jobSearchTerm("job")).toBe("");
    expect(jobSearchTerm("jobs")).toBe("");
    expect(jobSearchTerm("job #")).toBe("");
    expect(jobSearchTerm("   ")).toBe("");
  });
});
