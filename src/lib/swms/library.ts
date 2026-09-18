/* THE SWMS LIBRARY — the steps, hazards and controls the wizard writes a Safe
   Work Method Statement from, and the rules that turn a person's answers on
   site into the document.

   PURE, ON PURPOSE. No database, no session, no clock: the same answers
   always write the same SWMS, so the document can be tested line by line and
   a version frozen at issue can be rebuilt to prove what it said.

   THE WIZARD NEVER INVENTS A CONTROL. Every sentence below was drawn from a
   regulator's code of practice (the sources are in the research behind the
   mockup, and in docs/migrations/swms.sql's history); anything specific to a
   site — an anchor, an isolation point, why a higher control wasn't practicable
   — is typed by the person on site and printed as they typed it. A business
   adopts this library before the wizard will issue from it
   (swms_library_approvals), and a new LIBRARY_VERSION needs adopting again.

   WHAT IS LEFT OUT, deliberately: risk-score matrices, lists of standards and
   hazards that aren't high-risk construction work. Regulators say each one
   makes a SWMS longer and worse. A builder who insists on scores gets them as
   an optional appendix (`riskAppendix`), never instead of the legal minimum. */

export const LIBRARY_VERSION = "hvac-2026.09";

/** High risk construction work, WHS Regulation r 291 — the same 18 in the
    model regulations, NSW (WHS Regulation 2025) and Queensland (2011).

    TWO NAMES EACH. `label` is the regulation's wording and is what PAPER
    prints, because the document is read against the law. `plain` is what a
    SCREEN says to the person on site — "In an area with artificial extremes
    of temperature" is a roof space to everyone who has worked in one. */
export const HRCW: readonly { n: number; label: string; plain: string }[] = [
  { n: 1, label: "Risk of a person falling more than 2 m", plain: "Falling more than 2 m" },
  { n: 2, label: "On a telecommunication tower", plain: "On a telecommunication tower" },
  { n: 3, label: "Demolition of a load-bearing or structural element", plain: "Demolishing a load-bearing part of a building" },
  { n: 4, label: "Likely to involve disturbing asbestos", plain: "Disturbing asbestos" },
  { n: 5, label: "Structural alterations or repairs needing temporary support", plain: "Structural work that needs temporary propping" },
  { n: 6, label: "In or near a confined space", plain: "In or near a confined space" },
  { n: 7, label: "In or near a shaft or trench over 1.5 m deep, or a tunnel", plain: "In or near a trench or shaft over 1.5 m deep, or a tunnel" },
  { n: 8, label: "Use of explosives", plain: "Using explosives" },
  { n: 9, label: "On or near pressurised gas mains or piping", plain: "On or near gas mains or piping" },
  { n: 10, label: "On or near chemical, fuel or refrigerant lines", plain: "On or near refrigerant, fuel or chemical lines" },
  { n: 11, label: "On or near energised electrical installations or services", plain: "On or near live electrical wiring" },
  { n: 12, label: "In an area that may have a contaminated or flammable atmosphere", plain: "Where the air may be contaminated or flammable" },
  { n: 13, label: "Tilt-up or precast concrete", plain: "Tilt-up or precast concrete" },
  { n: 14, label: "On or next to a road, railway or other traffic corridor", plain: "Next to a road, railway or traffic" },
  { n: 15, label: "In an area with movement of powered mobile plant", plain: "Around moving plant, like a crane or an EWP" },
  { n: 16, label: "In an area with artificial extremes of temperature", plain: "Extreme heat or cold, like a roof space" },
  { n: 17, label: "In or near water or liquid with a drowning risk", plain: "In or near water deep enough to drown in" },
  { n: 18, label: "Diving work", plain: "Diving" },
];

export type Jurisdiction = "NSW" | "QLD";

/** The hierarchy of controls, strongest first. */
export type ControlLevel = "eliminate" | "substitute" | "isolate" | "engineering" | "admin" | "ppe";

/* TWO NAMES EACH, like the categories. PAPER spells out the regulation's own
   names for the levels — "Admin" read as the office, and "PPE" as a code.
   The TEMPLATE PAGE says what a control of that level does, for the owner
   reading it before approving. */
export const LEVEL_LABEL: Record<ControlLevel, string> = {
  eliminate: "Elimination",
  substitute: "Substitution",
  isolate: "Isolation",
  engineering: "Engineering",
  admin: "Administrative",
  ppe: "Protective equipment",
};
export const LEVEL_PLAIN: Record<ControlLevel, string> = {
  eliminate: "Removes the hazard",
  substitute: "Safer substitute",
  isolate: "Keeps people clear",
  engineering: "Equipment",
  admin: "Procedure",
  ppe: "Protective gear",
};

export const STEP_KEYS = ["roof", "lift", "drill", "ceiling", "braze", "test", "power", "charge"] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export const STEP_TITLE: Record<StepKey, string> = {
  roof: "Get onto the roof and set fall protection",
  lift: "Lift the outdoor unit onto the roof frame",
  drill: "Core drill the wall penetration",
  ceiling: "Run pipe and cable through the ceiling space",
  braze: "Braze the pipe joints",
  test: "Pressure test and evacuate",
  power: "Connect power to the system",
  charge: "Release the charge, leak test and commission",
};

/* A SERVICE OR REPAIR IS NOT AN INSTALL. Lifting a new unit onto the roof,
   core drilling a new penetration and connecting a new circuit are install
   work, and their controls say so ("installation wiring by a licensed
   electrician"), so a service is only ever offered the steps whose controls
   hold for it. The library still writes every word; this only decides which
   of its steps a kind of job can use. */
export const SERVICE_STEPS: readonly StepKey[] = ["roof", "ceiling", "braze", "test", "charge"];

export function stepsFor(kind: "install" | "service"): readonly StepKey[] {
  return kind === "install" ? STEP_KEYS : SERVICE_STEPS;
}

/** A step that is ticked AND belongs to this kind of job. */
export function stepOn(a: { kind: "install" | "service"; steps: Record<StepKey, boolean> }, key: StepKey): boolean {
  return a.steps[key] && stepsFor(a.kind).includes(key);
}

export type FallControl = "edge" | "scaffold" | "ewp" | "harness";

/** Everything the person on site chooses. Stored as-is on the version. */
export type SwmsAnswers = {
  kind: "install" | "service";
  jurisdiction: Jurisdiction;
  site: { pre1990: boolean; powerlines: boolean; traffic: boolean; builder: boolean };
  /** The builder running the site, named — they are handed a copy, and the
      document names who was handed it. */
  builderName: string;
  /** Categories ticked by hand on site, beyond what the answers switch on. */
  extraCategories: number[];
  steps: Record<StepKey, boolean>;
  fall: FallControl;
  anchor: string;
  /** Queensland, a harness as the only fall control: why higher controls weren't used. */
  qldFallReason: string;
  lift: "hoist" | "crane";
  dust: "wet" | "extract";
  silica: "high" | "low";
  silicaWhy: string;
  roofPower: "off" | "rcd";
  isolation: string;
  refrigerant: string;
  siteNotes: string;
  hospital: string;
  extinguisher: "van" | "site";
  riskAppendix: boolean;
};

export const DEFAULT_ANSWERS: SwmsAnswers = {
  kind: "install",
  jurisdiction: "NSW",
  site: { pre1990: false, powerlines: false, traffic: false, builder: false },
  builderName: "",
  extraCategories: [],
  steps: { roof: true, lift: true, drill: true, ceiling: true, braze: true, test: true, power: true, charge: true },
  fall: "edge",
  anchor: "",
  qldFallReason: "",
  lift: "hoist",
  dust: "wet",
  silica: "high",
  silicaWhy: "",
  roofPower: "off",
  isolation: "",
  refrigerant: "R32",
  siteNotes: "",
  hospital: "",
  extinguisher: "van",
  riskAppendix: false,
};

/** Where a new SWMS starts. Every install brazes, tests, connects power and
    charges; whether it goes on the roof, lifts a unit, drills or runs through
    the roof space depends on the site, so those start unticked and nothing
    claims work nobody has described. A service starts with nothing ticked:
    it needs a SWMS only for high-risk work, which the person on site names. */
export function startingAnswers(kind: "install" | "service", jurisdiction: Jurisdiction): SwmsAnswers {
  return {
    ...DEFAULT_ANSWERS,
    kind,
    jurisdiction,
    steps:
      kind === "install"
        ? { roof: false, lift: false, drill: false, ceiling: false, braze: true, test: true, power: true, charge: true }
        : { roof: false, lift: false, drill: false, ceiling: false, braze: false, test: false, power: false, charge: false },
  };
}

/** Install or service, read off the job's own ServiceM8 category. Null when
    the category doesn't say, and the question is asked instead. */
export function kindFromCategory(category: string | null): "install" | "service" | null {
  const c = (category ?? "").toLowerCase();
  if (/install|replace|supply|new system/.test(c)) return "install";
  if (/service|repair|maint|fault|breakdown|clean/.test(c)) return "service";
  return null;
}

export type SwmsControl = { level: ControlLevel; text: string };
export type SwmsStep = {
  key: StepKey;
  title: string;
  categories: number[];
  silica: boolean;
  hazards: string;
  controls: SwmsControl[];
  who: string;
  /** Written from something chosen or typed on this site. */
  site: boolean;
};
export type SwmsCategory = { n: number; reason: string };

/** 1–5 each; the score is their product. */
export type Rating = { likelihood: number; consequence: number };
export type RiskScore = { key: StepKey; title: string; before: Rating; after: Rating };

export type SwmsContent = {
  libraryVersion: string;
  jurisdiction: Jurisdiction;
  work: string;
  categories: SwmsCategory[];
  steps: SwmsStep[];
  plant: string[];
  ppe: string[];
  siteNotes: string[];
  emergency: { firstAider: string; hospital: string; extinguisher: string };
  /** The licence facts that aren't one person's ticket. */
  licenceNote: string;
  riskScores: RiskScore[] | null;
};

/** What the builder needs that isn't an answer: facts from the job and the team. */
export type BuildContext = {
  work: string;
  electricianName: string | null;
  firstAiderName: string | null;
};

/* ── refrigerants ──────────────────────────────────────────────────────── */

/** ASHRAE safety class of the refrigerants a Studio design can hold. A blend
    listed as "R32/R410A" is treated as its most flammable part. */
export function refrigerantClass(refrigerant: string): "A1" | "A2L" | "A3" {
  const r = refrigerant.toUpperCase().replace(/\s+/g, "");
  if (/R290|R600/.test(r)) return "A3";
  if (/R32|R454B|R1234/.test(r)) return "A2L";
  return "A1";
}

/* ── the site's state ──────────────────────────────────────────────────── */

export const AU_STATES = ["NSW", "QLD", "VIC", "SA", "WA", "TAS", "NT", "ACT"] as const;
export type AuState = (typeof AU_STATES)[number];
export const STATE_NAME: Record<AuState, string> = {
  NSW: "New South Wales",
  QLD: "Queensland",
  VIC: "Victoria",
  SA: "South Australia",
  WA: "Western Australia",
  TAS: "Tasmania",
  NT: "Northern Territory",
  ACT: "Australian Capital Territory",
};

/** The state on an Australian address — the site's, not the business's. Any
    state, so a site the template doesn't cover is named rather than read as
    one it does. The abbreviation before a postcode wins: a street can be
    called "Wa". */
export function stateFromAddress(address: string | null): AuState | null {
  if (!address) return null;
  let last: AuState | null = null;
  for (const m of address.toUpperCase().matchAll(/\b(NSW|QLD|VIC|SA|WA|TAS|NT|ACT)\b(\s*\d{4}\b)?/g)) {
    if (m[2]) return m[1] as AuState;
    last = m[1] as AuState;
  }
  return last;
}

/** A state ServiceM8 geocoded, by abbreviation or name. */
export function stateFromGeo(geo: string | null): AuState | null {
  const g = (geo ?? "").trim().toUpperCase();
  if ((AU_STATES as readonly string[]).includes(g)) return g as AuState;
  return AU_STATES.find((s) => STATE_NAME[s].toUpperCase() === g) ?? null;
}

/** The rules the template writes to for a state, or null for one it doesn't cover. */
export function jurisdictionOf(state: AuState | null): Jurisdiction | null {
  return state === "NSW" || state === "QLD" ? state : null;
}

/** Why a site in a state the template doesn't cover gets no SWMS from it. */
export function stateNotCovered(state: AuState): string {
  const place = state === "NT" || state === "ACT" ? `the ${STATE_NAME[state]}` : STATE_NAME[state];
  return `This job is in ${place}. The SWMS template is written to New South Wales and Queensland rules, so it can't write one for this site.`;
}

/* ── what the answers switch on ────────────────────────────────────────── */

/** The high-risk categories this job's answers make apply, each with why, in number order. */
export function categoriesOf(a: SwmsAnswers): SwmsCategory[] {
  const on = new Map<number, string>();
  const add = (n: number, reason: string) => {
    if (!on.has(n)) on.set(n, reason);
  };
  const s = Object.fromEntries(STEP_KEYS.map((k) => [k, stepOn(a, k)])) as Record<StepKey, boolean>;
  if (s.roof || s.lift) add(1, "Work on the roof, where a fall would be more than 2 m");
  if (s.drill && a.site.pre1990) add(4, "Drilling a building from before 1990, treated as possible asbestos");
  if (s.charge) add(10, "Work on charged refrigerant lines when releasing the charge and leak testing");
  if (s.drill) add(11, "Drilling a wall where live wiring may be present");
  if (s.ceiling) add(11, "Working in a roof space with live cables");
  if (s.power) add(11, "Connecting at the switchboard");
  if (a.site.powerlines) add(11, "Overhead powerlines near the work");
  if (s.drill && a.jurisdiction === "QLD") add(12, "Silica dust from drilling brick, which Queensland's silica code treats as a contaminated atmosphere");
  if (a.site.traffic) add(14, "Next to a road or driveway with traffic");
  if (s.lift && a.lift === "crane") add(15, "A crane or Hiab lift");
  if (s.roof && a.fall === "ewp") add(15, "An elevating work platform on site");
  if (s.ceiling) add(16, "Inside an enclosed roof cavity");
  for (const n of a.extraCategories) {
    if (HRCW.some((c) => c.n === n)) add(n, "Ticked on site");
  }
  return [...on.entries()].sort((x, y) => x[0] - y[0]).map(([n, reason]) => ({ n, reason }));
}

/* ── the steps ─────────────────────────────────────────────────────────── */

const c = (level: ControlLevel, text: string): SwmsControl => ({ level, text });

function roofStep(a: SwmsAnswers): SwmsStep {
  const QLD = a.jurisdiction === "QLD";
  const anchor = a.anchor.trim() || "the named anchor";
  const fall: SwmsControl = {
    edge: c("isolate", "Edge protection along the roof edges of the work area — top rail 900–1100 mm, mid-rail and toe-board — fitted before anyone works on the roof."),
    scaffold: c("isolate", "Work from a scaffold with stair access and guardrails, tagged before use; erected by a licensed scaffolder where a fall of more than 4 m is possible."),
    ewp: c("engineering", "Work from an elevating work platform on firm, level ground; operator trained on this model, holding a boom-type EWP licence if the boom is 11 m or more; harness on a short lanyard clipped to the basket anchor."),
    harness: c("ppe", `Restraint harness clipped to ${anchor} — an anchor approved by a competent person — with the lanyard set so the worker can't reach the edge; not used on a slope over 15° or on a fragile roof; never on the roof alone, rescue plan agreed.`),
  }[a.fall];
  return {
    key: "roof",
    title: STEP_TITLE.roof,
    categories: [1],
    silica: false,
    hazards: "Falling from the ladder or roof edge more than 2 m; falling through broken tiles, skylights or brittle sheeting.",
    controls: [
      c("admin", "Industrial ladder rated 120 kg or more, set at 4:1, secured top and bottom, extending at least 1 m past the step-off; three points of contact; nobody underneath."),
      fall,
      c("admin", "Walk only along the batten or purlin lines; never on skylights, brittle sheeting or cracked tiles."),
      c("isolate", "Area below the roof edge kept clear of people while work is overhead."),
      ...powerlineControls(a),
      ...(QLD && a.fall === "harness"
        ? [c("admin", `Higher controls considered first (Qld WHS Regulation s 299(4)): ${a.qldFallReason.trim()}`)]
        : []),
    ],
    who: "Crew lead",
    site: true,
  };
}

function powerlineControls(a: SwmsAnswers): SwmsControl[] {
  if (!a.site.powerlines) return [];
  return a.jurisdiction === "QLD"
    ? [c("isolate", "Ladders, tools and copper pipe kept at least 3.0 m from the uninsulated low-voltage line. The main switch does not make the service line dead.")]
    : [c("isolate", "Ladders and copper pipe kept at least 4.0 m from the overhead service line, hand tools at least 0.5 m; closer only with the network operator's written requirements. The main switch does not make the service line dead.")];
}

function liftStep(a: SwmsAnswers): SwmsStep {
  const crane = a.lift === "crane";
  return {
    key: "lift",
    title: STEP_TITLE.lift,
    categories: crane ? [1, 15] : [1],
    silica: false,
    hazards: "The unit or tools falling on people below; a worker overbalancing at the roof edge while taking the load.",
    controls: crane
      ? [
          c("admin", "Lift by an operator holding the crane licence the machine needs (vehicle loading crane of 10 metre-tonnes or more); load slung and directed by a licensed dogger; tag lines on the load."),
          c("isolate", "Exclusion zone under the lift path, marked and watched until the unit is set down."),
          c("admin", "Unit bolted to the roof frame before the slings are released."),
          ...powerlineControls(a),
        ]
      : [
          c("admin", "Unit weight read off its data plate before the lift."),
          c("engineering", "Unit raised with a rope hoist rated for that weight, from inside the fall-protected area; nobody under the load."),
          c("admin", "One person in charge of the lift; unit bolted to the roof frame before the hoist is released."),
        ],
    who: "Crew lead, installer",
    site: true,
  };
}

function drillStep(a: SwmsAnswers): SwmsStep {
  const QLD = a.jurisdiction === "QLD";
  return {
    key: "drill",
    title: STEP_TITLE.drill,
    categories: [...(a.site.pre1990 ? [4] : []), 11, ...(QLD ? [12] : [])],
    silica: true,
    hazards: "Drilling into live cables or pipes in the wall; breathing crystalline silica dust from brick or concrete; noise.",
    controls: [
      ...(a.site.pre1990
        ? [c("eliminate", "Built before 1990, so the material is treated as possible asbestos: the penetration goes through material that isn't suspect, or the material is tested before any drilling. If in doubt, stop.")]
        : []),
      c("isolate", "Services in the wall located and marked before drilling; circuits in that wall isolated at the switchboard; if a cable is hit, stop and call the electrician."),
      a.dust === "wet"
        ? c("engineering", "Core drilled with water fed to the bit so no dry dust is made; slurry cleaned up before it dries.")
        : c("engineering", "Core drill fitted with on-tool extraction to an M- or H-class vacuum."),
      c("ppe", "Fit-checked P2 respirator for anyone drilling or cleaning up; hearing protection while drilling."),
      a.silica === "high"
        ? c("admin", "Silica risk assessment, written before counting controls: high-risk processing (power-tool drilling of brick or concrete). The controls in this step are its silica risk control plan; the driller holds silica training.")
        : c("admin", `Silica risk assessment, written before counting controls: not high risk — ${a.silicaWhy.trim()}.`),
    ],
    who: "Installer",
    site: true,
  };
}

function ceilingStep(a: SwmsAnswers): SwmsStep {
  const QLD = a.jurisdiction === "QLD";
  const off = a.roofPower === "off" || QLD;
  return {
    key: "ceiling",
    title: STEP_TITLE.ceiling,
    categories: [11, 16],
    silica: false,
    hazards: "Electric shock from damaged or live cables; heat stress in the roof cavity; falling through the ceiling lining.",
    controls: [
      off
        ? c("eliminate", QLD
            ? "Mains switched off at the main switchboard, locked and tagged, before anyone enters the roof space (Qld Electrical Safety Regulation 2026). The incoming mains to the switchboard stay live."
            : "Mains switched off at the main switchboard, locked and tagged, before anyone enters the roof space. The incoming mains to the switchboard stay live.")
        : c("isolate", "Only the RCD-protected socket circuit left on, with the RCD tested first; cordless tools and a torch; no cable moved or covered."),
      c("admin", "Cables located and kept clear of fixings; downlights not covered; if a cable is damaged, stop and call the electrician."),
      c("admin", "Step only on joists or beams, never on the ceiling lining; torch carried."),
      c("admin", "Roof-space work in the cooler part of the day, with water and breaks outside the cavity; someone outside knows who is in the roof space and checks in."),
      c("ppe", "P2 respirator, goggles, head cover and long sleeves when working through insulation."),
    ],
    who: "Crew lead, installer",
    site: true,
  };
}

function brazeStep(a: SwmsAnswers): SwmsStep {
  return {
    key: "braze",
    title: STEP_TITLE.braze,
    categories: [],
    silica: false,
    hazards: "Fire from the torch flame; flashback in the gas hoses; burns and brazing fumes.",
    controls: [
      c("engineering", "Pipe purged with oxygen-free nitrogen before heating, and nitrogen kept flowing at low pressure while brazing."),
      c("engineering", "Flashback arrestors at both the torch and regulator ends of both hoses; cylinders upright and secured."),
      c("isolate", "Combustibles removed from the brazing area or shielded with fire-resistant barriers; fire extinguisher at hand."),
      ...(a.site.builder ? [c("admin", `Hot work permit obtained from ${a.builderName.trim() || "the builder"} before lighting the torch.`)] : []),
      c("admin", "Valves shut and hoses purged after use; the area checked for smouldering before it's left."),
      c("ppe", "Filter-shade eyewear, leather gloves and covered skin."),
    ],
    who: "Crew lead",
    site: false,
  };
}

function testStep(): SwmsStep {
  return {
    key: "test",
    title: STEP_TITLE.test,
    categories: [],
    silica: false,
    hazards: "Sudden release of high-pressure gas; a cylinder falling.",
    controls: [
      c("substitute", "Oxygen-free nitrogen only for the pressure test — never standard nitrogen, air or refrigerant."),
      c("admin", "Test pressure no higher than the system's maximum operating pressure and below relief settings, raised in stages; result recorded."),
      c("isolate", "Cylinder upright and strapped; nobody in line with joints or valves while under pressure; area ventilated."),
    ],
    who: "Crew lead",
    site: false,
  };
}

function powerStep(a: SwmsAnswers, ctx: BuildContext): SwmsStep {
  const who = ctx.electricianName ?? "the named electrician";
  return {
    key: "power",
    title: STEP_TITLE.power,
    categories: [11],
    silica: false,
    hazards: "Electric shock or arc flash at the switchboard.",
    controls: [
      c("admin", a.jurisdiction === "QLD"
        ? `Isolator, installation and interconnect wiring by a licensed electrician — ${who}. A restricted electrical licence doesn't cover it.`
        : `Installation and interconnect wiring by a licensed electrician — ${who}.`),
      c("eliminate", `Circuit isolated at ${a.isolation.trim() || "the named isolation point"}; personal lock and danger tag applied by the person working on it.`),
      c("admin", "Tester proved on a known live source, the circuit tested dead, the tester proved again; treated as live until proven dead."),
      c("engineering", "Dedicated circuit with earth-leakage protection suited to an inverter unit, confirmed before power-on."),
    ],
    who: "Electrician",
    site: true,
  };
}

function chargeStep(a: SwmsAnswers): SwmsStep {
  const cls = refrigerantClass(a.refrigerant);
  const r = a.refrigerant.trim() || "the refrigerant";
  const flammable = cls !== "A1";
  return {
    key: "charge",
    title: STEP_TITLE.charge,
    categories: [10],
    silica: false,
    hazards: flammable
      ? `${r} is flammable; cold burns from liquid refrigerant; refrigerant released to air.`
      : `High-pressure ${r}; cold burns from liquid refrigerant; refrigerant released to air.`,
    controls: [
      c("admin", "Refrigerant handled by a refrigerant handling licence holder whose licence covers this job; the business holds a refrigerant trading authorisation."),
      ...(cls === "A3" && a.jurisdiction === "QLD"
        ? [c("admin", "Queensland: the worker also holds a gas work licence for hydrocarbon refrigerants.")]
        : []),
      ...(flammable
        ? [
            c("eliminate", "A temporary flammable zone around open lines and charging: no ignition sources, nearby electrics off, ventilation checked first."),
            c("engineering", `Leak checked with a combustible-gas detector suited to ${r} — never a halide detector, and never refrigerant as a test gas; tools rated for ${cls} refrigerants.`),
            c("admin", "System earthed before charging; charge kept within the unit's and the room's limits; no refrigerant released to air."),
          ]
        : [
            c("engineering", `Leak checked with an electronic leak detector suited to ${r}; never refrigerant as a test gas.`),
            c("admin", "Charge kept within the unit's limits; no refrigerant released to air."),
          ]),
      c("ppe", "Safety glasses, and gloves that protect against cold burns, when connecting and removing hoses."),
    ],
    who: "Crew lead",
    site: flammable,
  };
}

/* ── risk scores, for the optional appendix ────────────────────────────── */

/** The library's own ratings, before and after the step's controls. */
const DEFAULT_SCORES: Record<StepKey, { before: Rating; after: Rating }> = {
  roof: { before: { likelihood: 4, consequence: 5 }, after: { likelihood: 1, consequence: 5 } },
  lift: { before: { likelihood: 3, consequence: 4 }, after: { likelihood: 2, consequence: 4 } },
  drill: { before: { likelihood: 3, consequence: 4 }, after: { likelihood: 1, consequence: 4 } },
  ceiling: { before: { likelihood: 3, consequence: 5 }, after: { likelihood: 1, consequence: 5 } },
  braze: { before: { likelihood: 3, consequence: 4 }, after: { likelihood: 1, consequence: 4 } },
  test: { before: { likelihood: 2, consequence: 4 }, after: { likelihood: 1, consequence: 4 } },
  power: { before: { likelihood: 3, consequence: 5 }, after: { likelihood: 1, consequence: 5 } },
  charge: { before: { likelihood: 3, consequence: 4 }, after: { likelihood: 1, consequence: 4 } },
};

export const LIKELIHOOD = ["Rare", "Unlikely", "Possible", "Likely", "Almost certain"] as const;
export const CONSEQUENCE = ["Insignificant", "Minor", "Moderate", "Major", "Catastrophic"] as const;

export function riskLevel(r: Rating): "Low" | "Medium" | "High" | "Extreme" {
  const score = r.likelihood * r.consequence;
  if (score >= 20) return "Extreme";
  if (score >= 10) return "High";
  if (score >= 5) return "Medium";
  return "Low";
}

/* ── the document ──────────────────────────────────────────────────────── */

export function buildSwms(a: SwmsAnswers, ctx: BuildContext): SwmsContent {
  const s = Object.fromEntries(STEP_KEYS.map((k) => [k, stepOn(a, k)])) as Record<StepKey, boolean>;
  const steps: SwmsStep[] = [];
  if (s.roof) steps.push(roofStep(a));
  if (s.lift) steps.push(liftStep(a));
  if (s.drill) steps.push(drillStep(a));
  if (s.ceiling) steps.push(ceilingStep(a));
  if (s.braze) steps.push(brazeStep(a));
  if (s.test) steps.push(testStep());
  if (s.power) steps.push(powerStep(a, ctx));
  if (s.charge) steps.push(chargeStep(a));

  const cls = refrigerantClass(a.refrigerant);
  const plant = [
    "Industrial extension ladder, rated 120 kg or more",
    ...(s.roof ? [{ edge: "Temporary roof edge protection", scaffold: "Scaffold with stair access, tagged", ewp: "Elevating work platform, pre-start checked", harness: "Harness, restraint lanyard and roof anchor, inspected" }[a.fall]] : []),
    ...(s.lift ? [a.lift === "crane" ? "Crane or Hiab with slings, inspected" : "Rope hoist rated for the unit's weight"] : []),
    ...(s.drill ? ["Cable and pipe detector", a.dust === "wet" ? "Core drill with water feed" : "Core drill with on-tool extraction and an M- or H-class vacuum"] : []),
    ...(s.braze ? ["Brazing kit with flashback arrestors at both ends of both hoses", "Fire-resistant barrier or blanket"] : []),
    ...(s.test ? ["Oxygen-free nitrogen cylinder, strapped, with its regulator"] : []),
    ...(s.charge || s.test ? ["Vacuum pump and gauges"] : []),
    ...(s.charge ? [cls === "A1" ? "Electronic leak detector" : `Combustible-gas leak detector suited to ${a.refrigerant}`, ...(cls === "A1" ? [] : [`Charging tools rated for ${cls} refrigerant`])] : []),
    ...(s.ceiling ? ["Torch and cordless tools for the roof space"] : []),
    "Portable RCD, push-tested daily; tools tested and tagged within 3 months",
    `Fire extinguisher — ${a.extinguisher === "van" ? "in the van" : "on site, marked"}`,
  ];

  const ppe = [
    "Safety footwear",
    "Safety glasses",
    ...(s.drill ? ["Fit-checked P2 respirator and hearing protection for drilling"] : []),
    ...(s.ceiling ? ["P2 respirator, goggles, head cover and long sleeves in insulation"] : []),
    ...(s.braze ? ["Filter-shade eyewear and leather gloves for brazing"] : []),
    ...(s.charge ? ["Gloves that protect against cold burns when handling hoses"] : []),
    ...(s.roof && (a.fall === "ewp" || a.fall === "harness") ? ["Full-body harness with double-action connectors"] : []),
    ...(s.roof ? ["Brimmed hat, sunglasses and SPF30+ sunscreen on the roof when the UV index is 3 or more"] : []),
  ];

  const siteNotes = [
    a.site.pre1990 ? "Building from before 1990; material treated as possible asbestos until tested." : null,
    a.site.powerlines ? "Overhead powerlines near the work." : null,
    a.site.traffic ? "Work next to a road or driveway with traffic." : null,
    a.site.builder ? `${a.builderName.trim() || "A builder"} runs the site as principal contractor.` : null,
    a.siteNotes.trim() || null,
  ].filter((x): x is string => !!x);

  const licenceNote = [
    "The business holds a refrigerant trading authorisation.",
    a.jurisdiction === "QLD"
      ? "Isolator and installation wiring is licensed electrical work in Queensland; a restricted electrical licence doesn't cover a split install."
      : "Installation wiring is licensed electrical work; the air conditioning licence covers only wiring associated with servicing.",
  ].join(" ");

  return {
    libraryVersion: LIBRARY_VERSION,
    jurisdiction: a.jurisdiction,
    work: ctx.work,
    categories: categoriesOf(a),
    steps,
    plant,
    ppe,
    siteNotes,
    emergency: {
      firstAider: ctx.firstAiderName ?? "Not named",
      hospital: a.hospital.trim(),
      extinguisher: a.extinguisher === "van" ? "In the van" : "On site, marked",
    },
    licenceNote,
    riskScores: a.riskAppendix
      ? steps.map((st) => ({ key: st.key, title: st.title, ...DEFAULT_SCORES[st.key] }))
      : null,
  };
}

/* ── before it can be issued ───────────────────────────────────────────── */

/** Words that leave the decision to the worker — the Code of Practice's own
    example of a control that isn't one. Matched as whole words or phrases. */
const VAGUE = ["appropriate", "as required", "where necessary", "if necessary", "be careful", "take care", "as needed", "suitable ppe"];

export function vagueWords(text: string): string[] {
  const t = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  return VAGUE.filter((w) => new RegExp(`[^a-z]${w}[^a-z]`).test(t));
}

export type IssueFacts = {
  people: number;
  responsibleChosen: boolean;
  electricianChosen: boolean;
  siteChecked: boolean;
};

/** The answer a problem is about, so a screen can take the reader to it. */
export type ProblemField =
  | "steps"
  | "kind"
  | "anchor"
  | "qldFallReason"
  | "silicaWhy"
  | "roofPower"
  | "isolation"
  | "electrician"
  | "builderName"
  | "hospital"
  | "people"
  | "responsible"
  | "siteNotes"
  | "siteChecked";
export type IssueProblem = { field: ProblemField; text: string };

/** Everything standing between these answers and an issue, in the order the
    wizard asks, each with the answer it is about. Empty means it can be issued. */
export function issueProblemList(a: SwmsAnswers, f: IssueFacts): IssueProblem[] {
  const out: IssueProblem[] = [];
  const add = (field: ProblemField, text: string) => out.push({ field, text });
  const s = Object.fromEntries(STEP_KEYS.map((k) => [k, stepOn(a, k)])) as Record<StepKey, boolean>;
  const anyStep = STEP_KEYS.some((k) => s[k]);
  if (!anyStep) add("steps", "Tick at least one step that's happening on this job.");
  if (a.kind === "service" && categoriesOf(a).length === 0) {
    /* the way out is a step, not calling the job an install */
    add("steps", "Nothing ticked here is high-risk work, and a service that has none doesn't need a SWMS.");
  }
  if (s.roof && a.fall === "harness" && !a.anchor.trim()) add("anchor", "Name the roof anchor the harness clips to.");
  if (s.roof && a.fall === "harness" && a.jurisdiction === "QLD" && !a.qldFallReason.trim()) {
    add("qldFallReason", "Say why edge protection, a scaffold or an EWP wasn't reasonably practicable — Queensland requires it for a harness.");
  }
  if (s.drill && a.silica === "low" && !a.silicaWhy.trim()) add("silicaWhy", "Say why the drilling isn't high-risk silica work.");
  if (s.ceiling && a.jurisdiction === "QLD" && a.roofPower !== "off") {
    add("roofPower", "In Queensland the mains must be off before anyone enters a house roof space.");
  }
  if (s.power && !a.isolation.trim()) add("isolation", "Name the isolation point.");
  if (s.power && !f.electricianChosen) add("electrician", "Choose the electrician doing the connection.");
  if (a.site.builder && !a.builderName.trim()) add("builderName", "Name the builder running the site — they're handed a copy.");
  if (!a.hospital.trim()) add("hospital", "Name the nearest hospital.");
  if (f.people === 0) add("people", "Choose who this SWMS covers.");
  if (!f.responsibleChosen) add("responsible", "Choose who's in charge on site.");
  for (const [field, name, text] of [
    ["anchor", "the anchor", a.anchor],
    ["qldFallReason", "the Queensland fall reason", a.qldFallReason],
    ["silicaWhy", "the silica reason", a.silicaWhy],
    ["siteNotes", "the site notes", a.siteNotes],
    ["builderName", "the builder's name", a.builderName],
  ] as const) {
    const hits = vagueWords(text);
    if (hits.length) add(field, `Replace "${hits[0]}" in ${name} with the exact item, number or person.`);
  }
  if (!f.siteChecked) add("siteChecked", "Confirm you've walked the site and this SWMS matches it.");
  return out;
}

/** The same, as the words alone. */
export function issueProblems(a: SwmsAnswers, f: IssueFacts): string[] {
  return issueProblemList(a, f).map((p) => p.text);
}

/* ── a correction ──────────────────────────────────────────────────────── */

/* A CORRECTION DOESN'T CHANGE HOW THE WORK IS DONE. Sign-ons and the site
   walk carry through one, so a revision that changes the method can't be
   issued as one. Every choice that decides a step or a control is compared;
   what may differ is what was typed (a name, an isolation point), the
   emergency details, the people and the paperwork. */
const METHOD: readonly [string, (a: SwmsAnswers) => string, StepKey?][] = [
  ["the kind of job", (a) => a.kind],
  ["the state", (a) => a.jurisdiction],
  ["the site questions", (a) => [a.site.pre1990, a.site.powerlines, a.site.traffic, a.site.builder].join()],
  ["the steps", (a) => STEP_KEYS.filter((k) => stepOn(a, k)).join()],
  ["the high-risk categories", (a) => a.extraCategories.join()],
  /* a step's own choice, compared only while the step is in both — a step
     coming or going is already "the steps" */
  ["fall protection", (a) => a.fall, "roof"],
  ["how the unit goes up", (a) => a.lift, "lift"],
  ["dust control", (a) => `${a.dust} ${a.silica}`, "drill"],
  ["power in the roof space", (a) => a.roofPower, "ceiling"],
  ["the refrigerant", (a) => a.refrigerant, "charge"],
];

/** What changed about how the work is done, in words; empty for a correction. */
export function methodChanges(before: SwmsAnswers, after: SwmsAnswers): string[] {
  return METHOD.filter(([, of, step]) => (!step || (stepOn(before, step) && stepOn(after, step))) && of(before) !== of(after)).map(
    ([name]) => name
  );
}

/** "the steps", "the steps and fall protection", "a, b and c". */
export function andList(items: readonly string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/* ── the team's tickets ────────────────────────────────────────────────── */

/** A first aid ticket, however it was typed on a staff card. CPR on its own isn't one. */
export function isFirstAidTicket(name: string): boolean {
  return /first[\s-]*aid|\bhltaid0(03|11|12|14)\b/i.test(name);
}
