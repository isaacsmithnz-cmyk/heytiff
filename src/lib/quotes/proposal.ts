import {
  CHECKLIST,
  CHECKLIST_KEYS,
  orderChecklist,
  type CheckItem,
  type CheckState,
  type ChecklistKey,
} from "./checklist";
import {
  PAYMENT_PRESETS,
  PAYMENT_PRESET_KEYS,
  type PaymentPreset,
  type PaymentStage,
} from "./payment";

/* A PROPOSAL DRAFT — the skeleton every Diamond Air proposal is built on, as
   data.

   WHY DATA AND NOT PROSE. Read side by side (2749, 3266, 2872, 2587, 3343),
   the ServiceM8 Proposals shared one structure, and what drifted was what a
   person typed fresh each time: the title, "Intro" or "Info", pros and cons
   on one job and not the next, "TBC" and "as discussed" where a fact should
   be. So the writer fills FIELDS and HeyTiff draws everything around them:
   the title from the address, "Option N:" numbering, the pricing shape, the
   payment stages, the wording of every extra note, the checklist's
   questions. What the writer gets to say is the intro, the "why this
   system" paragraph, the scope lines, the units in each room, the pros and
   cons, and which topics it already knows.

   READ AGAINST ALL TEN SAMPLE JOBS (2026-09-29), the skeleton needed: units
   per room (1352, 2587, 2872, 3266), a "why this system" paragraph (2587's
   VRF, 3266's brand switch, 1352's heritage building), extras with their own
   price (Wi-Fi, frameless grilles), allowances with a figure (2872's grilles),
   itemised pricing for building works (2501), and payment terms that follow
   the kind of job. A service call (3231) is not a proposal.

   Everything a model hands back passes through `normaliseDraft` before it is
   stored or shown, and so does a person's own edit. */

export type PricingMode = "multiple_choice" | "optional" | "itemised";

export type UnitLine = {
  /** "Master bedroom", "Downstairs". */
  room: string;
  /** "3.5 kW", as said. */
  capacity: string;
  /** "High wall", "Ducted, PEA-M140HAA". */
  type: string;
};

export type ProposalOption = {
  /** The option's own short name, without "Option 1:". Numbered where drawn. */
  name: string;
  /** The scope, one fact per line, in the house voice. */
  lines: string[];
  /** Each unit this option puts in, room by room. Empty for a single split. */
  units: UnitLine[];
  pros: string[];
  cons: string[];
};

/** An add-on the client can take or leave, priced on its own. */
export type Extra = { name: string; detail: string };
/** A choice not made yet, covered by a stated allowance. */
export type Allowance = { name: string; detail: string };
/** An itemised line, for work priced by quantity rather than by option. */
export type ItemLine = { name: string; qty: string };

/** The extra notes a job can need beyond the standard ones. The writer picks
    keys; the words are these, always. */
export const EXTRA_NOTES = {
  client_supplied: {
    heading: "Client-supplied equipment",
    lines: [
      "The unit's manufacturer warranty is between you and your supplier.",
      "Our installation workmanship warranty still applies.",
      "Time spent finding a fault with supplied equipment is charged.",
    ],
  },
  roof_access: {
    heading: "Roof access",
    lines: [
      "Roof tiles are lifted to reach the work and relaid when it is done.",
      "Tiles that are already cracked or brittle may break when lifted, and replacing them is extra.",
    ],
  },
  strata: {
    heading: "Strata approval",
    lines: [
      "Strata or building management approval is needed before we start.",
      "We can supply the specifications they ask for.",
    ],
  },
  existing_removal: {
    heading: "Existing system",
    lines: ["The old system is removed, its refrigerant recovered, and it is disposed of."],
  },
  pipe_reuse: {
    heading: "Existing pipework",
    lines: ["Existing pipes are reused where they pass a pressure test.", "If they fail, replacing them is extra."],
  },
  ceiling_opening: {
    heading: "Opening the ceiling",
    lines: [
      "Where the ceiling has to be opened, patching and painting are not included.",
      "We can organise it, or your own trades can.",
    ],
  },
  condensate_pump: {
    heading: "Condensate pumps",
    lines: ["Where a drain can't fall to a drain point, a condensate pump lifts it, and is listed in the scope."],
  },
  custom_grilles: {
    heading: "Custom and powder-coated grilles",
    lines: [
      "Custom and powder-coated grilles are made to order, and their lead time is confirmed when you accept.",
      "Colours are matched to a sample you approve.",
    ],
  },
  trading_hours: {
    heading: "Working around your trading hours",
    lines: ["We plan the noisy and disruptive work around your trading hours, agreed before we start."],
  },
} as const satisfies Record<string, { heading: string; lines: readonly string[] }>;

export type ExtraNoteKey = keyof typeof EXTRA_NOTES;
export const EXTRA_NOTE_KEYS = Object.keys(EXTRA_NOTES) as ExtraNoteKey[];

export type ProposalDraft = {
  intro: string;
  /** Why this system, when the choice needs explaining. Empty otherwise. */
  why: string;
  options: ProposalOption[];
  pricingMode: PricingMode;
  /** Itemised pricing only. */
  items: ItemLine[];
  extras: Extra[];
  allowances: Allowance[];
  notes: ExtraNoteKey[];
  payment: { preset: PaymentPreset; stages: PaymentStage[] };
  checklist: CheckItem[];
};

/* ── the clamps ── */

export const MAX_OPTIONS = 4;
export const MAX_LINES = 14;
export const MAX_UNITS = 12;
export const MAX_PROS = 4;
export const MAX_EXTRAS = 8;
export const MAX_ITEMS = 20;
export const MAX_STAGES = 8;
export const MAX_INTRO_CHARS = 900;
export const MAX_WHY_CHARS = 900;
export const MAX_NAME_CHARS = 80;
export const MAX_LINE_CHARS = 240;
export const MAX_SHORT_CHARS = 120;

const clean = (s: unknown, max: number): string =>
  typeof s === "string" ? s.replace(/[ \t]+\n/g, "\n").trim().slice(0, max) : "";

/** A bullet as typed or returned: a leading dash, asterisk or bullet is the
    list's own mark, not the words'. */
const cleanLine = (s: unknown, max = MAX_LINE_CHARS): string =>
  clean(s, max + 4)
    .replace(/^[-*•–]\s*/, "")
    .replace(/\s+/g, " ")
    .slice(0, max);

const lineList = (raw: unknown, max: number): string[] =>
  (Array.isArray(raw) ? raw : []).map((l) => cleanLine(l)).filter(Boolean).slice(0, max);

/** "Option 2: Replace" handed back as a name would be numbered twice. */
const cleanName = (s: unknown): string =>
  clean(s, MAX_NAME_CHARS + 12)
    .replace(/^option\s*\d+\s*[:.–-]\s*/i, "")
    .replace(/[:.]\s*$/, "")
    .slice(0, MAX_NAME_CHARS);

const obj = (x: unknown): Record<string, unknown> | null =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;

function pairs<T>(raw: unknown, max: number, make: (o: Record<string, unknown>) => T | null): T[] {
  return (Array.isArray(raw) ? raw : [])
    .map((x) => {
      const o = obj(x);
      return o ? make(o) : null;
    })
    .filter((x): x is T => x !== null)
    .slice(0, max);
}

const short = (s: unknown) => cleanLine(s, MAX_SHORT_CHARS);

function units(raw: unknown): UnitLine[] {
  return pairs(raw, MAX_UNITS, (o) => {
    const room = short(o.room);
    const capacity = short(o.capacity);
    const type = short(o.type);
    return room || capacity || type ? { room, capacity, type } : null;
  });
}

function stages(raw: unknown): PaymentStage[] {
  return pairs(raw, MAX_STAGES, (o) => {
    const when = short(o.when);
    if (!when) return null;
    const n = typeof o.percent === "number" ? o.percent : Number(o.percent);
    const percent = o.percent === null || o.percent === "" || !Number.isFinite(n) ? null : Math.round(Math.min(100, Math.max(0, n)));
    return { when, percent };
  });
}

function payment(raw: unknown): ProposalDraft["payment"] {
  const o = obj(raw);
  const preset = PAYMENT_PRESET_KEYS.includes(o?.preset as PaymentPreset) ? (o!.preset as PaymentPreset) : "domestic_small";
  const own = stages(o?.stages);
  return { preset, stages: own.length ? own : PAYMENT_PRESETS[preset].stages.map((s) => ({ ...s })) };
}

function checklist(raw: unknown): CheckItem[] {
  const seen = new Set<string>();
  const items = pairs(raw, CHECKLIST_KEYS.length, (o): CheckItem | null => {
    const key = o.key as ChecklistKey;
    if (!CHECKLIST_KEYS.includes(key) || seen.has(key)) return null;
    seen.add(key);
    const state: CheckState = o.state === "known" || o.state === "na" ? o.state : "ask";
    const answer = short(o.answer);
    /* "known" with nothing known is an ask, whatever it was called */
    const item: CheckItem = { key, state: state === "known" && !answer ? "ask" : state, answer };
    if (o.fresh === true && item.state === "known") item.fresh = true;
    return item;
  });
  return orderChecklist(items);
}

/** The one gate between a model (or a person's edit) and the table. Null
    when nothing usable is left: no option, and no itemised lines either. */
export function normaliseDraft(raw: unknown): ProposalDraft | null {
  const r = obj(raw);
  if (!r) return null;
  const options = pairs(r.options, MAX_OPTIONS, (x): ProposalOption | null => {
    const name = cleanName(x.name);
    const lines = lineList(x.lines, MAX_LINES);
    const u = units(x.units);
    if (!name && lines.length === 0 && u.length === 0) return null;
    return {
      name: name || "Scope",
      lines,
      units: u,
      pros: lineList(x.pros, MAX_PROS),
      cons: lineList(x.cons, MAX_PROS),
    };
  });
  const mode = r.pricingMode ?? r.pricing_mode;
  const items = pairs(r.items, MAX_ITEMS, (o) => {
    const name = short(o.name);
    return name ? { name, qty: short(o.qty) || "1" } : null;
  });
  /* building works priced line by line can have no option at all */
  if (options.length === 0 && !(mode === "itemised" && items.length > 0)) return null;

  const notes = (Array.isArray(r.notes) ? r.notes : []).filter(
    (k, i, all): k is ExtraNoteKey =>
      typeof k === "string" && (EXTRA_NOTE_KEYS as string[]).includes(k) && all.indexOf(k) === i
  );
  const named = (o: Record<string, unknown>) => {
    const name = short(o.name);
    return name ? { name, detail: short(o.detail) } : null;
  };

  return {
    intro: clean(r.intro, MAX_INTRO_CHARS),
    why: clean(r.why, MAX_WHY_CHARS),
    options,
    pricingMode: mode === "optional" || mode === "itemised" ? mode : "multiple_choice",
    items,
    extras: pairs(r.extras, MAX_EXTRAS, named),
    allowances: pairs(r.allowances, MAX_EXTRAS, named),
    notes,
    payment: payment(r.payment),
    checklist: checklist(r.checklist),
  };
}

/* ── the words drawn around the fields ── */

/** "Air Conditioning Scope – 37 Taleeban Rd, Riverview". The address as the
    job holds it, on one line, without the state and postcode. */
export function proposalTitle(address: string | null | undefined): string {
  const one = (address ?? "")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ")
    .replace(/\s+(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\s+\d{4}\s*$/i, "")
    .replace(/,\s*$/, "");
  return one ? `Air Conditioning Scope – ${one}` : "Air Conditioning Scope";
}

/** An option's heading: numbered when the client picks one, the area's own
    name when they tick the ones they want. Itemised work has one scope. */
export function optionHeading(draft: ProposalDraft, index: number): string {
  const name = draft.options[index]?.name ?? "";
  return draft.pricingMode === "multiple_choice" ? `Option ${index + 1}: ${name}` : name;
}

export const PRICING_WORDS: Record<PricingMode, string> = {
  multiple_choice: "The client picks one",
  optional: "The client ticks the ones they want",
  itemised: "Priced line by line",
};

/** The checklist topic's own words, for a row on the card. */
export const topicOf = (key: ChecklistKey) => CHECKLIST[key];
