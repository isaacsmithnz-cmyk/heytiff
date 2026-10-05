/* WHO MAKES IT, AND WHAT KIND OF UNIT IT IS — the price book's units by
   brand, then by type (Isaac, 2026-10-05: "the unit section is very messy.
   Needs to be sorted by brand").

   Read from the item's name the way a wholesaler writes it ("DAIKIN CORA
   HWS OUT 6KW R32", "MITSUBISHI ELEC. DUCT OUT 16KW", "FUJ EXT INPUT/OUTPUT
   PCB"), from a maker's own order code when its price list is terse
   ("MSZ-AP25VGD2-A1 | Indoor Unit - wireless R/C"), or from the supplier when
   the supplier is the maker. Worked out at read, never stored. Pure. */

/** A maker: its name, the words a wholesaler's name starts with for it,
    and the words that name it anywhere in a name. */
type Maker = { name: string; starts: RegExp; anywhere?: RegExp };

const MAKERS: Maker[] = [
  { name: "Mitsubishi Heavy Industries", starts: /^(MHI|MITSUBISHI\s+HEAVY)\b/i, anywhere: /\bMITSUBISHI\s+HEAVY\b/i },
  { name: "Mitsubishi Electric", starts: /^(MITSUBISHI(\s+ELEC(\.|TRIC)?)?|MITS\.|MIT|ME)\b/i, anywhere: /\bMITSUBISHI\s+ELEC/i },
  { name: "Daikin", starts: /^(DAIKIN|DAI)\b/i, anywhere: /\bDAIKIN\b/i },
  { name: "Fujitsu", starts: /^(FUJITSU|FUJ)\b/i, anywhere: /\bFUJITSU\b/i },
  { name: "Toshiba", starts: /^(TOSHIBA|TOSH)\b/i, anywhere: /\bTOSHIBA\b/i },
  { name: "Panasonic", starts: /^(PANASONIC|PAN)\b/i, anywhere: /\bPANASONIC\b/i },
  { name: "ActronAir", starts: /^ACTRON(\s*AIR)?\b/i, anywhere: /\bACTRON\b/i },
  { name: "Samsung", starts: /^SAMSUNG\b/i, anywhere: /\bSAMSUNG\b/i },
  { name: "Hisense", starts: /^HISENSE\b/i, anywhere: /\bHISENSE\b/i },
  { name: "Haier", starts: /^HAIER\b/i, anywhere: /\bHAIER\b/i },
  { name: "Carrier", starts: /^CARRIER\b/i },
  { name: "Rinnai", starts: /^RINNAI\b/i, anywhere: /\bRINNAI\b/i },
  { name: "Kaden", starts: /^KADEN\b/i, anywhere: /\bKADEN\b/i },
  { name: "LG", starts: /^LG\b/i },
  { name: "Gree", starts: /^GREE\b/i },
  { name: "Midea", starts: /^MIDEA\b/i, anywhere: /\bMIDEA\b/i },
  { name: "Kelvinator", starts: /^KELVINATOR\b/i },
  { name: "Hitachi", starts: /^HITACHI\b/i },
  { name: "Temperzone", starts: /^TEMPERZONE\b/i, anywhere: /\bTEMPERZONE\b/i },
  { name: "Brivis", starts: /^BRIVIS\b/i, anywhere: /\bBRIVIS\b/i },
  { name: "Braemar", starts: /^(BRAEMAR|BRA)\b/i },
  { name: "Bonaire", starts: /^BONAIRE\b/i },
  { name: "Coolair", starts: /^COOLAIR\b/i },
  { name: "Advantage Air", starts: /^(ADVANTAGE\s+AIR|MYAIR|MY\s*PLACE)\b/i, anywhere: /\bMY\s*AIR\d?\b|\bMYPLACE\b/i },
  { name: "AirTouch", starts: /^AIRTOUCH\b/i, anywhere: /\bAIRTOUCH\b/i },
  { name: "iZone", starts: /^IZONE\b/i, anywhere: /\bIZONE\b/i },
  { name: "Polyaire", starts: /^POLYAIRE\b/i, anywhere: /\bPOLYAIRE\b/i },
  { name: "Honeywell", starts: /^(HONEYWELL|H\/WELL)\b/i },
];

/** A supplier that makes what it sells. */
const MAKER_SUPPLIERS: Record<string, string> = {
  mitsubishi: "Mitsubishi Electric",
  temperzone: "Temperzone",
  advantage_air: "Advantage Air",
};

/* Mitsubishi Electric's own order codes */
const ME_CODE = /^(MSZ|MUZ|MXZ|MFZ|MLZ|SEZ|SUZ|SLZ|PEA|PEAD|PEFY|PKA|PKFY|PLA|PLFY|PCA|PCFY|PMFY|PSA|PUZ|PUHZ|PUHY|PUMY|PURY|PQHY|PQRY|PVA|PFFY|PFAV|LGH|GUF|PAR|PAC|MAC)-/i;

/** The maker of an item, or null when its name doesn't say. */
export function brandOf(name: string, code = "", supplierKey = ""): string | null {
  const n = name.trim();
  for (const m of MAKERS) if (m.starts.test(n)) return m.name;
  for (const m of MAKERS) if (m.anywhere?.test(n)) return m.name;
  if (MAKER_SUPPLIERS[supplierKey]) return MAKER_SUPPLIERS[supplierKey]!;
  if (ME_CODE.test(code)) return "Mitsubishi Electric";
  return null;
}

/** The words that name a maker at the start of a name, so a family under
    its maker's heading reads "Zone controller", not "Dai zone controller". */
export function withoutBrand(name: string, brand: string | null): string {
  const m = MAKERS.find((x) => x.name === brand);
  return m ? name.replace(m.starts, "").replace(/^[\s.,:\-]+/, "") : name;
}

/* ── units: what kind, which part ─────────────────────────────────────── */

export type UnitType =
  | "Wall split"
  | "Ducted"
  | "Bulkhead"
  | "Cassette"
  | "Floor console"
  | "Under ceiling"
  | "Multi"
  | "VRF"
  | "Ventilation"
  | "Window and portable"
  | "Hot water heat pump"
  | "Other units";

/** The order the types are listed in under a maker. */
export const UNIT_TYPES: UnitType[] = [
  "Wall split",
  "Multi",
  "Ducted",
  "Bulkhead",
  "Cassette",
  "Floor console",
  "Under ceiling",
  "VRF",
  "Ventilation",
  "Window and portable",
  "Hot water heat pump",
  "Other units",
];

/* the first that matches wins: a multi's indoor head is a multi before it's
   a wall split, a VRF ducted indoor is VRF before it's ducted */
const TYPE_RULES: { type: UnitType; test: RegExp; code?: RegExp }[] = [
  { type: "Ventilation", test: /lossnay|\bERV\b|\bHRV\b|energy\s*recovery|sensible\s*core/i, code: /^(LGH|GUF)-/i },
  { type: "Hot water heat pump", test: /hot\s*water|water\s*heater|heat\s*pump\s*water|monoblock/i },
  { type: "VRF", test: /\bVRF\b|\bVRV\b|city\s*multi|\bC\/M\b|\bT\/F\b|\bS\/F\b/i, code: /^(PEFY|PLFY|PKFY|PCFY|PMFY|PFFY|PFAV|PUMY|PURY|PUHY|PQHY|PQRY)-/i },
  { type: "Multi", test: /\bmulti\b|\d\s*-?\s*port\b/i, code: /^MXZ-/i },
  { type: "Bulkhead", test: /bulkhead|b\/head/i },
  { type: "Cassette", test: /cassette|\bCAS\b|\b[14]\s*-?\s*way\b|one-way/i, code: /^(PLA|SLZ|MLZ)-/i },
  { type: "Floor console", test: /floor|console/i, code: /^MFZ-/i },
  { type: "Under ceiling", test: /under\s*ceiling|ceiling\s*suspended/i, code: /^(PCA|PKA)-/i },
  { type: "Window and portable", test: /window|portable/i },
  { type: "Ducted", test: /\bduct(ed)?\b|\bDUC\b|\bDUC\/|ceiling\s*concealed|low\s*profile/i, code: /^(PEA|PEAD|SEZ|PUZ|SUZ|PUHZ|FDUA)-?/i },
  { type: "Wall split", test: /\bHWS\b|hi(gh)?\s*-?\s*wall|wall\s*(mounted|split|AC|A\/C)|\bWHS\b|\bsplit\b/i, code: /^(MSZ|MUZ)-/i },
];

/** The kind of unit, from its name or its maker's code. */
export function unitTypeOf(name: string, code = ""): UnitType {
  for (const r of TYPE_RULES) if (r.test.test(name) || r.code?.test(code)) return r.type;
  return "Other units";
}

export type UnitPart = "indoor" | "outdoor" | "system";

/** Which part of a system it is: an indoor head, an outdoor unit, or the
    whole system as one item (a set, a kit, "WALL MOUNTED AC"). Null when the
    name doesn't say. */
export function unitPartOf(name: string, code = ""): UnitPart | null {
  if (/\b(IND|INDOOR|IDU|HEAD)\b|indoor\s*unit/i.test(name)) return "indoor";
  if (/\b(OUT|OUTDOOR|ODU)\b|\bO\/U\b|outdoor/i.test(name)) return "outdoor";
  if (/^(MSZ|MFZ|MLZ|PEA|PEAD|SEZ|SLZ|PLA|PCA|PKA|PEFY|PLFY|PKFY|PCFY|PMFY|PFFY)-/i.test(code)) return "indoor";
  if (/^(MUZ|MXZ|PUZ|SUZ|PUHZ|PUMY|PURY|PUHY|PQHY|PQRY)-/i.test(code)) return "outdoor";
  if (/\b(SET|KIT|SYSTEM|AC|A\/C)\b/i.test(name)) return "system";
  return null;
}

/** A unit's capacity in kW: from its name ("7.1KW"), else from its maker's
    code ("PEA-M100…" is 10 kW, "MSZ-AP25…" 2.5 kW). Null when neither says. */
export function capacityOf(name: string, code = ""): number | null {
  const kw = name.match(/(\d+(?:\.\d+)?)\s*kW\b/i);
  if (kw) return Number(kw[1]);
  const m = code.match(/^[A-Z]+-[A-Z]*?(\d{2,3})(?!\d)/i);
  return m ? Number(m[1]) / 10 : null;
}

const PART_WORDS: Record<UnitPart, string> = { indoor: "indoor", outdoor: "outdoor", system: "system" };

/** A unit's family under its maker: its type and part, "Wall split indoor". */
export function unitFamilyOf(name: string, code = ""): { key: string; label: string; order: number } {
  const type = unitTypeOf(name, code);
  const part = unitPartOf(name, code);
  const partOrder = part === "system" ? 0 : part === "indoor" ? 1 : part === "outdoor" ? 2 : 3;
  return {
    key: `${type}|${part ?? ""}`,
    label: part ? `${type} ${PART_WORDS[part]}` : type,
    order: UNIT_TYPES.indexOf(type) * 10 + partOrder,
  };
}
