/* THE EQUIPMENT PACK'S MODELS, LINKED TO THE CODES THEY'RE ORDERED BY.

   The Studio's pack names a unit as the brochure does ("MSZ-AP71VGD2"); the
   price books sell it under its order code ("MSZ-AP71VGKD2-A2"). Nothing in
   the pack is renamed — a saved design keeps the name it was drawn with —
   the order code is found BESIDE it:

   - EXACT, or differing only by a revision or region tag (-A1, -E1, -AU,
     .TH): the same unit, linked without asking.
   - NEAR: the same range and size with letters that differ (K for Wi-Fi
     built in, D for DRED, a newer build D2 → D3). Proposed, and linked only
     once a person confirms it on the Quoting page; a rejection is kept too,
     so it is never proposed again.

   And the order code's letters say something a client wants to read —
   "K" is Wi-Fi built in — so they are turned into words for the quote.
   Pure. */

/** The same unit whatever revision or region tag it wears. */
export function sameUnitKey(code: string): string {
  let c = code.toUpperCase().trim();
  c = c.replace(/(\.TH|-AU)$/, "");
  c = c.replace(/-(A|E|ER|G)\d?$/, "");
  return c.replace(/-/g, "");
}

/** The same range and size, with the feature and build letters set aside. */
export function nearKey(code: string): string {
  let n = sameUnitKey(code);
  n = n.replace(/VGK?D?/, "VG");
  n = n.replace(/(VG|VF|VKA|VKM|YKM)D?\d?$/, "$1");
  return n;
}

export type Decision = "confirmed" | "rejected";

export type ModelLink = {
  /** the pack's model name */
  model: string;
  /** order codes it is priced by: exact or tag-only, and confirmed ones */
  codes: string[];
  /** near codes waiting for a person, best first */
  proposed: string[];
};

/** Every pack model's links, given the codes the price books hold and the
    decisions already made ("model|code" → decision). */
export function linkModels(models: string[], bookCodes: string[], decisions: Map<string, Decision>): ModelLink[] {
  const bySame = new Map<string, string[]>();
  const byNear = new Map<string, string[]>();
  for (const c of new Set(bookCodes)) {
    const s = sameUnitKey(c);
    bySame.set(s, [...(bySame.get(s) ?? []), c]);
    const n = nearKey(c);
    byNear.set(n, [...(byNear.get(n) ?? []), c]);
  }
  /* the newest revision first: -A2 before -A1 */
  const newestFirst = (a: string, b: string) => b.localeCompare(a);
  return models.map((model) => {
    const same = bySame.get(sameUnitKey(model)) ?? [];
    const confirmed = [...decisions.entries()]
      .filter(([k, d]) => d === "confirmed" && k.startsWith(`${model}|`))
      .map(([k]) => k.slice(model.length + 1));
    const codes = [...new Set([...same, ...confirmed])].sort(newestFirst);
    /* a near code still to decide, even beside an exact one: the pack's
       PUMY D2 links to the invoiced D2 exactly, and the trade book's newer
       D3 is the same unit to confirm */
    const proposed = (byNear.get(nearKey(model)) ?? [])
      .filter((c) => !codes.includes(c) && !decisions.has(`${model}|${c}`))
      .sort(newestFirst);
    return { model, codes, proposed };
  });
}

/* What an order code's letters mean, in a client's words. Only the letters
   whose meaning is settled for the range are read; nothing is guessed from
   a letter that could mean something else. */
const FEATURES: { test: RegExp; words: string }[] = [
  /* the wall and floor units' "K" — the trade book's "WiFi Built-in"
     (MSZ-AP25-80, MSZ-EF, MFZ-KW) */
  { test: /^(MSZ|MFZ)-[A-Z]+\d+VGK/, words: "Wi-Fi built in" },
  /* "D" after the series on the R32 outdoors: ready for demand response */
  { test: /^(MUZ|MXZ)-[A-Z0-9]+VGD|^(MSZ|MFZ)-[A-Z]+\d+VGK?D/, words: "Demand response (DRED) ready" },
];

/** The features an order code says the unit has, for the quote's line. */
export function codeFeatures(code: string): string[] {
  const c = code.toUpperCase();
  return FEATURES.filter((f) => f.test.test(c)).map((f) => f.words);
}
