/* What a search box asks for, and when it has started asking: the palette's
   and the jobs list's rules, shared so the two never disagree. */

/** Below this a query is a keystroke on the way to one, not a question. The
    same floor the mirror search uses, so the local and remote halves of one
    box never disagree about when searching has started. */
export const SEARCH_MIN = 2;

/* The word before the number: "job", "jobs", then "no", "no." or "number",
   each only as a whole word — "jobson" is a client, not a job. */
const JOB_LEAD = /^(?:jobs?(?=[\s#\d]|$)\s*(?:(?:number|no\.?)(?=[\s#\d]|$)\s*)?)?#?\s*/i;

/** What a search box asks for, from what somebody typed — the palette's and
    the Workboard's alike. People write the word before the number — "job
    288", "job #288", "#288", "job no. 288" — and every number is stored
    bare, so the lead goes and the rest is asked as typed: "job kingsford"
    asks for Kingsford. Nothing but the lead asks for nothing. */
export function jobSearchTerm(query: string): string {
  return query.trim().replace(JOB_LEAD, "").trim();
}
