import {
  EMPTY_ROW,
  EMPTY_TEST,
  type AcRow,
  type AcSystem,
  type Building,
  type ClauseKey,
  type FanRow,
} from "./mechanical";

/* WHAT THE JOB ALREADY SAYS — the wizard's first draft, read off the job's
   work-done description and address. Pure, so each reading can be tested
   against the real jobs it was written for.

   A SUGGESTION, NEVER AN ANSWER. Quotes are written by hand, every one a bit
   differently, so nothing here is right every time. The wizard marks what it
   read as read from the quote, and the person corrects it before anything is
   issued. A reading that finds nothing leaves the row empty rather than
   guessing. */

/* ── model numbers ─────────────────────────────────────────────────────── */

/* A model number: letters, a dash or not, then digits and more — MSZ-AP42VGKD2-A2,
   PUHY-P400YNW, PEFY-P32VMX-E1, RZA160C2V1, FDYAN160AV1, ASTH22KMTD. */
const MODEL = /\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z]{2})[A-Z]{2,6}-?[A-Z]{0,3}\d{2,3}[A-Z0-9]*(?:-[A-Z0-9]{1,4})*\b/g;

/** Outdoor units, by the makers' own prefixes. Everything else is an indoor unit. */
const OUTDOOR_PREFIX = /^(MUZ|MXZ|PUHY|PUMY|PUZ|SUZ|PUY|PURY|RZA|RZAC|RXM|RXYQ|RKM|RXV|RXS|\dMXM|\dMKM|AOTH|AOTG|AOKG|AOYG|RAS|SRC|FDC)/;
const NOT_A_MODEL = /^(R32|R410A|R454B|R290|AS\d+|NCC|BCA|DRED|RCBO|PVC)/;

export function modelsIn(line: string): string[] {
  const up = line.toUpperCase();
  return [...up.matchAll(MODEL)].map((m) => m[0]).filter((m) => !NOT_A_MODEL.test(m));
}

export const isOutdoorModel = (model: string): boolean => OUTDOOR_PREFIX.test(model.toUpperCase());

/* ── numbers and places in a line ──────────────────────────────────────── */

const KW = /(\d+(?:\.\d+)?)\s*kw\b/i;
const kwIn = (line: string): number | null => {
  const m = KW.exec(line);
  return m ? Number(m[1]) : null;
};

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "for the kitchen", "to the living room", "for Master Bed" → the place. */
function placeIn(line: string): string {
  const m = /\b(?:for|serving|to(?:\s+serve|\s+service)?)\s+(?:the\s+)?([a-z][a-z0-9'’ /,&-]*?)\s*(?:[.;(]|$)/i.exec(line);
  if (!m) return "";
  const place = m[1].replace(/\s+/g, " ").trim();
  /* "to suit", "to be installed", "for supply and installation" are not rooms */
  if (/^(suit|be |agreed|supply|install|ceiling space)/i.test(place) || place.length > 48) return "";
  return cap(place);
}

const OUTDOOR_PLACE: readonly [RegExp, string][] = [
  [/roof ?top/i, "Rooftop"],
  [/\broof\b/i, "Roof"],
  [/balcony/i, "Balcony"],
  [/courtyard/i, "Courtyard"],
  [/brackets?/i, "Wall brackets"],
  [/side passage/i, "Side passage"],
];

function outdoorPlaceIn(text: string): string {
  for (const line of text.split("\n")) {
    if (!/outdoor|condenser/i.test(line)) continue;
    for (const [re, place] of OUTDOOR_PLACE) if (re.test(line)) return place;
  }
  return "";
}

/* ── the reading ───────────────────────────────────────────────────────── */

export type QuoteReading = {
  systems: AcSystem[];
  fans: FanRow[];
  ductwork: boolean;
  fireRated: boolean;
  condensatePump: boolean;
  ventilation: boolean;
  refrigerant: string;
};

const INDOOR_WORDS = /indoor|high ?wall|bulkhead|ducted|cassette|floor[ -]?(standing|mounted|console)|ceiling (concealed|suspended)|unit/i;
const SYSTEM_LINE = /\b(ducted|bulkhead|split|high ?wall|cassette)\b[^\n]*\bsystem\b/i;
const OUTDOOR_LINE = /outdoor|\bvrf\b|\bvrv\b|multi(?:[ -]?split)?\b|condens(?:er|ing unit)/i;
/** A short line ending in a colon that names a place: "Study:", "Ground Floor". */
const HEADING = /^([A-Z][A-Za-z0-9 ,'’&/-]{1,40}?):?$/;
const NOT_A_PLACE = /^(note|notes|scope|materials|included|includes?|excludes?|exclusions|warranty|supply|option|system|equipment|zone|variation|outdoor unit|connected units)/i;

const clean = (line: string) => line.replace(/^\s*[-*•]+\s*/, "").trim();

export function readQuote(description: string | null): QuoteReading {
  const text = (description ?? "").replace(/\r/g, "");
  const lines = text.split("\n").map(clean).filter(Boolean);
  const refrigerant = (/\b(R32|R410A|R454B|R290)\b/i.exec(text)?.[1] ?? "").toUpperCase();

  const systems: AcSystem[] = [];
  const blank = (): AcSystem => ({ outdoor: { ...EMPTY_ROW }, indoors: [], test: { ...EMPTY_TEST, refrigerant } });
  /** The outdoor unit the indoor units that follow belong to. */
  let current: AcSystem | null = null;
  const indoorTo = (row: AcRow) => {
    if (!current) {
      current = blank();
      systems.push(current);
    }
    current.indoors.push(row);
  };
  const outdoorOf = (row: AcRow) => {
    /* a model line for the outdoor after its indoor: the same system */
    if (current && !current.outdoor.model && current.outdoor.capacityKw === null) current.outdoor = row;
    else {
      current = blank();
      current.outdoor = row;
      systems.push(current);
    }
  };

  let heading = "";
  /** "5 of PEFY-P32VMX-E1 3.6kW" waits for the headings under it: its rooms. */
  let collecting: AcRow | null = null;

  for (const line of lines) {
    const models = modelsIn(line);
    const outdoorModel = models.find(isOutdoorModel) ?? "";
    const indoorModel = models.find((m) => !isOutdoorModel(m)) ?? "";
    const kw = kwIn(line);

    const head = HEADING.exec(line);
    if (head && !NOT_A_PLACE.test(head[1]) && kw === null && models.length === 0 && line.length <= 42) {
      const place = head[1].trim();
      if (collecting) collecting.location = collecting.location ? `${collecting.location}, ${place}` : place;
      else heading = place;
      continue;
    }
    if (kw === null) continue;

    /* "5 of PEFY-P32VMX-E1 3.6kW C/M Compact Ceiling Concealed" */
    const nOf = /^(\d+)\s+of\s+/i.exec(line);
    if (nOf && indoorModel) {
      collecting = { ...EMPTY_ROW, model: indoorModel, qty: Number(nOf[1]), capacityKw: kw };
      indoorTo(collecting);
      continue;
    }
    collecting = null;

    /* "1 x 9KW indoor for the Living", "2 x 3.5kw high wall indoors to lower ground bedroom and living" */
    const nX = /^(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*kw\b(.*)$/i.exec(line);
    if (nX && !/outdoor/i.test(nX[3])) {
      indoorTo({ ...EMPTY_ROW, model: indoorModel, qty: Number(nX[1]), capacityKw: Number(nX[2]), location: placeIn(nX[3]) });
      continue;
    }

    /* A model line: "MUZ-AP42VGD2-A2 - MITSUBISHI ELEC. HWS OUT 4.2KW", "RZA160C2V1 – Daikin ... Outdoor Unit, 15.5kW" */
    if (models.length > 0 && line.toUpperCase().startsWith(models[0])) {
      if (isOutdoorModel(models[0])) outdoorOf({ ...EMPTY_ROW, model: models[0], capacityKw: kw });
      else indoorTo({ ...EMPTY_ROW, model: models[0], capacityKw: kw, location: heading });
      continue;
    }

    /* An outdoor named in a sentence: "20KW ... VRF outdoor", "VRF 40kw PUHY-P400YNW",
       "22kw outdoor system", "a Mitsubishi Electric 7kw multi split system".
       The indoor units after it are its own. */
    if (OUTDOOR_LINE.test(line) && !/^\d+\s*x\b/i.test(line)) {
      current = blank();
      current.outdoor = { ...EMPTY_ROW, model: outdoorModel, capacityKw: kw };
      systems.push(current);
      continue;
    }

    /* Under an outdoor, "7kw bulkhead system for the kitchen" is one of its
       indoor units. With no outdoor named it is a whole split or ducted
       system of its own: "a 10KW ... Underfloor Ducted system ... (PEA-M100HAA)" */
    const place = placeIn(line) || heading;
    if (current && current.outdoor.capacityKw !== null && INDOOR_WORDS.test(line)) {
      indoorTo({ ...EMPTY_ROW, model: indoorModel, capacityKw: kw, location: place });
      continue;
    }
    if (SYSTEM_LINE.test(line)) {
      /* the same system said twice — in the heading, then in the scope */
      if (systems.some((x) => x.outdoor.capacityKw === kw && x.indoors.length === 1 && x.indoors[0].model === indoorModel)) continue;
      const own = blank();
      own.outdoor = { ...EMPTY_ROW, model: outdoorModel, capacityKw: kw };
      own.indoors.push({ ...EMPTY_ROW, model: indoorModel, capacityKw: kw, location: place });
      systems.push(own);
    }
  }

  const place = outdoorPlaceIn(text);
  for (const s of systems) if (!s.outdoor.location && place) s.outdoor.location = place;

  const fans: FanRow[] = [];
  if (/lossnay/i.test(text)) {
    fans.push({ location: "", model: "Lossnay", qty: 1, airflowLps: null, airflowKind: "rated", serial: "" });
  }
  for (const line of lines) {
    const m = /^(?:(\d+)\s*x\s*)?.*\bexhaust fans?\b(.*)$/i.exec(line);
    if (m) fans.push({ location: placeIn(m[2]), model: "", qty: m[1] ? Number(m[1]) : 1, airflowLps: null, airflowKind: "rated", serial: "" });
  }

  return {
    systems,
    fans,
    ductwork: /\bducted\b|ductwork|plenum|bulkhead|ceiling concealed|flexible duct|sheet ?metal|under ?floor|linear bar|diffuser/i.test(text),
    fireRated: /fire[\s-]*rated|fire collar|fire[\s-]*stop/i.test(text),
    condensatePump: /condensat\w*\s+pump/i.test(text),
    ventilation: fans.length > 0 || /energy recovery|\berv\b|ventilation fan|fresh air fan|inline fan/i.test(text),
    refrigerant,
  };
}

/* ── the building, from the address ────────────────────────────────────── */

export type BuildingGuess = { building: Building; because: string };

/** A preselection, said as such: the wizard prints "From the address", and
    the class prints only once the person has picked it. */
export function suggestBuilding(address: string | null): BuildingGuess {
  const first = (address ?? "").split("\n")[0]?.trim() ?? "";
  if (/^shop\b/i.test(first)) return { building: "shop", because: "The address names a shop." };
  if (/\b(lv|lvl|level|suite)\b/i.test(first)) return { building: "office", because: "The address has a level or suite." };
  if (/^\s*(unit|apartment|apt)\b/i.test(first) || /^\s*\d+[a-z]?\s*\/\s*\d+/i.test(first)) {
    return { building: "apartment", because: "The address has a unit number." };
  }
  return { building: "house", because: "The address is a street address." };
}

/* ── a certifier's requirement, matched to a clause ────────────────────── */

export type Match = { clause: ClauseKey | null; notOurs: boolean };

/* Checked in this order, because one requirement often names several things:
   FutureCert's fire-mode line also mentions AS/NZS 1668.1 and "smoke control
   system", and is about fire mode. */
const MATCHERS: readonly [RegExp, ClauseKey | "smoke"][] = [
  [/fire mode|specification 21|spec\.? ?21\b|shuts? down/i, "fireMode"],
  [/stair pressuri|zone pressuri|smoke (exhaust|control system|management system|spill)/i, "smoke"],
  [/\bJ5\b|part j\b|section j\b|energy efficiency/i, "j5"],
  [/kitchen (exhaust|hood)|commercial kitchen/i, "kitchenExhaust"],
  [/car ?park|carbon monoxide|\bCO\b (monitor|detect)/i, "carPark"],
  [/air balanc|balance report|commissioning report|test(ing)? and balanc/i, "airBalance"],
  [/noise|acoustic|db\(?a\)?/i, "noise"],
  [/1668\.2.*\b(only|exhaust)|exhaust.*1668\.2/i, "as16682"],
  [/1668/i, "as1668"],
  [/5149|refrigerat/i, "refrigerant"],
  [/4254|ductwork/i, "ductwork"],
  [/penetration|fire[\s-]*rated|fire[\s-]*stop/i, "fireRated"],
  [/airflow|air flow|l\/s|exhaust fan/i, "ventAirflow"],
  [/discharge/i, "ventDischarge"],
  [/manufacturer/i, "manufacturer"],
  [/condensate/i, "condensate"],
  [/commission/i, "commissioned"],
];

export function matchRequirement(text: string): Match {
  for (const [re, key] of MATCHERS) {
    if (!re.test(text)) continue;
    return key === "smoke" ? { clause: null, notOurs: true } : { clause: key, notOurs: false };
  }
  return { clause: null, notOurs: false };
}
