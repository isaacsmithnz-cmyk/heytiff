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
    figure, airway openings and an external static. Presentation-side twin of
    DUCTED_FORMS (ready.ts, catalog.ts, table-groups.ts) and AIR_CAPABLE_FORMS
    (modules.ts), which all already read `["ducted", "bulkhead"]`. Kept here so
    the unit browser doesn't reach into the engine for it.

    NB there are now five copies of this same pair across the codebase. They
    agree today; a sixth form factor with a duct airway would have to be added
    to all five. Worth collapsing — out of scope for the reclassification. */
export const DUCT_AIRWAY_FORMS: readonly FormFactor[] = ["ducted", "bulkhead"];
