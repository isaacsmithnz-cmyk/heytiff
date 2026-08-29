import {
  PHOTO_SUBJECTS,
  SUBJECT_LABEL,
  SUBJECT_MEANING,
  countBySubject,
  isPhotoSubject,
  subjectColour,
  subjectLabel,
} from "@/lib/workboard/photo-subjects";

/* The closed set the showcase filters by. These tests exist because the whole
   value of a closed set is that both ends — the prompt that offers it and the
   gallery that draws it — agree on the same vocabulary. */

describe("the subject vocabulary", () => {
  it("gives every subject a label, a meaning and a colour", () => {
    /* A subject with no label draws as a raw slug; one with no meaning is
       offered to the reader with nothing to distinguish it from its
       neighbour; one with no colour is invisible in the filter row. All
       three maps are `satisfies Record<PhotoSubject, …>`, so this is the
       runtime half of a check the compiler already does — kept because the
       compiler's half disappears the moment somebody widens the annotation
       to `Record<string, string>`. */
    for (const s of PHOTO_SUBJECTS) {
      expect(SUBJECT_LABEL[s]).toBeTruthy();
      expect(SUBJECT_MEANING[s]).toBeTruthy();
      expect(subjectColour(s)).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  /* Semantic state is never a subject's colour: a photograph of a fault is
     not an error, and finished work is not a success message. The two that
     come closest borrow the state hues deliberately and nothing else may. */
  it("keeps every subject's colour distinct", () => {
    const colours = PHOTO_SUBJECTS.map((s) => subjectColour(s));
    expect(new Set(colours).size).toBe(PHOTO_SUBJECTS.length);
  });

  it("recognises only its own members", () => {
    expect(isPhotoSubject("ductwork")).toBe(true);
    expect(isPhotoSubject("Ductwork")).toBe(false);
    expect(isPhotoSubject("condenser")).toBe(false);
    expect(isPhotoSubject(null)).toBe(false);
    expect(isPhotoSubject(7)).toBe(false);
  });
});

describe("subjectLabel", () => {
  it("names an unread photo as unread rather than as nothing", () => {
    expect(subjectLabel(null)).toBe("Not read yet");
  });

  /* RETIRING A SUBJECT MUST NOT HIDE A PHOTOGRAPH. Rows already carry
     whatever the model was offered at the time, so a value this build no
     longer knows falls back to itself — the alternative is a starred photo
     silently dropping out of the gallery when a constant changes. */
  it("falls back to the stored value for a subject this build dropped", () => {
    expect(subjectLabel("refrigerant-scales")).toBe("refrigerant-scales");
    expect(subjectColour("refrigerant-scales")).toBe("#8A8F98");
  });
});

describe("countBySubject", () => {
  it("counts in the list's own order, not by size", () => {
    /* The filter row must not reshuffle under the cursor as photos are read,
       so the order is the vocabulary's, never the counts'. */
    const counts = countBySubject([
      { subject: "finished" },
      { subject: "finished" },
      { subject: "finished" },
      { subject: "outdoor-unit" },
    ]);
    expect(counts).toEqual([
      { subject: "outdoor-unit", count: 1 },
      { subject: "finished", count: 3 },
    ]);
  });

  /* An unread photo has no subject and must not be quietly filed under one —
     the gallery counts those separately, as "Not read yet". */
  it("files nothing under a subject a photo does not have", () => {
    expect(countBySubject([{ subject: null }, { subject: null }])).toEqual([]);
  });

  it("omits a subject nothing is filed under", () => {
    const counts = countBySubject([{ subject: "fault" }]);
    expect(counts.map((c) => c.subject)).toEqual(["fault"]);
  });
});
