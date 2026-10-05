import { sameUnitKey } from "./code-links";

/* A MAKER'S CODE LETTERS, READ FROM ITS OWN DOCUMENT (Isaac, 2026-10-05: the
   Mitsubishi letters were read by hand from documents he gave directly,
   "not in the app upload"; and "I would use Sonnet").

   A maker's brochure or trade price book often says what a letter in its
   model codes means — Mitsubishi's K is "WiFi Built-in". Tiff reads that
   legend off the document (code-letters-server.ts, on Sonnet), and this
   decides what to believe: a rule is kept only when the document gives an
   example of it — a code with the letter, and the same code without it —
   so where the letter sits is read off the example, never guessed. A person
   keeps the rules; then a unit priced through a code with the letter says
   what it means, and a near match that adds it says so.

   A rule applies to a code of the same family that has the letter where
   the example has it: Mitsubishi's MSZ-AP25VG(K)D2 reads as "MSZ, any
   series, a size, VG, then K", so MSZ-EF35VGKDW has it and MSZ-AP25VGD2
   doesn't.

   Pure and browser-safe (no lookbehind). */

export const CODE_LETTERS_SCHEMA = {
  type: "object",
  properties: {
    maker: { type: "string" },
    rules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          family: { type: "string" },
          letter: { type: "string" },
          meaning: { type: "string" },
          codeWith: { type: "string" },
          codeWithout: { type: "string" },
        },
        required: ["family", "letter", "meaning", "codeWith", "codeWithout"],
        additionalProperties: false,
      },
    },
  },
  required: ["maker", "rules"],
  additionalProperties: false,
} as const;

export const CODE_LETTERS_PROMPT =
  "This document is from an air-conditioning maker or a wholesaler. Find where it explains what a letter in a model code means: " +
  "a letter that marks Wi-Fi built in, demand response (DRED), a colour, a power supply, a refrigerant, a generation, and so on. " +
  "For each letter the document itself explains, give:\n" +
  '- family: the start of the model codes it applies to, as printed (for example "MSZ-AP")\n' +
  "- letter: the letter or letters, exactly as they appear in the code\n" +
  '- meaning: what it means, in a few plain words a customer would understand (for example "Wi-Fi built in")\n' +
  "- codeWith: one full model code printed in the document that has the letter\n" +
  '- codeWithout: the same model\'s code without the letter, as printed in the document, or "" when it shows none\n\n' +
  "Only letters the document explains in its own words; never guess a meaning from a code alone. " +
  "Also give maker: the maker's name. If the document explains no letters, return no rules.";

/** A letter in a maker's codes, what it means, and the document's own example of it. */
export type LetterRule = {
  family: string;
  letter: string;
  meaning: string;
  example: { with: string; without: string };
};

/** A rule a business kept, with where it came from. */
export type KeptRule = LetterRule & { id: string; supplierKey: string; source: string | null };

export type LettersRead = {
  maker: string;
  rules: LetterRule[];
  /** what was said and isn't kept, and why */
  skipped: { said: string; why: string }[];
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where a letter was inserted into a code to make another, or -1. */
function insertedAt(withIt: string, without: string, letter: string): number {
  if (withIt.length !== without.length + letter.length) return -1;
  for (let i = 0; i <= without.length; i++) {
    if (withIt.slice(i, i + letter.length) === letter && withIt.slice(0, i) + withIt.slice(i + letter.length) === without) return i;
  }
  return -1;
}

/** The example's code up to and through the letter, read as a pattern: the
    family as it is, a series as any letters, each size as any figures, and
    the rest as printed. Null when the example doesn't hold up. */
export function rulePattern(rule: LetterRule): RegExp | null {
  const family = norm(rule.family);
  const letter = norm(rule.letter);
  const withIt = sameUnitKey(rule.example.with);
  const without = sameUnitKey(rule.example.without);
  if (!family || !letter || !withIt.startsWith(family) || !without.startsWith(family)) return null;
  const at = insertedAt(withIt, without, letter);
  if (at < family.length) return null;
  const between = withIt.slice(family.length, at);
  const lead = /^[A-Z]*/.exec(between)![0];
  const rest = between.slice(lead.length).replace(/\d+/g, "\u0000");
  const body = escape(rest).split("\u0000").join("\\d+");
  return new RegExp(`^${escape(family)}${lead ? "[A-Z]*" : ""}${body}${escape(letter)}`);
}

/** Whether a code has a rule's letter where the rule's example has it. */
export function ruleApplies(rule: LetterRule, code: string): boolean {
  return rulePattern(rule)?.test(sameUnitKey(code)) ?? false;
}

/** The meanings a business's kept rules give a code. */
export function letterFeatures(code: string, rules: readonly LetterRule[]): string[] {
  return [...new Set(rules.filter((r) => ruleApplies(r, code)).map((r) => r.meaning))];
}

/** A rule's identity: one family, one letter, one place in the code. */
export const ruleKey = (rule: LetterRule) => `${norm(rule.family)}|${rulePattern(rule)?.source ?? ""}|${norm(rule.letter)}`;

/** What Tiff read, believed only as far as the document's own examples
    bear it out. A rule with no code without the letter is still kept when
    the letter sits only once in the code after its size. */
export function parseLettersRead(raw: unknown): LettersRead {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rules: LetterRule[] = [];
  const skipped: LettersRead["skipped"] = [];
  const seen = new Set<string>();
  for (const v of Array.isArray(r.rules) ? r.rules.slice(0, 60) : []) {
    const x = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const family = str(x.family, 24).toUpperCase();
    const letter = str(x.letter, 3).toUpperCase();
    const meaning = str(x.meaning, 60);
    const withIt = str(x.codeWith, 40).toUpperCase();
    let without = str(x.codeWithout, 40).toUpperCase();
    const said = `${letter || "?"}: ${meaning || "?"}${withIt ? ` (${withIt})` : ""}`;
    if (!/^[A-Z0-9]{1,3}$/.test(letter) || meaning.length < 2 || !family || !withIt) {
      skipped.push({ said, why: "not a letter and a meaning with an example" });
      continue;
    }
    if (!without) {
      /* the letter once after the code's size: take it out */
      const code = sameUnitKey(withIt);
      const size = /\d+/.exec(code.slice(norm(family).length));
      const after = size ? norm(family).length + size.index + size[0].length : -1;
      const first = after >= 0 ? code.indexOf(letter, after) : -1;
      if (first < 0 || code.indexOf(letter, first + 1) >= 0) {
        skipped.push({ said, why: "the document doesn't show where the letter sits" });
        continue;
      }
      without = code.slice(0, first) + code.slice(first + letter.length);
    }
    const rule: LetterRule = { family, letter, meaning, example: { with: withIt, without } };
    if (!rulePattern(rule)) {
      skipped.push({ said, why: "its example doesn't bear it out" });
      continue;
    }
    const key = ruleKey(rule);
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(rule);
  }
  return { maker: str(r.maker, 60), rules, skipped };
}

/** A rule in a few words, for a person to check: "K after VG, in MSZ codes". */
export function ruleWords(rule: LetterRule): string {
  const withIt = sameUnitKey(rule.example.with);
  const at = insertedAt(withIt, sameUnitKey(rule.example.without), norm(rule.letter));
  const before = at > 0 ? /[A-Z]+$/.exec(withIt.slice(0, at))?.[0] ?? "" : "";
  return `${rule.letter}${before ? ` after ${before}` : ""}, in ${rule.family} codes`;
}
