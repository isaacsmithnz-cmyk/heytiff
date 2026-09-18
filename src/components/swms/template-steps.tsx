import { buildSwms, DEFAULT_ANSWERS, LEVEL_PLAIN, type SwmsAnswers, type SwmsControl, type SwmsStep } from "@/lib/swms/library";

/* THE SWMS TEMPLATE, READ — every step with its hazards and controls, as the
   template writes them with nothing chosen on site yet.

   EVERY BRANCH, AND WHEN EACH ONE APPLIES. Built from the default answers
   alone, this showed one path — New South Wales, edge protection, wet
   drilling, R32 — under the words "every SWMS is written from these steps and
   controls". Built from every branch at once, it read as one contradictory
   method: the mains off AND the RCD circuit left on, four fall protections in
   a row, with a caption underneath excusing it. So a control that depends on
   a choice now carries that choice — "If a harness is used", "In Queensland"
   — and the controls with nothing under them are the ones that always apply.

   The blanks a site fills are named as blanks ("the named anchor", "the named
   electrician"), never stand-ins that read like the control itself.

   The control levels stay here: this is the business deciding that these
   controls are its own, which is exactly where the hierarchy matters. In
   words that say what a control of that level does — paper keeps the
   regulation's names. Pure and hook-free, so a server page and a client
   wizard both render it. */

const BASE: SwmsAnswers = { ...DEFAULT_ANSWERS, hospital: "—" };
const site = (over: Partial<SwmsAnswers["site"]>): Partial<SwmsAnswers> => ({ site: { ...DEFAULT_ANSWERS.site, ...over } });
const WRITTEN = "the reason written on site";

type Option = { when: string; answers: Partial<SwmsAnswers> };

/* ONE AXIS PER QUESTION THE SITE ANSWERS. A control every option of an axis
   writes doesn't belong to that axis; one only some options write does, and
   says so. */
const AXES: Option[][] = [
  [
    { when: "In New South Wales", answers: { jurisdiction: "NSW" } },
    { when: "In Queensland", answers: { jurisdiction: "QLD" } },
  ],
  [
    { when: "If edge protection is used", answers: { fall: "edge" } },
    { when: "If the work is off a scaffold", answers: { fall: "scaffold" } },
    { when: "If the work is off an elevating work platform", answers: { fall: "ewp" } },
    { when: "If a harness is used", answers: { fall: "harness" } },
  ],
  [
    { when: "If the unit goes up on a rope hoist", answers: { lift: "hoist" } },
    { when: "If a crane or Hiab lifts it", answers: { lift: "crane" } },
  ],
  [
    { when: "If the drilling is wet", answers: { dust: "wet" } },
    { when: "If the dust is taken by on-tool extraction", answers: { dust: "extract" } },
  ],
  [
    { when: "If the drilling is high-risk silica work", answers: { silica: "high" } },
    { when: "If it isn't high-risk silica work", answers: { silica: "low", silicaWhy: WRITTEN } },
  ],
  [
    { when: "If the mains are off while anyone is in the roof space", answers: { roofPower: "off" } },
    { when: "If only the RCD-protected circuit stays on", answers: { roofPower: "rcd" } },
  ],
  [
    { when: "If the refrigerant burns, like R32", answers: { refrigerant: "R32" } },
    { when: "If the refrigerant doesn't burn, like R410A", answers: { refrigerant: "R410A" } },
  ],
  [
    { when: "If the building isn't from before 1990", answers: site({ pre1990: false }) },
    { when: "If the building is from before 1990", answers: site({ pre1990: true }) },
  ],
  [
    { when: "If no powerlines are near the work", answers: site({ powerlines: false }) },
    { when: "If powerlines are near the work", answers: site({ powerlines: true }) },
  ],
  [
    { when: "If no builder runs the site", answers: site({ builder: false }) },
    { when: "If a builder runs the site", answers: site({ builder: true }) },
  ],
];

/* Two answers at once, where the second changes what the first writes. */
const COMBINATIONS: Option[] = [
  { when: "If a harness is used, in Queensland", answers: { fall: "harness", jurisdiction: "QLD", qldFallReason: WRITTEN } },
  { when: "If powerlines are near the work, in Queensland", answers: { ...site({ powerlines: true }), jurisdiction: "QLD" } },
  { when: "If it's a hydrocarbon refrigerant, in Queensland", answers: { refrigerant: "R290", jurisdiction: "QLD" } },
];

export type TemplateControl = SwmsControl & { when: string | null };
type TemplateStep = Omit<SwmsStep, "controls"> & { controls: TemplateControl[] };

const stepsOf = (answers: Partial<SwmsAnswers>): SwmsStep[] =>
  buildSwms({ ...BASE, ...answers }, { work: "", electricianName: null, firstAiderName: null }).steps;

/** Every step of every choice, each control once, carrying the choice it
    belongs to — or nothing, when every choice writes it. */
function everyStep(): TemplateStep[] {
  const steps = new Map<string, TemplateStep>();
  const when = new Map<string, string>();
  const add = (list: SwmsStep[]) => {
    for (const step of list) {
      const held = steps.get(step.key) ?? { ...step, controls: [] as TemplateControl[] };
      for (const c of step.controls) {
        if (!held.controls.some((x) => x.text === c.text)) held.controls.push({ ...c, when: null });
      }
      steps.set(step.key, held);
    }
  };

  /* the template's own answers lead, in the order the library writes them */
  add(stepsOf({}));

  for (const axis of AXES) {
    const written = axis.map((o) => ({ when: o.when, byStep: new Map(stepsOf(o.answers).map((s) => [s.key, s.controls.map((c) => c.text)])) }));
    for (const key of new Set(written.flatMap((w) => [...w.byStep.keys()]))) {
      const lists = written.map((w) => ({ when: w.when, texts: w.byStep.get(key) ?? [] }));
      const everywhere = new Set(lists[0].texts.filter((t) => lists.every((l) => l.texts.includes(t))));
      for (const l of lists) for (const t of l.texts) if (!everywhere.has(t) && !when.has(t)) when.set(t, l.when);
    }
    for (const o of axis) add(stepsOf(o.answers));
  }

  for (const combo of COMBINATIONS) {
    for (const step of stepsOf(combo.answers)) {
      for (const c of step.controls) if (!when.has(c.text) && !steps.get(step.key)?.controls.some((x) => x.text === c.text)) when.set(c.text, combo.when);
    }
    add(stepsOf(combo.answers));
  }

  return [...steps.values()].map((step) => ({
    ...step,
    controls: step.controls.map((c) => ({ ...c, when: when.get(c.text) ?? null })),
  }));
}

const PREVIEW = everyStep();

export function TemplateSteps() {
  return (
    <>
      {PREVIEW.map((s) => (
        <div key={s.key} className="sw-grp">
          <div className="sw-gh">
            <b>{s.title}</b>
          </div>
          <p className="sw-text">{s.hazards}</p>
          <ul className="sw-lib">
            {s.controls.map((c) => (
              <li key={c.text}>
                <span>{LEVEL_PLAIN[c.level]}</span>
                <span>
                  {c.text}
                  {c.when && <em>{c.when}</em>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
