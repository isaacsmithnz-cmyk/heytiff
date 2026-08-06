/* "Ask Tiff about this document" — the handoff between a library row and the
   composer (brief §4D, the pattern that later serves fault rows and designs).

   SESSION STORAGE RATHER THAN A QUERY STRING, deliberately. The thing being
   carried is the opening of a question somebody is about to ask, and a
   question does not belong in a URL: it lands in history, in a shared link and
   in whatever logs the URL passes through. This is a note left on the way to
   the next screen, read once and torn up.

   READ ONCE IS THE WHOLE CONTRACT. `consume` removes as it reads, so a
   refresh, a back button or a second visit gets an empty composer instead of a
   question the user already asked. That also makes it safe under React's
   double-invoked effects in development: the second read finds nothing and the
   input keeps what the first one put there.

   THE OPENER IS A SENTENCE, NOT A LABEL. `In “City Multi fault codes”, ` ends
   in a space with the caret after it, so the next thing typed continues the
   sentence — the prefill is scaffolding for the question, never the question
   itself, and nothing is sent until a human presses send. */

export const ASK_HANDOFF_KEY = "heytiff.tiff.ask.v1";

/** Longest document title the opener quotes in full. A library title is
    allowed 160 characters, which is a paragraph in a one-line composer. */
export const TITLE_CAP = 80;

/** The sentence-opener a document hands the composer. Empty for a doc with no
    usable title — there is nothing honest to write into the box. */
export function askPrefill(title: string): string {
  const clean = String(title ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim();
  if (!clean) return "";
  const quoted =
    clean.length > TITLE_CAP ? `${clean.slice(0, TITLE_CAP - 1).trimEnd()}…` : clean;
  return `In “${quoted}”, `;
}

/** Longest code or blink pattern the opener repeats back. Anything longer is
    a description rather than a code, and it belongs in the box the tech is
    about to type in. */
export const CODE_CAP = 60;

/** The sentence-opener the Fault Finder hands the composer when a diagnosis
    lands on a code.

    THE CODE IS QUOTED AND THE SENTENCE IS FINISHED, which is the one place
    this differs from `askPrefill`. A library row knows the document but not
    the question, so it can only open one; here the tech has just typed the
    thing they want to know about, and the question they meant is the obvious
    one. Quoting also carries a blink pattern — "3 flashes then a pause" — as
    naturally as it carries "E5", and the words "fault code" are kept in the
    sentence because that is what routes the search at the far end.

    It still ends in a space with the caret after it: the brand and model are
    what turn a generic answer into this unit's answer, and that is the next
    thing worth typing. Empty for an empty code — there is nothing to ask. */
export function faultCodePrefill(code: string): string {
  const clean = String(code ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!clean) return "";
  const quoted = clean.length > CODE_CAP ? `${clean.slice(0, CODE_CAP - 1).trimEnd()}…` : clean;
  return `The unit is showing “${quoted}”. What does that fault code mean, and what causes it? `;
}

/** Leave the note. False when there was nothing to leave, or nowhere to leave
    it — a blocked storage costs the prefill, never the navigation. */
export function writeAskText(prefill: string): boolean {
  if (!prefill.trim()) return false;
  try {
    sessionStorage.setItem(ASK_HANDOFF_KEY, prefill);
    return true;
  } catch {
    return false;
  }
}

export function writeAskHandoff(title: string): boolean {
  return writeAskText(askPrefill(title));
}

/** Read the note and tear it up. Null when there wasn't one. */
export function consumeAskHandoff(): string | null {
  try {
    const raw = sessionStorage.getItem(ASK_HANDOFF_KEY);
    sessionStorage.removeItem(ASK_HANDOFF_KEY);
    // a value that is only whitespace is not a prefill; the trailing space of
    // a real one is load-bearing and is kept
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}
