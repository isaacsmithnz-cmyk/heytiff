import {
  CLAUSE_NAME,
  DEFAULT_CERT_ANSWERS,
  buildCertificate,
  certFileName,
  certProblemList,
  certProblems,
  clausesFor,
  fmtKw,
  indoorTotalKw,
  statementsFor,
  suggestedReason,
  stateFormNote,
  changedSince,
  readsAs,
  shownParts,
  SHOWN,
  WORDING_GROUPS,
  wetMinimum,
  type ApprovedWording,
  type Building,
  type ClauseKey,
  type CertAnswers,
  type CertFacts,
  type Covers,
  type Requirement,
} from "../mechanical";
import { normaliseCertAnswers } from "../input";
import { matchRequirement } from "../match";
import { readQuote } from "../quote";
import { FUTURECERT_9_1, JOB_1245, JOB_1300, JOB_1383, JOB_2699, JOB_279, JOB_3326 } from "./fixtures/jobs";

/* THE GOLDEN JOBS (docs/certificates-plan.md, Build order, step 1): six real
   finished jobs, each of which must get exactly these statements. */

const AC_CORE = ["refrigerant", "manufacturer", "arc"];

const TESTED = { refrigerant: "R32", addedKg: 0 };

const FACTS: CertFacts = { today: "2026-10-01", approved: true, hasSignature: true, arcCurrent: true, contractorCurrent: true };

/** The answers a person would end on: the quote's reading, the building
    picked, every row completed, and the tests typed in. */
function answersFor(description: string, covers: Covers, building: Building, more: Partial<CertAnswers> = {}): CertAnswers {
  const q = readQuote(description);
  return {
    ...DEFAULT_CERT_ANSWERS,
    covers,
    /* the golden jobs are all in NSW */
    state: "NSW",
    building,
    completedOn: "2026-09-30",
    systems: q.systems.map((sys, i) => ({
      outdoor: { ...sys.outdoor, model: sys.outdoor.model || `OUT-${i + 1}`, location: sys.outdoor.location || "Roof" },
      indoors: sys.indoors.map((r, j) => ({ ...r, model: r.model || `IN-${j + 1}`, location: r.location || "Office" })),
      test: { ...TESTED, refrigerant: sys.test.refrigerant || "R32" },
    })),
    fans: q.fans.map((f) => ({ ...f, location: f.location || "Whole house", airflowGiven: true, airflowLps: 60 })),
    installed: { ductwork: q.ductwork, fireRated: q.fireRated, fireStopProduct: "Promat collars" },
    exhaustTo: covers.vent ? "outdoors" : null,
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
      fireMode: "individual",
      fireModeRatingsChecked: true,
      installed: { ductwork: true, fireRated: false, fireStopProduct: "" },
    });
    expect(clausesFor(a)).toEqual(["as1668", "fireMode", "j5", "approved", "refrigerant", "arc", "ductwork"]);
    expect(certProblems(a, FACTS)).toEqual([]);
    const c = buildCertificate(a);
    expect(c.statements.slice(0, 3).map((st) => st.requirement)).toEqual(FUTURECERT_9_1);
    expect(indoorTotalKw(a.systems)).toBeCloseTo(19.8);
    /* ductwork went in, so Part J5 says it is insulated and sealed too */
    expect(c.statements[2].text).toBe(
      "The installation complies with Section J of the BCA for air conditioning and ventilation: refrigerant pipework and ductwork are insulated, ductwork is sealed, and each unit can be switched off when its space is unoccupied."
    );
    const noDucts = buildCertificate({ ...a, installed: { ...a.installed, ductwork: false } });
    expect(noDucts.statements[2].text).toBe(
      "The installation complies with Section J of the BCA for air conditioning and ventilation: refrigerant pipework is insulated, and each unit can be switched off when its space is unoccupied."
    );
  });

  it("279: air conditioning and ventilation, ductwork and the Lossnay at its rated airflow", () => {
    const a = answersFor(JOB_279, BOTH, "house");
    expect(clausesFor(a)).toEqual([...AC_CORE, "ventAirflow", "ventDischarge", "ductwork"]);
    expect(certProblems(a, FACTS)).toEqual([]);
    expect(indoorTotalKw(a.systems)).toBeCloseTo(46.7);
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

  it("2699: the standard set and fire-rated penetrations, ticked by the person and never by the building", () => {
    expect(clausesFor(answersFor(JOB_2699, AC, "apartment", { installed: { ductwork: false, fireRated: false, fireStopProduct: "" } }))).toEqual(AC_CORE);
    const a = answersFor(JOB_2699, AC, "apartment", { installed: { ductwork: false, fireRated: true, fireStopProduct: "Promat collars" } });
    expect(clausesFor(a)).toEqual([...AC_CORE, "fireRated"]);
    expect(certProblems(a, FACTS)).toEqual([]);
    expect(buildCertificate(a).statements.find((s) => s.clause === "fireRated")?.text).toContain("Promat collars");
  });
});

describe("the statements", () => {
  it("state the pressure test and vacuum as passed, with no gauge figures, and the charge once or per outdoor unit", () => {
    const a = answersFor(JOB_1245, AC, "house");
    const one = statementsFor(a).statements[0].text;
    expect(one).toBe("Refrigerant circuits were pressure tested, evacuated, charged and commissioned to AS/NZS 5149.2. Refrigerant R32, no additional charge.");
    expect(one).not.toMatch(/kPa|microns|minutes/);
    a.systems[1].test = { ...TESTED, addedKg: 0.4 };
    const two = statementsFor(a).statements[0].text;
    expect(two).toContain("OUT-1: refrigerant R32, no additional charge.");
    expect(two).toContain("OUT-2: refrigerant R32, 0.4 kg added.");
  });

  it("claim the NCC minimum only when a wet area has a fan, and say when a figure was measured", () => {
    const a = answersFor(JOB_279, BOTH, "house");
    const plain = statementsFor(a).statements.find((s) => s.clause === "ventAirflow")!.text;
    expect(plain).not.toContain("NCC minimum");
    a.fans = [{ location: "Ensuite", model: "XF100", qty: 1, airflowGiven: true, airflowLps: 30, airflowKind: "measured", serial: "" }];
    const wet = statementsFor(a).statements.find((s) => s.clause === "ventAirflow")!.text;
    expect(wet).toContain("NCC minimum");
    expect(wet).toContain("Figures marked as measured were read on site.");
  });

  it("print what doesn't apply only when a certifier asked, with its reason", () => {
    const a = answersFor(JOB_1300, AC, "house", {
      requirements: [{ text: "Part J5 compliance", answer: "na", clause: "j5", own: "", reason: suggestedReason("j5", "house") }],
    });
    const { notApplicable } = statementsFor(a);
    expect(notApplicable.map((s) => s.text)).toEqual(["Part J5 compliance. For a house, energy efficiency is set by the BASIX certificate."]);
    expect(statementsFor(answersFor(JOB_1300, AC, "house")).notApplicable).toEqual([]);
  });

  it("print a person's own statement as typed, in the certifier's order", () => {
    const a = answersFor(JOB_3326, AC, "office", {
      requirements: [{ text: "Provide a schedule of equipment", answer: "own", clause: null, own: "The equipment is scheduled in the table above.", reason: "" }],
    });
    expect(statementsFor(a).statements[0]).toEqual({
      clause: null,
      text: "The equipment is scheduled in the table above.",
      requirement: "Provide a schedule of equipment",
    });
  });

  it("say the exhaust goes outdoors only when the person said so (job 2933: a fan into a warehouse)", () => {
    const base = answersFor(JOB_279, BOTH, "house");
    const discharge = (a: CertAnswers) => statementsFor(a).statements.some((st) => st.clause === "ventDischarge");
    expect(discharge(base)).toBe(true);
    expect(discharge({ ...base, exhaustTo: "not" })).toBe(false);
    expect(discharge({ ...base, exhaustTo: "none" })).toBe(false);
    expect(certProblems({ ...base, exhaustTo: "not" }, FACTS)).toEqual([]);
    expect(certProblems({ ...base, exhaustTo: null }, FACTS)).toEqual(["Say whether every exhaust fan discharges outdoors."]);
    /* asked for, but not true of every fan: answered, never certified */
    const asked = { ...base, exhaustTo: "not" as const, requirements: [{ text: "Exhaust to discharge outside", answer: "clause" as const, clause: "ventDischarge" as const, own: "", reason: "" }] };
    expect(certProblems(asked, FACTS)).toEqual([
      "Requirement 1 asks for discharge to outdoor air, but not every exhaust fan is marked as discharging outdoors. Mark it not applicable with a reason, or add what's missing.",
    ]);
    expect(normaliseCertAnswers({ ...base, exhaustTo: "roof" }).exhaustTo).toBeNull();
  });

  it("say what isn't covered only when the person typed it", () => {
    expect(buildCertificate(answersFor(JOB_3326, AC, "office")).notCovered).toBe("");
    const a = answersFor(JOB_3326, AC, "office", { notCoveredExtra: "the building's outdoor-air ventilation." });
    expect(buildCertificate(a).notCovered).toBe("Not covered: the building's outdoor-air ventilation.");
  });

  it("add nothing the building or the job didn't call for", () => {
    for (const b of ["house", "apartment", "office", "shop", "other"] as Building[]) {
      expect(clausesFor(answersFor(JOB_279, BOTH, b))).toEqual([...AC_CORE, "ventAirflow", "ventDischarge", "ductwork"]);
    }
    const text = statementsFor(answersFor(JOB_279, BOTH, "house")).statements.map((st) => st.text).join(" ");
    expect(text).not.toMatch(/roof space|clearances|by others|AS\/NZS 3000|AS 1668\.2/);
  });
});

describe("the paper's facts", () => {
  it("call every certificate a mechanical compliance certificate, whatever it covers", () => {
    for (const covers of [AC, { ac: false, vent: true }, BOTH]) expect(buildCertificate(answersFor(JOB_279, covers, "house")).title).toBe("Mechanical Compliance Certificate");
    expect(certFileName("74/10 Etham Avenue", "1383")).toBe("Mechanical Compliance Certificate – 74-10 Etham Avenue – job 1383.pdf");
  });

  it("print a class only when one was picked, and a serial column only when serials are added", () => {
    const a = answersFor(JOB_3326, AC, "other");
    expect(buildCertificate(a).building).toBeNull();
    expect(buildCertificate(a).showSerials).toBe(false);
    a.systems[0].outdoor.serial = "1234567";
    expect(buildCertificate(a).showSerials).toBe(false);
    a.serialsGiven = true;
    expect(buildCertificate(a).showSerials).toBe(true);
    /* a version saved before the option printed whatever serial was typed */
    const { serialsGiven: _gone, ...old } = { ...a };
    expect(normaliseCertAnswers(old).serialsGiven).toBe(true);
    expect(normaliseCertAnswers({ ...old, systems: [{ ...old.systems[0], outdoor: { ...old.systems[0].outdoor, serial: "" } }] }).serialsGiven).toBe(false);
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
    a.systems[0].test = { refrigerant: "", addedKg: null };
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
    a.fans = [{ location: "Bathroom", model: "XF100", qty: 1, airflowGiven: true, airflowLps: 20, airflowKind: "rated", serial: "" }];
    expect(certProblems(a, FACTS)).toEqual(["The Bathroom fan is 20 L/s, under the NCC minimum of 25 L/s."]);
  });

  it("stops at a smoke control system, and asks for the ratings check on individual units", () => {
    const base = answersFor(JOB_1383, AC, "apartment", {
      requirements: futureCert(),
    });
    expect(certProblems({ ...base, fireMode: "smoke" }, FACTS)).toEqual([
      "A smoke control system needs the mechanical engineer's certificate, not this one.",
    ]);
    expect(certProblems({ ...base, fireMode: "individual" }, FACTS)).toEqual([
      "Confirm each unit is rated at 1,000 L/s or less, from its spec sheet.",
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

  it("keeps no certifier, even when a saved draft still carries one", () => {
    const saved = { ...answersFor(JOB_3326, AC, "office"), certifier: { name: "FutureCert", projectNumber: "24-0108", consentAuthority: "" } };
    const a = normaliseCertAnswers(saved);
    expect("certifier" in a).toBe(false);
    expect(JSON.stringify(buildCertificate(a))).not.toMatch(/FutureCert|24-0108|certifier/i);
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
      installed: { ductwork: false, fireRated: false, fireStopProduct: "" },
    });
    expect(certProblems(a, FACTS)).toEqual([
      "Requirement 1 asks for discharge to outdoor air, but no ventilation is on this certificate. Mark it not applicable with a reason, or add what's missing.",
      "Requirement 2 asks for ductwork, but no ductwork is ticked as installed. Mark it not applicable with a reason, or add what's missing.",
    ]);
  });

  it("refuses statements worded for air conditioning on a ventilation-only certificate", () => {
    const a = answersFor(JOB_279, { ac: false, vent: true }, "house", {
      requirements: [ask("System commissioned and handed over"), ask("Complies with Section J"), ask("Outdoor unit noise to the approved plans")],
    });
    expect(certProblems(a, FACTS)).toEqual([
      "Requirement 1 asks for commissioning and handover, but no air conditioning is on this certificate. Mark it not applicable with a reason, or add what's missing.",
      "Requirement 2 asks for BCA Section J, air conditioning and ventilation, but no air conditioning is on this certificate. Mark it not applicable with a reason, or add what's missing.",
      "Requirement 3 asks for outdoor unit location and noise, but no air conditioning is on this certificate. Mark it not applicable with a reason, or add what's missing.",
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

describe("the wording the owner approves", () => {
  /* every way each clause can read, from answers that make it print */
  const asked = (clause: ClauseKey, more: Partial<CertAnswers> = {}) => {
    const a = answersFor(JOB_279, BOTH, "house", {
      requirements: [{ text: "Asked", answer: "clause", clause, own: "", reason: "" }],
      installed: { ductwork: false, fireRated: true, fireStopProduct: "Promat collars" },
      ...more,
    });
    return statementsFor(a).statements.find((st) => st.clause === clause)!.text;
  };
  const twoCharges = (): Partial<CertAnswers> => {
    const a = answersFor(JOB_1245, AC, "house");
    a.systems[1].test = { ...TESTED, addedKg: 0.4 };
    return { covers: BOTH, systems: a.systems };
  };
  const printed = (clause: ClauseKey): string[] => {
    const wet = [{ ...readQuote(JOB_279).fans[0], location: "Ensuite", model: "XF100", airflowGiven: true, airflowLps: 30 }];
    const extra: Partial<Record<ClauseKey, Partial<CertAnswers>[]>> = {
      refrigerant: [{}, twoCharges()],
      ventAirflow: [{}, { fans: wet }, { fans: [{ ...wet[0], airflowKind: "measured" }] }],
      j5: [{}, { installed: { ductwork: true, fireRated: false, fireStopProduct: "" } }],
      fireMode: [{ fireMode: "individual" }, { fireMode: "shutdown", fireModeInterface: "FIP relay", fireModeTestedOn: "2026-09-29" }],
      airBalance: [{ airBalance: "attached" }, { airBalance: "others" }],
    };
    return (extra[clause] ?? [{}]).map((more) => asked(clause, more));
  };

  it("groups every statement once, and shows each line it can print", () => {
    const grouped = WORDING_GROUPS.flatMap((g) => g.clauses.map((c) => c.clause));
    expect([...grouped].sort()).toEqual(Object.keys(CLAUSE_NAME).sort());
    for (const k of Object.keys(CLAUSE_NAME) as ClauseKey[]) {
      for (const text of printed(k)) expect([k, SHOWN[k].some((line) => readsAs(line, text))]).toEqual([k, true]);
    }
  });

  it("shows every statement a golden job's certificate makes", () => {
    const jobs = [
      answersFor(JOB_1383, AC, "apartment", { requirements: futureCert(), fireMode: "individual", fireModeRatingsChecked: true }),
      answersFor(JOB_279, BOTH, "house"),
      answersFor(JOB_2699, AC, "apartment", { installed: { ductwork: false, fireRated: true, fireStopProduct: "Promat collars" } }),
    ];
    for (const a of jobs) {
      for (const st of statementsFor(a).statements) {
        if (st.clause) expect([st.clause, SHOWN[st.clause].some((line) => readsAs(line, st.text))]).toEqual([st.clause, true]);
      }
    }
  });

  it("splits a shown line into its words, what's typed and the choices", () => {
    expect(shownParts("The report is {provided with this certificate|provided by others}, sealed with [the product].")).toEqual([
      { kind: "text", text: "The report is " },
      { kind: "choice", options: ["provided with this certificate", "provided by others"] },
      { kind: "text", text: ", sealed with " },
      { kind: "typed", text: "the product" },
      { kind: "text", text: "." },
    ]);
  });

  it("says which statements changed since an approval, and when it can't", () => {
    expect(changedSince(null)).toBeNull();
    expect(changedSince({ ...SHOWN })?.size).toBe(0);
    const before = { ...SHOWN, airBalance: ["The air balance and commissioning report is by others."] } as ApprovedWording;
    delete before.condensate;
    expect([...changedSince(before)!].sort()).toEqual(["airBalance", "condensate"]);
  });
});

describe("every unit listed", () => {
  it("won't issue until the person confirms nothing installed is missing", () => {
    const a = answersFor(JOB_3326, AC, "office", { equipmentConfirmed: false });
    expect(certProblems(a, FACTS)).toEqual(["Confirm every unit installed is listed, with its model off the plate."]);
    expect(certProblems({ ...a, equipmentConfirmed: true }, FACTS)).toEqual([]);
  });
});

describe("the state the job is in", () => {
  const asked = (state: CertAnswers["state"]) =>
    answersFor(JOB_1383, AC, "apartment", {
      state,
      fireMode: "individual",
      fireModeRatingsChecked: true,
      requirements: [{ text: "Installed to the approved plans", answer: "clause", clause: "approved", own: "", reason: "" }],
    });
  const approved = (state: CertAnswers["state"]) => statementsFor(asked(state)).statements.find((x) => x.clause === "approved")!.text;

  it("names NSW's own approvals only in NSW, and plain words in every other state", () => {
    expect(approved("NSW")).toContain("Construction Certificate or Complying Development Certificate");
    for (const st of ["VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const) {
      expect(approved(st)).toBe("The works are installed in accordance with the approved building documents and the conditions of the building approval.");
    }
  });

  it("offers BASIX as the reason only in NSW", () => {
    expect(suggestedReason("j5", "house", "NSW")).toContain("BASIX");
    expect(suggestedReason("j5", "house", "VIC")).toBe("For a house, energy efficiency is assessed under the NCC Housing Provisions, not Section J.");
  });

  it("asks for the state when the address didn't say", () => {
    expect(certProblemList({ ...asked("NSW"), state: null }, FACTS).map((p) => p.text)).toContain("Say which state the job is in.");
  });

  it("names the form a state's certifier may also want, which the certificate goes alongside", () => {
    expect(stateFormNote("NSW")).toBeNull();
    expect(stateFormNote("VIC")).toContain("VBA plumbing compliance certificate");
    expect(stateFormNote("QLD")).toContain("Form 16");
    expect(stateFormNote("TAS")).toContain("Form 55");
    expect(stateFormNote("WA")).toBe("Check with the certifier whether Western Australia needs a form of its own as well.");
  });

  it("reads a certificate saved before the state was asked as a NSW job, there being no other", () => {
    const { state: _gone, ...old } = asked("NSW");
    expect(normaliseCertAnswers(old).state).toBe("NSW");
    expect(normaliseCertAnswers({ ...old, state: "XX" }).state).toBeNull();
  });
});
