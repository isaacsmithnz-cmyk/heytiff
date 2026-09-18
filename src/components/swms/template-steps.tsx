import { buildSwms, DEFAULT_ANSWERS, LEVEL_PLAIN, type SwmsAnswers, type SwmsControl, type SwmsStep } from "@/lib/swms/library";

/* THE SWMS TEMPLATE, READ — every step with its hazards and controls, as the
   template writes them with nothing chosen on site yet.

   EVERY BRANCH, NOT ONE. It used to be built from the default answers alone —
   New South Wales, edge protection, wet drilling, R32, mains off — so the
   owner approving "the steps and controls every SWMS is written from" never
   saw the harness, the scaffold, the EWP, on-tool extraction, the Queensland
   clauses or the flammable-refrigerant controls their crew could issue the
   next morning. Each step now shows the controls of every choice the site can
   make, in the order the template writes them, each one once.

   The control levels stay here: this is the business deciding that these
   controls are its own, which is exactly where the hierarchy matters. In
   words that say what a control of that level does — paper keeps the
   regulation's names. Pure and hook-free, so a server page and a client
   wizard both render it. */

const BASE: SwmsAnswers = { ...DEFAULT_ANSWERS, isolation: "the isolation point", hospital: "—" };
const site = (over: Partial<SwmsAnswers["site"]>) => ({ site: { ...DEFAULT_ANSWERS.site, ...over } });

/** Each choice the person on site can make, once. */
const VARIANTS: Partial<SwmsAnswers>[] = [
  {},
  { jurisdiction: "QLD" },
  { fall: "scaffold" },
  { fall: "ewp" },
  { fall: "harness" },
  { fall: "harness", jurisdiction: "QLD", qldFallReason: "the reason given on site" },
  { lift: "crane" },
  { dust: "extract" },
  { silica: "low", silicaWhy: "the reason given on site" },
  { roofPower: "rcd" },
  { refrigerant: "R410A" },
  { refrigerant: "R290", jurisdiction: "QLD" },
  site({ pre1990: true }),
  site({ powerlines: true }),
  { ...site({ powerlines: true }), jurisdiction: "QLD" },
  site({ builder: true }),
];

/** The steps of every variant, each control kept once, in writing order. */
function everyStep(): SwmsStep[] {
  const out = new Map<string, SwmsStep>();
  const seen = new Map<string, Set<string>>();
  for (const v of VARIANTS) {
    for (const step of buildSwms({ ...BASE, ...v }, { work: "", electricianName: "the electrician", firstAiderName: null }).steps) {
      const held = out.get(step.key) ?? { ...step, controls: [] as SwmsControl[] };
      const kept = seen.get(step.key) ?? new Set<string>();
      for (const c of step.controls) {
        if (kept.has(c.text)) continue;
        kept.add(c.text);
        held.controls.push(c);
      }
      out.set(step.key, held);
      seen.set(step.key, kept);
    }
  }
  return [...out.values()];
}

const PREVIEW = everyStep();

export function TemplateSteps() {
  return (
    <>
      <p className="sw-note">
        Where the crew has a choice on site — how a fall is stopped, how dust is controlled, which state&apos;s rules apply — every
        option is here. A SWMS prints the ones chosen.
      </p>
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
                {c.text}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
