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

/** Leave the note. False when there was nothing to leave, or nowhere to leave
    it — a blocked storage costs the prefill, never the navigation. */
export function writeAskHandoff(title: string): boolean {
  const prefill = askPrefill(title);
  if (!prefill) return false;
  try {
    sessionStorage.setItem(ASK_HANDOFF_KEY, prefill);
    return true;
  } catch {
    return false;
  }
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
