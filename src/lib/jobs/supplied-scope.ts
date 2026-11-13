/* THE SUPPLIED SCOPE (Isaac, 11 November 2026, on the builder's package mock
   https://claude.ai/artifact/6FP52g4ropVpfAqqzNLk2c: "the original scope
   read from the plans ... we can override that with our own design, but it
   will always be visible what the initial plans said they wanted", then
   "supplied scope and quoted scope ... side by side for comparisons").

   What the job was SUPPLIED with: the plans' drawings, a specification, the
   builder's or the client's emails. Written from those alone, never from
   our own notes, so it stays what they asked for while the quoted scope
   (job-scope.ts, the brief) moves with what we tell Tiff. A new issue of the
   plans, a spec or an email rewrites it; nothing else does.

   Pure: the server side is supplied-scope-server.ts. */

import type { ScopeQuestion } from "./job-scope";
import { plainWords, topicsOf } from "./take-in";

export type SuppliedSystem = { area: string; kind: string; text: string; from: string[] };
/** A line of the fine print, and where it came from ("Spec 0702, page 180"). */
export type FinePrint = { text: string; from: string };

export type SuppliedScope = {
  lede: string;
  systems: SuppliedSystem[];
  fine: FinePrint[];
  notOurs: string[];
  clarify: ScopeQuestion[];
};

/** What the supplied scope is written from: a plan's words, a spec's pages
    on the air, an email from outside. `id` and `at` make the stamp. */
export type SuppliedSource = { id: string; at: string; kind: "drawings" | "spec" | "email"; label: string; words: string };

const MAX = { lede: 400, text: 700, short: 120, line: 300, systems: 12, fine: 16, notOurs: 8, clarify: 10, from: 6 };
/** The most of the sources' words handed to Tiff. */
export const SOURCE_WORDS_MAX = 120_000;

export const SUPPLIED_SCHEMA = {
  type: "object",
  properties: {
    lede: { type: "string" },
    systems: {
      type: "array",
      items: {
        type: "object",
        properties: { area: { type: "string" }, kind: { type: "string" }, text: { type: "string" }, from: { type: "array", items: { type: "string" } } },
        required: ["area", "kind", "text", "from"],
        additionalProperties: false,
      },
    },
    fine: {
      type: "array",
      items: { type: "object", properties: { text: { type: "string" }, from: { type: "string" } }, required: ["text", "from"], additionalProperties: false },
    },
    notOurs: { type: "array", items: { type: "string" } },
    clarify: {
      type: "array",
      items: { type: "object", properties: { q: { type: "string" }, who: { type: "string" } }, required: ["q", "who"], additionalProperties: false },
    },
  },
  required: ["lede", "systems", "fine", "notOurs", "clarify"],
  additionalProperties: false,
} as const;

export const SUPPLIED_SYSTEM_PROMPT =
  "You read what a small Australian air conditioning and HVAC company was supplied for one " +
  "job: the architect's or builder's drawings, a specification, and emails from the builder " +
  "or the client. Write what THEY ask for, in plain Australian trade English, short sentences. " +
  "Never what the company has decided: that is kept elsewhere.\n\n" +
  "`lede`: one or two sentences: whose set it is, its issue and date, and what it asks for on " +
  "the air side.\n\n" +
  "`systems`: one per system the supplied papers ask for, area by area in the order of the " +
  "building: air conditioning, ventilation, exhaust, a subfloor or garage system. `area` is " +
  "where (\"Ground floor\", \"First floor\", \"Subfloor\", \"Ensuite and powder room\"); `kind` " +
  "the system in a few words (\"Ducted\", \"Ventilation\", \"Exhaust\"). `text` is three or " +
  "four plain sentences: the units by their model as the papers print them, the rooms, where " +
  "the outdoor units go, the grilles and any product the papers name, and who supplies what " +
  "when they say. `from` is where it came from, each a short label: a drawing by its page as " +
  "the words head it (\"Drawings, page 6\"), never a sheet number the words don't show; a " +
  "spec's clause and page (\"Spec 0702, page 185\"); or an email (\"JT Construct's email, " +
  "12 Nov\").\n\n" +
  "`fine`: the conditions the papers put on the work that change what's priced or how it's " +
  "done: design conditions, refrigerant limits, duct sizing and lengths, filters, noise, " +
  "commissioning, manuals and maintenance, samples to approve. Each one line with its `from`. " +
  "At most sixteen, the ones that cost money or time first. Skip what any installer does " +
  "anyway.\n\n" +
  "`notOurs`: only what the papers say is by others or stays as it is; never a guess at who " +
  "does what. `clarify`: what they leave " +
  "open or contradict that changes what goes in, each with `who` can answer (\"Architect\", " +
  "\"Builder\", \"Client\"), or \"\".\n\n" +
  "Never invent a unit, a size, a room or a clause the papers don't give: say less rather than " +
  "guess. When two papers disagree, the later email over the drawings, the drawings over the " +
  "specification's general clauses; say it in `clarify`. STRICTLY NO MONEY: no prices or sums " +
  "beyond naming a PC or provisional sum as one. Never mention this system or that anything " +
  "was generated.";

/** What Tiff is handed: the job and its supplied papers, newest first. */
export function suppliedPrompt(read: { client: string | null; site: string | null; sources: readonly SuppliedSource[] }): string {
  let room = SOURCE_WORDS_MAX;
  const parts: string[] = [];
  for (const s of read.sources) {
    const words = s.words.slice(0, Math.max(0, room));
    room -= words.length;
    parts.push(`${s.label}:\n${words}`);
    if (room <= 0) break;
  }
  return [`Client: ${read.client ?? "unknown"}`, `Site: ${read.site ?? "unknown"}`, ...parts].join("\n\n");
}

/** A drawing sheet's words cut to what the supplied scope needs: its title
    and number, and each line on the air side or in a legend near one, so a
    25-sheet set is a page of words, not a book. */
export function drawingWords(sheets: readonly { n: number; lines: readonly string[] }[]): string {
  const AIR = /\b(a\/c|air[- ]?con\w*|ducted|daikin|mitsubishi|fujitsu|panasonic|samsung|lg|toshiba|actron|grille?s?|diffuser|exhaust|ventilat\w*|louvre|mechanical|condenser|outdoor unit|bulkhead|return air|supply air|rangehood|fan)\b/i;
  /* a unit by its model code, as a legend prints it: FXDQ25TV1C, PEA-M125HAA, PUMY-SP125 */
  const MODEL = /\b(fxdq|fxsq|fxmq|ftxm|ftxz|fdyq|rxyq|rzq|rxm|pea|pead|puz|puhz|pumy|pefy|pkfy|plfy|msz|muz|sez|suz|arty|aoty|asty|ftkm|cs-|cu-|ac\d)\-?[a-z]*\d/i;
  const TITLE = /\b(floor|ceiling|rcp|section|elevation|plan|schedule|joinery|roof|site|demolition|level)\b/i;
  const out: string[] = [];
  for (const sheet of sheets) {
    const lines = sheet.lines.map(plainWords).filter(Boolean);
    const title = lines.filter((l) => TITLE.test(l) && l.length < 60 && l === l.toUpperCase()).slice(0, 2);
    const air = [...new Set(lines.filter((l) => AIR.test(l) || MODEL.test(l)))].slice(0, 40);
    if (air.length === 0) continue;
    /* by its page: a sheet's own number can't be told from the sheets it points to */
    out.push(`[Drawings, page ${sheet.n}${title.length ? `: ${title.join(", ")}` : ""}]\n${air.join("\n")}`);
  }
  return out.join("\n\n");
}

/** An email from outside is supplied when it is about the air side. */
export const emailSupplies = (subject: string, body: string): boolean => topicsOf(`${subject} ${body}`).length > 0;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Tiff's answer (or a stored row's `supplied`), clamped; null when it holds nothing. */
export function suppliedOf(raw: unknown): SuppliedScope | null {
  const r = obj(raw);
  const systems = list(r.systems)
    .map((x) => {
      const s = obj(x);
      return { area: str(s.area, MAX.short), kind: str(s.kind, MAX.short), text: str(s.text, MAX.text), from: list(s.from).map((f) => str(f, MAX.short)).filter(Boolean).slice(0, MAX.from) };
    })
    .filter((s) => s.area || s.text)
    .slice(0, MAX.systems);
  const fine = list(r.fine)
    .map((x) => ({ text: str(obj(x).text, MAX.line), from: str(obj(x).from, MAX.short) }))
    .filter((f) => f.text)
    .slice(0, MAX.fine);
  const notOurs = list(r.notOurs).map((x) => str(x, MAX.line)).filter(Boolean).slice(0, MAX.notOurs);
  const clarify = list(r.clarify)
    .map((x) => ({ q: str(obj(x).q, MAX.line), who: str(obj(x).who, MAX.short) }))
    .filter((c) => c.q)
    .slice(0, MAX.clarify);
  const lede = str(r.lede, MAX.lede);
  if (!lede && systems.length === 0 && fine.length === 0) return null;
  return { lede, systems, fine, notOurs, clarify };
}

/** The supplied scope in a few lines, for the quoted brief's writer and the quote. */
export function suppliedWords(s: SuppliedScope): string {
  return [
    s.lede,
    ...s.systems.map((x) => `${[x.area, x.kind].filter(Boolean).join(": ")}. ${x.text}${x.from.length ? ` (${x.from.join(", ")})` : ""}`),
    s.fine.length ? `Fine print: ${s.fine.map((f) => `${f.text}${f.from ? ` (${f.from})` : ""}`).join("; ")}` : "",
    s.notOurs.length ? `Not ours: ${s.notOurs.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
