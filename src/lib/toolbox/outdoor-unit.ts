/* Outdoor Unit Placement — where a NSW outdoor unit can sit without council
   approval. Pure data + logic, no React (lib discipline).

   Wording is deliberately plain: no "exempt development", no clause numbers in
   the labels, no "primary road" or "habitable room". The legal terms live in
   SOURCE_NOTE and nowhere else — a tradie standing in a backyard should be able
   to read every line without a planning dictionary.

   Rules verified 2026-07-19 against Codes SEPP 2008 cl 2.6. NOTE the 1.8 m
   height cap is qualified "if located on the ground floor" — an amendment in
   force 29 Nov 2024 removed the cap for units above the ground floor. The
   source document this tool was built from omitted that qualifier. */

export type PropertyType = "home" | "business";
export type Floor = "ground" | "above";
/** cl 2.6 treats a heritage ITEM and a heritage CONSERVATION AREA differently —
    a home in an area is not required to be ground-mounted, only an item is. */
export type Heritage = "none" | "area" | "item";

export interface Placement {
  property: PropertyType;
  floor: Floor;
  heritage: Heritage;
}

export const DEFAULT_PLACEMENT: Placement = {
  property: "home",
  floor: "ground",
  heritage: "none",
};

/** Applicability, kept as data rather than predicates so the list stays
    serialisable and diffable. Present keys are ANDed. */
export interface RuleWhen {
  property?: PropertyType[];
  floor?: Floor[];
  heritage?: Heritage[];
}

export interface Rule {
  id: string;
  /** phrased so that "yes" always means you're in the clear */
  label: string;
  detail: string;
  /** hover note where the plain wording needs a caveat */
  tip?: string;
  when?: RuleWhen;
  /** overrides the default Yes / No wording */
  answerLabels?: [string, string];
}

/* Transcribed from cl 2.6 verbatim on 2026-07-20. The two subclauses are NOT
   the same list with different numbers — 2.6(1A) has no boundary setback, no
   bedroom rule, no height cap and no wall/ground-only restriction, so a
   non-residential unit may be roof-mounted. Only paragraphs that genuinely
   appear in a subclause are gated to it. */
export const RULES: Rule[] = [
  {
    id: "boundary",
    label: "At least 450 mm from every boundary",
    detail: "Measure from the unit itself to the fence line — on every side.",
    when: { property: ["home"] },
  },
  {
    id: "business-setback",
    label: "If it's built into an external wall — 3 m off the side and rear boundaries, and 6 m from other buildings",
    detail:
      "Only bites when the unit is recessed into a wall. Ground-mounted or roof-mounted units aren't caught by it — answer yes.",
    when: { property: ["business"] },
  },
  {
    id: "bedroom",
    label: "At least 1 m from a neighbour's bedroom",
    detail: "That's to their bedroom, not to the fence.",
    when: { property: ["home"] },
  },
  {
    id: "street",
    label: "Not on a wall or roof facing the street",
    detail: "Keep it behind the front of the building, out of view from the road.",
  },
  {
    id: "mounting",
    label: "On the ground, or fixed to an outside wall",
    detail:
      "Those are the only two options on a home — a roof-mounted unit always needs approval. A balcony floor counts, but check the strata rules.",
    when: { property: ["home"] },
  },
  {
    id: "height",
    label: "No higher than 1.8 m off the ground",
    detail: "To the top of the unit as installed, bracket included.",
    tip: "The cap applies to units fixed on the ground floor. Since November 2024 a unit on an upper storey — an apartment balcony, say — has no height limit. It's about where the unit sits, not which rooms it serves.",
    when: { property: ["home"], floor: ["ground"] },
  },
  {
    id: "building",
    label: "Doesn't weaken the building or its fire safety",
    detail: "The install must not cut into structure or drop the fire rating.",
  },
  {
    id: "noise-peak",
    label: "No more than 5 dB(A) above the background noise at any boundary",
    detail: "Measured at any property boundary, during peak times.",
    tip: "You're predicting this, not measuring it. Tight against a fence or under a neighbour's window, get a sound check before you commit. Peak and off-peak times are defined in the planning policy — confirm them for your case.",
    answerLabels: ["Confirmed", "Not sure"],
  },
  {
    id: "noise-offpeak",
    label: "Not audible inside a neighbour's home outside peak times",
    detail:
      "This is a condition of skipping approval, not just an operating rule — the unit has to be incapable of it.",
    tip: "Separate from, and stricter than, the noise-hours offence. Even a quiet unit can breach this if it runs overnight close to a neighbour's window.",
    answerLabels: ["Confirmed", "Not sure"],
  },
  /* heritage — an ITEM and a CONSERVATION AREA carry different duties, and the
     duties differ again between the two subclauses */
  {
    id: "heritage-ground",
    label: "Ground-mounted",
    detail: "Required on a heritage item — no wall or roof mounting.",
    when: { property: ["home"], heritage: ["item"] },
  },
  {
    id: "heritage-rear",
    label: "At or behind the rear building line",
    detail: "Applies on a heritage item, and anywhere in a heritage conservation area.",
    when: { property: ["home"], heritage: ["item", "area"] },
  },
  {
    id: "biz-heritage-wall",
    label: "Not wall-mounted",
    detail: "Required on a heritage item.",
    when: { property: ["business"], heritage: ["item"] },
  },
  {
    id: "biz-heritage-line",
    label: "Behind the building line of any road frontage",
    detail: "Applies in a heritage conservation area.",
    when: { property: ["business"], heritage: ["area"] },
  },
];

/* Operating hours — a separate thing from placement. These govern when it may
   run, not whether you need approval, so they are not checklist rules. */
export interface QuietHours {
  day: string;
  window: string;
}

export const QUIET_HOURS: QuietHours[] = [
  { day: "Weekdays", window: "before 7 am · after 10 pm" },
  { day: "Weekends & public holidays", window: "before 8 am · after 10 pm" },
];

export const QUIET_HOURS_RULE =
  "Outside these hours it must not be audible inside a neighbour's home. Separate from the planning condition on the list — this one is an offence in its own right.";

export const QUIET_HOURS_PENALTY =
  "First time gets a warning. Do it again within 28 days and it's an offence.";

export const RULE_OF_THUMB =
  "Sit it on the ground behind the front of the building, 450 mm off every fence and a metre clear of the neighbour's bedroom. Keep it under 1.8 m if it's on the ground floor, and make sure it won't be heard over the fence. Miss any one of those and you need council approval.";

export const SOURCE_NOTE =
  "NSW rules — Codes SEPP 2008 cl 2.6 (placement) and the Noise Control Regulation 2017 cl 45 (hours). Your council can add its own screening and noise conditions on top, so check with them before you commit.";

/* ------------------------------------------------------------------ logic */

export function ruleApplies(rule: Rule, p: Placement): boolean {
  const w = rule.when;
  if (!w) return true;
  if (w.property && !w.property.includes(p.property)) return false;
  if (w.floor && !w.floor.includes(p.floor)) return false;
  if (w.heritage && !w.heritage.includes(p.heritage)) return false;
  return true;
}

export function rulesFor(p: Placement): Rule[] {
  return RULES.filter((r) => ruleApplies(r, p));
}

export type Answer = "yes" | "no";
export type Answers = Record<string, Answer | undefined>;
export type Verdict = "clear" | "approval" | "unanswered";

export interface Result {
  verdict: Verdict;
  met: string[];
  failed: string[];
  unanswered: string[];
  total: number;
}

/** Answers for rules that don't apply to the current placement are ignored —
    tick everything on the ground floor, switch to upstairs, and the stale
    height answer must not count. */
export function check(p: Placement, answers: Answers): Result {
  const rules = rulesFor(p);
  const met: string[] = [];
  const failed: string[] = [];
  const unanswered: string[] = [];

  for (const r of rules) {
    const a = answers[r.id];
    if (a === "yes") met.push(r.id);
    else if (a === "no") failed.push(r.id);
    else unanswered.push(r.id);
  }

  // one "no" settles it, even with the rest still blank
  const verdict: Verdict =
    failed.length > 0 ? "approval" : unanswered.length > 0 ? "unanswered" : "clear";

  return { verdict, met, failed, unanswered, total: rules.length };
}

/** The three rules the drawing actually shows. Keeps the SVG dumb and the
    rule → picture mapping testable.

    The drawing is a section through the side yard, so it shows the three
    MEASURED rules — the two setbacks and the mounting height. "Not facing the
    street" is a plan-view fact and can't be drawn in elevation; it stays in the
    list only. */
export type Mark = "boundary" | "bedroom" | "height";

const MARK_BY_RULE: Record<string, Mark> = {
  boundary: "boundary",
  bedroom: "bedroom",
  height: "height",
};

export function marksFor(p: Placement, answers: Answers): Partial<Record<Mark, "ok" | "bad">> {
  const out: Partial<Record<Mark, "ok" | "bad">> = {};
  for (const rule of rulesFor(p)) {
    const mark = MARK_BY_RULE[rule.id];
    if (!mark) continue;
    const a = answers[rule.id];
    if (a === "yes") out[mark] = "ok";
    else if (a === "no") out[mark] = "bad";
  }
  return out;
}
