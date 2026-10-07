import { VISIT_STAGES, type Visit, type VisitStage } from "./buildup";
import type { QuoteLine } from "./lines";
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

export type ByHand = {
  /** the options the client took, by index; one, as a client picks one */
  accepted: number[];
};

const whole = (v: unknown) => (typeof v === "number" ? v : Number(v));

/** The by-hand record a stored draft holds; empty when it holds none. */
export function byHandOf(draft: unknown): ByHand {
  const r = draft && typeof draft === "object" ? (draft as Record<string, unknown>).byHand : null;
  const raw = r && typeof r === "object" ? (r as Record<string, unknown>).accepted : null;
  const accepted = (Array.isArray(raw) ? raw : [])
    .map(whole)
    .filter((v, i, all) => Number.isInteger(v) && v >= 0 && v < 20 && all.indexOf(v) === i)
    .slice(0, 1);
  return { accepted };
}

/** Marking option `i` accepted, or taking the mark off: a client who picks
    one option has accepted only that one. */
export function toggleAccepted(b: ByHand, i: number): ByHand {
  return { accepted: b.accepted.includes(i) ? [] : [i] };
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
