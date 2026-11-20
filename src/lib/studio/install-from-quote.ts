/* INSTALL DETAILS, ANSWERED BY THE QUOTE (Isaac, 20 November 2026: "does
   the quote talk to install details", then "Yes, add it", and "Yes, build
   it" to the mock, 21 November 2026). A quote's option already says much of
   how its system goes in: a wall bracket says where the outdoor sits (a
   250 kg one, a heavy-duty bracket), a condensate pump and drain hose say how
   the water goes, and a quote with no controller on it means the remotes the
   heads come with. An isolator and cable don't settle the electrical: the
   electrician may bring them, and job 3517's quote has both with Electrical
   answered No (Isaac, 21 November 2026: "Not always"), so it stays to answer.
   Adding the option to a design answers those questions from its lines, and
   keeps what the quote said, so Install details can say Quoted while the
   answer is still the quote's. What the quote doesn't say stays to answer.
   Pure. */

import type { DesignDocument } from "./document";
import { answerInstall, installAnswers } from "./install";

/** a quote's material line, by its words: the name and how many */
export type QuotedMaterial = { name: string; qty: number };

/** a condensate pump's line */
const PUMP = /\bcond(ensate)?\b.*\bpump\b|\bpump\b.*\bcond(ensate)?\b|\bmini\s*(aqua|orange)\b/i;

/** how many condensate pumps the quote has: two for four heads is two, not
    a pump a head (the live walk, 21 November 2026) */
export function pumpsFromQuote(materials: readonly QuotedMaterial[]): number {
  return materials.filter((m) => PUMP.test(m.name)).reduce((n, m) => n + (m.qty > 0 ? m.qty : 0), 0);
}

/** question id → the option ids the quote's lines tick */
export function answersFromQuote(materials: readonly QuotedMaterial[]): Record<string, string[]> {
  const has = (re: RegExp) => materials.some((m) => re.test(m.name));
  const out: Record<string, string[]> = {};

  /* where the outdoor sits, and on what */
  if (has(/\bbracket\b/i)) {
    out["outdoor-sits"] = ["wall"];
    out["wall-bracket"] = [has(/\b(250\s?kg|heavy|h\.?d\.?)\b/i) ? "heavy-bracket" : "wall-bracket"];
  } else if (has(/\broof\s*(frame|stand)\b/i)) {
    out["outdoor-sits"] = ["roof"];
    out["roof-frame"] = ["roof-frame"];
  } else if (has(/\b(ground|base|condenser)\s*pad\b|\bpad\b.*\b(outdoor|condenser)\b/i)) {
    out["outdoor-sits"] = ["ground"];
    out["ground-base"] = ["ground-pad"];
  } else if (has(/\b(rubber|neoprene|isolation|anti[\s-]?vib\w*)\b.*\b(feet|foot|mounts?)\b/i)) {
    /* "NEOPRENE COND MOUNT ADJUSTABLE": the outdoor on the ground on rubber
       mounts, as job 3517 was answered by hand */
    out["outdoor-sits"] = ["ground"];
    out["ground-base"] = ["rubber-feet"];
  }

  /* the controls: a Wi-Fi adapter or a wired controller where the quote has
     one (a zone control's touchscreen, AirTouch's, is on the wall, wired, as
     job 3517 was answered by hand), else the remotes that come with each
     head */
  out.controls = has(/\bwi-?fi\b|\bwifi\b|\bMAC-\d/i)
    ? ["wifi"]
    : has(/\bwired\b.*\b(controller|remote)\b|\bPA[CR]-\d|\bair\s?touch\b|\bzone\s+control/i)
      ? ["wired"]
      : ["wireless"];

  /* the condensate: pumped where the quote has a pump, by gravity where it
     has drain hose; both, where it has both */
  const pump = materials.some((m) => PUMP.test(m.name));
  const gravity = has(/\bdrain\b/i);
  if (pump || gravity) out.condensate = [...(gravity ? ["gravity"] : []), ...(pump ? ["pump"] : [])];

  return out;
}

/** The quote's answers put on a system, where nothing is answered yet; the
    quote's ticks kept on the system as `installQuoted`, so a row can say
    Quoted while its answer is still the quote's. */
export function answerFromQuote(doc: DesignDocument, systemId: string, materials: readonly QuotedMaterial[]): DesignDocument {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys) return doc;
  const quoted = answersFromQuote(materials);
  const already = installAnswers(doc, sys);
  let d = doc;
  const kept: Record<string, string[]> = {};
  /* a question's own answer first, then its follow-up, which needs its
     parent's tick to be kept */
  for (const id of ["outdoor-sits", "wall-bracket", "roof-frame", "ground-base", "controls", "condensate"]) {
    const ticks = quoted[id];
    if (!ticks || (already[id] ?? []).length) continue;
    d = answerInstall(d, systemId, id, ticks);
    kept[id] = ticks;
  }
  if (!Object.keys(kept).length) return d;
  /* the quote's pumps, kept beside its ticks: the equipment list counts
     them while the condensate is still the quote's (install.ts) */
  const pumps = kept.condensate?.includes("pump") ? pumpsFromQuote(materials) : 0;
  return {
    ...d,
    systems: d.systems.map((s) =>
      s.id === systemId ? { ...s, settings: { ...s.settings, installQuoted: kept, ...(pumps ? { installQuotedPumps: pumps } : {}) } } : s
    ),
  };
}

/** whether a question's answer is still the quote's */
export function stillQuoted(quotedTicks: unknown, current: readonly string[] | undefined): boolean {
  if (!Array.isArray(quotedTicks) || !current?.length) return false;
  const q = [...quotedTicks].map(String).sort();
  const c = [...current].sort();
  return q.length === c.length && q.every((v, i) => v === c[i]);
}
