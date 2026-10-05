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

/** A code without the revision or region tag it wears (-A2, -E1, .TH,
    -AU, a build's R1), hyphens kept. */
function untagged(code: string): string {
  let c = code.toUpperCase().trim();
  c = c.replace(/(\.TH|-AU)$/, "");
  c = c.replace(/([A-Z])R\d$/, "$1");
  return c.replace(/-(A|E|ER|G)\d?$/, "");
}

/** The same unit whatever revision or region tag it wears. */
export function sameUnitKey(code: string): string {
  return untagged(code).replace(/-/g, "");
}

/** The same range and size, with the feature and build letters set aside. */
export function nearKey(code: string): string {
  let n = sameUnitKey(code);
  n = n.replace(/VGK?D?/, "VG");
  n = n.replace(/(VG|VF|VKA|VKM|YKM)D?\d?$/, "$1");
  return n;
}

/** The names a pack model stands for: its brochure shorthand read out —
    "PEAD-M50JAA(D)" is JAA or JAAD, "PKA-M71KA(L)2" is KA2 or KAL2,
    "PAR-CT01MAA-PB/SB" is the PB or the SB. */
export function packAlternatives(model: string): string[] {
  let names = [model.toUpperCase().trim()];
  names = names.flatMap((n) => {
    const m = /^(.*-)([A-Z0-9]+(?:\/[A-Z0-9]+)+)$/.exec(n);
    return m ? m[2]!.split("/").map((x) => m[1] + x) : [n];
  });
  for (let i = 0; i < 3; i++) {
    names = names.flatMap((n) => {
      const m = /\(([A-Z0-9]+)\)/.exec(n);
      return m ? [n.replace(m[0], ""), n.replace(m[0], m[1]!)] : [n];
    });
  }
  return [...new Set(names)];
}

/** A code's parts, tags aside: its family (PUMY), series letters and size
    (P 200), and the letters after (YKMD2). A multi's port count is part of
    its series: MXZ-4F71 is the 4F at 71. Null when it has no size. */
export function partsOf(code: string): { family: string; series: string; size: string; tail: string } | null {
  const m = /^([A-Z]+)-(\d*[A-Z]+|)(\d+)(.*)$/.exec(untagged(code));
  return m ? { family: m[1]!, series: m[2]!, size: m[3]!, tail: m[4]!.replace(/-/g, "") } : null;
}

type Parts = NonNullable<ReturnType<typeof partsOf>>;

/** What a near order code differs by, and so which group it waits in. */
export type DiffKind = "build" | "wifi" | "dred" | "letter";
export type Difference = { kind: DiffKind; words: string };

const letters = (t: string) => t.replace(/\d/g, "");
const digits = (t: string) => t.replace(/\D/g, "");
const WIFI_RANGES = /^(MSZ|MFZ)$/;
const DRED_RANGES = /^(MSZ|MFZ|MUZ|MXZ|MUFZ)$/;
/* the letters that make a unit what it is: the build's digits, the DRED
   "D" and the wall units' Wi-Fi "K" set aside */
const coreOf = (p: Parts) => {
  const t = letters(p.tail).replace(/D/g, "");
  return WIFI_RANGES.test(p.family) ? t.replace(/^VGK/, "VG") : t;
};
/** One more letter in one than the other, the rest in order: TB and PTB, MAA and MAAM. */
function oneLetterMore(a: string, b: string): boolean {
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (long.length !== short.length + 1) return false;
  for (let i = 0; i < long.length; i++) if (long.slice(0, i) + long.slice(i + 1) === short) return true;
  return false;
}

/** How a near order code differs from a pack name of the same range and
    size, in words a person can judge — null when it isn't near: another
    series, another supply (V and Y), a cold-climate HZ. */
export function differenceOf(model: Parts, code: Parts): Difference | null {
  if (model.family !== code.family || model.series !== code.series || model.size !== code.size) return null;
  const from = `${model.tail} → ${code.tail}`;
  if (coreOf(model) === coreOf(code)) {
    const wifi = WIFI_RANGES.test(code.family) && /VGK/.test(code.tail) && !/VGK/.test(model.tail);
    const dCount = (t: string) => (letters(t).match(/D/g) ?? []).length;
    const dred = DRED_RANGES.test(code.family) && dCount(code.tail) > dCount(model.tail);
    const [was, now] = [Number(digits(model.tail) || 0), Number(digits(code.tail) || 0)];
    const build = now !== was && digits(code.tail) !== "" ? (now > was ? "a newer build" : "an older build") : null;
    const said = [wifi ? "adds Wi-Fi built in (K)" : null, dred ? "adds demand response (D)" : null, build].filter(Boolean).join(", ");
    const kind: DiffKind = wifi ? "wifi" : dred ? "dred" : build ? "build" : "letter";
    return { kind, words: said ? `${from}, ${said}` : from };
  }
  if (digits(model.tail) === digits(code.tail) && oneLetterMore(letters(model.tail), letters(code.tail))) {
    return { kind: "letter", words: `${from}, ${letters(code.tail).length > letters(model.tail).length ? "one letter more" : "one letter fewer"}` };
  }
  return null;
}

export type Decision = "confirmed" | "rejected";

/** A unit that may be the pack model: every code it's sold under (its
    revisions, at every supplier), and what it differs by. One decision. */
export type Proposal = { codes: string[] } & Difference;

export type ModelLink = {
  /** the pack's model name */
  model: string;
  /** order codes it is priced by: exact or tag-only, and confirmed ones */
  codes: string[];
  /** near codes waiting for a person, best first */
  proposed: string[];
  /** the same, one per unit, with what each differs by */
  proposals: Proposal[];
};

/* the newest revision first: -A2 before -A1 */
const newestFirst = (a: string, b: string) => b.localeCompare(a);

/** Every pack model's links, given the codes the price books hold and the
    decisions already made ("model|code" → decision). A pack name in the
    brochure's shorthand links through every name it stands for. */
export function linkModels(models: string[], bookCodes: string[], decisions: Map<string, Decision>): ModelLink[] {
  const bySame = new Map<string, string[]>();
  const bySize = new Map<string, { code: string; parts: Parts }[]>();
  for (const c of new Set(bookCodes)) {
    const s = sameUnitKey(c);
    bySame.set(s, [...(bySame.get(s) ?? []), c]);
    const parts = partsOf(c);
    if (!parts) continue;
    const size = `${parts.family}|${parts.series}|${parts.size}`;
    bySize.set(size, [...(bySize.get(size) ?? []), { code: c, parts }]);
  }
  return models.map((model) => {
    const names = packAlternatives(model);
    const same = names.flatMap((n) => bySame.get(sameUnitKey(n)) ?? []);
    const confirmed = [...decisions.entries()]
      .filter(([k, d]) => d === "confirmed" && k.startsWith(`${model}|`))
      .map(([k]) => k.slice(model.length + 1));
    const codes = [...new Set([...same, ...confirmed])].sort(newestFirst);
    /* a near code still to decide, even beside an exact one: the pack's
       PUMY D2 links to the invoiced D2 exactly, and the trade book's newer
       D3 is the same unit to confirm. A unit's revisions and suppliers are
       one decision. */
    const byUnit = new Map<string, Proposal>();
    for (const n of names) {
      const parts = partsOf(n);
      if (!parts) continue;
      for (const c of bySize.get(`${parts.family}|${parts.series}|${parts.size}`) ?? []) {
        if (codes.includes(c.code) || decisions.has(`${model}|${c.code}`)) continue;
        const diff = differenceOf(parts, c.parts);
        if (!diff) continue;
        const unit = sameUnitKey(c.code);
        const had = byUnit.get(unit);
        if (had) {
          if (!had.codes.includes(c.code)) had.codes.push(c.code);
        } else byUnit.set(unit, { codes: [c.code], ...diff });
      }
    }
    const proposals = [...byUnit.values()]
      .map((p) => ({ ...p, codes: [...p.codes].sort(newestFirst) }))
      .sort((a, b) => newestFirst(a.codes[0]!, b.codes[0]!));
    return { model, codes, proposed: proposals.flatMap((p) => p.codes), proposals };
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
