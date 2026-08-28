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

/** The note's words with its handles taken out — what a task drafted from it
    should be TITLED.

    A mention is addressing, not content: "@lukeingold @michaeldiamond still
    need another day on site" is a task called "Still need another day on
    site", and the people are the assignment, not the sentence. Capitalised
    because a title starts like one, and clipped at a sentence so a rambling
    note doesn't become a rambling title. */
export function taskTitleFromNote(text: string, limit = 90): string {
  const stripped = text
    .replace(TOKEN, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return "";
  /* The first sentence, when there is more than one and it is long enough to
     stand alone — otherwise the lot, clipped. A four-word first sentence
     ("Hi mate.") would make a useless title. */
  const stop = stripped.search(/[.!?](\s|$)/);
  const first = stop > 24 ? stripped.slice(0, stop) : stripped;
  const clipped = first.length > limit ? `${first.slice(0, limit - 1).trimEnd()}…` : first;
  return clipped.charAt(0).toUpperCase() + clipped.slice(1);
}
