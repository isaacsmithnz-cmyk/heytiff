import {
  DEFAULT_CERT_ANSWERS,
  buildCertificate,
  buildingSuggests,
  certFileName,
  certProblemList,
  certProblems,
  certTitle,
  clausesFor,
  fmtKw,
  statementsFor,
  suggestedReason,
  wetMinimum,
  type Building,
  type CertAnswers,
  type CertFacts,
  type Covers,
  type Requirement,
} from "../mechanical";
import { normaliseCertAnswers } from "../input";
import { matchRequirement, readQuote } from "../quote";
import { FUTURECERT_9_1, JOB_1245, JOB_1300, JOB_1383, JOB_2699, JOB_279, JOB_3326 } from "./fixtures/jobs";

/* THE GOLDEN JOBS (docs/certificates-plan.md, Build order, step 1): six real
   finished jobs, each of which must get exactly these statements. */

const AC_CORE = ["refrigerant", "manufacturer", "arc"];

const TESTED = { pressureKpa: 4150, holdMinutes: 30, vacuumMicrons: 350, manufacturerMicrons: null, refrigerant: "R32", addedKg: 0 };

const FACTS: CertFacts = { today: "2026-10-01", approved: true, hasSignature: true, arcCurrent: true, contractorCurrent: true };

/** The answers a person would end on: the quote's reading, the building
    picked, every row completed, and the tests typed in. */
function answersFor(description: string, covers: Covers, building: Building, more: Partial<CertAnswers> = {}): CertAnswers {
  const q = readQuote(description);
  const s = buildingSuggests(building);
  return {
    ...DEFAULT_CERT_ANSWERS,
    covers,
    building,
    completedOn: "2026-09-30",
    systems: q.systems.map((sys, i) => ({
      outdoor: { ...sys.outdoor, model: sys.outdoor.model || `OUT-${i + 1}`, location: sys.outdoor.location || "Roof" },
      indoors: sys.indoors.map((r, j) => ({ ...r, model: r.model || `IN-${j + 1}`, location: r.location || "Office" })),
      test: { ...TESTED, refrigerant: sys.test.refrigerant || "R32" },
    })),
    fans: q.fans.map((f) => ({ ...f, location: f.location || "Whole house", airflowLps: 60 })),
    installed: { ductwork: q.ductwork, fireRated: q.fireRated || s.fireRated, fireStopProduct: "Promat collars", condensatePump: q.condensatePump },
    ventAs16682: covers.vent && s.ventAs16682,
    equipmentConfirmed: true,
    ...more,
  };
}

const AC: Covers = { ac: true, vent: false };
const BOTH: Covers = { ac: true, vent: true };

function futureCert(): Requirement[] {
  return FUTURECERT_9_1.map((text) => ({ text, answer: "clause", clause: matchRequirement(text).clause, own: "", reason: "" }));
}

describe("the golden jobs", () => {
  it("1383: FutureCert's three requirements first, in its order, then the approved documents, the refrigerant pair and ductwork", () => {
    const a = answersFor(JOB_1383, AC, "apartment", {
      requirements: futureCert(),
      certifier: { name: "FutureCert", projectNumber: "24-0108", consentAuthority: "Woollahra Municipal Council" },
      fireMode: "individual",
      fireModeRatingsChecked: true,
      installed: { ductwork: true, fireRated: false, fireStopProduct: "", condensatePump: false },
    });
    expect(clausesFor(a)).toEqual(["as1668", "fireMode", "j5", "approved", "refrigerant", "arc", "ductwork"]);
    expect(certProblems(a, FACTS)).toEqual([]);
    const c = buildCertificate(a);
    expect(c.statements.slice(0, 3).map((st) => st.requirement)).toEqual(FUTURECERT_9_1);
    expect(c.indoorKw).toBeCloseTo(19.8);
    /* ductwork went in, so Part J5 says it is insulated and sealed too */
    expect(c.statements[2].text).toBe(
      "The installation complies with Section J of the BCA for air-conditioning and ventilation: refrigerant pipework and ductwork are insulated, ductwork is sealed, and each unit can be switched off when its space is unoccupied."
    );
    const noDucts = buildCertificate({ ...a, installed: { ...a.installed, ductwork: false } });
    expect(noDucts.statements[2].text).toBe(
      "The installation complies with Section J of the BCA for air-conditioning and ventilation: refrigerant pipework is insulated, and each unit can be switched off when its space is unoccupied."
    );
  });

  it("279: air conditioning and ventilation, ductwork and the Lossnay at its rated airflow", () => {
    const a = answersFor(JOB_279, BOTH, "house");
    expect(clausesFor(a)).toEqual([...AC_CORE, "ventAirflow", "ventDischarge", "ductwork"]);
    expect(certProblems(a, FACTS)).toEqual([]);
    expect(buildCertificate(a).indoorKw).toBeCloseTo(46.7);
  });

  it("1300 and 1245: the standard set and ductwork", () => {
    for (const job of [JOB_1300, JOB_1245]) {
      const a = answersFor(job, AC, "house");
      expect(clausesFor(a)).toEqual([...AC_CORE, "ductwork"]);
      expect(certProblems(a, FACTS)).toEqual([]);
    }
  });

  it("3326: an office gets nothing beyond the standard set — no fire mode, no J5", () => {
    const a = answersFor(JOB_3326, AC, "office");
    expect(clausesFor(a)).toEqual(AC_CORE);
    expect(certProblems(a, FACTS)).toEqual([]);
  });

  it("2699: the standard set and fire-rated penetrations", () => {
    const a = answersFor(JOB_2699, AC, "apartment");
    expect(clausesFor(a)).toEqual([...AC_CORE, "fireRated"]);
    expect(certProblems(a, FACTS)).toEqual([]);
    expect(buildCertificate(a).statements.find((s) => s.clause === "fireRated")?.text).toContain("Promat collars");
  });
});

describe("the statements", () => {
  it("state the pressure test and vacuum as passed, with no gauge figures, and the charge once or per outdoor unit", () => {
    const a = answersFor(JOB_1245, AC, "house");
    const one = statementsFor(a).statements[0].text;
    expect(one).toBe("Refrigerant circuits were pressure tested, evacuated, charged and commissioned to AS/NZS 5149.2. R32, no additional charge.");
    expect(one).not.toMatch(/kPa|microns|minutes/);
    a.systems[1].test = { ...TESTED, addedKg: 0.4 };
    const two = statementsFor(a).statements[0].text;
    expect(two).toContain("OUT-1: R32, no additional charge.");
    expect(two).toContain("OUT-2: R32, 0.4 kg added.");
  });

  it("never prints a gauge figure, even one saved on an older version", () => {
    const a = answersFor(JOB_3326, AC, "office");
    a.systems[0].test = { ...TESTED, vacuumMicrons: 700, manufacturerMicrons: 1000 };
    expect(statementsFor(a).statements[0].text).not.toMatch(/700|1000|4150/);
    expect(certProblems(a, FACTS)).toEqual([]);
  });

  it("claim the NCC minimum only when a wet area has a fan, and say when a figure was measured", () => {
    const a = answersFor(JOB_279, BOTH, "house");
    const plain = statementsFor(a).statements.find((s) => s.clause === "ventAirflow")!.text;
    expect(plain).not.toContain("NCC minimum");
    a.fans = [{ location: "Ensuite", model: "XF100", qty: 1, airflowLps: 30, airflowKind: "measured", serial: "" }];
    const wet = statementsFor(a).statements.find((s) => s.clause === "ventAirflow")!.text;
    expect(wet).toContain("NCC minimum");
    expect(wet).toContain("Figures marked measured were read on site.");
  });

  it("print what doesn't apply only when a certifier asked, with its reason", () => {
    const a = answersFor(JOB_1300, AC, "house", {
      requirements: [{ text: "Part J5 compliance", answer: "na", clause: "j5", own: "", reason: suggestedReason("j5", "house") }],
      certifier: { name: "A Certifier", projectNumber: "1", consentAuthority: "" },
    });
    const { notApplicable } = statementsFor(a);
    expect(notApplicable.map((s) => s.text)).toEqual(["Part J5 compliance: House: energy efficiency is set by the BASIX certificate."]);
    expect(statementsFor(answersFor(JOB_1300, AC, "house")).notApplicable).toEqual([]);
  });

  it("print a person's own statement as typed, in the certifier's order", () => {
    const a = answersFor(JOB_3326, AC, "office", {
      requirements: [{ text: "Provide a schedule of equipment", answer: "own", clause: null, own: "The equipment is scheduled in the table above.", reason: "" }],
      certifier: { name: "A Certifier", projectNumber: "1", consentAuthority: "" },
    });
    expect(statementsFor(a).statements[0]).toEqual({
      clause: null,
      text: "The equipment is scheduled in the table above.",
      requirement: "Provide a schedule of equipment",
    });
  });

  it("say what isn't covered on every certificate, with one more item when given", () => {
    expect(buildCertificate(answersFor(JOB_3326, AC, "office")).notCovered).toBe(
      "Not covered: electrical work, certified separately under AS/NZS 3000."
    );
    const a = answersFor(JOB_3326, AC, "office", { notCoveredExtra: "the building's outdoor-air ventilation." });
    expect(buildCertificate(a).notCovered).toBe(
      "Not covered: electrical work, certified separately under AS/NZS 3000; the building's outdoor-air ventilation."
    );
  });
});

describe("the paper's facts", () => {
  it("call every certificate a mechanical compliance certificate, whatever it covers", () => {
    expect(certTitle(AC)).toBe("Mechanical compliance certificate");
    expect(certTitle({ ac: false, vent: true })).toBe("Mechanical compliance certificate");
    expect(certTitle(BOTH)).toBe("Mechanical compliance certificate");
    expect(certFileName(BOTH, "74/10 Etham Avenue", "1383")).toBe("Mechanical compliance certificate – 74-10 Etham Avenue – job 1383.pdf");
  });

  it("print a class only when one was picked, and a serial column only when there is a serial", () => {
    const a = answersFor(JOB_3326, AC, "other");
    expect(buildCertificate(a).building).toBeNull();
    expect(buildCertificate(a).showSerials).toBe(false);
    a.systems[0].outdoor.serial = "1234567";
    expect(buildCertificate(a).showSerials).toBe(true);
    expect(buildCertificate({ ...a, building: "office" }).building).toEqual({ label: "Office", cls: "Class 5" });
  });

  it("format capacities the way paper prints them", () => {
    expect([fmtKw(7), fmtKw(3.6), fmtKw(46.7), fmtKw(19.8)]).toEqual(["7.0 kW", "3.6 kW", "46.7 kW", "19.8 kW"]);
  });

  it("read the NCC minimum off a room's name", () => {
    expect([wetMinimum("Ensuite"), wetMinimum("Bathroom 2"), wetMinimum("Powder room"), wetMinimum("Laundry"), wetMinimum("Kitchen"), wetMinimum("Bedroom")]).toEqual([
      25, 25, 25, 40, 40, null,
    ]);
  });
});

describe("certProblemList", () => {
  const fields = (a: CertAnswers, f: CertFacts = FACTS) => certProblemList(a, f).map((p) => p.field);

  it("asks only for the refrigerant and the charge: the pressure test and vacuum print as passed", () => {
    const a = answersFor(JOB_3326, AC, "office");
    a.systems[0].test = { pressureKpa: null, holdMinutes: null, vacuumMicrons: null, manufacturerMicrons: null, refrigerant: "", addedKg: null };
    expect(certProblems(a, FACTS)).toEqual(["Enter MUZ-AP42VGD2-A2's refrigerant.", "Enter the refrigerant added to MUZ-AP42VGD2-A2, or 0."]);
  });

  it("asks for models a quote didn't give, and never for a capacity, which isn't printed", () => {
    const a = answersFor(JOB_1300, AC, "house");
    a.systems[0].outdoor.model = "";
    a.systems[0].indoors[0].capacityKw = null;
    expect(certProblems(a, FACTS)).toEqual(["Give outdoor unit 1 its model."]);
  });

  it("refuses a brand or a series where a model number belongs", () => {
    const a = answersFor(JOB_1300, AC, "house");
    a.systems[0].outdoor.model = "Mitsubishi Electric VRF";
    a.systems[0].indoors[0].model = "Mitsubishi Electric VMX";
    expect(certProblems(a, FACTS)).toEqual([
      `"Mitsubishi Electric VRF" isn't a model number. Enter the one on the outdoor unit's plate.`,
      `"Mitsubishi Electric VMX" on Kitchen isn't a model number. Enter the one on the unit's plate.`,
    ]);
    a.systems[0].outdoor.model = "PUMY-P200YKM";
    a.systems[0].indoors[0].model = "PEFY-P28VMA";
    expect(certProblems(a, FACTS)).toEqual([]);
  });

  it("refuses a bathroom fan under the NCC minimum", () => {
    const a = answersFor(JOB_279, BOTH, "house");
    a.fans = [{ location: "Bathroom", model: "XF100", qty: 1, airflowLps: 20, airflowKind: "rated", serial: "" }];
    expect(certProblems(a, FACTS)).toEqual(["The Bathroom fan is 20 L/s, under the NCC minimum of 25 L/s."]);
  });

  it("stops at a smoke control system, and asks for the ratings check on individual units", () => {
    const base = answersFor(JOB_1383, AC, "apartment", {
      requirements: futureCert(),
      certifier: { name: "FutureCert", projectNumber: "24-0108", consentAuthority: "" },
    });
    expect(certProblems({ ...base, fireMode: "smoke" }, FACTS)).toEqual([
      "A smoke control system needs the mechanical engineer's certificate, not this one.",
    ]);
    expect(certProblems({ ...base, fireMode: "individual" }, FACTS)).toEqual([
      "Confirm each unit is rated at 1000 L/s or less, from its spec sheet.",
    ]);
    expect(certProblems({ ...base, fireMode: "shutdown", fireModeInterface: "FIP relay", fireModeTestedOn: "2026-09-29" }, FACTS)).toEqual([]);
  });

  it("asks for every requirement to be answered, and never for a certifier: requirements come from anyone", () => {
    const a = answersFor(JOB_3326, AC, "office", {
      requirements: [{ text: "Something unusual", answer: "clause", clause: null, own: "", reason: "" }],
    });
    expect(certProblems(a, FACTS)).toEqual([
      "Choose a statement for requirement 1, write one, or mark it not applicable.",
    ]);
  });

  it("needs the signatory's own current licences, a signature and the approved wording", () => {
    const a = answersFor(JOB_3326, AC, "office");
    expect(certProblems(a, { today: "2026-10-01", approved: false, hasSignature: false, arcCurrent: false, contractorCurrent: false })).toEqual([
      "Draw your signature.",
      "Your ARC licence isn't current on your staff card.",
      "Your contractor licence isn't current on your staff card.",
      "The owner approves the certificate wording before the first one can be issued.",
    ]);
  });

  it("refuses a completion date in the future, and asks for one that's missing", () => {
    expect(certProblems(answersFor(JOB_3326, AC, "office", { completedOn: "2026-10-02" }), FACTS)).toEqual([
      "The completion date can't be in the future.",
    ]);
    expect(fields(answersFor(JOB_3326, AC, "office", { completedOn: "" }))).toEqual(["completedOn"]);
  });

  it("asks what is being certified", () => {
    expect(fields(answersFor(JOB_3326, { ac: false, vent: false }, "office"))).toEqual(["covers"]);
  });
});

describe("normaliseCertAnswers", () => {
  it("keeps what the library writes from and drops the rest", () => {
    const a = normaliseCertAnswers({
      covers: { ac: true, vent: "yes" },
      building: "castle",
      completedOn: "30/09/2026",
      systems: [{ outdoor: { model: " MUZ-1 ", capacityKw: "4.2", qty: 0, extra: 1 }, indoors: [{ location: "Office", capacityKw: -2 }], test: { refrigerant: "r32", addedKg: "0" } }],
      fans: [{ location: "Bathroom", airflowLps: 30, airflowKind: "guessed" }],
      requirements: [{ text: "Part J5", answer: "clause", clause: "anything" }, { text: "" }],
      fireMode: "maybe",
      hacked: true,
    });
    expect(a.covers).toEqual({ ac: true, vent: false });
    expect(a.building).toBeNull();
    expect(a.completedOn).toBe("");
    expect(a.systems[0].outdoor).toEqual({ location: "", model: "MUZ-1", qty: 1, capacityKw: 4.2, serial: "" });
    expect(a.systems[0].indoors[0].capacityKw).toBeNull();
    expect(a.systems[0].test).toMatchObject({ refrigerant: "R32", addedKg: 0 });
    expect(a.fans[0].airflowKind).toBe("rated");
    expect(a.requirements).toEqual([{ text: "Part J5", answer: "clause", clause: null, own: "", reason: "" }]);
    expect(a.fireMode).toBeNull();
    expect("hacked" in a).toBe(false);
  });
});

describe("no padding", () => {
  it("with nothing asked for: the refrigerant pair and the manufacturer's instructions, and nothing about condensate or handover", () => {
    const c = buildCertificate(answersFor(JOB_3326, AC, "office"));
    expect(c.statements.map((st) => st.clause)).toEqual(["refrigerant", "manufacturer", "arc"]);
  });

  it("condensate and handover print when asked for, in the asker's place", () => {
    const a = answersFor(JOB_3326, AC, "office", {
      requirements: [{ text: "Condensate drains to an approved point", answer: "clause", clause: matchRequirement("Condensate drains to an approved point").clause, own: "", reason: "" }],
    });
    expect(clausesFor(a)).toEqual(["condensate", "approved", "refrigerant", "arc"]);
  });

  it("matches a request about the approved plans to the approved-documents statement", () => {
    expect(matchRequirement("Installed in accordance with the approved plans").clause).toBe("approved");
    expect(matchRequirement("Works comply with the Construction Certificate").clause).toBe("approved");
    expect(matchRequirement("Installed in accordance with AS 1668.2 and the approved plans").clause).toBe("as1668");
  });
});

describe("what was asked against what was installed", () => {
  const ask = (text: string): Requirement => ({ text, answer: "clause", clause: matchRequirement(text).clause, own: "", reason: "" });

  it("refuses to certify exhaust fans on an air conditioning-only job, and ductwork that isn't ticked", () => {
    const a = answersFor(JOB_3326, AC, "office", {
      requirements: [ask("Exhaust fans discharge to outdoor air"), ask("Ductwork installed to AS 4254")],
      installed: { ductwork: false, fireRated: false, fireStopProduct: "", condensatePump: false },
    });
    expect(certProblems(a, FACTS)).toEqual([
      "Requirement 1 asks for discharge to outdoor air, but no ventilation is on this certificate. Mark it not applicable with a reason, or add what's missing.",
      "Requirement 2 asks for ductwork, but no ductwork is ticked as installed. Mark it not applicable with a reason, or add what's missing.",
    ]);
  });

  it("is satisfied once the item is marked not applicable with a reason", () => {
    const a = answersFor(JOB_3326, AC, "office", {
      requirements: [{ ...ask("Exhaust fans discharge to outdoor air"), answer: "na", reason: "No exhaust fans in our scope." }],
    });
    expect(certProblems(a, FACTS)).toEqual([]);
  });

  it("raises nothing when what was asked is on the certificate", () => {
    const a = answersFor(JOB_1383, AC, "apartment", { requirements: futureCert(), fireMode: "individual", fireModeRatingsChecked: true });
    expect(certProblems(a, FACTS)).toEqual([]);
  });
});

describe("every unit listed", () => {
  it("won't issue until the person confirms nothing installed is missing", () => {
    const a = answersFor(JOB_3326, AC, "office", { equipmentConfirmed: false });
    expect(certProblems(a, FACTS)).toEqual(["Confirm every unit installed is listed, with its model off the plate."]);
    expect(certProblems({ ...a, equipmentConfirmed: true }, FACTS)).toEqual([]);
  });
});
