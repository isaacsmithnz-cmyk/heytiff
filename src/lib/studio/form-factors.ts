/* Form-factor display names — the one place a form factor is put into words.

   A leaf module on purpose. It was three maps before: select.ts (typed and
   exhaustive), unit-specs.ts (the canvas + cockpit wording) and summary.ts
   (the Summary sheet's own wording, missing three keys). Four of the seven
   form factors in the shipped pack were worded differently between them, and
   summary.ts had no `bulkhead` key at all — so the moment a pack classified a
   unit as bulkhead, the plan said "Bulkhead" and the Summary sheet printed the
   raw slug "bulkhead". A unit must not be called one thing in the inspector
   and another on the sheet.

   Zero imports beyond the schema TYPE, so anything may pull it: hq/grouping.ts
   previously had to stay server-side only because reaching the labels dragged
   in select.ts and the split engine behind it. */

import type { FormFactor } from "./packs/schema";

/* `satisfies`, not an annotation: `Record<FormFactor, string>` as an
   annotation widens keyof to string and a typo'd lookup would type-check
   straight into the `?? ff` fallback. This way a new FormFactor is a compile
   error here, which is the whole point of the file. */
export const FORM_FACTOR_LABELS = {
  wall: "Wall-mounted",
  ducted: "Ducted",
  "cassette-4way": "4-way cassette",
  "cassette-2way": "2-way cassette",
  "cassette-1way": "1-way cassette",
  "cassette-compact": "Compact cassette",
  "under-ceiling": "Under-ceiling",
  "floor-console": "Floor console",
  "floor-concealed": "Floor concealed",
  bulkhead: "Bulkhead",
} satisfies Record<FormFactor, string>;

/** the human name for a form factor ("cassette-4way" → "4-way cassette").
    Falls back to the raw value so a form factor from a future pack shows up
    rather than vanishing — `installed-packs.test.ts` asserts no unit in any
    SHIPPED pack ever takes that fallback. */
export function formFactorLabel(ff: string): string;
export function formFactorLabel(ff: string | null | undefined): string | null;
export function formFactorLabel(ff: string | null | undefined): string | null {
  if (!ff) return null;
  return FORM_FACTOR_LABELS[ff as FormFactor] ?? ff;
}

/** Does this form factor have a name of its own, or would it print as its
    slug? The guard test's predicate — exported so it has exactly one
    definition rather than a second copy of the lookup in the test. */
export function hasFormFactorLabel(ff: string): boolean {
  return Object.hasOwn(FORM_FACTOR_LABELS, ff);
}

/** Forms whose air side runs through ductwork — the ones that own an airflow
    figure, airway openings and an external static.

    THE definition, not a copy of one. It was five: DUCT_AIRWAY_FORMS here,
    AIR_CAPABLE_FORMS (modules.ts), and a DUCTED_FORMS/DUCTED_ONLY apiece in
    packs/ready.ts, hq/catalog.ts and hq/table-groups.ts. They agreed, which is
    the only reason nothing was broken — but a sixth ducted-airway form would
    have had to be added in five places, and missing one fails silently in the
    same way `bulkhead` did: a unit keeps its airflow on one surface and loses
    it on another, with no test red.

    This file stays a leaf (a type import and nothing else), so the engine, HQ
    and the browser can all reach it without dragging anything behind them. */
export const DUCT_AIRWAY_FORMS: readonly FormFactor[] = ["ducted", "bulkhead"];

const DUCT_AIRWAY_SET: ReadonlySet<string> = new Set(DUCT_AIRWAY_FORMS);

/** Does this form factor take a duct? Predicate form of DUCT_AIRWAY_FORMS,
    for the call sites that test a pack row's raw `form_factor` string rather
    than a typed tab. Set-backed, so it costs the same as the four Sets it
    replaced. */
export function hasDuctAirway(ff: string | null | undefined): boolean {
  return ff != null && DUCT_AIRWAY_SET.has(ff);
}
