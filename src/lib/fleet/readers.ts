/* Reading a document into a record — the pure half.

   The server actions in app/actions/fleet-ai.ts make the call to Tiff;
   everything about what to ASK for and what to BELIEVE lives here, where it
   runs without an API key and is tested to the field. Same split as
   parseValuations: the model's answer is INPUT. Every value is checked before
   it becomes a form value, because a figure that lands in a form is a figure
   that gets saved — and the forms these feed are the ones that decide whether
   a vehicle is legal to drive.

   Two documents, two readers:

   RENEWAL — an insurance schedule, a rego notice, a green slip. One reader
   for the three kinds because they carry the same core facts (who, how much,
   from when, until when) and differ only in the extras each kind prints.

   REGO CERTIFICATE — the Certificate of Registration that arrives with every
   NSW renewal notice and is the closest thing a vehicle has to a birth
   certificate: plate, make, model, variant, year, VIN, engine number, weights,
   seating, and the expiry. Adding a vehicle by scanning it is the point of the
   redesigned form. */

import {
  AU_STATES,
  BODY_TYPES,
  INSURANCE_COVERS,
  type AuState,
  type BodyType,
  type InsuranceCover,
  type RenewalKind,
} from "@/components/fleet/logic";
import { canonicalMake } from "./makes";

/* ---------------- shared validation ---------------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const text = (v: unknown, max = 120): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

const isoDate = (v: unknown): string | null =>
  typeof v === "string" && ISO_DATE.test(v) ? v : null;

/** Dollars: a finite, non-negative number. Anything else — a string with a
    `$`, a negative, NaN — is not a figure we'd write to a premium column. */
const money = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;

/** A count or a measurement: a positive whole number. `2442.0` cc rounds to
    2442; `0`, negatives and non-numbers are null, never 0 — a zero-kilogram
    van is a claim, not a blank. */
const positiveInt = (v: unknown, max = 1_000_000): number | null => {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n > 0 && n <= max ? n : null;
};

const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;

/* ---------------- renewals ---------------- */

export type RenewalRead = {
  provider: string | null;
  premium: number | null;
  startsOn: string | null;
  expiresOn: string | null;
  /* The extras. Which of these a kind can even have is enforced in the parse:
     a rego notice has no policy number and a green slip has no excess, and a
     model that offers one anyway has misread something. */
  policyNumber: string | null;
  cover: InsuranceCover | null;
  excess: number | null;
  termMonths: number | null;
  garagingPostcode: string | null;
  inspectionOn: string | null;
};

const nullable = (t: "string" | "number" | "integer") => ({ type: [t, "null"] });

export const RENEWAL_READ_SCHEMA = {
  type: "object",
  properties: {
    provider: nullable("string"),
    premium: nullable("number"),
    startsOn: nullable("string"),
    expiresOn: nullable("string"),
    policyNumber: nullable("string"),
    cover: { anyOf: [{ type: "string", enum: [...INSURANCE_COVERS] }, { type: "null" }] },
    excess: nullable("number"),
    termMonths: nullable("integer"),
    garagingPostcode: nullable("string"),
    inspectionOn: nullable("string"),
  },
  required: [
    "provider",
    "premium",
    "startsOn",
    "expiresOn",
    "policyNumber",
    "cover",
    "excess",
    "termMonths",
    "garagingPostcode",
    "inspectionOn",
  ],
  additionalProperties: false,
} as const;

/* What each kind of paper is, and who it comes FROM.

   The third row is not a variation on the first. A green slip is CTP — the
   personal-injury cover the state makes you carry to be registered — and it is
   issued by an INSURER, while the rego notice beside it comes from the road
   authority. Asked for "the issuing road authority" a green slip reads as the
   wrong document entirely, and the last line of the prompt then (correctly)
   returns nulls for a document that was in fact perfectly readable.

   The premium note is there because a real green slip prints FOUR figures —
   the insurer's premium, GST, a fund levy, and the total of the three. Only
   the last is what the renewal cost, and it is not the one nearest the word
   "premium". */
const RENEWAL_WHAT: Record<RenewalKind, { what: string; provider: string; extras: string }> = {
  insurance: {
    what: "an Australian motor-vehicle insurance policy schedule or certificate of currency",
    provider: 'the insurer\'s name (e.g. "NRMA", "Allianz")',
    extras:
      "- policyNumber: the policy number as printed\n" +
      "- cover: the type of cover — \"comprehensive\", \"third_party_property\" (third party " +
      "property damage only) or \"third_party_fire_theft\" (third party, fire and theft). " +
      "Null if the document doesn't say.\n" +
      "- excess: the standard/basic excess in dollars, if printed\n" +
      "- termMonths: the length of the policy period in months (usually 12)\n" +
      "- garagingPostcode: null\n" +
      "- inspectionOn: null\n",
  },
  rego: {
    what: "an Australian vehicle registration renewal notice or certificate of registration",
    provider: 'the issuing road authority (e.g. "Transport for NSW")',
    extras:
      "- policyNumber: null (registration has no policy number)\n" +
      "- cover: null\n" +
      "- excess: null\n" +
      "- termMonths: the registration term in months — NSW offers 3, 6 or 12\n" +
      "- garagingPostcode: null\n" +
      "- inspectionOn: the date of the safety check (pink slip / eSafety inspection) as " +
      "yyyy-mm-dd, ONLY if one is printed. Null if not shown, or if the notice says an " +
      "inspection is not required.\n",
  },
  ctp: {
    what:
      "an Australian compulsory third party (CTP) personal injury insurance certificate — " +
      "in NSW this is called a Green Slip",
    provider: 'the CTP insurer\'s name (e.g. "QBE", "AAMI", "Allianz")',
    extras:
      "- policyNumber: the certificate or policy number as printed\n" +
      "- cover: null\n" +
      "- excess: null\n" +
      "- termMonths: the period of cover in months (usually 12, sometimes 6)\n" +
      "- garagingPostcode: the garaging suburb's four-digit postcode, if printed\n" +
      "- inspectionOn: null\n",
  },
};

const PREMIUM_NOTE: Record<RenewalKind, string> = {
  insurance: "",
  rego: "",
  ctp:
    ". A green slip usually itemises the insurer's premium, GST and a fund or levy " +
    "line separately and then totals them — take the TOTAL, not the premium line",
};

/** The instruction sent with a renewal document of this kind. */
export function renewalPrompt(kind: RenewalKind): string {
  const k = RENEWAL_WHAT[kind];
  return (
    `This is ${k.what}. Extract:\n` +
    `- provider: ${k.provider}\n` +
    `- premium: the total amount payable in AUD, GST inclusive${PREMIUM_NOTE[kind]}\n` +
    "- startsOn: the date cover/registration BEGINS, as yyyy-mm-dd\n" +
    "- expiresOn: the date cover/registration ENDS or is due for renewal, as yyyy-mm-dd\n" +
    k.extras +
    "\nexpiresOn is the important one — it is the date the vehicle's record will be " +
    "updated to. If the document shows a period like \"01/09/2026 to 01/09/2027\", " +
    "the LATER date is expiresOn. Use null for anything not clearly readable; a " +
    "guessed expiry is worse than a blank one, because it silences a real warning. " +
    "If this is not that kind of document at all, return null for every field."
  );
}

/** The model's answer, believed only where it is well-formed AND belongs to
    this kind of document. */
export function parseRenewalRead(raw: unknown, kind: RenewalKind): RenewalRead {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  /* Checked whole, not truncated to four: slicing first would turn "20311"
     into a postcode that passes, and a postcode that passes is one that gets
     saved as the garaging address the premium was rated on. */
  const postcode = text(r.garagingPostcode, 12);
  return {
    provider: text(r.provider, 60),
    premium: money(r.premium),
    startsOn: isoDate(r.startsOn),
    expiresOn: isoDate(r.expiresOn),
    policyNumber: kind === "rego" ? null : text(r.policyNumber, 40),
    cover: kind === "insurance" ? oneOf(r.cover, INSURANCE_COVERS) : null,
    excess: kind === "insurance" ? money(r.excess) : null,
    termMonths: positiveInt(r.termMonths, 60),
    garagingPostcode: kind === "ctp" && postcode && /^\d{4}$/.test(postcode) ? postcode : null,
    inspectionOn: kind === "rego" ? isoDate(r.inspectionOn) : null,
  };
}

/* ---------------- the certificate of registration ---------------- */

export type RegoCertificateRead = {
  plate: string | null;
  plateState: AuState | null;
  /** Canonical (a name the make picker knows) where the printed make maps to
      one; otherwise as printed, for the "not listed" path. */
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  bodyType: BodyType | null;
  colour: string | null;
  vin: string | null;
  engineNumber: string | null;
  engineCapacityCc: number | null;
  seating: number | null;
  tareKg: number | null;
  gvmKg: number | null;
  atmKg: number | null;
  /** The expiry printed on the certificate itself. */
  expiresOn: string | null;
  /** The total payable on an attached renewal notice, if the page has one. */
  renewalAmount: number | null;
  customerNo: string | null;
  issuer: string | null;
};

export const REGO_CERT_SCHEMA = {
  type: "object",
  properties: {
    plate: nullable("string"),
    plateState: nullable("string"),
    make: nullable("string"),
    model: nullable("string"),
    variant: nullable("string"),
    year: nullable("integer"),
    bodyType: { anyOf: [{ type: "string", enum: [...BODY_TYPES] }, { type: "null" }] },
    colour: nullable("string"),
    vin: nullable("string"),
    engineNumber: nullable("string"),
    engineCapacityCc: nullable("number"),
    seating: nullable("integer"),
    tareKg: nullable("number"),
    gvmKg: nullable("number"),
    atmKg: nullable("number"),
    expiresOn: nullable("string"),
    renewalAmount: nullable("number"),
    customerNo: nullable("string"),
    issuer: nullable("string"),
  },
  required: [
    "plate",
    "plateState",
    "make",
    "model",
    "variant",
    "year",
    "bodyType",
    "colour",
    "vin",
    "engineNumber",
    "engineCapacityCc",
    "seating",
    "tareKg",
    "gvmKg",
    "atmKg",
    "expiresOn",
    "renewalAmount",
    "customerNo",
    "issuer",
  ],
  additionalProperties: false,
} as const;

export const REGO_CERT_PROMPT =
  "This is an Australian vehicle registration document — a Certificate of Registration, " +
  "a registration renewal notice, or one page carrying both. Extract:\n" +
  "- plate: the registration / plate number, letters and digits only\n" +
  "- plateState: the state or territory whose road authority issued it, as a code: NSW, VIC, " +
  "QLD, SA, WA, TAS, NT or ACT. Transport for NSW and Service NSW mean NSW; VicRoads means " +
  "VIC; Queensland Transport and Main Roads means QLD.\n" +
  "- make: the manufacturer's FULL name. Certificates abbreviate — MIT is Mitsubishi, TOYT " +
  "is Toyota, HOLD is Holden, ISUZ is Isuzu, HYUN is Hyundai, NISS is Nissan, MERC is " +
  "Mercedes-Benz, VOLK is Volkswagen, MAZD is Mazda. Expand them.\n" +
  "- model: the model name (e.g. \"Triton\", \"Hiace\")\n" +
  "- variant: the variant or series code exactly as printed (e.g. \"MR4W30-\"), or null\n" +
  "- year: the year of manufacture\n" +
  "- bodyType: classify the vehicle as \"van\", \"ute\", \"car\", \"truck\" or \"trailer\" " +
  "from its description, shape and weights. A cab chassis or dual cab is a ute; a trailer " +
  "has no engine.\n" +
  "- colour: the colour, ONLY if printed (most NSW certificates don't print it)\n" +
  "- vin: the VIN / chassis number exactly as printed\n" +
  "- engineNumber: the engine number exactly as printed\n" +
  "- engineCapacityCc: engine capacity in cubic centimetres, as a number (2442.0 is 2442)\n" +
  "- seating: seating capacity\n" +
  "- tareKg: tare weight in kg\n" +
  "- gvmKg: gross vehicle mass in kg\n" +
  "- atmKg: aggregate trailer mass in kg — trailers only, null otherwise\n" +
  "- expiresOn: the expiry date printed on the Certificate of Registration, as yyyy-mm-dd. " +
  "If the page is also a renewal notice, the certificate's own printed expiry is the answer, " +
  "not the payment due date.\n" +
  "- renewalAmount: if a renewal notice is present, its TOTAL amount payable in AUD; null " +
  "otherwise\n" +
  "- customerNo: the road authority's customer number for this registration, if printed\n" +
  "- issuer: the issuing authority's name as printed (e.g. \"Transport for NSW\")\n\n" +
  "Use null for anything not clearly readable — a guessed VIN or expiry is worse than a " +
  "blank one. If this is not a vehicle registration document at all, return null for " +
  "every field.";

/* The abbreviations NSW certificates actually print. The prompt asks for the
   full name and usually gets it; this is the net under the wire, and it feeds
   the same canonicaliser the make picker uses so "MIT" lands on the picker's
   own "Mitsubishi" rather than beside it. */
const MAKE_ABBREVIATIONS: Record<string, string> = {
  MIT: "Mitsubishi",
  MITS: "Mitsubishi",
  TOYT: "Toyota",
  TOYO: "Toyota",
  HOLD: "Holden",
  ISUZ: "Isuzu",
  HYUN: "Hyundai",
  NISS: "Nissan",
  MERC: "Mercedes-Benz",
  VOLK: "Volkswagen",
  MAZD: "Mazda",
  SUBA: "Subaru",
  SUZU: "Suzuki",
  RENA: "Renault",
  MITF: "Mitsubishi Fuso",
};

function readMake(v: unknown): string | null {
  const printed = text(v, 40);
  if (!printed) return null;
  const expanded = MAKE_ABBREVIATIONS[printed.toUpperCase()] ?? printed;
  return canonicalMake(expanded) ?? expanded;
}

/** Plates print with spaces and dashes people don't type: "YLI 59V" is YLI59V. */
function readPlate(v: unknown): string | null {
  const p = text(v, 12)?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
  return p.length >= 2 && p.length <= 7 ? p : null;
}

/** A VIN is seventeen characters, but the field is "VIN / chassis number" and
    an older trailer's chassis number isn't. Shape-check, don't length-lock. */
function readVin(v: unknown): string | null {
  const s = text(v, 24)?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
  return s.length >= 5 && s.length <= 17 ? s : null;
}

function readEngineNumber(v: unknown): string | null {
  const s = text(v, 32)?.toUpperCase().replace(/[^A-Z0-9-]/g, "") ?? "";
  return s.length >= 3 ? s : null;
}

export function parseRegoCertificate(raw: unknown, now = new Date()): RegoCertificateRead {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const year = positiveInt(r.year, now.getFullYear() + 1);
  return {
    plate: readPlate(r.plate),
    plateState: oneOf(text(r.plateState, 3)?.toUpperCase(), AU_STATES),
    make: readMake(r.make),
    model: text(r.model, 60),
    variant: text(r.variant, 40),
    year: year !== null && year >= 1900 ? year : null,
    bodyType: oneOf(r.bodyType, BODY_TYPES),
    colour: text(r.colour, 30),
    vin: readVin(r.vin),
    engineNumber: readEngineNumber(r.engineNumber),
    engineCapacityCc: positiveInt(r.engineCapacityCc, 30_000),
    seating: positiveInt(r.seating, 100),
    tareKg: positiveInt(r.tareKg, 100_000),
    gvmKg: positiveInt(r.gvmKg, 200_000),
    atmKg: positiveInt(r.atmKg, 200_000),
    expiresOn: isoDate(r.expiresOn),
    renewalAmount: money(r.renewalAmount),
    customerNo: text(r.customerNo, 30),
    issuer: text(r.issuer, 60),
  };
}
