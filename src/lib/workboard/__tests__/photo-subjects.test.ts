import {
  FAMILY_COLOUR,
  FAMILY_LABEL,
  PHOTO_FAMILIES,
  PHOTO_SUBJECTS,
  SUBJECT_LABEL,
  SUBJECT_MEANING,
  countByFamily,
  countBySubject,
  familyOf,
  isPhotoSubject,
  subjectColour,
  subjectLabel,
  subjectsInFamily,
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

/* ── the families ─────────────────────────────────────────────────────────
   The broad cut the gallery's tabs are made of. Ten chips in a row was the
   whole filter and it read as a wall of labels; five tabs is the way in, and
   the ten subjects moved behind a filter button. */

describe("the families", () => {
  /* THE FAILURE THIS PREVENTS IS A PHOTOGRAPH REACHABLE FROM NO TAB. Every
     subject must land in a family, or a photo of that subject is filtered out
     of every tab including the one that claims to hold its kind. */
  it("files every subject under exactly one family", () => {
    for (const s of PHOTO_SUBJECTS) {
      const f = familyOf(s);
      expect(f).not.toBeNull();
      expect(PHOTO_FAMILIES).toContain(f);
    }
  });

  it("gives every family a label and a colour", () => {
    for (const f of PHOTO_FAMILIES) {
      expect(FAMILY_LABEL[f]).toBeTruthy();
      expect(FAMILY_COLOUR[f]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("leaves no family empty — a tab with nothing under it is furniture", () => {
    for (const f of PHOTO_FAMILIES) {
      expect(subjectsInFamily(f).length).toBeGreaterThan(0);
    }
  });

  /* An unread photo has no subject, and a subject this build has retired is
     one it cannot place. Both are "not filed", which is the honest answer —
     inventing a family for either is how a photo ends up under a heading
     nobody chose for it. */
  it("files neither an unread photo nor a subject it does not know", () => {
    expect(familyOf(null)).toBeNull();
    expect(familyOf("something-we-retired")).toBeNull();
  });

  it("keeps faults and finished apart — they are the two ends of a job", () => {
    expect(familyOf("fault")).not.toBe(familyOf("finished"));
  });
});

describe("countByFamily", () => {
  const p = (subject: string | null) => ({ subject });

  it("counts each family and skips the empty ones", () => {
    expect(
      countByFamily([p("outdoor-unit"), p("dataplate"), p("ductwork"), p("fault")])
    ).toEqual([
      { family: "equipment", count: 2 },
      { family: "installation", count: 1 },
      { family: "faults", count: 1 },
    ]);
  });

  /* The list's own order, never the data's — a row that reshuffles as photos
     are read is a row you cannot aim at. */
  it("keeps the family list's order whatever order the photos arrive in", () => {
    const a = countByFamily([p("finished"), p("outdoor-unit")]).map((r) => r.family);
    const b = countByFamily([p("outdoor-unit"), p("finished")]).map((r) => r.family);
    expect(a).toEqual(b);
    expect(a).toEqual(["equipment", "finished"]);
  });

  it("counts no unread photo under a family", () => {
    expect(countByFamily([p(null), p(null)])).toEqual([]);
  });
});
