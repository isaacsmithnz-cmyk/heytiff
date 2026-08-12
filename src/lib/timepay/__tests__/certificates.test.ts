import { certificateExpected, type LeaveKind } from "../leave";

/* WHEN A CERTIFICATE IS EXPECTED — one rule, read by the request form, the
   approver's pending card and the timesheet bullet, so those three cannot
   disagree about the same absence.

   Before this existed the word `certificate` appeared in exactly one file in
   the codebase: a bullet on the approver's screen reading "confirm a
   certificate if required". There was no field, nothing to upload, and nothing
   that recorded one. The prompt was the whole mechanism. */

const P: LeaveKind = "personal";

describe("certificateExpected", () => {
  it("asks for nothing when the workspace hasn't set a threshold", () => {
    // every existing org, and the default — nobody wakes up to a new warning
    expect(certificateExpected(P, 5, null)).toBe(false);
    expect(certificateExpected(P, 5, undefined)).toBe(false);
  });

  it("asks from the threshold up, and not below it", () => {
    expect(certificateExpected(P, 1, 2)).toBe(false);
    expect(certificateExpected(P, 2, 2)).toBe(true);
    expect(certificateExpected(P, 9, 2)).toBe(true);
  });

  it("a threshold of 1 means every personal day", () => {
    expect(certificateExpected(P, 1, 1)).toBe(true);
  });

  /* PERSONAL LEAVE ONLY. Annual leave is a holiday and unpaid leave is an
     arrangement; neither has a doctor in it. Applying the threshold to all
     three would put a warning on the form of everyone taking a week off in
     January. */
  it.each(["annual", "unpaid"] as const)("never asks %s leave for one", (kind) => {
    expect(certificateExpected(kind, 10, 1)).toBe(false);
  });

  /* It counts WORKING days, which is the caller's job to supply — and the
     reason every caller routes through `businessDays`. A Friday-to-Monday sick
     spell is four days on a calendar and two on a roster, and two is both the
     number the form prints under the picker and the number a person would say
     out loud. This is the contract that keeps a part-timer's Mon/Thu week from
     being counted as a full one. */
  it("takes working days, so a weekend inside a span doesn't inflate it", () => {
    // Fri + Mon = 2 working days across a 4-day calendar span
    expect(certificateExpected(P, 2, 3)).toBe(false);
    expect(certificateExpected(P, 4, 3)).toBe(true);
  });
});
