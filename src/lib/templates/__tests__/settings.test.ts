import { PAYMENT_PRESETS } from "@/lib/quotes/payment";
import { DEFAULT_CHECKLIST } from "@/lib/workboard/stages";
import { STANDARD_EMAIL, fillEmail, noteKeyFor, standardTemplates, templateProblems, templatesFrom } from "../settings";

/* A business's own templates: the standard wording until it writes its own,
   its own read back through the same normaliser wherever it is used, and the
   email's brackets filled from the job without leaving stray punctuation. */

describe("the standard wording", () => {
  it("is what a business gets until it changes something", () => {
    const t = templatesFrom([]);
    expect(t.paymentTerms).toEqual(PAYMENT_PRESETS);
    expect(t.projectChecklist).toEqual(DEFAULT_CHECKLIST);
    expect(t.quoteNotes.map((n) => n.key)).toContain("roof_access");
    expect(t.quoteNotes.every((n) => !n.always)).toBe(true);
    expect(t.changed).toEqual({});
  });
});

describe("a business's own", () => {
  it("replaces the standard one, and says when", () => {
    const t = templatesFrom([
      { key: "documents_email", value: { subject: "Paperwork for [job number]", message: "Hi,\n\nAttached." }, updated_at: "2026-10-03T01:00:00Z" },
      { key: "project_checklist", value: [{ section: "Handover", label: "Remote set up" }], updated_at: "2026-10-03T02:00:00Z" },
    ]);
    expect(t.documentsEmail).toEqual({ subject: "Paperwork for [job number]", message: "Hi,\n\nAttached." });
    expect(t.projectChecklist).toEqual([{ section: "Handover", label: "Remote set up" }]);
    expect(t.changed).toEqual({ documents_email: "2026-10-03T01:00:00Z", project_checklist: "2026-10-03T02:00:00Z" });
  });

  it("falls back to the standard one when what's stored can't be read", () => {
    const t = templatesFrom([{ key: "documents_email", value: { subject: "" }, updated_at: "x" }]);
    expect(t.documentsEmail).toEqual(STANDARD_EMAIL);
    expect(t.changed).toEqual({});
  });

  it("gives a note it adds a key of its own, never one already taken", () => {
    expect(noteKeyFor("Warranty", [])).toBe("own-warranty");
    expect(noteKeyFor("Warranty", ["own-warranty"])).toBe("own-warranty-2");
    const t = templatesFrom([
      {
        key: "quote_notes",
        value: [
          { key: "roof_access", heading: "Roof access", lines: ["Tiles."], always: true },
          { key: "roof_access", heading: "Roof again", lines: ["Twice."] },
          { heading: "Empty", lines: [] },
        ],
        updated_at: "x",
      },
    ]);
    expect(t.quoteNotes.map((n) => [n.key, n.always])).toEqual([
      ["roof_access", true],
      ["own-roof-again", false],
    ]);
  });
});

describe("what stops a save", () => {
  it("holds home payment terms to the Home Building Act and to 100%", () => {
    const terms = standardTemplates().paymentTerms;
    terms.domestic_small.stages = [
      { when: "Deposit, on accepting", percent: 20 },
      { when: "Balance", percent: 70 },
    ];
    expect(templateProblems("payment_terms", terms)).toEqual([
      "Home, small job: a deposit on a home job can't be more than 10%.",
      "Home, small job: the stages add up to 90%, not 100%.",
    ]);
    expect(templateProblems("payment_terms", standardTemplates().paymentTerms)).toEqual([]);
  });

  it("wants an email with a subject and a message, and a checklist with something on it", () => {
    expect(templateProblems("documents_email", { subject: "x", message: "" })).toEqual(["Give the email a subject and a message."]);
    expect(templateProblems("project_checklist", [])).toEqual(["Give the checklist at least one item."]);
  });
});

describe("the email, filled in from the job", () => {
  const facts = { jobNumber: "1234", siteAddress: "12 Smith St", yourName: "Dan", business: "Coolbreeze Air" };

  it("puts the job's facts where the brackets are", () => {
    expect(fillEmail(STANDARD_EMAIL.subject, facts)).toBe("Documents for job 1234, 12 Smith St");
    expect(fillEmail(STANDARD_EMAIL.message, facts)).toBe("Hi,\n\nPlease find our documents for this job attached.\n\nKind regards,\nDan\nCoolbreeze Air");
  });

  it("takes out a fact the job doesn't have, and the comma it leaves", () => {
    expect(fillEmail(STANDARD_EMAIL.subject, { ...facts, siteAddress: null })).toBe("Documents for job 1234");
    expect(fillEmail(STANDARD_EMAIL.message, { ...facts, yourName: null })).toBe("Hi,\n\nPlease find our documents for this job attached.\n\nKind regards,\nCoolbreeze Air");
  });
});
