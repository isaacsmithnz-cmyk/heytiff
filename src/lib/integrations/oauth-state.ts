/* The OAuth `state` handshake, in one place because both routes have to agree
   about it exactly.

   State does two jobs here. Xero's own is CSRF: the value we send must be the
   value that comes back, so somebody else's authorisation code can't be walked
   into our callback. Ours is BINDING: the cookie also carries the org the flow
   was started from, and the callback refuses if the session has since moved to
   a different one. Without that, an owner of two orgs who switches tabs
   mid-consent lands their accounting system on the wrong company — silently,
   and with no error anywhere.

   The cookie is httpOnly (the browser never needs to read it), sameSite=lax
   (Xero returns via a top-level GET, which lax allows and strict would eat),
   and scoped to the two routes that use it. */

export const STATE_COOKIE = "xero_oauth_state";

/** Ten minutes is longer than a consent screen takes and shorter than a
    forgotten tab. An expired cookie reads as "start again", not as an error. */
export const STATE_TTL_SECONDS = 600;

/** Path both routes live under, so the cookie is sent to the callback and to
    nothing else. */
export const STATE_COOKIE_PATH = "/api/integrations/xero";

export type StateCookie = { state: string; orgId: string };

export function encodeState(value: StateCookie): string {
  return `${value.state}:${value.orgId}`;
}

/** Split on the FIRST colon only: the random half never contains one, and an
    org id is whatever the session says it is. Returns null for anything that
    doesn't yield both halves. */
export function decodeState(raw: string | undefined | null): StateCookie | null {
  if (!raw) return null;
  const i = raw.indexOf(":");
  if (i <= 0) return null;
  const state = raw.slice(0, i);
  const orgId = raw.slice(i + 1);
  if (!state || !orgId) return null;
  return { state, orgId };
}

/** Does the callback match the flow we started? Every mismatch is the same
    answer — there is nothing a user could do differently for one and not the
    others, and distinguishing them out loud only helps someone probing. */
export function stateMatches(
  cookie: StateCookie | null,
  returnedState: string | null,
  sessionOrgId: string
): boolean {
  if (!cookie || !returnedState) return false;
  if (cookie.state !== returnedState) return false;
  return cookie.orgId === sessionOrgId;
}
