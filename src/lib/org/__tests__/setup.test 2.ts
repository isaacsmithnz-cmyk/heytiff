/* The setup steps — a subset of the Organisation screen's sections, and the
   routing of a rejected save back to the step that shows the field. */

import { ORG_EDITABLE_SECTIONS, type OrgSection } from "../settings";
import { draftSections, EMPTY_SETUP_DRAFT, SETUP_STEPS, stepForFields } from "../setup";

/* THE PIN THIS FILE EXISTS FOR. completeOrgSetup writes through
   saveOrgSection, whose section allowlists silently drop anything outside
   them — so a field named on a step but absent from its section would
   render, accept typing, and vanish on save without a word. Every step field
   must be inside its own section's allowlist. */
it("offers no field the section allowlist would drop", () => {
  for (const step of SETUP_STEPS) {
    const allowed = ORG_EDITABLE_SECTIONS[step.section as OrgSection];
    expect(allowed).toBeDefined();
    for (const field of step.fields) {
      expect(allowed).toContain(field);
    }
  }
});

it("drafts every step field and nothing else", () => {
  const drafted = Object.keys(EMPTY_SETUP_DRAFT).sort();
  const stepped = SETUP_STEPS.flatMap((s) => [...s.fields]).sort();
  expect(drafted).toEqual(stepped);
});

it("splits a draft into exactly the per-step payloads", () => {
  const { identity, contact } = draftSections({
    ...EMPTY_SETUP_DRAFT,
    trading_name: "Smith Air",
    gst_registered: "Yes",
    state: "VIC",
  });
  expect(identity).toEqual({
    trading_name: "Smith Air",
    legal_name: "",
    abn: "",
    gst_registered: "Yes",
  });
  expect(contact).toEqual({
    email: "",
    phone: "",
    address: "",
    suburb: "",
    state: "VIC",
    postcode: "",
  });
});

describe("stepForFields", () => {
  it("routes a field to the step that renders it", () => {
    expect(stepForFields(["abn"])).toBe(0);
    expect(stepForFields(["trading_name"])).toBe(0);
    expect(stepForFields(["state"])).toBe(1);
    expect(stepForFields(["postcode"])).toBe(1);
  });

  it("follows the first named offender when a rejection spans steps", () => {
    expect(stepForFields(["postcode", "abn"])).toBe(1);
    expect(stepForFields(["abn", "postcode"])).toBe(0);
  });

  /* The failure has to land somewhere VISIBLE — an unknown column or an
     empty list resolves to the front, where the flow restarts. */
  it("falls back to the first step for unknown or absent fields", () => {
    expect(stepForFields(["acn"])).toBe(0);
    expect(stepForFields([])).toBe(0);
    expect(stepForFields(undefined)).toBe(0);
  });
});
