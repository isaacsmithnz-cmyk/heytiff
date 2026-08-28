/* The way back OUT of HeyTiff — ServiceM8's own web-app deep links.

   VERIFIED, NOT REMEMBERED. developer.servicem8.com/reference/listjobs.md
   carries a section headed "Opening Records in ServiceM8" giving
   `https://go.servicem8.com/OpenJob/{job_uuid}` (and the sibling
   `OpenClient/{uuid}`), and says in terms that these are web-app links, not
   REST endpoints, and take no API authentication: a staff member who isn't
   signed in is redirected through login and back to the record. Checked
   2026-08-28 — read the page before changing a character of this, the way
   sm8.ts's OAuth endpoints are treated.

   IT IS DOCUMENTATION, NOT A FIELD THE API RETURNS, so it can go stale
   silently: nothing in a response would tell us the pattern had moved. That
   is the whole reason the URL is built in exactly one place.

   Client-safe on purpose — sm8.ts is server-only (it holds the OAuth
   client), and a chip in the job card cannot import that. This module is a
   string and a guard. */

const SM8_APP_BASE = "https://go.servicem8.com/";

/** ServiceM8's uuids are ordinary v4 strings; anything else is not an id we
    were given, and a URL built from it would send the reader to a 404 with
    our own rubbish in the path. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The job's door, or null when there is no id to open — a caller renders
    nothing rather than a link that goes nowhere. */
export function sm8JobUrl(uuid: string | null | undefined): string | null {
  const id = uuid?.trim() ?? "";
  return UUID.test(id) ? `${SM8_APP_BASE}OpenJob/${id}` : null;
}
