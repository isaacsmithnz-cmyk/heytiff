import { guessKbCategory, titleFromFilename } from "../guess";

/* The drawer's opening offer. Both of these prefill a field the uploader can
   change, so what these tests pin is that the guess is SENSIBLE and never
   destructive — a model number that comes out of titleFromFilename as a
   different model number is the one failure here that matters. */

describe("guessKbCategory", () => {
  it("reads the fault books", () => {
    for (const name of [
      "mitsubishi-fault-codes.pdf",
      "VRV error code index.pdf",
      "daikin_troubleshooting_guide.pdf",
      "City Multi service manual.pdf",
      "rooftop-repair-guide.pdf",
      "alarm-list-2026.pdf",
    ]) {
      expect(guessKbCategory(name)).toBe("faults");
    }
  });

  it("reads the install books", () => {
    for (const name of [
      "PUZ-ZM250 installation manual.pdf",
      "ducted_install_checklist.pdf",
      "commissioning-sheet.pdf",
      "airstage-setup-guide.pdf",
    ]) {
      expect(guessKbCategory(name)).toBe("install");
    }
  });

  it("reads the company's own paperwork", () => {
    for (const name of [
      "SOP-warranty-claims.pdf",
      "site_procedure_confined_spaces.pdf",
      "leave policy.pdf",
      "new-starter-induction.pdf",
      "quoting workflow.pdf",
    ]) {
      expect(guessKbCategory(name)).toBe("sops");
    }
  });

  it("reads the spec sheets", () => {
    for (const name of [
      "PEAD-M140 datasheet.pdf",
      "data sheet - FDUA100.pdf",
      "2026 product catalogue.pdf",
      "brochure_city_multi.pdf",
      "capacity-tables.pdf",
    ]) {
      expect(guessKbCategory(name)).toBe("specs");
    }
  });

  it("falls back to specs when the name says nothing", () => {
    // a datasheet is what most of a manufacturer's library is, and it is the
    // pile a wrong guess misleads nobody from
    expect(guessKbCategory("scan_0001.pdf")).toBe("specs");
    expect(guessKbCategory("")).toBe("specs");
    expect(guessKbCategory("PUZ-ZM250.pdf")).toBe("specs");
  });

  it("lets the filename's own emphasis break a tie", () => {
    // whoever named the file put the important word first
    expect(guessKbCategory("installation-and-service-manual.pdf")).toBe("install");
    expect(guessKbCategory("service-and-installation-manual.pdf")).toBe("faults");
  });

  it("survives whichever separator the file was named with", () => {
    for (const name of ["fault codes.pdf", "fault_codes.pdf", "fault-codes.pdf", "fault.codes.pdf"]) {
      expect(guessKbCategory(name)).toBe("faults");
    }
  });

  it("does not find `sop` inside a longer word", () => {
    // the one stem short enough to sit inside real words
    expect(guessKbCategory("aesop-brochure.pdf")).toBe("specs");
    expect(guessKbCategory("isopropyl datasheet.pdf")).toBe("specs");
  });

  it("ignores the extension itself", () => {
    expect(guessKbCategory("catalogue.pdf")).toBe("specs");
  });
});

describe("titleFromFilename", () => {
  it("drops the extension and de-snakes the rest", () => {
    expect(titleFromFilename("ducted_install_checklist.pdf")).toBe("Ducted Install Checklist");
    expect(titleFromFilename("fault-code-index.PDF")).toBe("Fault Code Index");
  });

  it("keeps a model number exactly as it was written", () => {
    // the one thing that must never be re-cased or de-kebabbed: "Puz Zm250"
    // is a different unit
    expect(titleFromFilename("PUZ-ZM250_installation-manual.pdf")).toBe(
      "PUZ-ZM250 Installation Manual"
    );
    expect(titleFromFilename("PEAD-M140 datasheet.pdf")).toBe("PEAD-M140 Datasheet");
    expect(titleFromFilename("r32-charging-guide.pdf")).toBe("r32 Charging Guide");
  });

  it("leaves a word the uploader capitalised alone", () => {
    expect(titleFromFilename("FUJITSU airstage V-III.pdf")).toBe("FUJITSU Airstage V-III");
    expect(titleFromFilename("SOP warranty claims.pdf")).toBe("SOP Warranty Claims");
  });

  it("keeps small words small, except at the front", () => {
    expect(titleFromFilename("the-guide-to-commissioning.pdf")).toBe("The Guide to Commissioning");
    expect(titleFromFilename("of_pipes_and_pumps.pdf")).toBe("Of Pipes and Pumps");
  });

  it("collapses whatever whitespace and separators arrived", () => {
    expect(titleFromFilename("  spec   sheet__2026 .pdf")).toBe("Spec Sheet 2026");
  });

  it("takes the file's own name out of a path", () => {
    expect(titleFromFilename("/Users/me/Downloads/leave-policy.pdf")).toBe("Leave Policy");
  });

  it("is never empty and never longer than the column", () => {
    expect(titleFromFilename("")).toBe("Untitled");
    expect(titleFromFilename(".pdf")).toBe("Untitled");
    expect(titleFromFilename(`${"a".repeat(400)}.pdf`).length).toBeLessThanOrEqual(160);
  });
});
