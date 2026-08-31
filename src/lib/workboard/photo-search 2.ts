/* Turning what somebody typed into something Postgres can answer.

   PURE AND CLIENT-SAFE: the action that runs the query is a `"use server"`
   module and may only export async Server Functions, so the parsing and the
   shaping live here where they can be tested against the strings people
   actually type.

   FOUR MATCHERS, and the count went UP after an earlier claim here was found
   to be too strong. It said a tsvector could not find a partial model number.
   Measured, that is only true of `websearch_to_tsquery`, which cannot emit a
   prefix:

     to_tsvector('simple','MODEL PUZ-M125VKA2-A')
       @@ websearch_to_tsquery('simple','PUZ-M125')              ->  FALSE
       @@ to_tsquery('simple', quote_literal('puz-m125')||':*')  ->  TRUE

   `puz-m125` is a PREFIX of the lexeme `puz-m125vka2-a`, so the vector finds
   it — through the GIN index, which the ILIKE never was. What ILIKE is
   actually for is the narrower thing only it can do: a fragment starting in
   the MIDDLE of a token (`vka2`), which no tsquery reaches.

     · a prefix tsquery — words and leading fragments, indexed
     · ILIKE           — true mid-token fragments
     · array overlap   — the tags, which cannot be in the tsvector at all
                         (array_to_string is only STABLE)

   Each contributes to the rank, so a photo matched several ways sorts above
   one matched by a substring alone.

   THE QUERY ITSELF IS `search_job_photos`, not built here — see
   docs/migrations/search_job_photos_fn.sql for why the escaping and the
   matching belong in one testable place. */

/** How many results one search returns. A wall of photographs is answered by
    looking, not by paging — but an unbounded query over a bank that grows to
    tens of thousands is how a search box becomes a timeout. */
export const PHOTO_SEARCH_LIMIT = 120;

/** The shortest query worth running. One character matches most of the bank
    and tells nobody anything. */
export const PHOTO_SEARCH_MIN = 2;

export type PhotoQuery = {
  /** The whole trimmed string — what ILIKE looks for, verbatim, because a
      model number is a substring and not a word. */
  raw: string;
  /** The individual words, lowercased — what the tags are matched against. */
  words: string[];
  /** True when there is enough here to be worth asking the database. */
  usable: boolean;
};

/** Read a typed query.

    THE RAW STRING SURVIVES INTACT. Splitting `PUZ-M125` into `puz` and `m125`
    and searching for those separately is how you match every Mitsubishi
    outdoor unit in the account instead of the one somebody wanted. */
export function parsePhotoQuery(input: string): PhotoQuery {
  const raw = (input ?? "").trim().slice(0, 120);
  const words = raw
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1);
  return { raw, words, usable: raw.length >= PHOTO_SEARCH_MIN };
}

/* THE ESCAPING LIVES IN SQL, NOT HERE. It used to be a `escapeLike` helper in
   this module, and having it in two languages is the bug it was meant to
   prevent: one of the copies would eventually drift. `search_job_photos` owns
   the LIKE pattern, and it is tested there — `%`, `_` and `a,b` all return
   nothing. */

/* ── ranking, done here rather than in SQL ──
   The three matchers cannot be summed inside a single portable query without
   naming them all twice, so the query returns WHICH ways each row matched and
   the ordering is computed here. That also means the weights are visible,
   testable, and changeable without a migration. */

export type PhotoMatch = {
  /** The tsvector matched: a real word in the caption, transcription, job or client. */
  text: boolean;
  /** The raw string appears inside the transcription. A model number's home. */
  transcript: boolean;
  /** The raw string appears in the caption. */
  caption: boolean;
  /** One of the query's words is one of the photo's tags. */
  tag: boolean;
};

/** What a match is worth.

    THE TRANSCRIPTION OUTWEIGHS EVERYTHING because of what these photographs
    are: if the thing you typed is literally printed on the equipment in the
    frame, that is not a coincidence and not a near-miss. A tag is the weakest
    on its own — tags are broad by design — but it lifts a photo that also
    matched some other way, which is exactly the ensemble behaviour that makes
    a search feel like it works. */
const WEIGHT = { transcript: 1, text: 0.6, caption: 0.5, tag: 0.25 } as const;

export function scoreMatch(m: PhotoMatch): number {
  return (
    (m.transcript ? WEIGHT.transcript : 0) +
    (m.text ? WEIGHT.text : 0) +
    (m.caption ? WEIGHT.caption : 0) +
    (m.tag ? WEIGHT.tag : 0)
  );
}

/** Order results: best match first, and ties broken by the most recently read
    so a fresh photograph is not buried under an identical older one. */
export function rankPhotos<T extends { match: PhotoMatch; readAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const d = scoreMatch(b.match) - scoreMatch(a.match);
    if (d !== 0) return d;
    return b.readAt.localeCompare(a.readAt);
  });
}

/** The phrase a result list leads with. Says what was searched and how much
    came back, because "23 results" alone does not tell you whether the bank
    is small or your query was narrow. */
export function searchSummary(count: number, banked: number, term: string): string {
  const found =
    count === 0 ? "Nothing" : count === 1 ? "1 photo" : `${count} photos`;
  const of = banked === 1 ? "1 photo read so far" : `${banked} photos read so far`;
  return count === 0
    ? `${found} matching “${term}” — out of ${of}.`
    : `${found} matching “${term}”, out of ${of}.`;
}
