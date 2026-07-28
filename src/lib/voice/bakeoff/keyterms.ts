/* Building the keyterm list — the biggest accuracy lever we control.

   Keyterm prompting biases the transcriber toward words it would otherwise
   guess at: staff first names, client names, street names, model strings. It
   is why proper nouns survive, and proper nouns are what routing runs on.

   THE CAP IS SMALL AND THAT MAKES THIS A REAL DESIGN PROBLEM. ElevenLabs'
   own sources disagree: the capabilities overview says 1,000 terms for batch,
   while the API reference and their skills repo both say 100 (each ≤50 chars,
   ≤5 words). We default to the conservative 100 — two independent sources beat
   one, and being wrong the other way means a 422 on every call. `max` is a
   parameter so the first live run settles it empirically: raise it, and if
   nothing 422s the overview was right.

   At 100 terms you cannot send the whole company. A roster plus a client list
   plus every street already overflows it, so SELECTION matters and is worth
   measuring — which is why the pools are priority-ordered and the order is an
   input rather than a constant.

   ANTI-CHEAT, and this is the one that invalidates the whole exercise if you
   get it wrong: the pools must be the org's REAL lists — every tech, every
   client, every street — not the terms that happen to appear in the recording
   being scored. Seeding a case's own answers as keyterms measures nothing
   except your ability to write down what you already know. `assertNotSeeded`
   exists to make that mistake loud. */

/** ElevenLabs rejects these outright in a keyterm. */
const UNSUPPORTED = /[<>{}[\]\\]/g;

export const KEYTERM_MAX_CHARS = 50;
export const KEYTERM_MAX_WORDS = 5;
export const KEYTERM_DEFAULT_CAP = 100;

/** Named pools, listed in the order they should win the cap. Earlier pools are
    filled first; a later pool gets whatever room is left. */
export type KeytermPools = {
  /** Staff first names + preferred names. Highest value: they route work. */
  people?: string[];
  /** Street names and suburbs — what a site is identified by out loud. */
  sites?: string[];
  /** Client and business names. */
  clients?: string[];
  /** Model strings: "PUMY-SP112", "Bosch 5000". */
  equipment?: string[];
  /** Trade vocabulary: "condensate", "penetrations", "grilles". */
  vocab?: string[];
};

export const POOL_ORDER = ["people", "sites", "clients", "equipment", "vocab"] as const;

export type PoolName = (typeof POOL_ORDER)[number];

/** Strip unsupported characters and collapse whitespace. Returns null when
    nothing usable is left, or the term breaks a documented limit. */
export function cleanTerm(raw: string): string | null {
  const cleaned = raw.replace(UNSUPPORTED, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length === 0 || cleaned.length > KEYTERM_MAX_CHARS) return null;
  if (cleaned.split(" ").length > KEYTERM_MAX_WORDS) return null;
  return cleaned;
}

export type KeytermBuild = {
  terms: string[];
  /** Terms that could not be sent, and why — surfaced rather than swallowed,
      so a silently-dropped model string is visible when a case fails. */
  rejected: { term: string; reason: "unusable" | "over-cap" }[];
};

export function buildKeyterms(
  pools: KeytermPools,
  opts: { max?: number; order?: readonly PoolName[] } = {},
): KeytermBuild {
  const max = opts.max ?? KEYTERM_DEFAULT_CAP;
  const order = opts.order ?? POOL_ORDER;

  const terms: string[] = [];
  const rejected: KeytermBuild["rejected"] = [];
  const seen = new Set<string>();

  for (const pool of order) {
    for (const raw of pools[pool] ?? []) {
      const cleaned = cleanTerm(raw);
      if (cleaned === null) {
        rejected.push({ term: raw, reason: "unusable" });
        continue;
      }
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      if (terms.length >= max) {
        rejected.push({ term: cleaned, reason: "over-cap" });
        continue;
      }
      seen.add(key);
      terms.push(cleaned);
    }
  }
  return { terms, rejected };
}

/** Throw if the pools look like they were written from one recording's
    expectations rather than from the org's real data. Not a proof — a small
    company genuinely has few staff — but it catches the obvious mistake of a
    five-term pool that happens to contain exactly this case's answers. */
export function assertNotSeeded(pools: KeytermPools, expectedTerms: readonly string[]): void {
  const all = POOL_ORDER.flatMap((p) => pools[p] ?? []).map((t) => t.toLowerCase());
  if (all.length === 0 || expectedTerms.length === 0) return;
  const overlap = expectedTerms.filter((t) => all.includes(t.toLowerCase())).length;
  // Every pooled term appearing in one short recording means the pool IS the
  // recording. A real roster is mostly people who aren't in this note.
  if (overlap === all.length && all.length < 20) {
    throw new Error(
      `keyterm pools look seeded from a single case (${overlap}/${all.length} terms appear in it). ` +
        `Pools must be the org's full lists — every tech, every client, every street — not one note's answers.`,
    );
  }
}
