/* WHO A SERVICEM8 NOTE IS TALKING TO.

   ServiceM8's notes carry @mentions, and the handle is not an id — it is the
   staff member's first and last name run together in lower case, spaces
   removed. Verified against the live mirror before this was written:
   @lukeingold appears 783 times, @michaeldiamond 161, @isaacsmith 130, and
   every handle in the account resolves that way, including the odd one whose
   surname is a full stop.

   So the WHO is a string join, not a lookup — which is the whole reason the
   attention strip can name a person at all without a model in the loop.

   PURE ON PURPOSE. The join it feeds crosses three tables (sm8_staff →
   integration_links → staff_profiles) and none of that belongs in a regex. */

/** ServiceM8's own handle for a staff member: first + last, lower case, no
    spaces. Null when there is nothing to build one from — a mirror row with
    no name can never be mentioned, and an empty handle would match every
    bare "@". */
export function sm8Handle(first: string | null, last: string | null): string | null {
  const joined = `${first ?? ""}${last ?? ""}`.replace(/\s+/g, "").toLowerCase();
  return joined ? joined : null;
}

/* The characters a handle can carry. Letters and digits obviously; dots
   because one live account holds a surname of ".", and hyphens because a
   double-barrelled surname keeps its own. Anything else — a comma, an
   apostrophe, the end of a sentence — ends the handle, which is what stops
   "@lukeingold's van" naming nobody. */
const TOKEN = /@([a-z0-9.'-]+)/gi;

/** Every handle this text mentions, in the order it says them, deduped.

    Matched against the handles we KNOW rather than returned raw: an email
    address in a note is full of "@" and none of it is a mention, and a
    trailing full stop is punctuation on half the sentences that end in a
    name. Trimming trailing dots and re-trying is the whole of that
    tolerance — a handle that genuinely ends in one still matches first. */
export function mentionedHandles(text: string, known: Iterable<string>): string[] {
  const set = new Set([...known].filter(Boolean));
  if (set.size === 0) return [];
  const found: string[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const raw = m[1].toLowerCase();
    /* Longest first: a handle that really ends in "." must not lose it to
       the sentence's full stop, and "ross." beats "ross" when both exist. */
    const candidates = [raw, raw.replace(/[.'-]+$/, "")];
    const hit = candidates.find((c) => c && set.has(c));
    if (hit && !found.includes(hit)) found.push(hit);
  }
  return found;
}

/** The note's words with its handles taken out, and nothing else done to
    them — what a row that has ALREADY NAMED the person should quote.

    A walk on live data caught why this is needed: the strip drew
    `Luke Ingold — "@LukeIngold Bill 90%"`, which says the same person twice
    in one line. The handle is addressing, and a row that opens with the name
    has already done the addressing. */
export function withoutHandles(text: string): string {
  return text.replace(TOKEN, " ").replace(/\s+/g, " ").trim();
}

/* A handle with the spaces either side of it, so taking one out can close
   the gap it leaves instead of leaving two spaces or a space before a
   comma. Horizontal only: a note's line breaks are its own. */
const SPACED_TOKEN = /([ \t]*)@([a-z0-9.'-]+)([ \t]*)/gi;

/* What can sit straight after a handle and end the gap: the end of a line,
   or the sentence's own punctuation. */
const CLOSES = /^$|^[\r\n,.;:!?)\]]/;

/* A character that makes the "@" part of an address rather than a mention:
   "susie@peterson.com" and "info@isaacsmith" name nobody. */
const IN_ADDRESS = /[a-z0-9._%+-]/i;

/** The note's words with only the handles we KNOW taken out — what a row
    that QUOTES a person should show.

    `withoutHandles` takes out every @word, which is right for a task's title
    and wrong for a quote: "email susie@peterson.com about it" became "email
    susie about it", half an address and a sentence that says something
    else. This takes out exactly what `mentionedHandles` would count, keeps
    an address whole (an "@" inside a word is never a mention), keeps a
    sentence's full stop when the handle ended it, and leaves every other
    character — line breaks included — where the writer put it. */
export function withoutKnownHandles(text: string, known: Iterable<string>): string {
  return sayKnownHandles(text, lowerSet(known), () => null);
}

/** A note as the diary QUOTES it to one reader: only the ADDRESSING taken
    out, and every other person it names said by name.

    Taking out every handle we know changed what was asked: "Hi @isaacsmith,
    can you ask @michaeldiamond to bring the ladder" became "Hi, can you ask
    to bring the ladder". A handle is addressing in two places only:
      - the run of handles the note opens with ("@isaacsmith @michaeldiamond
        please…", "@isaacsmith and @michaeldiamond please…"), which is who
        the note is to, not what it says — the run goes whole, with the
        colon or dash that closes it. Unless the sentence carries on from
        it with "and" ("@michaeldiamond and I will sort it"): then the run
        is who the sentence is ABOUT, and each handle in it is said by
        name, the reader's own included;
      - `addressing` wherever it is: the reader's own handle in a note to
        them, the asker's in the reader's reply. The row already says who
        is talking to whom.
    Every other handle we know becomes `names`' word for it — "can you ask
    Michael to bring the ladder" — and an address, an unknown @word and a
    possessive stay as written, as withoutKnownHandles leaves them. */
export function quotedNote(
  text: string,
  say: { names: ReadonlyMap<string, string>; addressing: Iterable<string> }
): string {
  const names = new Map([...say.names].filter(([h]) => h).map(([h, w]) => [h.toLowerCase(), w]));
  const addressing = lowerSet(say.addressing);
  const known = new Set([...names.keys(), ...addressing]);
  if (known.size === 0) return text.trim();
  const run = addressRun(text, known);
  const rest = run.subject ? text : text.slice(run.end);
  const about = run.subject ? run.end : 0;
  return sayKnownHandles(rest, known, (h, at) =>
    at >= about && addressing.has(h) ? null : names.get(h) ?? null
  );
}

/** A note as Tiff READS it for one reader: nothing taken out, and every
    handle we know said as `names`' word for it.

    The quote takes the addressing out, which is right for a row that
    already says who is talking to whom and wrong for a reader deciding
    what the note asks of whom: "@lukeingold when you send invoice can you
    send the warranty stuff / @isaacsmith can you send David the builder's
    contact" quoted to Isaac is two asks with nobody in front of either,
    and the real read (2026-09-26) made Luke's half part of Isaac's task.
    Here each part keeps the person it is to — "Luke when you send
    invoice… / Isaac can you send David…" — and an address, an unknown
    @word and a possessive stay as written, as the quote leaves them. */
export function namedNote(text: string, names: ReadonlyMap<string, string>): string {
  const words = new Map([...names].filter(([h, w]) => h && w).map(([h, w]) => [h.toLowerCase(), w]));
  return sayKnownHandles(text, new Set(words.keys()), (h) => words.get(h) ?? null);
}

const lowerSet = (hs: Iterable<string>) => new Set([...hs].filter(Boolean).map((h) => h.toLowerCase()));

/* Longest first, as mentionedHandles reads it: "ross." is a handle before
   "ross" is one with a full stop after it. "" when it is nobody we know. */
function knownIn(raw: string, known: ReadonlySet<string>): string {
  const lower = raw.toLowerCase();
  const bare = known.has(lower) ? lower : lower.replace(/[.'-]+$/, "");
  return bare && known.has(bare) ? bare : "";
}

/* Every known handle outside an address, through `say` (the handle, and
   where in `text` it stands): the words to put in its place, or null to
   take it out and close the gap it leaves. */
function sayKnownHandles(
  text: string,
  known: ReadonlySet<string>,
  say: (handle: string, at: number) => string | null
): string {
  if (known.size === 0) return text.trim();
  const out = text.replace(
    SPACED_TOKEN,
    (whole: string, lead: string, raw: string, trail: string, offset: number, all: string) => {
      const before = offset > 0 ? all[offset - 1] : "";
      if (lead === "" && before !== "" && IN_ADDRESS.test(before)) return whole;
      const bare = knownIn(raw, known);
      if (!bare) return whole;
      const kept = raw.slice(bare.length);
      const word = say(bare, offset + lead.length);
      if (word !== null) return `${lead}${word}${kept}${trail}`;
      const after = all.slice(offset + whole.length, offset + whole.length + 1);
      if (kept) return trail ? `${kept} ` : kept;
      if (CLOSES.test(after)) return "";
      return lead ? " " : "";
    }
  );
  return out.trim();
}

/* The handles a note opens with, joined by spaces, a comma, "&", "+", "/"
   or "and" — only while another handle follows the join. A handle that
   carries the sentence's full stop ends the run. `end` is where the rest
   of the note starts, past the colon, dash or line break that closes the
   run; 0 when it opens with no handle we know. `subject` when the sentence
   carries on from the run with "and" or "&" — "@michaeldiamond and I will
   sort it" — so the run is who it is about; `end` is then the run's own. */
const RUN_HANDLE = /^@([a-z0-9.'-]+)/i;
const RUN_JOIN = /^(?:[ \t]*[,&+/][ \t]*|[ \t]+and[ \t]+|[ \t]+)(?=@)/i;
const RUN_SUBJECT = /^(?:[ \t]*&|[ \t]+and\b)/i;
const RUN_CLOSE = /^[\s,:;.!?\u2013\u2014-]*/;

function addressRun(text: string, known: ReadonlySet<string>): { end: number; subject: boolean } {
  let i = text.length - text.trimStart().length;
  let end = 0;
  let stopped = false;
  for (;;) {
    const m = RUN_HANDLE.exec(text.slice(i));
    const bare = m ? knownIn(m[1], known) : "";
    if (!m || !bare) break;
    i += 1 + bare.length;
    end = i;
    if (m[1].length > bare.length) {
      stopped = true;
      break;
    }
    const join = RUN_JOIN.exec(text.slice(i));
    if (!join) break;
    i += join[0].length;
  }
  if (end === 0) return { end: 0, subject: false };
  if (!stopped && RUN_SUBJECT.test(text.slice(end))) return { end, subject: true };
  return { end: end + (RUN_CLOSE.exec(text.slice(end))?.[0].length ?? 0), subject: false };
}

/** The note's words with its handles taken out — what a task drafted from it
    should be TITLED.

    A mention is addressing, not content: "@lukeingold @michaeldiamond still
    need another day on site" is a task called "Still need another day on
    site", and the people are the assignment, not the sentence. Capitalised
    because a title starts like one, and clipped at a sentence so a rambling
    note doesn't become a rambling title. */
export function taskTitleFromNote(text: string, limit = 90): string {
  const stripped = withoutHandles(text);
  if (!stripped) return "";
  /* The first sentence, when there is more than one and it is long enough to
     stand alone — otherwise the lot, clipped. A four-word first sentence
     ("Hi mate.") would make a useless title. */
  const stop = stripped.search(/[.!?](\s|$)/);
  const first = stop > 24 ? stripped.slice(0, stop) : stripped;
  const clipped = first.length > limit ? `${first.slice(0, limit - 1).trimEnd()}…` : first;
  return clipped.charAt(0).toUpperCase() + clipped.slice(1);
}
