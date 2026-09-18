import {
  DEFAULT_ANSWERS,
  HRCW,
  STEP_KEYS,
  type FallControl,
  type Jurisdiction,
  type StepKey,
  type SwmsAnswers,
} from "./library";

/* WHAT ARRIVES FROM THE BROWSER IS A CLAIM, NOT AN ANSWER.

   The wizard sends its answers as JSON, and a version is legal paperwork
   frozen forever — so nothing typed in a request reaches `swms_versions`
   without being read back into the shape the library writes from. Unknown
   keys are dropped, every choice is one of its known values or the library's
   default, every text is trimmed and capped. Pure, so it can be tested
   without a request. */

const TEXT_MAX = 600;
const text = (v: unknown, max = TEXT_MAX): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const bool = (v: unknown): boolean => v === true;
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function normaliseAnswers(raw: unknown): SwmsAnswers {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const site = (r.site && typeof r.site === "object" ? r.site : {}) as Record<string, unknown>;
  const steps = (r.steps && typeof r.steps === "object" ? r.steps : {}) as Record<string, unknown>;
  const valid = new Set(HRCW.map((c) => c.n));
  const extra = Array.isArray(r.extraCategories) ? r.extraCategories : [];

  return {
    kind: oneOf(r.kind, ["install", "service"] as const, DEFAULT_ANSWERS.kind),
    jurisdiction: oneOf<Jurisdiction>(r.jurisdiction, ["NSW", "QLD"], DEFAULT_ANSWERS.jurisdiction),
    site: {
      pre1990: bool(site.pre1990),
      powerlines: bool(site.powerlines),
      traffic: bool(site.traffic),
      builder: bool(site.builder),
    },
    builderName: text(r.builderName, 120),
    extraCategories: [...new Set(extra.filter((n): n is number => typeof n === "number" && valid.has(n)))].sort((a, b) => a - b),
    steps: Object.fromEntries(STEP_KEYS.map((k) => [k, bool(steps[k])])) as Record<StepKey, boolean>,
    fall: oneOf<FallControl>(r.fall, ["edge", "scaffold", "ewp", "harness"], DEFAULT_ANSWERS.fall),
    anchor: text(r.anchor, 200),
    qldFallReason: text(r.qldFallReason),
    lift: oneOf(r.lift, ["hoist", "crane"] as const, DEFAULT_ANSWERS.lift),
    dust: oneOf(r.dust, ["wet", "extract"] as const, DEFAULT_ANSWERS.dust),
    silica: oneOf(r.silica, ["high", "low"] as const, DEFAULT_ANSWERS.silica),
    silicaWhy: text(r.silicaWhy),
    roofPower: oneOf(r.roofPower, ["off", "rcd"] as const, DEFAULT_ANSWERS.roofPower),
    isolation: text(r.isolation, 200),
    refrigerant: oneOf(r.refrigerant, ["R32", "R410A", "R454B", "R290"] as const, "R32"),
    siteNotes: text(r.siteNotes, 1200),
    hospital: text(r.hospital, 200),
    extinguisher: oneOf(r.extinguisher, ["van", "site"] as const, DEFAULT_ANSWERS.extinguisher),
    riskAppendix: bool(r.riskAppendix),
  };
}

/** Someone from outside the business, as typed. Nameless rows are dropped,
    and so is a second row with a name already on the list: a name is the only
    thing that identifies someone the business has no staff card for, so two
    rows of it would be two people on the document, two sign-ons to collect,
    and one signature carried onto both by a correction. */
export function normaliseOutsiders(raw: unknown): { name: string; company: string | null }[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .map((o) => {
      const r = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
      const company = text(r.company, 120);
      return { name: text(r.name, 120), company: company || null };
    })
    .filter((o) => {
      const key = o.name.toLowerCase();
      if (!o.name.length || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

/* ── the signature ─────────────────────────────────────────────────────────
   A drawn signature arrives as SVG path data and nothing else: move and line
   commands with numbers. The SVG around it is written HERE, so no markup a
   browser sent is ever stored or rendered back into a document. */

const PATH_MAX = 20_000;
const PATH_SHAPE = /^[ML0-9.,\s-]+$/;

export const SIGNATURE_VIEWBOX = { width: 600, height: 200 };

/** The stored signature, or null when the path isn't a real drawn signature. */
export function signatureSvg(pathData: unknown): string | null {
  if (typeof pathData !== "string") return null;
  const d = pathData.trim();
  if (!d || d.length > PATH_MAX || !PATH_SHAPE.test(d)) return null;
  // a signature is more than a dot: at least one line segment
  if ((d.match(/L/g) ?? []).length < 2) return null;
  const { width, height } = SIGNATURE_VIEWBOX;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><path d="${d}" fill="none" stroke="#0b0d12" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
