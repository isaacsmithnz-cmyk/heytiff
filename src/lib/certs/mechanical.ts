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

/* .1 (2026-10-03): the wording page now shows every statement that can
   print, condensate, commissioning and Section J with ductwork among them,
   so it is approved again with all of them in view. */
export const CERT_LIBRARY_VERSION = "mech-2026.10.1";

/* ── what the certificate covers, and where ────────────────────────────── */

export type Covers = { ac: boolean; vent: boolean };

/* ONE NAME FOR EVERY CERTIFICATE (Isaac, 2026-10-02): "Mechanical
   compliance certificate" covers air conditioning, ventilation or both, so
   the heading never needs to change with the job. What it covers is the
   tables' own headings. */
export const CERT_TITLE = "Mechanical compliance certificate";

/** The words before the numbered statements, and before each thing asked
    for that doesn't apply. */
export const CERT_LEDE = "I certify that:";
export const NOT_APPLICABLE = "Not applicable:";

/** The site as lines: as written when it has lines, else split at its first
    comma, so the title is the street and not the whole address. A trailing
    comma, as ServiceM8 sometimes leaves one, isn't part of a line. */
export function addressLines(address: string | null): string[] {
  const lines = (address ?? "").split("\n").map((l) => l.trim().replace(/,$/, "").trim()).filter(Boolean);
  if (lines.length !== 1) return lines;
  const at = lines[0].indexOf(",");
  return at > 0 ? [lines[0].slice(0, at).trim(), lines[0].slice(at + 1).trim()].filter(Boolean) : lines;
}

/** The file's name, from the site's first line (the paper's own title) and
    the job. */
export function certFileName(site: string, jobNumber: string | null): string {
  const where = site.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
  return [CERT_TITLE, where || null, jobNumber ? `job ${jobNumber}` : null].filter(Boolean).join(" – ") + ".pdf";
}

/* THE BUILDING, in words that are true for their class. An address can't
   settle it (a "2/15" can be a villa; townhouses over a shared basement are
   Class 2), so the class prints only when somebody picked it. It adds no
   statement and ticks nothing: it only offers a reason when something asked
   for doesn't apply. */
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

/* ── the equipment ─────────────────────────────────────────────────────── */

/** One circuit's refrigerant, typed on site and never assumed.

    THE PRESSURE TEST AND THE VACUUM ARE A RESULT, NOT FIGURES (Isaac,
    2026-10-02). The certificate states that the circuit was pressure tested
    and evacuated, which is true of every circuit done right and is what the
    certifier relies on; the gauge readings stay on the job. */
export type CircuitTest = {
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
  // only when asked for
  | "as16682"
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

/* WHERE THE EXHAUST GOES IS ASKED, NEVER ASSUMED (job 2933, 2026-10-03: a
   bathroom fan ducted into a warehouse). "Every exhaust fan discharges to
   outdoor air" prints only when the person says so; "none" is a job whose
   fans are all supply, which discharge nothing. */
export type ExhaustTo = "outdoors" | "not" | "none";
export const EXHAUST_TO: readonly { key: ExhaustTo; label: string }[] = [
  { key: "outdoors", label: "Yes, every one discharges outdoors" },
  { key: "not", label: "No, not every one" },
  { key: "none", label: "There are no exhaust fans" },
];
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

/** Everything the person chooses or types. Stored as-is on the version. */
export type CertAnswers = {
  covers: Covers;
  building: Building | null;
  /** yyyy-mm-dd */
  completedOn: string;
  systems: AcSystem[];
  fans: FanRow[];
  installed: { ductwork: boolean; fireRated: boolean; fireStopProduct: string };
  /** Where the exhaust fans discharge, as the person said; null until asked. */
  exhaustTo: ExhaustTo | null;
  requirements: Requirement[];
  fireMode: FireMode | null;
  /** The person checked each unit's rated airflow against 1000 L/s. */
  fireModeRatingsChecked: boolean;
  fireModeInterface: string;
  /** yyyy-mm-dd */
  fireModeTestedOn: string;
  airBalance: "attached" | "others" | null;
  /** What the certificate doesn't cover, printed only when typed. */
  notCoveredExtra: string;
  /** The person confirmed every unit installed is on the certificate, with
      its model off the plate. Cleared whenever a unit changes. */
  equipmentConfirmed: boolean;
};

export const EMPTY_TEST: CircuitTest = { refrigerant: "", addedKg: null };

export const EMPTY_ROW: AcRow = { location: "", model: "", qty: 1, capacityKw: null, serial: "" };
export const EMPTY_FAN: FanRow = { location: "", model: "", qty: 1, airflowLps: null, airflowKind: "rated", serial: "" };

export const DEFAULT_CERT_ANSWERS: CertAnswers = {
  covers: { ac: true, vent: false },
  building: null,
  completedOn: "",
  systems: [],
  fans: [],
  installed: { ductwork: false, fireRated: false, fireStopProduct: "" },
  exhaustTo: null,
  requirements: [],
  fireMode: null,
  fireModeRatingsChecked: false,
  fireModeInterface: "",
  fireModeTestedOn: "",
  airBalance: null,
  notCoveredExtra: "",
  equipmentConfirmed: false,
};

/* ── the rules for which statements a job gets ─────────────────────────── */

/** The clauses this job's certificate makes, in order: what was asked for
    first, in the order it was asked, so it can be ticked off; then the
    standard set; then what the installation adds. A clause appears once
    however many requirements point at it.

    NO PADDING. Every line answers something asked for or is a statement the
    certificate can't go without. Every air conditioning certificate states
    the two the law asks of every installer: the refrigerant circuit to
    AS/NZS 5149.2, with the refrigerant and its charge, and ARC licensed
    handling. With nothing asked for, it also says the equipment went in to
    the manufacturer's instructions, so a bare "send me the certificate"
    still certifies the installation. With something asked, the approved
    documents take that place. Condensate and handover print only when
    asked for. */
export function clausesFor(a: CertAnswers): ClauseKey[] {
  const out: ClauseKey[] = [];
  const add = (k: ClauseKey) => {
    if (!out.includes(k)) out.push(k);
  };
  for (const r of a.requirements) if (r.answer === "clause" && r.clause) add(r.clause);
  const asked = a.requirements.length > 0;
  if (asked) add("approved");
  if (a.covers.ac) {
    add("refrigerant");
    if (!asked) add("manufacturer");
    add("arc");
  }
  if (a.covers.vent) {
    add("ventAirflow");
    if (a.exhaustTo === "outdoors") add("ventDischarge");
  }
  if (a.installed.ductwork) add("ductwork");
  if (a.installed.fireRated) add("fireRated");
  return out;
}

/** The reason given when what was asked is a smoke control system, which
    this certificate never covers. The person can change it. */
export const NOT_OURS_REASON = "Not part of these works: a smoke control system is certified by the mechanical engineer.";

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

/* ── numbers, as they're shown ─────────────────────────────────────────── */

export const fmtKw = (n: number) => `${Number.isInteger(n) ? n.toFixed(1) : String(Math.round(n * 100) / 100)} kW`;
export const fmtNum = (n: number) => String(Math.round(n * 100) / 100);

export function indoorTotalKw(systems: readonly AcSystem[]): number {
  return systems.reduce(
    (sum, s) => sum + s.indoors.reduce((t, r) => t + (r.capacityKw ?? 0) * Math.max(1, r.qty), 0),
    0
  );
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
      return "The equipment is installed to the manufacturer's installation instructions.";
    case "condensate":
      return "Condensate is drained to a suitable point without damage or nuisance.";
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
      return "Every exhaust fan discharges to outdoor air.";
    case "ductwork":
      return "Ductwork, plenums and flexible duct are installed, supported, sealed and insulated in accordance with AS 4254.1 and AS 4254.2.";
    case "fireRated":
      return `Penetrations through fire-rated walls and floors are sealed with ${a.installed.fireStopProduct.trim() || "a tested fire-stopping system"} to maintain the element's fire resistance level.`;
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

/** Empty unless the person typed something: what a certificate covers is
    its tables, so nothing is ruled out by default. */
export function notCoveredLine(a: CertAnswers): string {
  const what = a.notCoveredExtra.trim().replace(/\.$/, "");
  return what ? `Not covered: ${what}.` : "";
}

/* ── the frozen document ───────────────────────────────────────────────── */

export type CertContent = {
  libraryVersion: string;
  title: string;
  covers: Covers;
  building: { label: string; cls: string | null } | null;
  completedOn: string;
  systems: AcSystem[];
  fans: FanRow[];
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
    title: CERT_TITLE,
    covers: a.covers,
    building: b && b.key !== "other" ? { label: b.label, cls: b.cls } : null,
    completedOn: a.completedOn,
    systems,
    fans,
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

/** A clause's name inside a sentence: lower case to start, but a standard's
    or the code's own letters ("AS/NZS 5149.2", "BCA") as they are. */
const nameInSentence = (k: ClauseKey) => {
  const n = CLAUSE_NAME[k];
  return /^[A-Z]{2}/.test(n) ? n : n.charAt(0).toLowerCase() + n.slice(1);
};

/* WHAT WAS ASKED AGAINST WHAT WAS INSTALLED. A builder's list is matched to
   a statement by rule, but a statement is only true of works on this
   certificate: a list that asks for exhaust fans on an air conditioning job,
   or ductwork where none went in, would otherwise certify something that
   isn't there. Each gap is said, and blocks the issue until it is answered
   (marked not applicable with a reason, or the missing works added). */
function notInstalled(k: ClauseKey, a: CertAnswers): string | null {
  const vent = a.covers.vent && a.fans.length > 0;
  const ac = a.covers.ac && a.systems.length > 0;
  switch (k) {
    case "ventDischarge":
      if (!vent) return "discharge to outdoor air, but no ventilation is on this certificate";
      return a.exhaustTo === "outdoors" ? null : "discharge to outdoor air, but not every exhaust fan is marked as discharging outdoors";
    case "ventAirflow":
    case "as16682":
    case "kitchenExhaust":
    case "carPark":
      return vent ? null : `${nameInSentence(k)}, but no ventilation is on this certificate`;
    /* worded for air conditioning: refrigerant pipework, heating and
       cooling, the outdoor unit */
    case "refrigerant":
    case "arc":
    case "condensate":
    case "commissioned":
    case "fireMode":
    case "j5":
    case "noise":
      return ac ? null : `${nameInSentence(k)}, but no air conditioning is on this certificate`;
    case "ductwork":
      return a.installed.ductwork ? null : "ductwork, but no ductwork is ticked as installed";
    case "fireRated":
      return a.installed.fireRated ? null : "fire-rated penetrations, but none are ticked as installed";
    default:
      return null;
  }
}

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
    if (a.fans.length > 0 && a.exhaustTo === null) add("fans", "Say whether every exhaust fan discharges outdoors.");
  }

  /* A UNIT LEFT OFF IS THE ONE MISTAKE NOTHING ELSE CATCHES: every row on
     the certificate is checked, but a unit that isn't a row can't be. So the
     person says, once the rows are right, that nothing is missing. */
  if ((a.covers.ac || a.covers.vent) && !a.equipmentConfirmed) {
    add("equipment", "Confirm every unit installed is listed, with its model off the plate.");
  }

  if (a.installed.fireRated && missing(a.installed.fireStopProduct)) {
    add("installed", "Name the fire-stopping product used on the fire-rated penetrations.");
  }

  a.requirements.forEach((r, i) => {
    const which = `requirement ${i + 1}`;
    const Which = `Requirement ${i + 1}`;
    if (r.answer === "clause" && !r.clause) add("requirements", `Choose a statement for ${which}, write one, or mark it not applicable.`);
    if (r.answer === "own" && missing(r.own)) add("requirements", `Write the statement for ${which}.`);
    if (r.answer === "na" && missing(r.reason)) add("requirements", `Say why ${which} doesn't apply.`);
    if (r.answer === "clause" && r.clause) {
      const gap = notInstalled(r.clause, a);
      if (gap) add("requirements", `${Which} asks for ${gap}. Mark it not applicable with a reason, or add what's missing.`);
    }
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
  ventDischarge: "Ventilation, when you say every exhaust fan discharges outdoors",
  ductwork: "When ductwork, plenums or flexible duct were installed",
  fireRated: "When penetrations went through fire-rated walls or floors",
  as16682: "Only when asked for",
  as1668: "Only when asked for",
  fireMode: "Only when asked for, worded by the answer",
  j5: "Only when asked for",
  kitchenExhaust: "Only when asked for",
  carPark: "Only when asked for",
  airBalance: "Only when asked for, worded by the answer",
  noise: "Only when asked for",
};

/** Every clause as it prints, with each wording a clause can take, in the
    order CLAUSE_NAME lists them: all of them, so nothing can print that the
    owner hasn't read. The figures a person types are shown as what they
    are, in brackets. */
export function wordingSamples(): Wording[] {
  const base: CertAnswers = { ...DEFAULT_CERT_ANSWERS, covers: { ac: true, vent: true } };
  const variants: Partial<Record<ClauseKey, CertAnswers[]>> = {
    ventAirflow: [
      { ...base, fans: [{ ...EMPTY_FAN, location: "Living", airflowLps: 60 }] },
      { ...base, fans: [{ ...EMPTY_FAN, location: "Bathroom", airflowLps: 30 }] },
      { ...base, fans: [{ ...EMPTY_FAN, location: "Bathroom", airflowLps: 30, airflowKind: "measured" }] },
    ],
    j5: [base, { ...base, installed: { ...base.installed, ductwork: true } }],
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
  return (Object.keys(CLAUSE_NAME) as ClauseKey[]).map((k) => ({
    clause: k,
    name: CLAUSE_NAME[k],
    when: WHEN[k],
    texts: [...new Set((variants[k] ?? [base]).map((a) => clauseText(k, a)))],
  }));
}
