/* What a file is, read off its name — the drawer's opening offer.

   A GUESS, NEVER A DECISION. Both of these prefill a field the uploader can
   change before anything is stored, so being wrong costs a click. That is the
   whole reason this is allowed to be a heuristic at all: nothing downstream
   trusts it, and the server re-validates the category it eventually receives.

   THE FILENAME'S OWN EMPHASIS DECIDES. "service-and-installation-manual" is
   both books at once, so the EARLIEST keyword wins rather than a fixed
   ranking — whoever named the file put the important word first. Equal
   positions fall back to the order the rules are listed in. */

import { kbTitle, type KbCategory } from "./files";

/* Matched against the name with every separator turned into a space, so
   `\b` behaves whether the file was named with spaces, dashes, underscores or
   dots. Stems (`servic\w*`) rather than whole words: plurals and -ing forms
   are the norm in a filename. `sop` is the exception — it is short enough to
   sit inside real words, so it is matched whole. */
const RULES: readonly { cat: KbCategory; re: RegExp }[] = [
  { cat: "faults", re: /\b(?:fault|error|troubleshoot|diagnos|servic|repair|alarm)\w*/ },
  { cat: "install", re: /\b(?:install|commission|fitting|mounting|setup)\w*/ },
  { cat: "sops", re: /\bsops?\b|\b(?:procedur|policy|policies|process|workflow|handbook|induction)\w*/ },
  {
    cat: "specs",
    re: /\bdata ?sheets?\b|\b(?:spec|catalog|catalogue|brochure|submittal|dimension|capacit|performance)\w*/,
  },
];

/** Lower case, and every separator a space — the shape the rules expect. */
function normalise(filename: string): string {
  return String(filename ?? "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* The shelf this file probably belongs on. Anything with no signal at all is
   a spec: a datasheet is what most of a manufacturer's library is, and it is
   the category a mis-guess does the least damage in — nobody searching fault
   codes is misled by a spec sheet sitting in the wrong pile. */
export function guessKbCategory(filename: string): KbCategory {
  const hay = normalise(filename);
  let best: { cat: KbCategory; at: number } | null = null;

  for (const rule of RULES) {
    const m = hay.match(rule.re);
    if (!m || m.index === undefined) continue;
    if (!best || m.index < best.at) best = { cat: rule.cat, at: m.index };
  }

  return best?.cat ?? "specs";
}

/* Words that stay lower case mid-title. Not applied to the first word, which
   is always capitalised. */
const SMALL = new Set(["a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "with"]);

/* Trade acronyms the industry writes in capitals but filenames often don't —
   "daikin vrv diagnosis manual.pdf" title-cased to "Daikin Vrv …", which no
   tech would type and which then reads wrong on every citation chip (found
   live: the one document in the pilot library wears it). Whole lowercase words
   only; a token with ANY capitals already keeps itself via `keepAsIs`. The
   value is the exact print, so "sops" can come out as "SOPs". */
const TRADE_CAPS: Record<string, string> = {
  vrv: "VRV",
  vrf: "VRF",
  hvac: "HVAC",
  ahu: "AHU",
  fcu: "FCU",
  pcb: "PCB",
  bms: "BMS",
  erv: "ERV",
  hrv: "HRV",
  iaq: "IAQ",
  dx: "DX",
  sop: "SOP",
  sops: "SOPs",
};

/** A piece of a model designation: short, or carrying a number. */
const isCodePiece = (p: string): boolean => /^[a-z0-9]+$/i.test(p) && (/\d/.test(p) || p.length <= 4);

/* A model number: digits beside letters, and EVERY hyphenated piece short or
   numbered. The second half is what keeps "r32-charging-guide" out — it has a
   digit and a hyphen too, and treating the whole thing as a part number would
   leave the title un-de-kebabbed. */
const isModelToken = (t: string): boolean =>
  /[a-z]/i.test(t) && /\d/.test(t) && t.split("-").every(isCodePiece);

/** Written in capitals by the person who named the file (VRF, PEAD-M, V-III). */
const isAcronym = (t: string): boolean => t.length >= 2 && t === t.toUpperCase() && /[A-Z]/.test(t);

const keepAsIs = (t: string): boolean => isAcronym(t) || isModelToken(t);

function cap(word: string, allowSmall: boolean): string {
  const lower = word.toLowerCase();
  const trade = TRADE_CAPS[lower];
  if (trade) return trade;
  if (allowSmall && SMALL.has(lower)) return lower;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/* A title a person would have typed, from the name the file arrived with.

   HYPHENS ARE SPLIT ON, EXCEPT INSIDE A MODEL NUMBER. De-kebabbing is the
   whole point — "install-checklist" is two words — but the same pass would
   turn PUZ-ZM250 into "Puz Zm250", which is not the same unit any more.
   Tokens carrying letters beside digits, and tokens already in capitals, are
   therefore copied out untouched rather than re-cased. */
export function titleFromFilename(name: string): string {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  const noExt = base.replace(/\.[a-zA-Z0-9]{1,5}$/, "");

  const parts: { text: string; verbatim: boolean }[] = [];
  for (const token of noExt.split(/[_\s]+/)) {
    if (!token) continue;
    if (keepAsIs(token)) {
      parts.push({ text: token, verbatim: true });
      continue;
    }
    // de-kebabbed, but a model number sitting inside the token still survives
    for (const word of token.split("-")) {
      if (word) parts.push({ text: word, verbatim: keepAsIs(word) });
    }
  }

  const words = parts.map((p, i) => (p.verbatim ? p.text : cap(p.text, i > 0)));
  return kbTitle(words.join(" "));
}
