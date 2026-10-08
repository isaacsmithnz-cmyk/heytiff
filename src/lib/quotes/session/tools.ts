import { LINE_UNITS, MAX_OPTIONS, type LineKind, type LineSource, type LineUnit } from "../lines";
import { OLD_PIPES, PIPE_SIZES } from "../kits";
import { rollMetresOf } from "../components";
import type { Product } from "../families";
import type { Offer } from "../price-book";
import { supplierOffer } from "../lookups";
import { DEFAULT_CLIMATE_ZONE, ORIENTATIONS, roomHeatLoadKw } from "@/lib/studio/loads";
import type { ToolDef } from "./model";

/* TIFF'S HANDS ON A QUOTE (slice 4.2) — the quote by hand's own actions as
   her tools, and the lookups: she reads the quote, searches the business's
   book, reads a unit off its maker's data pack, adds and changes lines, adds
   a kit, copies an option and asks what she can't know.

   THE SAME CHECKS AS A PERSON'S EDIT. Every change goes through
   lines-server.ts, so it's versioned, kept in the line's history with "Tiff"
   as who made it, and can be undone.

   SHE NEVER SETS A PRICE. A line with a code is priced from the business's
   book, and a code the book hasn't got is refused; a line with no code is
   one nobody knows the price of yet. Labour is hours at the business's own
   hour. What a line sells for is the business's markup, or a person's.

   EVERY LINE SAYS WHERE IT CAME FROM: said (the words, quoted), assumed
   (the reason), unknown (what's needed), fitted (made to fit, and to what).
   Pure: the definitions, and each call's input made safe. */

export type NewLine = {
  optionIndex: number;
  system: string;
  group: string;
  name: string;
  code: string | null;
  kind: LineKind;
  qty: number;
  unit: LineUnit;
  source: Exclude<LineSource, "by_hand">;
  why: string;
};

export type LinePatch = { qty?: number; unit?: LineUnit; code?: string; name?: string; system?: string; group?: string; source: NewLine["source"]; why: string };

/** What a tapped answer does to the quote (applied by slice 6.1). */
export type AnswerChange =
  | { op: "qty"; lineId: string; qty: number }
  | { op: "swap"; lineId: string; code: string }
  | { op: "remove"; lineId: string }
  | { op: "add"; line: NewLine };

export type Question = { question: string; why: string; answers: { label: string; changes: AnswerChange[] }[] };

const SOURCES = ["said", "assumed", "unknown", "fitted"] as const;
const KINDS = ["unit", "material", "labour"] as const;
export const MAX_ADD = 40;
const MAX_ANSWERS = 5;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const option = (v: unknown) => {
  const n = num(v);
  return n == null ? 0 : Math.max(0, Math.min(MAX_OPTIONS - 1, Math.round(n)));
};

type Err = { error: string };
const isErr = (v: unknown): v is Err => !!v && typeof v === "object" && "error" in v;
export { isErr };

/** One new line as she gave it, made safe, or why it can't be one. */
export function newLineOf(raw: unknown): NewLine | Err {
  const r = obj(raw);
  const name = str(r.name, 200);
  const group = str(r.group, 60);
  if (!name) return { error: "A line needs a name." };
  if (!group) return { error: `${name}: a line needs a group (Units, Materials, Labour…).` };
  const kind = (KINDS as readonly unknown[]).includes(r.kind) ? (r.kind as LineKind) : "material";
  const source = (SOURCES as readonly unknown[]).includes(r.source) ? (r.source as NewLine["source"]) : null;
  if (!source) return { error: `${name}: say where it came from: said, assumed, unknown or fitted.` };
  const why = str(r.why, 400);
  if (source !== "unknown" && !why) return { error: `${name}: ${source === "said" ? "quote the words it came from" : "say why"} in why.` };
  const qty = num(r.qty);
  const code = kind === "labour" ? null : str(r.code, 80) || null;
  const unit = kind === "labour" ? "h" : (LINE_UNITS as readonly unknown[]).includes(r.unit) ? (r.unit as LineUnit) : "";
  return { optionIndex: option(r.option), system: str(r.system, 60), group, name, code, kind, qty: qty != null && qty >= 0 ? Math.min(100_000, qty) : 0, unit, source, why };
}

export function patchOf(raw: unknown): { id: string; version: number; patch: LinePatch } | Err {
  const r = obj(raw);
  const id = str(r.id, 60);
  const version = num(r.version);
  if (!id || version == null) return { error: "Name the line by its id and the version you read." };
  const source = (SOURCES as readonly unknown[]).includes(r.source) ? (r.source as NewLine["source"]) : null;
  if (!source) return { error: "Say where the change came from: said, assumed, unknown or fitted." };
  const why = str(r.why, 400);
  if (!why) return { error: "Say why in why." };
  const patch: LinePatch = { source, why };
  const qty = num(r.qty);
  if (qty != null) patch.qty = Math.max(0, Math.min(100_000, qty));
  if ((LINE_UNITS as readonly unknown[]).includes(r.unit)) patch.unit = r.unit as LineUnit;
  for (const k of ["code", "name", "system", "group"] as const) {
    const v = str(r[k], k === "name" ? 200 : k === "code" ? 80 : 60);
    if (v) patch[k] = v;
  }
  return { id, version: Math.round(version), patch };
}

function changeOf(raw: unknown): AnswerChange | null {
  const r = obj(raw);
  const lineId = str(r.line_id ?? r.lineId, 60);
  if (r.op === "qty") {
    const qty = num(r.qty);
    return lineId && qty != null && qty >= 0 ? { op: "qty", lineId, qty } : null;
  }
  if (r.op === "swap") {
    const code = str(r.code, 80);
    return lineId && code ? { op: "swap", lineId, code } : null;
  }
  if (r.op === "remove") return lineId ? { op: "remove", lineId } : null;
  if (r.op === "add") {
    const line = newLineOf(r.line);
    return isErr(line) ? null : { op: "add", line };
  }
  return null;
}

export function questionOf(raw: unknown): Question | Err {
  const r = obj(raw);
  const question = str(r.question, 300);
  if (!question) return { error: "Ask the question in question." };
  const answers = (Array.isArray(r.answers) ? r.answers : [])
    .slice(0, MAX_ANSWERS)
    .map((a) => {
      const o = obj(a);
      const label = str(o.label, 80);
      return label ? { label, changes: (Array.isArray(o.changes) ? o.changes : []).slice(0, 10).map(changeOf).filter((c): c is AnswerChange => c != null) } : null;
    })
    .filter((a): a is Question["answers"][number] => a != null);
  return { question, why: str(r.why, 300), answers };
}

/* ── the definitions she's handed ── */

const lineFields = {
  option: { type: "integer", description: "The option it's on, counted from 0." },
  system: { type: "string", description: "The system it's part of, as the quote names it: \"Downstairs\", \"Living\". Empty for labour and anything shared." },
  group: { type: "string", description: "Its group: Units, Ductwork and grilles, Pipe, power and controls, Mounting and drain, Labour, or one the job needs." },
  name: { type: "string", description: "What it is. For a book item, the book's own name." },
  code: { type: "string", description: "The book item's code, exactly as search_book gave it. Leave out for an allowance nobody has priced yet." },
  kind: { type: "string", enum: [...KINDS] },
  qty: { type: "number", description: "How many; metres for a length; hours for labour." },
  unit: { type: "string", enum: [...LINE_UNITS], description: "\"m\" for a length, \"h\" for hours, \"\" for a count." },
  source: { type: "string", enum: [...SOURCES], description: "said: the brief or the person said it. assumed: your judgement. unknown: not known yet. fitted: made to fit something else on the quote." },
  why: { type: "string", description: "said: the words, quoted. assumed: the reason. unknown: what's needed to know it. fitted: what it was made to fit." },
};

export const SESSION_TOOLS: ToolDef[] = [
  {
    name: "read_quote",
    description: "The quote as it stands: every option's lines (with each line's id and version, needed to change it), each option's total ex GST and what's still to price.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search_book",
    description:
      "Search the business's own price book: the items it buys, its preferred first, then what's on most of its quotes, then the cheapest. Words in the name or code; a size in mm narrows to items that come in it. Only items found here can go on the quote.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string" }, size_mm: { type: "number" }, brand: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "unit_specs",
    description:
      "A unit's specs from its maker's data pack: indoor or outdoor, capacity, size, weight, sound, phase, current and pipe. Says \"no data pack\" for a brand HeyTiff has none for: then its figures are assumed and marked not checked.",
    input_schema: { type: "object", properties: { brand: { type: "string", description: "e.g. mitsubishi-electric" }, model: { type: "string" } }, required: ["brand", "model"], additionalProperties: false },
  },
  {
    name: "room_load",
    description:
      "Each room's design load in kW by Studio's own load method, when the brief gives rooms but no capacity: the area, the climate zone (5 for Sydney, Perth, Adelaide; 6 Melbourne, Canberra; 2 Brisbane), and what's known of the room. A unit covers a room when its rating is short by less than 0.1 kW. Pick the unit from the book, then check it on its data pack.",
    input_schema: {
      type: "object",
      properties: {
        climate_zone: { type: "integer", minimum: 1, maximum: 8 },
        building_type: { type: "string", enum: ["residential", "light_commercial", "commercial"] },
        rooms: {
          type: "array",
          maxItems: 30,
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              area_m2: { type: "number" },
              glazing: { type: "string", enum: ["low", "moderate", "high"] },
              condition: { type: "string", enum: ["well_insulated", "standard", "poor"] },
              ceiling_height_m: { type: "number" },
              orientation: { type: "string", enum: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] },
              internal: { type: "boolean", description: "No external walls" },
              room_above: { type: "boolean", description: "Another floor above, not a roof" },
            },
            required: ["name", "area_m2"],
            additionalProperties: false,
          },
        },
      },
      required: ["rooms"],
      additionalProperties: false,
    },
  },
  {
    name: "add_lines",
    description: `Add up to ${MAX_ADD} lines. A line with a code is priced from the book; a code the book hasn't got is refused. Labour is hours (unit h, no code), named by its stage and crew: \"Rough-in: 2 people\".`,
    input_schema: {
      type: "object",
      properties: { lines: { type: "array", maxItems: MAX_ADD, items: { type: "object", properties: lineFields, required: ["option", "group", "name", "kind", "qty", "source", "why"], additionalProperties: false } } },
      required: ["lines"],
      additionalProperties: false,
    },
  },
  {
    name: "change_line",
    description: "Change one line: its qty, unit, item (a new code from the book), name, system or group. Name the line by its id and the version read_quote gave; a line changed since is refused, so read it again.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        version: { type: "integer" },
        qty: lineFields.qty,
        unit: lineFields.unit,
        code: lineFields.code,
        name: lineFields.name,
        system: lineFields.system,
        group: lineFields.group,
        source: lineFields.source,
        why: lineFields.why,
      },
      required: ["id", "version", "source", "why"],
      additionalProperties: false,
    },
  },
  {
    name: "remove_line",
    description: "Take one line off, by its id and version, saying why.",
    input_schema: { type: "object", properties: { id: { type: "string" }, version: { type: "integer" }, why: { type: "string" } }, required: ["id", "version", "why"], additionalProperties: false },
  },
  {
    name: "add_kit",
    description:
      "Add the parts a split or ducted system takes to install, each picked from the book: pipe, interconnect, power, breaker, isolator, mount, drain, trunking, and for ducted the flex, outlets and return. Name the outdoor and its pack and its pipe and current are read off it. A fact left out leaves its part on the quote as not known yet. Change any part after, saying why.",
    input_schema: {
      type: "object",
      properties: {
        kit: { type: "string", enum: ["split", "ducted"] },
        option: lineFields.option,
        system: lineFields.system,
        brand: { type: "string", description: "The outdoor's data pack, e.g. mitsubishi-electric" },
        model: { type: "string", description: "The outdoor's model" },
        pipe: { type: "string", enum: [...PIPE_SIZES] },
        pipe_m: { type: "number" },
        power_m: { type: "number" },
        amps: { type: "number" },
        mount: { type: "string", enum: ["ground", "wall"] },
        trunking_m: { type: "number" },
        drain_m: { type: "number" },
        outlets: { type: "integer" },
        outlet_mm: { type: "number" },
        replacing: { type: "string", enum: ["no", "yes", "keep"], description: "An old system comes out; keep: and its pipe is kept" },
        kept_pipe: { type: "string", enum: [...OLD_PIPES] },
      },
      required: ["kit", "option", "system"],
      additionalProperties: false,
    },
  },
  {
    name: "compare_with",
    description: "Add a unit from the book to the compare on a unit line, when the person asked to compare it with something: the indoor's code as search_book gave it; its outdoor is paired from the book.",
    input_schema: { type: "object", properties: { line_id: { type: "string" }, code: { type: "string" } }, required: ["line_id", "code"], additionalProperties: false },
  },
  {
    name: "name_option",
    description: "Name an option as the proposal heads it and ServiceM8 gets it: short, what it is, \"Ducted upstairs, Cora 7.1 kW downstairs\".",
    input_schema: { type: "object", properties: { option: lineFields.option, name: { type: "string" } }, required: ["option", "name"], additionalProperties: false },
  },
  {
    name: "copy_option",
    description: "Start an option as a copy of another's lines, to change from there.",
    input_schema: { type: "object", properties: { from: { type: "integer" }, to: { type: "integer" } }, required: ["from", "to"], additionalProperties: false },
  },
  {
    name: "ask",
    description:
      "Ask the business one thing you can't know and the quote needs: one question, with up to five short answers to tap, each carrying the line changes it makes. Ask only what changes the price or the work.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string" },
        why: { type: "string", description: "What it changes on the quote." },
        answers: {
          type: "array",
          maxItems: MAX_ANSWERS,
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              changes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    op: { type: "string", enum: ["qty", "swap", "remove", "add"] },
                    line_id: { type: "string" },
                    qty: { type: "number" },
                    code: { type: "string" },
                    line: { type: "object", properties: lineFields, additionalProperties: false },
                  },
                  required: ["op"],
                  additionalProperties: false,
                },
              },
            },
            required: ["label"],
            additionalProperties: false,
          },
        },
      },
      required: ["question", "answers"],
      additionalProperties: false,
    },
  },
];

/** The words the thread shows for a tool as she uses it. */
export const TOOL_LABELS: Record<string, string> = {
  read_quote: "Read the quote",
  search_book: "Searched your book",
  unit_specs: "Read the data pack",
  room_load: "Sized the rooms",
  add_lines: "Added lines",
  change_line: "Changed a line",
  remove_line: "Took a line off",
  add_kit: "Added a kit",
  copy_option: "Copied an option",
  name_option: "Named an option",
  compare_with: "Added to the compare",
  ask: "Asked",
};

/** A kit call's facts, in the form the kit form sends them. */
export function kitAskOf(raw: unknown): { kit: "split" | "ducted"; at: { optionIndex: number; system: string }; unit: { brand: string; model: string } | null; facts: Record<string, unknown> } {
  const r = obj(raw);
  const brand = str(r.brand, 60);
  const model = str(r.model, 60);
  return {
    kit: r.kit === "ducted" ? "ducted" : "split",
    at: { optionIndex: option(r.option), system: str(r.system, 60) },
    unit: brand && model ? { brand, model } : null,
    facts: {
      pipe: r.pipe,
      pipeM: r.pipe_m,
      powerM: r.power_m,
      amps: r.amps,
      mount: r.mount,
      trunkingM: r.trunking_m,
      drainM: r.drain_m,
      outlets: r.outlets,
      outletMm: r.outlet_mm,
      replacing: r.replacing === "yes" || r.replacing === "keep" ? r.replacing : "",
      keptPipe: r.kept_pipe,
    },
  };
}

/** A book item by its code, as a line buys it: the business's preferred
    offer of that code, else the lowest; by the metre when the line is a
    length and the item is sold by the roll. Null: not in the book. */
export function bookPrice(
  products: readonly Product[],
  code: string,
  unit: LineUnit,
  /** the job's supplier: its offer of the same item, where it sells it */
  supplier: string | null = null
): { name: string; code: string; supplierKey: string; costCents: number; kind: "unit" | "material" } | null {
  const want = code.trim().toUpperCase();
  if (supplier) {
    const p = products.find((x) => x.offers.some((o) => o.code.toUpperCase() === want));
    const o = p ? supplierOffer(p, supplier) : null;
    if (p && o) return priced(p, o, unit);
  }
  let best: { p: Product; o: Offer } | null = null;
  for (const p of products) {
    for (const o of p.offers) {
      if (o.code.toUpperCase() !== want || !(o.netCents > 0)) continue;
      const preferred = p.preferred && p.preferred.code === o.code && p.preferred.supplierKey === o.supplierKey;
      if (preferred) return priced(p, o, unit);
      if (!best || o.netCents < best.o.netCents) best = { p, o };
    }
  }
  return best ? priced(best.p, best.o, unit) : null;
}

function priced(p: Product, o: Offer, unit: LineUnit) {
  const roll = unit === "m" ? (rollMetresOf(o.name) ?? null) : null;
  return {
    name: p.name,
    code: o.code,
    supplierKey: o.supplierKey,
    costCents: roll && roll > 1 ? Math.round((o.netCents / roll) * 10) / 10 : o.netCents,
    kind: p.category === "units" ? ("unit" as const) : ("material" as const),
  };
}

/** Each room's load by Studio's load method (lib/studio/loads.ts), from what
    she gave; a room with no area is left out, saying so. */
export function roomLoads(raw: unknown): { rooms: { name: string; area_m2: number; load_kw: number }[]; total_kw: number; skipped: string[]; climate_zone: number } {
  const r = obj(raw);
  const zone = Math.max(1, Math.min(8, Math.round(num(r.climate_zone) ?? DEFAULT_CLIMATE_ZONE)));
  const type = (["residential", "light_commercial", "commercial"] as const).find((t) => t === r.building_type) ?? "residential";
  const out: { name: string; area_m2: number; load_kw: number }[] = [];
  const skipped: string[] = [];
  for (const raw2 of (Array.isArray(r.rooms) ? r.rooms : []).slice(0, 30)) {
    const o = obj(raw2);
    const name = str(o.name, 60) || "A room";
    const area = num(o.area_m2);
    if (area == null || area <= 0 || area > 2000) {
      skipped.push(`${name}: no area`);
      continue;
    }
    const load = roomHeatLoadKw({
      areaM2: area,
      climateZone: zone,
      buildingType: type,
      glazing: (["low", "moderate", "high"] as const).find((g) => g === o.glazing),
      condition: (["well_insulated", "standard", "poor"] as const).find((c) => c === o.condition),
      ceilingHeightM: num(o.ceiling_height_m) ?? undefined,
      orientation: ORIENTATIONS.find((d) => d === o.orientation),
      hasExternalWalls: o.internal === true ? false : true,
      roomAbove: o.room_above === true,
    });
    out.push({ name, area_m2: area, load_kw: load });
  }
  return { rooms: out, total_kw: Math.round(out.reduce((n, x) => n + x.load_kw, 0) * 1000) / 1000, skipped, climate_zone: zone };
}
