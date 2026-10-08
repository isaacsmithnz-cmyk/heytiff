import { VISIT_STAGES, type Visit, type VisitStage } from "./buildup";
import type { QuoteLine } from "./lines";
import { proposalOf, type LinesProposal } from "./lines-proposal";
import type { UnitSpecs } from "./lookups";
import { normaliseDraft, type ProposalDraft, type UnitLine, type UnitRole } from "./proposal";

/* A QUOTE BUILT ON ITS KEPT LINES, AS THE JOB READS IT (slice 3.3) — the
   ServiceM8 send, the accepted option's materials, the Installation hours
   bar and the certificate's equipment all read a quote as a proposal's
   options: each with its units, its labour as visits, and which were
   accepted. A switched quote has no proposal yet (that's slice 7.1), so its
   options are drawn here from its lines, one for one, and nothing is read
   twice: what's on the lines is what the job gets.

   Which options were accepted is kept beside the switch, under the draft's
   own `byHand` key: an empty draft is still no proposal to every proposal
   reader, and a quote brought across from Tiff's builder keeps its old
   proposal, and its old accepted mark, untouched underneath. Pure. */

/** A hard job's loading on an option's labour, with its reason (9.2). */
export type OptionLoading = { pct: number; reason: string };

export type ByHand = {
  /** the options the client took, by index; one, as a client picks one */
  accepted: number[];
  /** each option's name, as the proposal and ServiceM8 give it; "" unnamed */
  names: string[];
  /** each option's loading on its labour, by index */
  loading: Record<number, OptionLoading>;
  /** the units asked to be compared with a unit line, by its id: codes (10.2) */
  compare: Record<string, string[]>;
  /** the supplier the whole job buys from where it sells the item; null:
      any (Isaac, 2026-10-08: "select aad to use only items from their price
      book unless something doesn't show up") */
  supplier: string | null;
  /** the proposal's words, written by Tiff or a person (7.1, lines-proposal.ts) */
  proposal: LinesProposal | null;
  /** lines priced from the web, by id: the page the price rests on (12.2) */
  researched: Record<string, { url: string; title: string }>;
};

/** Units a compare holds beside its suggestions, at most. */
export const MAX_COMPARED = 4;

export const MAX_OPTION_NAME = 120;
/** 50% on the labour: a typo's ceiling, not a guide */
export const MAX_LOADING_PCT = 50;

const whole = (v: unknown) => (typeof v === "number" ? v : Number(v));
const said = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** One loading as given, made safe; null for none (no percent). */
export function loadingOf(raw: unknown): OptionLoading | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pct = whole(o.pct);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  return { pct: Math.min(MAX_LOADING_PCT, Math.round(pct * 10) / 10), reason: said(o.reason, 200) };
}

/** The by-hand record a stored draft holds; empty when it holds none. */
export function byHandOf(draft: unknown): ByHand {
  const r = draft && typeof draft === "object" ? (draft as Record<string, unknown>).byHand : null;
  const o = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
  const accepted = (Array.isArray(o.accepted) ? o.accepted : [])
    .map(whole)
    .filter((v, i, all) => Number.isInteger(v) && v >= 0 && v < 20 && all.indexOf(v) === i)
    .slice(0, 1);
  const names = (Array.isArray(o.names) ? o.names : []).slice(0, 20).map((n) => said(n, MAX_OPTION_NAME));
  const loading: Record<number, OptionLoading> = {};
  const rawLoading = o.loading && typeof o.loading === "object" ? (o.loading as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(rawLoading)) {
    const i = whole(k);
    const l = loadingOf(v);
    if (Number.isInteger(i) && i >= 0 && i < 20 && l) loading[i] = l;
  }
  const compare: Record<string, string[]> = {};
  const rawCompare = o.compare && typeof o.compare === "object" ? (o.compare as Record<string, unknown>) : {};
  for (const [id, codes] of Object.entries(rawCompare).slice(0, 50)) {
    const list = (Array.isArray(codes) ? codes : []).map((c) => said(c, 80)).filter(Boolean).slice(0, MAX_COMPARED);
    if (/^[\w-]{1,60}$/.test(id) && list.length) compare[id] = list;
  }
  const supplier = said(o.supplier, 40) || null;
  const proposal = o.proposal && typeof o.proposal === "object" ? proposalOf(o.proposal) : null;
  const researched: ByHand["researched"] = {};
  const rawResearched = o.researched && typeof o.researched === "object" ? (o.researched as Record<string, unknown>) : {};
  for (const [id, v] of Object.entries(rawResearched).slice(0, 100)) {
    const s = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    const url = said(s.url, 500);
    if (/^[\w-]{1,60}$/.test(id) && /^https?:\/\//.test(url)) researched[id] = { url, title: said(s.title, 200) || url };
  }
  return { accepted, names, loading, compare, supplier, proposal, researched };
}

/** The proposal's words changed: a patch over what's there (blocks left
    out stay as they were), stamped now, so an approval given before it no
    longer stands. */
export function withProposal(b: ByHand, patch: unknown, now: string, options: number): ByHand {
  const was = b.proposal ?? proposalOf({});
  const p = patch && typeof patch === "object" ? (patch as Record<string, unknown>) : {};
  const merged = proposalOf({ ...was, ...p, updatedAt: now, approvedAt: was.approvedAt, approvedBy: was.approvedBy });
  /* one set of words an option the quote has, never more or fewer */
  const opts = Array.from({ length: Math.max(1, options) }, (_, i) => merged.options[i] ?? { summary: "", areas: [], included: [] });
  return { ...b, proposal: { ...merged, options: opts } };
}

/** The proposal approved by a person, now: one never written is approved
    as it's drawn, the lines with no words of their own. */
export const withApproval = (b: ByHand, by: string, now: string): ByHand => ({
  ...b,
  proposal: { ...(b.proposal ?? { ...proposalOf({}), updatedAt: now }), approvedAt: now, approvedBy: by },
});

/** A line priced from the web, with the page it rests on; null takes the mark off. */
export function withResearched(b: ByHand, lineId: string, source: { url: string; title: string } | null): ByHand {
  const researched = { ...b.researched };
  if (source) researched[lineId] = { url: source.url.slice(0, 500), title: source.title.slice(0, 200) };
  else delete researched[lineId];
  return { ...b, researched };
}

/** The job's supplier set, or any with none. */
export const withSupplier = (b: ByHand, key: unknown): ByHand => ({ ...b, supplier: said(key, 40) || null });

/** A unit added to a line's compare: once, the newest kept. */
export function withCompared(b: ByHand, lineId: string, code: string): ByHand {
  const now = (b.compare[lineId] ?? []).filter((c) => c.toUpperCase() !== code.toUpperCase());
  return { ...b, compare: { ...b.compare, [lineId]: [...now, code].slice(-MAX_COMPARED) } };
}

/** Each option's name: as named on the quote, else, on a quote brought
    across, its old option's. */
export function optionNames(raw: unknown, byHand: ByHand): string[] {
  const old = (normaliseDraft(raw)?.options ?? []).map((o) => o.name);
  return Array.from({ length: Math.max(old.length, byHand.names.length) }, (_, i) => byHand.names[i] || old[i] || "");
}

/** Marking option `i` accepted, or taking the mark off: a client who picks
    one option has accepted only that one. */
export function toggleAccepted(b: ByHand, i: number): ByHand {
  return { ...b, accepted: b.accepted.includes(i) ? [] : [i] };
}

/** Option `i` named; blank takes the name off. */
export function withName(b: ByHand, i: number, name: unknown): ByHand {
  const names = [...b.names];
  while (names.length <= i) names.push("");
  names[i] = said(name, MAX_OPTION_NAME);
  while (names.length && !names[names.length - 1]) names.pop();
  return { ...b, names };
}

/** Option `i`'s loading set, or taken off with no percent. */
export function withLoading(b: ByHand, i: number, raw: unknown): ByHand {
  const loading = { ...b.loading };
  const l = loadingOf(raw);
  if (l) loading[i] = l;
  else delete loading[i];
  return { ...b, loading };
}

/** What a unit line is: its maker's pack says, else its own words; a unit
    nothing tells is an indoor, as a unit with no role always has been
    (proposal.ts). */
export function roleOf(l: Pick<QuoteLine, "name">, specs: UnitSpecs | null): UnitRole {
  if (specs) return specs.role;
  if (/\b(exhaust|in-?line)?\s*fan\b/i.test(l.name)) return "fan";
  if (/\boutdoor\b|\bcondens/i.test(l.name)) return "outdoor";
  return "indoor";
}

/** A capacity as the quote says it: the pack's cooling, else the kW in its name. */
function capacityOf(l: Pick<QuoteLine, "name">, specs: UnitSpecs | null): string {
  if (specs?.coolKw != null) return `${specs.coolKw} kW`;
  const m = /(\d+(?:\.\d+)?)\s*kW\b/i.exec(l.name);
  return m ? `${m[1]} kW` : "";
}

/** One option's unit lines as the equipment rows a proposal keeps. Each
    system is the lines a person put under one name: its outdoors numbered
    in order across the option, its indoors run from its first outdoor, or,
    where a nameless system holds as many outdoors as indoors (a quote
    brought across holds every unit there), each from the outdoor in the
    same place. The system's name is the room. `specs` by line id. */
export function linesUnits(lines: readonly QuoteLine[], specs: ReadonlyMap<string, UnitSpecs | null>): UnitLine[] {
  const units = lines.filter((l) => l.kind === "unit" && l.qty > 0);
  const out: UnitLine[] = [];
  let n = 0;
  for (const system of [...new Set(units.map((l) => l.system))]) {
    const mine = units.filter((l) => l.system === system).map((l) => ({ l, s: specs.get(l.id) ?? null, role: roleOf(l, specs.get(l.id) ?? null) }));
    const outdoors = mine.filter((u) => u.role === "outdoor");
    const indoors = mine.filter((u) => u.role === "indoor");
    const first = n + 1;
    const numbers = new Map(outdoors.map((u) => [u.l.id, ++n]));
    const paired = system === "" && outdoors.length > 1 && outdoors.length === indoors.length;
    for (const u of mine) {
      const row: UnitLine = {
        role: u.role,
        room: u.role === "outdoor" ? "" : system,
        capacity: u.role === "fan" ? "" : capacityOf(u.l, u.s),
        type: /\bducted\b/i.test(u.l.name) || u.l.duct ? "Ducted" : "",
        model: (u.l.code ?? "").trim(),
        qty: Math.max(1, Math.round(u.l.qty)),
        system: u.role === "fan" ? 0 : u.role === "outdoor" ? numbers.get(u.l.id)! : outdoors.length === 0 ? 0 : paired ? first + indoors.indexOf(u) : first,
        lps: null,
      };
      /* a unit with nothing to say what or where it is isn't a row */
      if (row.model || row.room || row.capacity || row.type) out.push(row);
    }
  }
  return out;
}

/** A labour line's stage and crew, as its name gives them ("Rough-in: 2
    people", as a quote brought across names them); else one person installing. */
function stageOf(name: string): { stage: VisitStage; people: number } {
  const m = /^\s*([A-Za-z -]+?)\s*(?::\s*(\d+)\s*people)?\s*$/.exec(name);
  const stage = VISIT_STAGES.find((s) => s.toLowerCase() === (m?.[1] ?? "").toLowerCase());
  return { stage: stage ?? "Install", people: stage && m?.[2] ? Math.max(1, Number(m[2])) : 1 };
}

/** An option's labour lines as visits: its hours over its crew, in the
    business's working day; with no working day set, a visit is still one
    visit. */
export function labourVisits(lines: readonly QuoteLine[], dayHours: number | null): Visit[] {
  return lines
    .filter((l) => l.kind === "labour" && l.qty > 0)
    .map((l) => {
      const { stage, people } = stageOf(l.name);
      return { stage, people, days: dayHours && dayHours > 0 ? Math.round((l.qty / people / dayHours) * 1000) / 1000 : 1 };
    });
}

/** The quote as the job reads it: an option for each, named as the quote
    names it, its units and its labour, with the accepted mark. Null when it
    has no line at all. */
export function linesDraft(
  lines: readonly QuoteLine[],
  names: readonly string[],
  byHand: ByHand,
  specs: ReadonlyMap<string, UnitSpecs | null>,
  dayHours: number | null
): ProposalDraft | null {
  if (lines.length === 0) return null;
  const count = Math.max(names.length, ...lines.map((l) => l.optionIndex + 1));
  const options = Array.from({ length: count }, (_, i) => {
    const mine = lines.filter((l) => l.optionIndex === i);
    const visits = labourVisits(mine, dayHours);
    return {
      name: names[i] || `Option ${i + 1}`,
      lines: [],
      units: linesUnits(mine, specs),
      priceCents: null,
      labour: visits.length ? { visits, from: "you" } : null,
    };
  });
  return normaliseDraft({ options, accepted: byHand.accepted.filter((i) => i < count) });
}

/** What the job's own materials list gets from one option's lines: every
    part, by its name, its code and how many. */
export function linesMaterials(lines: readonly QuoteLine[]): { name: string; sub: string; qty: string }[] {
  return lines
    .filter((l) => l.kind !== "labour" && l.qty > 0)
    .map((l) => ({ name: l.name, sub: l.code ?? "", qty: `${l.qty}${l.unit ? ` ${l.unit}` : ""}` }));
}

/** The labour the lines hold, in person-hours: what was priced. */
export const linesHours = (lines: readonly QuoteLine[]) => Math.round(lines.filter((l) => l.kind === "labour").reduce((n, l) => n + l.qty, 0) * 10) / 10;
