/* THE JOB A TASK'S WORDS NAME, for the task form to offer when the task has
   no job of its own. A number is a job when it is written as one: "#2845",
   "job 2845", or a number with a name after it, "Proceed with 3450
   Kingsford". A number followed by anything else is a measure or a model:
   "140 single-phase outdoor" offered job #140 (Isaac, 28 October 2026). */

const MARKED = /(?:#|\bjob\s+#?)(\d{3,6}[A-Z]?)\b/i;
const NAMED = /\b(\d{3,6}[A-Z]?)\s+(?=[A-Z][a-z])/;

export function namedJobNumber(title: string): string | null {
  return MARKED.exec(title)?.[1] ?? NAMED.exec(title)?.[1] ?? null;
}
