/* New › Task's words (v2): one task a line, so a list makes several at
   once (Isaac, 18 October). Pure, so the form can count what a save will
   make and the action can make exactly that. */

/** The most tasks one save makes: a list, not a document. */
export const TASKS_AT_ONCE = 20;

/** The tasks a form's words make: one a line, trimmed, blank lines dropped,
    each at most 200 characters, at most TASKS_AT_ONCE. */
export function taskLinesOf(text: string): string[] {
  return (typeof text === "string" ? text.split(/\r?\n/) : [])
    .map((l) => l.trim().slice(0, 200).trim())
    .filter(Boolean)
    .slice(0, TASKS_AT_ONCE);
}
