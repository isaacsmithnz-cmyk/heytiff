import { LINE_UNITS, MAX_OPTIONS, type LineKind, type LineSource, type LineUnit } from "../lines";
import { OLD_PIPES, PIPE_SIZES } from "../kits";
import { rollMetresOf } from "../components";
import type { Product } from "../families";
import type { Offer } from "../price-book";
import { supplierOffer } from "../lookups";
import { DEFAULT_CLIMATE_ZONE, ORIENTATIONS, roomHeatLoadKw } from "@/lib/studio/loads";
import { OUTLET_KINDS, type AirflowAsk, type OutletKind } from "@/lib/guides/airflow";
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
  /** a price the person gave, each, ex GST, cents: only on a said line */
  sellCents?: number | null;
  /** ductwork, grilles and the return: what the duct contingency covers */
  duct?: boolean;
};

export type LinePatch = { qty?: number; unit?: LineUnit; code?: string; name?: string; system?: string; group?: string; source: NewLine["source"]; why: string; sellCents?: number };

/** A price the person gave, held to a line's: only when the line says it's theirs. */
const saidPrice = (r: Record<string, unknown>, source: unknown) => {
  const c = num(r.sell_each_cents);
  return source === "said" && c != null && c > 0 && c < 100_000_000 ? Math.round(c) : null;
};

/** What a tapped answer does to the quote (applied by slice 6.1). */
export type AnswerChange =
  | { op: "qty"; lineId: string; qty: number }
  | { op: "swap"; lineId: string; code: string }
  | { op: "remove"; lineId: string }
  | { op: "add"; line: NewLine };

/** An answer's `goOn`: picking it leaves her work to do — a price to look
    up, a part to rebuild — so tapping it starts her turn (Isaac's production
    test, 2026-10-12: "Research them on the web" sat until he typed). */
export type Question = { question: string; why: string; topic?: string; put?: string; answers: { label: string; changes: AnswerChange[]; goOn?: true }[] };

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
  const sellCents = kind === "labour" ? null : saidPrice(r, source);
  return { optionIndex: option(r.option), system: str(r.system, 60), group, name, code, kind, qty: qty != null && qty >= 0 ? Math.min(100_000, qty) : 0, unit, source, why, ...(sellCents ? { sellCents } : {}), ...(r.duct === true ? { duct: true } : {}) };
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
  const sell = saidPrice(r, source);
  if (sell) patch.sellCents = sell;
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
      if (!label) return null;
      const changes = (Array.isArray(o.changes) ? o.changes : []).slice(0, 10).map(changeOf).filter((c): c is AnswerChange => c != null);
      /* as she asks it, or as it's kept in the thread */
      return o.go_on === true || o.goOn === true ? { label, changes, goOn: true as const } : { label, changes };
    })
    .filter((a): a is Question["answers"][number] => a != null);
  return { question, why: str(r.why, 300), topic: str(r.topic, 80), put: str(r.put, 80), answers };
}

/* ── the definitions she's handed ── */

const lineFields = {
  option: { type: "integer", description: "The option it's on, counted from 0: what a person calls option 1 is 0, option 2 is 1." },
  system: { type: "string", description: "The system it's part of, as the quote names it: \"Downstairs\", \"Living\". Empty for labour and anything shared." },
  group: { type: "string", description: "Its group: Units, Ductwork and grilles, Pipe, power and controls, Mounting and drain, Labour, or one the job needs." },
  name: { type: "string", description: "What it is. A book item goes on under the book's own name; a unit by what it is, \"Indoor unit\", \"Outdoor unit\", a head \"Indoor unit, Study\"." },
  code: { type: "string", description: "The book item's code, exactly as search_book gave it. Leave out for an allowance nobody has priced yet." },
  kind: { type: "string", enum: [...KINDS] },
  qty: { type: "number", description: "How many; metres for a length; hours for labour." },
  unit: { type: "string", enum: [...LINE_UNITS], description: "\"m\" for a length, \"h\" for hours, \"\" for a count." },
  source: { type: "string", enum: [...SOURCES], description: "said: the brief or the person said it. assumed: your judgement. unknown: not known yet. fitted: made to fit something else on the quote." },
  why: { type: "string", description: "said: the words, quoted. assumed: the reason. unknown: what's needed to know it. fitted: what it was made to fit." },
  sell_each_cents: { type: "integer", description: "A price the person gave you for one of it, ex GST, in cents: only with source said and their words in why. Never a price of your own." },
  duct: { type: "boolean", description: "True for ductwork, grilles and the return: what the duct contingency covers." },
};

export const SESSION_TOOLS: ToolDef[] = [
  {
    name: "read_quote",
    description:
      "The quote as it stands: every option's lines (with each line's id and version, needed to change it), each option's total ex GST and what's still to price. A long quote comes back narrowed, saying so: one option's lines (the others' totals and what's still to price stay, with lines_not_shown), shortened whys, or a page of lines (read_more_from). Read the rest by option and from.",
    input_schema: {
      type: "object",
      properties: {
        option: { type: "integer", description: "One option's lines, by its number (0 is the first); every option's total still comes back" },
        from: { type: "integer", description: "Where a long option's lines carry on from, as the last read said (read_more_from)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_book",
    description:
      "Search the business's own price book: the items it buys, its preferred first, then what's on most of its quotes, then the cheapest. Names are the suppliers' own and often abbreviated (\"TRUNK CAP 2.4M SHALE GREY\", \"DAI WIRED 7 DAY PROG CONTROL\"), so search one or two key words or a code, not a description; when nothing has every word, the items with most of them come back. A size in mm narrows to items that come in it. Only items found here can go on the quote.",
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
  /* 3209, 17 October: a whole 10 kg cylinder on a PUMY-SP112 the book puts at about 4 kg */
  {
    name: "refrigerant_charge",
    description:
      "The refrigerant a system takes on top of its outdoor's own, by its maker's book: a split pair's rule on the run, a multi's rule, a VRF's by the liquid pipe of each size, the run to the farthest head and the heads it carries. Gives the kg to add, the outdoor's own charge and the most it may hold. Says when the book needs a length it hasn't been given.",
    input_schema: {
      type: "object",
      properties: {
        brand: { type: "string", description: "The maker's data pack, e.g. mitsubishi-electric" },
        outdoor: { type: "string", description: "The outdoor's model" },
        indoors: { type: "array", items: { type: "string" }, description: "Every indoor on it, one entry a head" },
        liquid_pipe: {
          type: "array",
          description: "The liquid pipe by size: metres of each, across the whole system",
          items: { type: "object", properties: { size_mm: { type: "number", description: "The liquid pipe's size, mm: 6.35, 9.52, 12.7…" }, metres: { type: "number" } }, required: ["size_mm", "metres"], additionalProperties: false },
        },
        farthest_m: { type: "number", description: "VRF: the run from the outdoor to the farthest head, metres" },
        method: { type: "string", enum: ["joint", "branch-box"], description: "VRF: how the heads connect; joints unless said" },
      },
      required: ["brand", "outdoor", "indoors", "liquid_pipe"],
      additionalProperties: false,
    },
  },
  /* the bench, 15 October: a VRF ducted head went on a multi outdoor, "pairing not checked" */
  {
    name: "pairing_check",
    description:
      "Whether an outdoor takes its indoors, by its maker's book: a split's pair from the pair table (and the pair's rated capacity), a multi's set by its combination rules, a VRF's by its own. Says why not in the book's words, and for a split what the outdoor does pair with. Check every system's units before they go on.",
    input_schema: {
      type: "object",
      properties: {
        brand: { type: "string", description: "The maker's data pack, e.g. mitsubishi-electric" },
        outdoor: { type: "string", description: "The outdoor's model" },
        indoors: { type: "array", items: { type: "string" }, description: "Every indoor on that outdoor, one entry a head (a model twice for two of it)" },
      },
      required: ["brand", "outdoor", "indoors"],
      additionalProperties: false,
    },
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
    description: `Add up to ${MAX_ADD} lines. A line with a code is priced from the book; a code the book hasn't got is refused. A unit is named by what it is, \"Indoor unit\" or \"Outdoor unit\", a multi's or VRF's head by the room it serves, \"Indoor unit, Study\"; its model is its code. Labour is hours (unit h, no code), named by its stage and crew: \"Rough-in: 2 people\".`,
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
      "Add the parts a split or ducted system takes to install, each picked from the book: pipe, interconnect, power, breaker, isolator, mount, drain, trunking; for ducted the supply plenum made for the indoor's face and a return plenum where its return has one, the Ys and reducers of the layout, the flex, outlets, and the return grille and box at their size. Name the outdoor and its pipe and current are read off its pack; name the indoor and its faces are. A fact left out leaves its part on the quote as not known yet. Every duct size (takeoffs, fittings, reducers, outlet_mm) is the brief's, a plan's or the person's; where none gives one, the airflow guide's (airflow_check), as assumed, never the business's usual. Change any part after, saying why.",
    input_schema: {
      type: "object",
      properties: {
        kit: { type: "string", enum: ["split", "ducted"] },
        option: lineFields.option,
        system: lineFields.system,
        brand: { type: "string", description: "The outdoor's data pack, e.g. mitsubishi-electric" },
        model: { type: "string", description: "The outdoor's model" },
        indoor_model: { type: "string", description: "Ducted: the indoor's model, from the same pack: its plenums are made for its faces" },
        takeoffs: { type: "array", items: { type: "number" }, description: "Ducted: the spigots the ductwork takes off the supply plenum, mm, as the brief, a plan or the person gives them: [400, 400]. Where none gives them, the airflow guide's size for the air they carry" },
        fittings: {
          type: "array",
          description: "Ducted: where the main duct splits, each Y's size in and outs, mm, and how many",
          items: { type: "object", properties: { in_mm: { type: "number" }, outs_mm: { type: "array", items: { type: "number" } }, count: { type: "integer" } }, required: ["in_mm", "outs_mm"], additionalProperties: false },
        },
        reducers: {
          type: "array",
          description: "Ducted: where the main duct steps down, mm, and how many",
          items: { type: "object", properties: { from_mm: { type: "number" }, to_mm: { type: "number" }, count: { type: "integer" } }, required: ["from_mm", "to_mm"], additionalProperties: false },
        },
        return_grille: { type: "object", description: "Ducted: the return grille's face, mm; its box is the same face", properties: { w_mm: { type: "number" }, h_mm: { type: "number" } }, required: ["w_mm", "h_mm"], additionalProperties: false },
        pipe: { type: "string", enum: [...PIPE_SIZES] },
        pipe_m: { type: "number" },
        power_m: { type: "number" },
        amps: { type: "number" },
        mount: { type: "string", enum: ["ground", "wall"] },
        trunking_m: { type: "number" },
        drain_m: { type: "number" },
        outlets: { type: "integer" },
        outlet_mm: { type: "number", description: "Ducted: the outlets' size, mm, as the brief, a plan or the person gives it. Where none gives it, the airflow guide's for the air each carries, never the business's usual" },
        replacing: { type: "string", enum: ["no", "yes", "keep"], description: "An old system comes out; keep: and its pipe is kept" },
        underfloor: { type: "boolean", description: "Ducted: the indoor goes under the floor, its outlets floor grilles on boots" },
        kept_pipe: { type: "string", enum: [...OLD_PIPES] },
        zones: { type: "integer", description: "Ducted, zoned: how many zones. The kit takes the maker's zone system from its data: its interface, its own controller in place of the unit's, a sensor in every zone" },
        zone_control: { type: "string", enum: ["temperature", "on_off"], description: "Ducted, zoned: by temperature (linear, a sensor a zone) or on and off" },
        wifi: { type: "boolean", description: "WiFi asked for: the zone system's own" },
      },
      required: ["kit", "option", "system"],
      additionalProperties: false,
    },
  },
  /* Isaac, 2026-10-15: "build a section in the data pack that recommended
     airflow numbers go through. So she has something to compare it with" */
  {
    name: "airflow_check",
    description:
      "Check a ducted system's air against HeyTiff's ducted airflow guide, the median of what makers, codes and industry bodies publish: each outlet and the flex feeding it, the runs off the plenum, the return grille and duct, whether the zones that can be left running carry the unit's least airflow, and whether the index run fits in the unit's static. Give the unit's airflow and rated static from unit_specs, and the outlets, their sizes and zones as the brief, a plan or the person gives them. Each check comes back with the guide's figure and the reason: a recommendation, never a size to settle without saying so.",
    input_schema: {
      type: "object",
      properties: {
        unit: {
          type: "object",
          properties: {
            airflow_ls: { type: "number", description: "Its rated airflow, L/s, from unit_specs." },
            static_pa: { type: "number", description: "The external static it's rated for, Pa, from unit_specs." },
            low_airflow_ls: { type: "number", description: "Its own low-fan airflow, L/s, only where its data gives it." },
            capacity_kw: { type: "number" },
          },
          required: ["airflow_ls"],
          additionalProperties: false,
        },
        outlets: {
          type: "array",
          maxItems: 40,
          items: {
            type: "object",
            properties: {
              count: { type: "integer" },
              kind: { type: "string", enum: [...OUTLET_KINDS] },
              size: { type: "string", description: "As the maker names it: \"250\" for a round diffuser's neck, \"300x300\", \"round neck 250\" for a square face on a round spigot, \"300x100\" for a floor grille, \"2-slot\" for a linear slot." },
              zone: { type: "string", description: "The zone it's in, as zones names it." },
              room: { type: "string" },
              ls_each: { type: "number", description: "Its airflow, L/s, where the design gives one; otherwise the unit's is shared evenly." },
              duct_mm: { type: "number", description: "The flex run feeding it, mm, as given. A round neck's own size when left out." },
              length_m: { type: "number", description: "A linear slot's length." },
              slots: { type: "integer", description: "A linear slot's slots." },
            },
            required: ["count", "kind", "size"],
            additionalProperties: false,
          },
        },
        takeoffs: {
          type: "array",
          description: "The runs off the supply plenum, as given.",
          items: { type: "object", properties: { count: { type: "integer" }, dia_mm: { type: "number" }, ls_each: { type: "number" }, rigid: { type: "boolean" } }, required: ["count", "dia_mm"], additionalProperties: false },
        },
        zones: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, stays_open: { type: "boolean", description: "A common, constant or spill zone: open whenever the unit runs." } },
            required: ["name"],
            additionalProperties: false,
          },
        },
        return: {
          type: "object",
          properties: {
            filtered: { type: "boolean" },
            pleated: { type: "boolean", description: "A deep pleated or high-MERV filter." },
            w_mm: { type: "number" },
            h_mm: { type: "number" },
            count: { type: "integer", description: "How many return grilles share the airflow." },
            duct_mm: { type: "number", description: "The return duct's diameter, mm: the unit's return spigots where nothing else gives it." },
            ducts: { type: "integer" },
          },
          required: ["filtered"],
          additionalProperties: false,
        },
        run: {
          type: "object",
          description: "The index run, the longest from the unit to an outlet, as given.",
          properties: { rigid_m: { type: "number" }, flex_m: { type: "number" }, flex_mm: { type: "number" }, flex_ls: { type: "number" }, bends: { type: "integer" }, balancing_damper: { type: "boolean" } },
          additionalProperties: false,
        },
      },
      required: ["unit", "outlets"],
      additionalProperties: false,
    },
  },
  {
    name: "compare_with",
    description: "Add a unit from the book to the compare on a unit line, when the person asked to compare it with something: the indoor's code as search_book gave it; its outdoor is paired from the book.",
    input_schema: { type: "object", properties: { line_id: { type: "string" }, code: { type: "string" } }, required: ["line_id", "code"], additionalProperties: false },
  },
  {
    name: "job_files",
    description: "The job's photos and documents you can look at, newest first: their ids, names, whether a photo or a document, and when.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "look_at",
    description:
      "Look at one of the job's photos or PDFs by its id from job_files: a floor plan for its rooms and their sizes, a switchboard for its phase and whether it has room for a circuit, a site photo for access. Say what you read, and ask to confirm what the quote rests on.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "your_corrections",
    description:
      "What people changed on the lines you wrote on this business's past quotes, newest first: on this kind of job, unless every_kind. Read it before you build, and don't make the same mistake twice.",
    input_schema: { type: "object", properties: { every_kind: { type: "boolean" } }, additionalProperties: false },
  },
  {
    name: "name_option",
    description: "Name an option as the proposal heads it and ServiceM8 gets it: short, what it is, \"Ducted upstairs, Cora 7.1 kW downstairs\".",
    input_schema: { type: "object", properties: { option: lineFields.option, name: { type: "string" } }, required: ["option", "name"], additionalProperties: false },
  },
  {
    name: "build_labour",
    description:
      "Work out an option's labour task by task: the visits the job takes (rough-in, install, fit-off, commissioning, a return trip), the people on each, and every task in each visit with the person-hours an experienced crew takes for it in this job's conditions. Each visit becomes one labour line, named for its crew and days, with its tasks on it for the person to see and change. It replaces the labour worked out before on that option: a task whose hours a person changed keeps their hours, and a task they added stays; a person's own labour line stays.",
    input_schema: {
      type: "object",
      properties: {
        option: lineFields.option,
        visits: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            properties: {
              stage: { type: "string", description: "\"Install\", \"Rough-in\", \"Fit-off and commissioning\", \"Return: grilles\"." },
              people: { type: "integer" },
              tasks: {
                type: "array",
                items: {
                  type: "object",
                  properties: { task: { type: "string" }, hours: { type: "number", description: "Person-hours: two people for 3 hours is 6." } },
                  required: ["task", "hours"],
                  additionalProperties: false,
                },
              },
            },
            required: ["stage", "people", "tasks"],
            additionalProperties: false,
          },
        },
      },
      required: ["option", "visits"],
      additionalProperties: false,
    },
  },
  {
    name: "research_price",
    description:
      "Find a price on the web for a line the business's book hasn't got (a core hole, a crane, a brand they don't stock), when the person asks for it or agrees. One price, where it's from, and a short summary come back; the person presses Use it to put it on the line. Don't change the line's price yourself. Each research costs money: only when it's asked for.",
    input_schema: { type: "object", properties: { line_id: { type: "string" }, what: { type: "string", description: "What to price, in a few words: \"200 mm core hole through sandstone, Sydney\"." } }, required: ["line_id", "what"], additionalProperties: false },
  },
  {
    name: "write_up",
    description:
      "Write the job out, the way an estimator does on paper before pricing: what you read (the brief, the notes, the plans, each in a line), the sizing (each system's load and the unit it takes, and why), the work (system by system, what goes in and where), the visits (each stage, its crew and days), what you can't price yet, and what you're assuming. Short lines, plain words. The person sees it at the top of your panel, and you build every line from it. Write it again, whole, when the job changes.",
    input_schema: {
      type: "object",
      properties: {
        read: { type: "array", items: { type: "string" } },
        sizing: { type: "array", items: { type: "string" } },
        work: { type: "array", items: { type: "string" } },
        visits: { type: "array", items: { type: "string" } },
        unpriced: { type: "array", items: { type: "string" } },
        assuming: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
  },
  {
    name: "plan_parts",
    description:
      "Before you build, say the parts of the quote you'll build, in order: each a system and a group, as the lines will carry them (\"Downstairs\" + \"Units\", \"Downstairs\" + \"Ductwork and grilles\", \"\" + \"Labour\"), with a few words on what it is. The page shows them as you work. Plan again if the plan changes.",
    input_schema: {
      type: "object",
      properties: {
        option: lineFields.option,
        parts: {
          type: "array",
          maxItems: 20,
          items: { type: "object", properties: { system: { type: "string" }, group: { type: "string" }, detail: { type: "string" } }, required: ["group"], additionalProperties: false },
        },
      },
      required: ["parts"],
      additionalProperties: false,
    },
  },
  {
    name: "write_proposal",
    description:
      "Write the proposal's words, the way the client reads them: the title and an introduction of two or three sentences, and for an option its summary (what it is and why, in plain words), the work by area and what's included. What isn't included and how the client chooses (one option, or any they tick) are the whole proposal's. Give only what you're writing; the rest stays. Never a price or a figure: those come from the lines. Plainly and with confidence, as the business puts it to its client: no hedge or working (about, approximately, assumed, an allowance per item, a count not settled), a choice still open as \"Floor grille style to be confirmed with you\", and never the business's own notes. A person approves it before it goes.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        intro: { type: "string" },
        option: lineFields.option,
        summary: { type: "string" },
        work: {
          type: "array",
          items: { type: "object", properties: { area: { type: "string" }, items: { type: "array", items: { type: "string" } } }, required: ["items"], additionalProperties: false },
        },
        included: { type: "array", items: { type: "string" } },
        not_included: { type: "array", items: { type: "string" } },
        choice: { type: "string", enum: ["one", "any"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "copy_option",
    description: "Start an option as a copy of another's lines, to change from there.",
    input_schema: { type: "object", properties: { from: { type: "integer" }, to: { type: "integer" } }, required: ["from", "to"], additionalProperties: false },
  },
  {
    name: "ask",
    description:
      "Ask the business one thing you can't know and the quote needs: one question, in plain words. Up to five short answers to tap where the answer is one of a few, each carrying the line changes it makes; none for a number they'll type (a length, a distance). Mark go_on on an answer that leaves you work to do once it's picked (look a price up, rebuild a part): tapping it starts you again. Ask only what changes the price or the work.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "One thing, asked as a person would: \"How long is the pipe run, indoor to outdoor?\"" },
        why: { type: "string", description: "What it changes on the quote." },
        topic: { type: "string", description: "A few words for what's asked, as the list shows it once answered: \"Pipe run, indoor to outdoor\"." },
        put: { type: "string", description: "What the quote has for it now, in a few words: \"10 m\". Leave out when nothing's on it yet." },
        answers: {
          type: "array",
          maxItems: MAX_ANSWERS,
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              go_on: { type: "boolean", description: "True when picking it leaves you work to do before the quote is right (\"Research it on the web\", \"Rebuild it as the slimline\"); false when its changes make the quote right, or nothing changes." },
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
            required: ["label", "go_on"],
            additionalProperties: false,
          },
        },
      },
      required: ["question", "answers"],
      additionalProperties: false,
    },
  },
  {
    name: "settle",
    description:
      "Tick off your open questions that the person's own words answered, once you've changed the lines to match: each by its number from the open list you were given, with the answer in a few words (\"14 m\").",
    input_schema: {
      type: "object",
      properties: {
        settled: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            properties: { question: { type: "integer" }, answer: { type: "string" } },
            required: ["question", "answer"],
            additionalProperties: false,
          },
        },
      },
      required: ["settled"],
      additionalProperties: false,
    },
  },
];

/** The words the thread shows for a tool as she uses it. */
export const TOOL_LABELS: Record<string, string> = {
  read_quote: "Read the quote",
  search_book: "Searched your book",
  unit_specs: "Read the data pack",
  pairing_check: "Checked the pairing",
  refrigerant_charge: "Worked out the refrigerant",
  room_load: "Sized the rooms",
  add_lines: "Added lines",
  change_line: "Changed a line",
  remove_line: "Took a line off",
  add_kit: "Added a kit",
  copy_option: "Copied an option",
  name_option: "Named an option",
  write_proposal: "Wrote the proposal",
  plan_parts: "Planned the quote",
  write_up: "Wrote the job out",
  research_price: "Researched a price",
  build_labour: "Worked out the labour",
  your_corrections: "Read her corrections",
  job_files: "Listed the job's files",
  look_at: "Looked at",
  compare_with: "Added to the compare",
  airflow_check: "Checked the air",
  ask: "Asked",
  settle: "Ticked off",
};

/** A kit call's facts, in the form the kit form sends them. */
export function kitAskOf(raw: unknown): {
  kit: "split" | "ducted";
  at: { optionIndex: number; system: string };
  unit: { brand: string; model: string } | null;
  indoor: { brand: string; model: string } | null;
  facts: Record<string, unknown>;
} {
  const r = obj(raw);
  const brand = str(r.brand, 60);
  const model = str(r.model, 60);
  const indoorModel = str(r.indoor_model, 60);
  const list = (v: unknown) => (Array.isArray(v) ? v.map(obj) : undefined);
  const grille = obj(r.return_grille);
  return {
    kit: r.kit === "ducted" ? "ducted" : "split",
    at: { optionIndex: option(r.option), system: str(r.system, 60) },
    unit: brand && model ? { brand, model } : null,
    indoor: brand && indoorModel ? { brand, model: indoorModel } : null,
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
      underfloor: r.underfloor === true,
      takeoffs: r.takeoffs,
      fittings: list(r.fittings)?.map((x) => ({ inMm: x.in_mm, outsMm: x.outs_mm, count: x.count })),
      reducers: list(r.reducers)?.map((x) => ({ fromMm: x.from_mm, toMm: x.to_mm, count: x.count })),
      returnGrille: grille.w_mm != null ? { w: grille.w_mm, h: grille.h_mm } : undefined,
      zones: r.zones,
      zoneControl: r.zone_control,
      wifi: r.wifi === true,
    },
  };
}

/** An airflow check's facts, made safe: a figure that isn't a sensible
    number is left out, never guessed (lib/guides/airflow.ts says what's
    needed for each check). */
export function airflowAskOf(raw: unknown): AirflowAsk | Err {
  const r = obj(raw);
  const u = obj(r.unit);
  const pos = (v: unknown, max: number) => {
    const n = num(v);
    return n != null && n > 0 && n <= max ? n : null;
  };
  const count = (v: unknown) => Math.max(1, Math.min(100, Math.round(num(v) ?? 1)));
  const airflow = pos(u.airflow_ls, 20_000);
  if (airflow == null) return { error: "Give the unit's airflow in L/s, from unit_specs." };
  const outlets = (Array.isArray(r.outlets) ? r.outlets : []).slice(0, 40).flatMap((x) => {
    const o = obj(x);
    const kind = (OUTLET_KINDS as readonly unknown[]).includes(o.kind) ? (o.kind as OutletKind) : null;
    const size = str(o.size, 40);
    if (!kind || !size) return [];
    return [{ count: count(o.count), kind, size, zone: str(o.zone, 60), room: str(o.room, 60), ls_each: pos(o.ls_each, 5_000), duct_mm: pos(o.duct_mm, 1_000), length_m: pos(o.length_m, 50), slots: pos(o.slots, 12) }];
  });
  if (outlets.length === 0) return { error: "Give the outlets: how many, their kind and size, as the brief, a plan or the person gives them." };
  const takeoffs = (Array.isArray(r.takeoffs) ? r.takeoffs : []).slice(0, 20).flatMap((x) => {
    const t = obj(x);
    const dia = pos(t.dia_mm, 1_500);
    return dia == null ? [] : [{ count: count(t.count), dia_mm: dia, ls_each: pos(t.ls_each, 10_000), rigid: t.rigid === true }];
  });
  const zones = (Array.isArray(r.zones) ? r.zones : []).slice(0, 20).flatMap((x) => {
    const z = obj(x);
    const name = str(z.name, 60);
    return name ? [{ name, stays_open: z.stays_open === true }] : [];
  });
  const back = r.return && typeof r.return === "object" ? obj(r.return) : null;
  const run = r.run && typeof r.run === "object" ? obj(r.run) : null;
  return {
    unit: { airflow_ls: airflow, static_pa: pos(u.static_pa, 2_000), low_airflow_ls: pos(u.low_airflow_ls, airflow), capacity_kw: pos(u.capacity_kw, 200) },
    outlets,
    takeoffs,
    zones,
    ret: back ? { filtered: back.filtered !== false, pleated: back.pleated === true, w_mm: pos(back.w_mm, 3_000), h_mm: pos(back.h_mm, 3_000), count: pos(back.count, 10), duct_mm: pos(back.duct_mm, 1_500), ducts: pos(back.ducts, 10) } : null,
    run: run ? { rigid_m: pos(run.rigid_m, 200), flex_m: pos(run.flex_m, 50), flex_mm: pos(run.flex_mm, 1_000), flex_ls: pos(run.flex_ls, 5_000), bends: pos(run.bends, 20), balancing: run.balancing_damper === true } : null,
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
): { name: string; code: string; supplierKey: string; costCents: number; kind: "unit" | "material"; brand: string | null } | null {
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
    /* its maker, for a unit's pack (unit-name.ts) */
    brand: p.brand ?? null,
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
