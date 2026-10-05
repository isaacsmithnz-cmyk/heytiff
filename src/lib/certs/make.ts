import { brandOfCode } from "@/lib/quotes/brand";
import { brandOf } from "@/lib/quotes/brands";
import type { AcSystem, FanRow } from "./mechanical";

/* WHO MADE IT — the make a certifier reads beside the model ("Mitsubishi
   Electric PEFY-P63VMX-A"), because a model code alone names nothing to
   someone who doesn't know the maker's codes (job 2905, 2026-10-05: a
   certificate of PEFY and PUMY codes, and Mitsubishi nowhere on it).

   Read off the model code first, the price book's way; failing that, from
   the job's own words when they name one maker and only one. Never guessed
   past that: an empty make is the person's to fill in. Pure. */

const NAMED: readonly [string, RegExp][] = [
  ["Mitsubishi Heavy Industries", /\bmitsubishi\s+heavy\b|\bMHI\b/i],
  ["Mitsubishi Electric", /\bmitsubishi(?!\s+heavy)\b/i],
  ["Daikin", /\bdaikin\b/i],
  ["Fujitsu", /\bfujitsu\b/i],
  ["Toshiba", /\btoshiba\b/i],
  ["Panasonic", /\bpanasonic\b/i],
  ["ActronAir", /\bactron\s*air\b|\bactron\b/i],
  ["Samsung", /\bsamsung\b/i],
  ["Hisense", /\bhisense\b/i],
  ["Haier", /\bhaier\b/i],
  ["Temperzone", /\btemperzone\b/i],
  ["LG", /\bLG\b/],
];

/** The one maker a text names, or null when it names none or several. */
function onlyMakerIn(text: string): string | null {
  const found = NAMED.filter(([, re]) => re.test(text)).map(([name]) => name);
  return found.length === 1 ? found[0] : null;
}

/** The make of a unit from its model, else from the job's words. */
export function makeOf(model: string, words = ""): string {
  const code = model.trim();
  if (code) {
    const fromCode = brandOf("", code);
    if (fromCode) return fromCode;
    if (brandOfCode(code) === "daikin") return "Daikin";
  }
  return onlyMakerIn(words) ?? "";
}

/** Every row given its make where it has none. */
export function withMakes<T extends { systems: AcSystem[]; fans: FanRow[] }>(reading: T, words = ""): T {
  const fill = <R extends { make: string; model: string }>(r: R): R => (r.make.trim() ? r : { ...r, make: makeOf(r.model, words) });
  return {
    ...reading,
    systems: reading.systems.map((s) => ({ ...s, outdoor: fill(s.outdoor), indoors: s.indoors.map(fill) })),
    fans: reading.fans.map(fill),
  };
}
