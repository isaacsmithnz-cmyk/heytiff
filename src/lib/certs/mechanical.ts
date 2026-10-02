/* THE MECHANICAL CERTIFICATE — the approved wording an installer's
   certificate is written from, the rules for which statements a job gets, and
   what stands between a draft and an issued version.

   PURE, ON PURPOSE, like the SWMS library. No database, no session, no clock:
   the same answers always write the same certificate, so the paper can be
   tested statement by statement and a frozen version rebuilt to prove what it
   said. docs/certificates-plan.md is the design; this file is its wording.

   WHAT A CERTIFICATE IS. Evidence a certifier relies on to issue an
   Occupation Certificate, not a statutory compliance certificate. It proves
   the work was done correctly: who did it, what was installed and where, the
   test results, and the standards it was done to. It does not walk through
   standards the job isn't about, describe features, or claim a measurement
   nobody took.

   THE WIZARD NEVER INVENTS A STATEMENT. Every sentence below is approved by
   the business before anything issues (cert_template_approvals), and a new
   CERT_LIBRARY_VERSION needs approving again. A certifier's requirement that
   matches no clause is written by the person, printed as typed, or marked not
   applicable with a reason. */

export const CERT_LIBRARY_VERSION = "mech-2026.10";

/* ── what the certificate covers, and where ────────────────────────────── */

export type Covers = { ac: boolean; vent: boolean };

/* ONE NAME FOR EVERY CERTIFICATE (Isaac, 2026-10-02): "Mechanical
   compliance certificate" covers air conditioning, ventilation or both, so
   the heading never needs to change with the job. What it covers is said
   once, in the figures row ("Certifying"). */
export const CERT_TITLE = "Mechanical compliance certificate";

export function certTitle(_c?: Covers): string {
  return CERT_TITLE;
}

/** The file's name, from the site's first line and the job. */
export function certFileName(_c: Covers, site: string, jobNumber: string | null): string {
  const where = site.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
  return [CERT_TITLE, where || null, jobNumber ? `job ${jobNumber}` : null].filter(Boolean).join(" – ") + ".pdf";
}

/* THE BUILDING, in words that are true for their class. An address can't
   settle it (a "2/15" can be a villa; townhouses over a shared basement are
   Class 2), so the class prints only when somebody picked it. It decides very
   little on purpose: it never adds fire mode or Part J5 by itself. */
export const BUILDINGS = [
  { key: "house", label: "House, townhouse or duplex", cls: "Class 1a" },
  { key: "apartment", label: "Apartment building", cls: "Class 2" },
  { key: "office", label: "Office", cls: "Class 5" },
  { key: "shop", label: "Shop, café or restaurant", cls: "Class 6" },
  { key: "other", label: "Other or not sure", cls: null },
] as const;
export type Building = (typeof BUILDINGS)[number]["key"];

export function buildingOf(key: Building | null): (typeof BUILDINGS)[number] | null {
  return BUILDINGS.find((b) => b.key === key) ?? null;
}

const COMMERCIAL: readonly Building[] = ["office", "shop", "other"];

/* ── the equipment ─────────────────────────────────────────────────────── */

/** One circuit's refrigerant, typed on site and never assumed.

    THE PRESSURE TEST AND THE VACUUM ARE A RESULT, NOT FIGURES (Isaac,
    2026-10-02). The certificate states that the circuit held under
    nitrogen and was evacuated to the manufacturer's specified vacuum, which
    is true of every circuit done right and is what the certifier relies on;
    the gauge readings stay on the job. The figure fields stay in the type
    so a version saved before still reads, but nothing asks for them or
    prints them. */
export type CircuitTest = {
  pressureKpa: number | null;
  holdMinutes: number | null;
  vacuumMicrons: number | null;
  /** The manufacturer's own figure, needed only for a vacuum above 500. */
  manufacturerMicrons: number | null;
  refrigerant: string;
  /** Zero is an answer: the factory charge covered the pipe run. */
  addedKg: number | null;
};

export type AcRow = {
  location: string;
  model: string;
  /** Identical units in neighbouring rooms share a row. */
  qty: number;
  /** Per unit. */
  capacityKw: number | null;
  serial: string;
};

/** One outdoor unit, the indoor units it runs, and its circuit's tests. */
export type AcSystem = {
  outdoor: AcRow;
  indoors: AcRow[];
  test: CircuitTest;
};

export type FanRow = {
  location: string;
  model: string;
  qty: number;
  airflowLps: number | null;
  /** Rated is the default; measured only when somebody measured it. */
  airflowKind: "rated" | "measured";
  serial: string;
};

/* ── the clauses ───────────────────────────────────────────────────────── */

export type ClauseKey =
  // whenever something was asked for: the approval the certifier holds the works to
  | "approved"
  // every air conditioning certificate
  | "refrigerant"
  | "manufacturer"
  | "condensate"
  | "commissioned"
  | "arc"
  // every ventilation certificate
  | "ventAirflow"
  | "ventDischarge"
  // added by what was installed
  | "ductwork"
  | "fireRated"
  | "as16682"
  // only when a certifier's list asks
  | "as1668"
  | "fireMode"
  | "j5"
  | "kitchenExhaust"
  | "carPark"
  | "airBalance"
  | "noise";

/** What each clause is about, for the wording page and the matcher's picker. */
export const CLAUSE_NAME: Record<ClauseKey, string> = {
  approved: "Approved documents and conditions of consent",
  refrigerant: "Refrigerant circuit, AS/NZS 5149.2",
  manufacturer: "Manufacturer's instructions",
  condensate: "Condensate drainage",
  commissioned: "Commissioning and handover",
  arc: "Refrigerant handled by ARC licence holders",
  ventAirflow: "Fan airflow",
  ventDischarge: "Discharge to outdoor air",
  ductwork: "Ductwork, AS 4254",
  fireRated: "Fire-rated penetrations",
  as16682: "Mechanical ventilation, AS 1668.2",
  as1668: "AS/NZS 1668.1 and AS 1668.2",
  fireMode: "Fire mode, Specification 21",
  j5: "BCA Section J, air-conditioning and ventilation",
  kitchenExhaust: "Kitchen exhaust",
  carPark: "Car park ventilation",
  airBalance: "Air balance report",
  noise: "Outdoor unit location and noise",
};

/* NO PADDING. Every line answers something asked for or is a statement the
   certificate can't go without. Every air conditioning certificate states
   the two the law asks of every installer: the refrigerant circuit to
   AS/NZS 5149.2, with its figures, and ARC licensed handling. With nothing
   asked for, it also says the equipment went in to the manufacturer's
   instructions, so a bare "send me the certificate" still certifies the
   installation. With something asked, the approved documents take that
   place. Condensate and handover print only when asked for. */
export const AC_CORE: readonly ClauseKey[] = ["refrigerant", "manufacturer", "arc"];
export const AC_CORE_ASKED: readonly ClauseKey[] = ["refrigerant", "arc"];
export const VENT_CORE: readonly ClauseKey[] = ["ventAirflow", "ventDischarge"];
/** The clauses a certifier's requirement can be answered with. */
export const MATCHABLE: readonly ClauseKey[] = [
  "approved",
  "as1668",
  "fireMode",
  "j5",
  "refrigerant",
  "ductwork",
  "fireRated",
  "as16682",
  "kitchenExhaust",
  "carPark",
  "airBalance",
  "noise",
  "manufacturer",
  "condensate",
  "commissioned",
  "arc",
  "ventAirflow",
  "ventDischarge",
];

export type FireMode = "individual" | "shutdown" | "smoke";

/** One requirement off a certifier's list, and how it is answered. */
export type Requirement = {
  /** As the certifier wrote it. */
  text: string;
  answer: "clause" | "own" | "na";
  clause: ClauseKey | null;
  /** The person's own statement, printed as typed. */
  own: string;
  /** Why it doesn't apply, printed with it. */
  reason: string;
};

export type Certifier = { name: string; projectNumber: string; consentAuthority: string };

/** Everything the person chooses or types. Stored as-is on the version. */
export type CertAnswers = {
  covers: Covers;
  building: Building | null;
  /** yyyy-mm-dd */
  completedOn: string;
  systems: AcSystem[];
  fans: FanRow[];
  installed: { ductwork: boolean; fireRated: boolean; fireStopProduct: string; condensatePump: boolean };
  /** Suggested for ventilation in a commercial building; removable. */
  ventAs16682: boolean;
  certifier: Certifier | null;
  requirements: Requirement[];
  fireMode: FireMode | null;
  /** The person checked each unit's rated airflow against 1000 L/s. */
  fireModeRatingsChecked: boolean;
  fireModeInterface: string;
  /** yyyy-mm-dd */
  fireModeTestedOn: string;
  airBalance: "attached" | "others" | null;
  /** One more item for the Not covered line. */
  notCoveredExtra: string;
};

export const EMPTY_TEST: CircuitTest = {
  pressureKpa: null,
  holdMinutes: null,
  vacuumMicrons: null,
  manufacturerMicrons: null,
  refrigerant: "",
  addedKg: null,
};

export const EMPTY_ROW: AcRow = { location: "", model: "", qty: 1, capacityKw: null, serial: "" };

export const DEFAULT_CERT_ANSWERS: CertAnswers = {
  covers: { ac: true, vent: false },
  building: null,
  completedOn: "",
  systems: [],
  fans: [],
  installed: { ductwork: false, fireRated: false, fireStopProduct: "", condensatePump: false },
  ventAs16682: false,
  certifier: null,
  requirements: [],
  fireMode: null,
  fireModeRatingsChecked: false,
  fireModeInterface: "",
  fireModeTestedOn: "",
  airBalance: null,
  notCoveredExtra: "",
};

/* ── the rules for which statements a job gets ─────────────────────────── */

/** The clauses this job's certificate makes, in order: the certifier's
    requirements first, in the certifier's order, so they can tick them off;
    then the standard set; then what the installation adds. A clause appears
    once however many requirements point at it. */
export function clausesFor(a: CertAnswers): ClauseKey[] {
  const out: ClauseKey[] = [];
  const add = (k: ClauseKey) => {
    if (!out.includes(k)) out.push(k);
  };
  for (const r of a.requirements) if (r.answer === "clause" && r.clause) add(r.clause);
  const asked = a.requirements.length > 0;
  if (asked) add("approved");
  if (a.covers.ac) (asked ? AC_CORE_ASKED : AC_CORE).forEach(add);
  if (a.covers.vent) VENT_CORE.forEach(add);
  if (a.installed.ductwork) add("ductwork");
  if (a.installed.fireRated) add("fireRated");
  if (a.covers.vent && a.ventAs16682) add("as16682");
  return out;
}

/** What the building suggests, never decides: fire-rated penetrations in an
    apartment building, AS 1668.2 for ventilation in a commercial one. */
export function buildingSuggests(b: Building | null): { fireRated: boolean; ventAs16682: boolean } {
  return { fireRated: b === "apartment", ventAs16682: b !== null && COMMERCIAL.includes(b) };
}

/** The reason offered when a certifier asks for something that doesn't apply.
    The person can change it; it is only a start. */
export function suggestedReason(clause: ClauseKey | null, b: Building | null): string {
  if (b === "house" && clause === "j5") return "House: energy efficiency is set by the BASIX certificate.";
  if (b === "house" && (clause === "fireMode" || clause === "as1668")) {
    return "House: no air-handling system needs to shut down in fire mode.";
  }
  if (clause === "carPark") return "No car park ventilation is part of these works.";
  if (clause === "kitchenExhaust") return "No commercial kitchen exhaust is part of these works.";
  return "";
}

/* ── numbers, as paper prints them ─────────────────────────────────────── */

const kw = (n: number) => `${Number.isInteger(n) ? n.toFixed(1) : String(Math.round(n * 100) / 100)} kW`;
export const fmtKw = kw;
export const fmtNum = (n: number) => String(Math.round(n * 100) / 100);

export function indoorTotalKw(systems: readonly AcSystem[]): number {
  return systems.reduce(
    (sum, s) => sum + s.indoors.reduce((t, r) => t + (r.capacityKw ?? 0) * Math.max(1, r.qty), 0),
    0
  );
}

export function outdoorTotalKw(systems: readonly AcSystem[]): number {
  return systems.reduce((sum, s) => sum + (s.outdoor.capacityKw ?? 0) * Math.max(1, s.outdoor.qty), 0);
}

/* ── wet areas and the NCC minimum ─────────────────────────────────────── */

/** NCC 2022 minimum exhaust for a room, read off its name: 25 L/s for a
    bathroom or toilet, 40 L/s for a kitchen or laundry. Null for anything
    else, which no minimum is claimed for. */
export function wetMinimum(location: string): number | null {
  const l = location.toLowerCase();
  if (/kitchen|laundry|butler/.test(l)) return 40;
  if (/bath|ensuite|toilet|\bwc\b|powder|shower/.test(l)) return 25;
  return null;
}

/* ── the statements ────────────────────────────────────────────────────── */

export type Statement = {
  clause: ClauseKey | null;
  text: string;
  /** The certifier's words this statement answers, when it answers one. */
  requirement: string | null;
};

function testLine(t: CircuitTest): string {
  return (t.addedKg ?? 0) === 0 ? `${t.refrigerant}, no additional charge.` : `${t.refrigerant}, ${fmtNum(t.addedKg ?? 0)} kg added.`;
}

/** The refrigerant and charge, once when every circuit had the same, per
    outdoor unit when they differ. */
function testLines(systems: readonly AcSystem[]): string {
  if (systems.length === 0) return "";
  const lines = systems.map((s) => testLine(s.test));
  if (lines.every((l) => l === lines[0])) return lines[0];
  return systems
    .map((s, i) => `${s.outdoor.model || s.outdoor.location || `Outdoor unit ${i + 1}`}: ${lines[i]}`)
    .join(" ");
}

function clauseText(k: ClauseKey, a: CertAnswers): string {
  switch (k) {
    case "refrigerant":
      return (
        `Refrigerant circuits were pressure tested, evacuated, charged and commissioned to AS/NZS 5149.2. ${testLines(a.systems)}`
      ).trim();
    case "manufacturer":
      return "The equipment is installed to the manufacturer's installation instructions, including clearances, mounting and pipe lengths.";
    case "condensate":
      return a.installed.condensatePump
        ? "Condensate is drained to a suitable point, by condensate pump where fitted, without damage or nuisance."
        : "Condensate is drained to a suitable point without damage or nuisance.";
    case "commissioned":
      return "The system was commissioned and checked in heating and cooling, and the operating instructions and maintenance schedule were handed over.";
    case "arc":
      return "All refrigerant was handled by ARC licence holders.";
    case "approved":
      return "The works are installed in accordance with the documents approved under the Construction Certificate or Complying Development Certificate, and the relevant conditions of consent.";
    case "ventAirflow": {
      const measured = a.fans.some((f) => f.airflowKind === "measured");
      const wet = a.fans.some((f) => wetMinimum(f.location) !== null);
      return [
        measured
          ? "Each fan is selected and installed to the manufacturer's instructions to deliver the airflow shown. Figures marked measured were read on site."
          : "Each fan is selected and installed to the manufacturer's instructions to deliver the rated airflow shown.",
        wet ? "Each exhaust fan is rated at or above the NCC minimum of 25 L/s for a bathroom or toilet and 40 L/s for a kitchen or laundry." : "",
      ]
        .filter(Boolean)
        .join(" ");
    }
    case "ventDischarge":
      /* exhaust only: a supply fan draws outdoor air in, it discharges nothing */
      return "Every exhaust fan discharges to outdoor air, not into the roof space.";
    case "ductwork":
      return "Ductwork, plenums and flexible duct are installed, supported, sealed and insulated in accordance with AS 4254.1 and AS 4254.2.";
    case "fireRated":
      return `Penetrations through fire-rated walls and floors are sealed with ${a.installed.fireStopProduct.trim() || "a tested fire-stopping system"} to maintain the element's fire resistance level. The penetration schedule is by others.`;
    case "as16682":
      return "The mechanical ventilation is installed in accordance with AS 1668.2.";
    case "as1668":
      return "The mechanical ventilation and air-conditioning works are installed in accordance with AS/NZS 1668.1 and AS 1668.2.";
    case "fireMode":
      if (a.fireMode === "shutdown") {
        return `The air-handling system shuts down on a fire signal from ${a.fireModeInterface.trim() || "the fire indicator panel"}, tested on ${a.fireModeTestedOn || "the commissioning date"}, as required by Specification 21 and AS/NZS 1668.1.`;
      }
      return "The system comprises individual room units, each rated at not more than 1000 L/s, and is not part of a smoke control system, so it is not required to shut down in fire mode under Specification 21 and AS/NZS 1668.1.";
    case "j5":
      /* SECTION J, NOT A PART NUMBER. Air-conditioning and ventilation is
         Part J5 in BCA 2019 and Part J6 in NCC 2022, where J5 became
         building sealing; certifiers' lists still say J5. Naming the
         subject is true under either edition. */
      return a.installed.ductwork
        ? "The installation complies with Section J of the BCA for air-conditioning and ventilation: refrigerant pipework and ductwork are insulated, ductwork is sealed, and each unit can be switched off when its space is unoccupied."
        : "The installation complies with Section J of the BCA for air-conditioning and ventilation: refrigerant pipework is insulated, and each unit can be switched off when its space is unoccupied.";
    case "kitchenExhaust":
      return "The kitchen exhaust hood and ductwork are installed in accordance with AS/NZS 1668.1 and AS 1668.2.";
    case "carPark":
      return "The car park ventilation is installed in accordance with AS 1668.2.";
    case "airBalance":
      return a.airBalance === "others"
        ? "The air balance and commissioning report is by others."
        : "The air balance and commissioning report is provided with this certificate.";
    case "noise":
      return "The outdoor unit is installed in the location shown on the approved plans.";
  }
}

/** Every statement the certificate makes, in order, then what doesn't apply. */
export function statementsFor(a: CertAnswers): { statements: Statement[]; notApplicable: Statement[] } {
  const statements: Statement[] = [];
  const notApplicable: Statement[] = [];
  const used = new Set<ClauseKey>();
  for (const r of a.requirements) {
    if (r.answer === "clause" && r.clause) {
      if (used.has(r.clause)) continue;
      used.add(r.clause);
      statements.push({ clause: r.clause, text: clauseText(r.clause, a), requirement: r.text });
    } else if (r.answer === "own" && r.own.trim()) {
      statements.push({ clause: null, text: r.own.trim(), requirement: r.text });
    } else if (r.answer === "na") {
      notApplicable.push({ clause: r.clause, text: `${r.text.trim()}: ${r.reason.trim()}`, requirement: r.text });
    }
  }
  for (const k of clausesFor(a)) {
    if (used.has(k)) continue;
    used.add(k);
    statements.push({ clause: k, text: clauseText(k, a), requirement: null });
  }
  return { statements, notApplicable };
}

export function notCoveredLine(a: CertAnswers): string {
  const extra = a.notCoveredExtra.trim().replace(/\.$/, "");
  return `Not covered: electrical work, certified separately under AS/NZS 3000${extra ? `; ${extra}` : ""}.`;
}

/* ── the frozen document ───────────────────────────────────────────────── */

export type CertContent = {
  libraryVersion: string;
  title: string;
  covers: Covers;
  building: { label: string; cls: string | null } | null;
  completedOn: string;
  certifier: Certifier | null;
  systems: AcSystem[];
  fans: FanRow[];
  outdoorKw: number;
  indoorKw: number;
  fanCount: number;
  showSerials: boolean;
  statements: Statement[];
  notApplicable: Statement[];
  notCovered: string;
};

export function buildCertificate(a: CertAnswers): CertContent {
  const b = buildingOf(a.building);
  const systems = a.covers.ac ? a.systems : [];
  const fans = a.covers.vent ? a.fans : [];
  const { statements, notApplicable } = statementsFor({ ...a, systems, fans });
  const rows = [...systems.flatMap((s) => [s.outdoor, ...s.indoors]), ...fans];
  return {
    libraryVersion: CERT_LIBRARY_VERSION,
    title: certTitle(a.covers),
    covers: a.covers,
    building: b && b.key !== "other" ? { label: b.label, cls: b.cls } : null,
    completedOn: a.completedOn,
    certifier: a.certifier && a.certifier.name.trim() ? a.certifier : null,
    systems,
    fans,
    outdoorKw: outdoorTotalKw(systems),
    indoorKw: indoorTotalKw(systems),
    fanCount: fans.reduce((n, f) => n + Math.max(1, f.qty), 0),
    showSerials: rows.some((r) => r.serial.trim() !== ""),
    statements,
    notApplicable,
    notCovered: notCoveredLine(a),
  };
}

/* ── before it can be issued ───────────────────────────────────────────── */

/** What the server knows that the answers don't. */
export type CertFacts = {
  /** yyyy-mm-dd, in Australia. */
  today: string;
  approved: boolean;
  hasSignature: boolean;
  /** The signatory's own licences, current on `today`. */
  arcCurrent: boolean;
  contractorCurrent: boolean;
};

export type CertProblemField =
  | "covers"
  | "building"
  | "equipment"
  | "fans"
  | "tests"
  | "installed"
  | "requirements"
  | "fireMode"
  | "airBalance"
  | "completedOn"
  | "sign"
  | "approval";
export type CertProblem = { field: CertProblemField; text: string };

const missing = (s: string) => s.trim() === "";
/** A model number has a digit in it: "PEFY-P63VMX-E1", "FTXM35W". A brand or
    a series ("Mitsubishi Electric VMX") names a family of units, not the one
    on the plate, and a certifier can't check it against anything. */
export const looksLikeModel = (s: string) => /\d/.test(s);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Everything standing between these answers and an issue, in the order the
    wizard asks, each with the step it is about. Empty means it can issue. */
export function certProblemList(a: CertAnswers, f: CertFacts): CertProblem[] {
  const out: CertProblem[] = [];
  const add = (field: CertProblemField, text: string) => out.push({ field, text });

  if (!a.covers.ac && !a.covers.vent) add("covers", "Choose what you're certifying.");
  /* asked every time, never taken from the address: the guess is a hint the
     person confirms, because the building decides which statements apply */
  if (a.building === null) add("building", "Choose what kind of building it is.");

  if (a.covers.ac) {
    if (a.systems.length === 0) add("equipment", "Add the outdoor unit and the indoor units it runs.");
    a.systems.forEach((s, i) => {
      const name = s.outdoor.model.trim() || `outdoor unit ${i + 1}`;
      if (missing(s.outdoor.model)) add("equipment", `Give outdoor unit ${i + 1} its model.`);
      else if (!looksLikeModel(s.outdoor.model)) add("equipment", `"${s.outdoor.model.trim()}" isn't a model number. Enter the one on the outdoor unit's plate.`);
      if (missing(s.outdoor.location)) add("equipment", `Say where ${name} is.`);
      if (s.indoors.length === 0) add("equipment", `Add the indoor units ${name} runs.`);
      s.indoors.forEach((r, j) => {
        const row = r.location.trim() || `indoor unit ${j + 1} on ${name}`;
        if (missing(r.location)) add("equipment", `Say where indoor unit ${j + 1} on ${name} is.`);
        if (missing(r.model)) add("equipment", `Give ${row} its model.`);
        else if (!looksLikeModel(r.model)) add("equipment", `"${r.model.trim()}" on ${row} isn't a model number. Enter the one on the unit's plate.`);
      });
      const t = s.test;
      if (missing(t.refrigerant)) add("tests", `Enter ${name}'s refrigerant.`);
      if (t.addedKg === null || t.addedKg < 0) add("tests", `Enter the refrigerant added to ${name}, or 0.`);
    });
  }

  if (a.covers.vent) {
    if (a.fans.length === 0) add("fans", "Add the fans.");
    a.fans.forEach((fan, i) => {
      const row = fan.location.trim() || `fan ${i + 1}`;
      if (missing(fan.location)) add("fans", `Say where fan ${i + 1} is.`);
      if (missing(fan.model)) add("fans", `Give the ${row} fan its model.`);
      if (fan.airflowLps === null || fan.airflowLps <= 0) add("fans", `Give the ${row} fan its airflow.`);
      const min = wetMinimum(fan.location);
      if (min !== null && fan.airflowLps !== null && fan.airflowLps > 0 && fan.airflowLps < min) {
        add("fans", `The ${row} fan is ${fmtNum(fan.airflowLps)} L/s, under the NCC minimum of ${min} L/s.`);
      }
    });
  }

  if (a.installed.fireRated && missing(a.installed.fireStopProduct)) {
    add("installed", "Name the fire-stopping product used on the fire-rated penetrations.");
  }

  a.requirements.forEach((r, i) => {
    const which = `requirement ${i + 1}`;
    if (r.answer === "clause" && !r.clause) add("requirements", `Choose a statement for ${which}, write one, or mark it not applicable.`);
    if (r.answer === "own" && missing(r.own)) add("requirements", `Write the statement for ${which}.`);
    if (r.answer === "na" && missing(r.reason)) add("requirements", `Say why ${which} doesn't apply.`);
  });

  const clauses = clausesFor(a);
  if (clauses.includes("fireMode")) {
    if (a.fireMode === null) add("fireMode", "Answer how the system behaves in fire mode.");
    if (a.fireMode === "smoke") {
      add("fireMode", "A smoke control system needs the mechanical engineer's certificate, not this one.");
    }
    if (a.fireMode === "individual" && !a.fireModeRatingsChecked) {
      add("fireMode", "Confirm each unit is rated at 1000 L/s or less, from its spec sheet.");
    }
    if (a.fireMode === "shutdown" && (missing(a.fireModeInterface) || !ISO_DAY.test(a.fireModeTestedOn))) {
      add("fireMode", "Name the fire signal interface and the date the shutdown was tested.");
    }
  }
  if (clauses.includes("airBalance") && a.airBalance === null) {
    add("airBalance", "Say whether the air balance report is attached or by others.");
  }

  if (!ISO_DAY.test(a.completedOn)) add("completedOn", "Enter the date the works were completed.");
  else if (a.completedOn > f.today) add("completedOn", "The completion date can't be in the future.");

  if (!f.hasSignature) add("sign", "Draw your signature.");
  if (!f.arcCurrent) add("sign", "Your ARC licence isn't current on your staff card.");
  if (!f.contractorCurrent) add("sign", "Your contractor licence isn't current on your staff card.");
  if (!f.approved) add("approval", "The owner approves the certificate wording before the first one can be issued.");
  return out;
}

export function certProblems(a: CertAnswers, f: CertFacts): string[] {
  return certProblemList(a, f).map((p) => p.text);
}

/* ── the wording, for the owner to read before approving ───────────────── */

export type Wording = { clause: ClauseKey; name: string; when: string; texts: string[] };

const WHEN: Record<ClauseKey, string> = {
  approved: "Whenever something was asked for",
  refrigerant: "Every air conditioning certificate, followed by the refrigerant and charge as typed",
  manufacturer: "Air conditioning, when nothing was asked for, or when asked",
  condensate: "Only when asked for",
  commissioned: "Only when asked for",
  arc: "Every air conditioning certificate",
  ventAirflow: "Every ventilation certificate",
  ventDischarge: "Every ventilation certificate",
  ductwork: "When ductwork, plenums or flexible duct were installed",
  fireRated: "When penetrations went through fire-rated walls or floors",
  as16682: "When ventilation the building relies on was installed",
  as1668: "Only when asked for",
  fireMode: "Only when asked for, worded by the answer",
  j5: "Only when asked for",
  kitchenExhaust: "Only when asked for",
  carPark: "Only when asked for",
  airBalance: "Only when asked for, worded by the answer",
  noise: "Only when asked for",
};

/** Every clause as it prints, with each wording a clause can take. The
    figures a person types are shown as what they are, in brackets. */
export function wordingSamples(): Wording[] {
  const base: CertAnswers = { ...DEFAULT_CERT_ANSWERS, covers: { ac: true, vent: true } };
  const order: ClauseKey[] = ["approved", ...AC_CORE, ...VENT_CORE, "ductwork", "fireRated", "as16682", "as1668", "fireMode", "j5", "kitchenExhaust", "carPark", "airBalance", "noise"];
  const variants: Partial<Record<ClauseKey, CertAnswers[]>> = {
    condensate: [base, { ...base, installed: { ...base.installed, condensatePump: true } }],
    ventAirflow: [
      { ...base, fans: [{ location: "Bathroom", model: "", qty: 1, airflowLps: 30, airflowKind: "rated", serial: "" }] },
      { ...base, fans: [{ location: "Bathroom", model: "", qty: 1, airflowLps: 30, airflowKind: "measured", serial: "" }] },
    ],
    fireRated: [{ ...base, installed: { ...base.installed, fireStopProduct: "[the fire-stopping product]" } }],
    fireMode: [
      { ...base, fireMode: "individual" },
      { ...base, fireMode: "shutdown", fireModeInterface: "[the interface]", fireModeTestedOn: "[the date]" },
    ],
    airBalance: [
      { ...base, airBalance: "attached" },
      { ...base, airBalance: "others" },
    ],
  };
  return order.map((k) => ({
    clause: k,
    name: CLAUSE_NAME[k],
    when: WHEN[k],
    texts: [...new Set((variants[k] ?? [base]).map((a) => clauseText(k, a)))],
  }));
}
