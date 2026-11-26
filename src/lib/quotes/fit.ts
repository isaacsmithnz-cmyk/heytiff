import { wallBracketCode } from "./buildup";
import type { UnitLookup } from "./lookups";
import { bracketOf, isolatorOf } from "./ranges";

/* DOES EACH PART FIT THE UNIT IT'S FOR (the engine rebuild, slice 3.1) — a
   quote's parts checked against its outdoor unit, from the maker's data
   pack: the isolator and the circuit breaker against what the unit draws,
   the pipe against the unit's connections, the wall bracket against its
   width and weight. A part that fits says "fitted"; one that doesn't says
   why, in a person's words; a system whose unit has no data pack says "not
   checked", never fitted on a guess (the plan: "a brand with no pack says
   not checked").

   Only parts a rule knows are checked; everything else is left as it is.
   Pure: the quote page marks each line, Tiff's tools refuse a misfit, and
   the review before Approve lists them. */

export type FitPart = { key: string; system: string; name: string; code?: string | null; group?: string };
/** A VRF or multi-head system's pipe, besides its outdoor's stubs: each
    head's connection, and the sizes the pack's pipe tables give its runs
    (lookups.ts systemPipesOf). */
export type SystemPipe = {
  /** a VRF or a multi, or more than one head on the system */
  multi: boolean;
  heads: { model: string; pipeMm: { liquid: number; gas: number } }[];
  sections: { liquid: number; gas: number }[];
};
export type Fit = { key: string; state: "fitted" | "misfit" | "not checked"; why: string };

/** Pipe sizes in inches as written ("3/8 + 5/8"), in mm as the packs keep them. */
const INCH_MM: Record<string, number> = { "1/4": 6.35, "3/8": 9.52, "1/2": 12.7, "5/8": 15.88, "3/4": 19.05, "7/8": 22.22, "1 1/8": 28.58 };
export function pipeOf(name: string): { liquid: number; gas: number } | null {
  const m = /(1\/4|3\/8|1\/2|5\/8|3\/4|7\/8)\s*["”]?\s*(?:\+|&|X|AND)\s*(1 1\/8|1\/4|3\/8|1\/2|5\/8|3\/4|7\/8)/i.exec(name);
  if (!m) return null;
  return { liquid: INCH_MM[m[1]!]!, gas: INCH_MM[m[2]!]! };
}
const inches = (mm: number) => Object.entries(INCH_MM).find(([, v]) => Math.abs(v - mm) < 0.2)?.[0] ?? `${mm} mm`;

/** What kind of part a rule knows it as. */
function ruleOf(p: FitPart): "isolator" | "breaker" | "pipe" | "bracket" | null {
  const n = `${p.name} ${p.code ?? ""}`;
  if (/isolat/i.test(n)) return "isolator";
  if (/\b(RCBO|MCB|circuit\s*breaker|breaker)\b/i.test(n)) return "breaker";
  if (/pair\s*coil|paired\s*coil|\bPC\d{3,4}\b/i.test(n) && pipeOf(n)) return "pipe";
  if (/\bbracket\b|\bCWB/i.test(n) && !/spring|hanger/i.test(n)) return "bracket";
  return null;
}

const samePipe = (a: { liquid: number; gas: number }, b: { liquid: number; gas: number }) => Math.abs(a.liquid - b.liquid) < 0.2 && Math.abs(a.gas - b.gas) < 0.2;

/** Every part a rule knows, checked against its system's outdoor unit. A
    VRF's or a multi's pipe may also be a head's connection or a size its
    pipe tables give a run (`pipes`); a single split's is its outdoor's. */
export function fitChecks(parts: FitPart[], outdoorBySystem: Map<string, UnitLookup>, pipes: Map<string, SystemPipe> = new Map()): Fit[] {
  const out: Fit[] = [];
  for (const p of parts) {
    const rule = ruleOf(p);
    if (!rule) continue;
    const unit = outdoorBySystem.get(p.system);
    if (!unit || !unit.found || unit.specs.role !== "outdoor") {
      out.push({ key: p.key, state: "not checked", why: unit && !unit.found && unit.reason === "no data pack" ? "No data pack for this brand" : "No outdoor unit to check it against" });
      continue;
    }
    const u = unit.specs;
    const draw = u.mcaAmps ?? u.maxAmps;
    if (rule === "isolator" || rule === "breaker") {
      const rated = isolatorOf(p.name)?.amps ?? null;
      if (rated == null || draw == null) {
        out.push({ key: p.key, state: "not checked", why: rated == null ? "Its rating isn't in its name" : "The pack doesn't give the unit's current" });
      } else if (rated >= draw) {
        out.push({ key: p.key, state: "fitted", why: `${rated} A for the ${u.model}'s ${draw} A` });
      } else {
        out.push({ key: p.key, state: "misfit", why: `${rated} A is under the ${u.model}'s ${draw} A` });
      }
      continue;
    }
    if (rule === "pipe") {
      const pipe = pipeOf(`${p.name} ${p.code ?? ""}`)!;
      const sys = pipes.get(p.system);
      const head = sys?.multi ? sys.heads.find((h) => samePipe(pipe, h.pipeMm)) : undefined;
      const section = sys?.multi ? sys.sections.some((s) => samePipe(pipe, s)) : false;
      if (!u.pipeMm) {
        out.push({ key: p.key, state: "not checked", why: "The pack doesn't give the unit's pipe" });
      } else if (samePipe(pipe, u.pipeMm)) {
        out.push({ key: p.key, state: "fitted", why: `The ${u.model} connects ${inches(u.pipeMm.liquid)} + ${inches(u.pipeMm.gas)}` });
      } else if (head) {
        out.push({ key: p.key, state: "fitted", why: `The ${head.model} connects ${inches(head.pipeMm.liquid)} + ${inches(head.pipeMm.gas)}` });
      } else if (section) {
        out.push({ key: p.key, state: "fitted", why: `A size the ${u.model}'s pipe table gives its runs between joints and to its heads` });
      } else if (sys?.multi) {
        out.push({ key: p.key, state: "misfit", why: `Not the ${u.model}'s ${inches(u.pipeMm.liquid)} + ${inches(u.pipeMm.gas)}, a head's connection or a size its pipe table gives` });
      } else {
        out.push({ key: p.key, state: "misfit", why: `The ${u.model} connects ${inches(u.pipeMm.liquid)} + ${inches(u.pipeMm.gas)}` });
      }
      continue;
    }
    /* a wall bracket: by the unit's width as well as its weight (buildup.ts) */
    const width = u.sizeMm?.[0] ?? null;
    const want = wallBracketCode(width, u.weightKg);
    const held = bracketOf(p.name)?.kg ?? null;
    const isCode = (p.code ?? "").toUpperCase();
    if (u.weightKg == null && width == null) {
      out.push({ key: p.key, state: "not checked", why: "The pack doesn't give the unit's size or weight" });
    } else if (isCode === want || (held != null && u.weightKg != null && held >= u.weightKg && want === "CWB180")) {
      out.push({ key: p.key, state: "fitted", why: `Holds the ${u.model}${u.weightKg != null ? `, ${u.weightKg} kg` : ""}` });
    } else {
      out.push({ key: p.key, state: "misfit", why: `The ${u.model}${width != null ? ` is ${width} mm wide` : ""}${u.weightKg != null ? `, ${u.weightKg} kg` : ""}: it needs a ${want}` });
    }
  }
  return out;
}
