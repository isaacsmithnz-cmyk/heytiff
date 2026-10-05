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

/* A PROPOSAL DRAFT — the skeleton every proposal is built on, as data.

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

/* THE EQUIPMENT, AS DATA. Every unit an option puts in is one row: each
   outdoor unit, each indoor unit (with the outdoor it runs from), and each
   fan. The rooms the client reads are drawn from these rows, and so is the
   compliance certificate's equipment, so the two can't disagree and nothing
   reads a model number back out of a sentence. A model is as given; until it
   is, it is empty and the checklist asks for it. */
export type UnitRole = "outdoor" | "indoor" | "fan";
export const UNIT_ROLES: readonly UnitRole[] = ["outdoor", "indoor", "fan"];

export type UnitLine = {
  role: UnitRole;
  /** Indoor and fan: the room, "Master bedroom". Outdoor: where it goes,
      "Side of the house". */
  room: string;
  /** "3.5 kW", as said. Empty for a fan. */
  capacity: string;
  /** "High wall", "Ducted", "In-line fan". */
  type: string;
  /** As on the plate, "PEA-M140HAA". Empty until it is known: never guessed. */
  model: string;
  /** Identical units in the same place. */
  qty: number;
  /** An indoor unit: the outdoor it runs from, counted from 1 in the order
      the outdoor units are listed. An outdoor unit: its own number. A fan: 0. */
  system: number;
  /** A fan's rated airflow in L/s, when known. Null otherwise. */
  lps: number | null;
};

export type ProposalOption = {
  /** The option's own short name, without "Option 1:". Numbered where drawn. */
  name: string;
  /** The scope, one fact per line, in the house voice. */
  lines: string[];
  /** Every unit this option puts in: outdoor units, the indoor units they
      run, and fans. A single split is one outdoor and one indoor. */
  units: UnitLine[];
  pros: string[];
  cons: string[];
  /** What the option costs the client, ex GST, in cents — the business's
      own price, set on the card (taken from the Price block, or typed);
      never Tiff's. Null until it's set. */
  priceCents: number | null;
};

/** The most an option's price can be: a typo's ceiling, not a guide. */
export const MAX_OPTION_PRICE_CENTS = 1_000_000_000;

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
  /** Keys of the business's quote notes (lib/templates/settings). */
  notes: string[];
  payment: { preset: PaymentPreset; stages: PaymentStage[] };
  checklist: CheckItem[];
  /** The options the client accepted, by index. One when they pick one;
      any number when they tick the ones they want. Empty until marked. */
  accepted: number[];
  /** Whether the customer sees each option's line items, or only its total;
      null: the business's own default (Quoting). */
  showLines: boolean | null;
};

/* ── the clamps ── */

export const MAX_OPTIONS = 4;
export const MAX_LINES = 14;
export const MAX_UNITS = 24;
export const MAX_UNIT_QTY = 20;
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

const wholeIn = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};

/** A model as typed: one line, its own case, no brackets around it. */
const cleanModel = (v: unknown): string => short(v).replace(/^\(|\)$/g, "").trim().toUpperCase();

function units(raw: unknown): UnitLine[] {
  const rows = pairs(raw, MAX_UNITS, (o): UnitLine | null => {
    /* a row saved before roles were kept is an indoor unit, as it was drawn */
    const role: UnitRole = UNIT_ROLES.includes(o.role as UnitRole) ? (o.role as UnitRole) : "indoor";
    const room = short(o.room);
    const capacity = role === "fan" ? "" : short(o.capacity);
    const type = short(o.type);
    const model = cleanModel(o.model);
    if (!room && !capacity && !type && !model) return null;
    const lps = role === "fan" && o.lps !== null && o.lps !== "" && o.lps !== undefined ? wholeIn(o.lps, 1, 5000, 0) || null : null;
    return { role, room, capacity, type, model, qty: wholeIn(o.qty, 1, MAX_UNIT_QTY, 1), system: wholeIn(o.system, 0, MAX_UNITS, 0), lps };
  });
  /* outdoors numbered in order; an indoor points at one that exists, or the
     first when it names none; a fan belongs to no outdoor */
  const outdoors = rows.filter((r) => r.role === "outdoor").length;
  let n = 0;
  return rows.map((r) => {
    if (r.role === "outdoor") return { ...r, system: ++n };
    if (r.role === "fan") return { ...r, system: 0 };
    return { ...r, system: outdoors === 0 ? 0 : r.system >= 1 && r.system <= outdoors ? r.system : 1 };
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
const priceOf = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(MAX_OPTION_PRICE_CENTS, Math.round(v)) : null;

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
      priceCents: priceOf(x.priceCents ?? x.price_cents),
    };
  });
  const mode = r.pricingMode ?? r.pricing_mode;
  const items = pairs(r.items, MAX_ITEMS, (o) => {
    const name = short(o.name);
    return name ? { name, qty: short(o.qty) || "1" } : null;
  });
  /* building works priced line by line can have no option at all */
  if (options.length === 0 && !(mode === "itemised" && items.length > 0)) return null;

  /* a business's own notes have their own keys, so a key is checked for its
     shape here and looked up where the note is drawn */
  const notes = (Array.isArray(r.notes) ? r.notes : [])
    .filter((k, i, all): k is string => typeof k === "string" && /^[a-z0-9_-]{1,40}$/.test(k) && all.indexOf(k) === i)
    .slice(0, 20);
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
    accepted: acceptedOf(r.accepted, options.length, mode === "optional"),
    showLines: ((v: unknown) => (typeof v === "boolean" ? v : null))(r.showLines ?? r.show_lines),
  };
}

function acceptedOf(raw: unknown, count: number, many: boolean): number[] {
  const picked = (Array.isArray(raw) ? raw : [])
    .map((v) => (typeof v === "number" ? v : Number(v)))
    .filter((v, i, all) => Number.isInteger(v) && v >= 0 && v < count && all.indexOf(v) === i)
    .sort((a, b) => a - b);
  /* a client who picks one option has accepted one */
  return many ? picked : picked.slice(0, 1);
}

/** The options the client took: the ones marked accepted, or the only
    option when there is just one. Empty when it can't be told. */
export function acceptedOptions(draft: ProposalDraft): ProposalOption[] {
  if (draft.accepted.length > 0) return draft.accepted.map((i) => draft.options[i]).filter(Boolean);
  return draft.options.length === 1 ? [draft.options[0]] : [];
}

/** Marking option `i` accepted, or taking the mark off. A client who
    picks one option has accepted only that one. */
export function toggleAccepted(draft: ProposalDraft, i: number): number[] {
  if (draft.accepted.includes(i)) return draft.accepted.filter((x) => x !== i);
  return draft.pricingMode === "multiple_choice" ? [i] : [...draft.accepted, i].sort((a, b) => a - b);
}

/** A new, empty row of the given kind, under the last outdoor unit. */
export function blankUnit(role: UnitRole, outdoors: number): UnitLine {
  return {
    role,
    room: "",
    capacity: "",
    type: role === "outdoor" ? "Outdoor unit" : "",
    model: "",
    qty: 1,
    system: role === "outdoor" ? outdoors + 1 : role === "indoor" ? Math.max(1, outdoors) : 0,
    lps: null,
  };
}

/** Each row's outdoor unit number by position (1, 2 …), 0 for the rest. */
function outdoorNumbers(units: readonly UnitLine[]): number[] {
  let n = 0;
  return units.map((u) => (u.role === "outdoor" ? (n += 1) : 0));
}

/* OUTDOOR UNITS ARE NUMBERED BY POSITION, and an indoor unit names the one it
   runs from by that number. So every change to which rows are outdoor units
   comes through here: the outdoors are numbered again, and each indoor unit's
   number moves with its own outdoor unit, so an edit above never re-pairs the
   units below it. `from[k]` is the row of `before` that row k of `after` was.
   An indoor unit whose outdoor unit is gone runs from the nearest one above
   it, else the first. */
function rewire(before: readonly UnitLine[], after: readonly UnitLine[], from: readonly number[]): UnitLine[] {
  const was = outdoorNumbers(before);
  const now = outdoorNumbers(after);
  const moved = new Map<number, number>();
  after.forEach((u, k) => {
    const j = from[k];
    if (u.role === "outdoor" && j >= 0 && before[j]?.role === "outdoor") moved.set(was[j], now[k]);
  });
  const first = now.find((n) => n > 0) ?? 0;
  let above = 0;
  return after.map((u, k) => {
    if (u.role === "outdoor") {
      above = now[k];
      return { ...u, system: now[k] };
    }
    if (u.role === "fan") return { ...u, system: 0 };
    const kept = before[from[k]]?.role === "indoor" ? moved.get(u.system) : undefined;
    return { ...u, system: kept ?? (above || first) };
  });
}

/** The rows after the row at `i` is taken out. */
export function removeUnit(units: readonly UnitLine[], i: number): UnitLine[] {
  const keep = units.map((_, j) => j).filter((j) => j !== i);
  return rewire(units, keep.map((j) => units[j]), keep);
}

/** The rows after the row at `i` becomes another kind of unit. */
export function setUnitRole(units: readonly UnitLine[], i: number, role: UnitRole): UnitLine[] {
  const after = units.map((u, j) => (j === i ? { ...u, role, lps: null } : u));
  return rewire(units, after, units.map((_, j) => j));
}

/** An accepted index list after option `removed` is taken out. */
export function acceptedAfterRemoving(accepted: readonly number[], removed: number): number[] {
  return accepted.filter((i) => i !== removed).map((i) => (i > removed ? i - 1 : i));
}

/** One unit, as the card and the proposal say it: what it is after where. */
export function unitWords(u: UnitLine): string {
  const what = [u.capacity, u.type, u.model].filter(Boolean).join(", ");
  const airflow = u.role === "fan" && u.lps !== null ? `${u.lps} L/s` : "";
  const count = u.qty > 1 ? `${u.qty} x ` : "";
  return count + [what, airflow].filter(Boolean).join(", ");
}

/** Where a unit is, as a heading for its row. */
export function unitPlace(u: UnitLine): string {
  if (u.role === "outdoor") return u.room ? `Outdoor unit ${u.system}, ${u.room.charAt(0).toLowerCase()}${u.room.slice(1)}` : `Outdoor unit ${u.system}`;
  return u.room || (u.role === "fan" ? "Fan" : "Indoor unit");
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
