/* The Auth0 Management API — server only, and deliberately tiny.

   WHY THIS EXISTS AT ALL. `profiles.email` is not a fact this app owns. It is
   re-upserted from the Auth0 session on every single login (see
   lib/auth0.ts, `beforeSessionSaved`), so writing a new address into our own
   table changes what the app displays until the next sign-in and nothing
   after that. The address lives in Auth0, and the only way to move it is
   this API.

   ONE APPLICATION, NOT A NEW ONE. The client credentials here are the app's
   own — the same AUTH0_CLIENT_ID/SECRET that run the login. Auth0 lets a
   Regular Web Application hold a Management API grant, so this needs no
   second set of secrets to leak; what it DOES need is that grant, authorised
   once in the dashboard with `update:users`. Until someone does that, every
   call here comes back 403 and `NO_GRANT` is what the screen says. That is a
   configuration fact, not a bug, and it must read like one.

   THE SCOPES ARE THE SECURITY BOUNDARY. `update:users` is enough to change
   anybody's email in the tenant, so nothing in this module decides WHOSE
   email is being changed — the caller passes a user id, and the one caller
   there is takes it from the session and nowhere else. See
   app/actions/account.ts. A function here that took an id off a request would
   be an account-takeover endpoint. */

import "server-only";
import { resolveTenantDomain } from "./auth0-tenant-domain";

/* NOT `AUTH0_DOMAIN`, and the difference only appears the day a custom domain
   does. Auth0 keeps the Management API on the canonical tenant name even
   after login moves to auth.example.com, so the two names split and this one
   must follow the tenant. `auth0-tenant-domain.ts` carries the argument and
   refuses to guess when it cannot. */
const resolved = resolveTenantDomain(process.env);
const DOMAIN = resolved.ok ? resolved.domain : "";
/* A misconfiguration is not a missing configuration: NOT_CONFIGURED means "no
   tenant wired up", which is a fine state for a local checkout, and it must
   not silently swallow "you pointed this at a custom domain". Said once, at
   boot, naming the variable. */
if (!resolved.ok && process.env.AUTH0_DOMAIN) {
  console.error(`Auth0 Management API disabled — ${resolved.reason}`);
}
const CLIENT_ID = process.env.AUTH0_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.AUTH0_CLIENT_SECRET ?? "";

/** Every way this can fail that a person needs told apart. The screen turns
    each into a sentence; nothing here writes UI copy. */
export type MgmtError =
  /** No AUTH0_* vars — a local checkout without a real tenant. */
  | "NOT_CONFIGURED"
  /** The application has no Management API grant, or not `update:users`. */
  | "NO_GRANT"
  /** Somebody else in the tenant already signs in with that address. */
  | "EMAIL_IN_USE"
  /** Auth0 rejected the value itself. */
  | "REJECTED"
  /** Network, 5xx, or anything unrecognised. */
  | "UNAVAILABLE";

export type MgmtResult<T> = { ok: true; value: T } | { ok: false; error: MgmtError; detail?: string };

export const isAuth0ManagementConfigured = () =>
  Boolean(DOMAIN && CLIENT_ID && CLIENT_SECRET);

/* THE TOKEN IS CACHED IN MODULE MEMORY, with a minute shaved off its life.

   Management tokens last 24 hours and are rate-limited to mint, so fetching
   one per call would be both slow and a way to get throttled. The margin
   matters more than it looks: a token that expires between "we checked" and
   "Auth0 read it" fails the user's request for a reason they cannot act on.

   Per-process, so a serverless instance that never warms simply mints its
   own. There is nothing to invalidate — the only thing that could make a
   cached token wrong is the grant being revoked, and that arrives as a 403
   the next call, which is handled. */
let cached: { token: string; expiresAtMs: number } | null = null;

async function token(): Promise<MgmtResult<string>> {
  if (!isAuth0ManagementConfigured()) return { ok: false, error: "NOT_CONFIGURED" };
  if (cached && cached.expiresAtMs > Date.now()) return { ok: true, value: cached.token };

  let res: Response;
  try {
    res = await fetch(`https://${DOMAIN}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        audience: `https://${DOMAIN}/api/v2/`,
      }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "UNAVAILABLE" };
  }

  /* A tenant that has never authorised this application answers the token
     request itself with 403 `access_denied` — the failure lands here rather
     than on the call that wanted it, which is why NO_GRANT is raised in both
     places. */
  if (res.status === 401 || res.status === 403) return { ok: false, error: "NO_GRANT" };
  if (!res.ok) return { ok: false, error: "UNAVAILABLE" };

  const body = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number }
    | null;
  if (!body?.access_token) return { ok: false, error: "UNAVAILABLE" };

  const lifetime = typeof body.expires_in === "number" ? body.expires_in : 86400;
  cached = {
    token: body.access_token,
    expiresAtMs: Date.now() + Math.max(0, lifetime - 60) * 1000,
  };
  return { ok: true, value: cached.token };
}

/** Move a user's sign-in address, and mark it unverified.

    `email_verified: false` IS PART OF THE CHANGE, not a nicety beside it. An
    address nobody has proved they can read is not yet an identity, and
    leaving the flag true would let a typo become a verified login. Auth0
    treats the pair as one write.

    `name` IS OPTIONAL AND ALMOST ALWAYS OMITTED. Auth0 seeds `name` with the
    email address when a database user is created, so somebody who never
    typed a real name is left displaying their OLD address as their name
    forever after a move — which is exactly what happened to the first person
    to use this screen. The caller decides whether that applies; this
    function only carries the value, because "is this name really just the
    old email" is a product question and not an HTTP one. See
    app/actions/account.ts. */
export async function setUserEmail(
  userId: string,
  email: string,
  name?: string,
): Promise<MgmtResult<{ email: string }>> {
  const t = await token();
  if (!t.ok) return t;

  let res: Response;
  try {
    res = await fetch(`https://${DOMAIN}/api/v2/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${t.value}`, "content-type": "application/json" },
      body: JSON.stringify(name === undefined ? { email, email_verified: false } : { email, email_verified: false, name }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "UNAVAILABLE" };
  }

  if (res.ok) return { ok: true, value: { email } };
  if (res.status === 403) return { ok: false, error: "NO_GRANT" };
  /* 409 is Auth0's "somebody already signs in with that", and it is the one
     failure a person can actually do something about, so it never gets
     folded into the general case. */
  if (res.status === 409) return { ok: false, error: "EMAIL_IN_USE" };
  if (res.status === 400 || res.status === 422) {
    const detail = await res.text().catch(() => "");
    return { ok: false, error: "REJECTED", detail: detail.slice(0, 300) };
  }
  return { ok: false, error: "UNAVAILABLE" };
}

/** Ask Auth0 to send its own "verify your address" mail.

    THIS APP CANNOT SEND EMAIL. Resend was never wired (see the TODO in
    app/actions/invite.ts), which is also why an invite is a copied link. So
    the verification cannot be ours — it is Auth0's own job endpoint, using
    whatever email provider the tenant has configured.

    BEST EFFORT ON PURPOSE. The address has already moved by the time this is
    called, and failing the whole change because the courier was busy would
    leave the person believing nothing happened when their sign-in address had
    in fact changed. The caller reports it as an extra line, never as failure. */
export async function sendVerificationEmail(userId: string): Promise<MgmtResult<true>> {
  const t = await token();
  if (!t.ok) return t;

  try {
    const res = await fetch(`https://${DOMAIN}/api/v2/jobs/verification-email`, {
      method: "POST",
      headers: { authorization: `Bearer ${t.value}`, "content-type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
      cache: "no-store",
    });
    if (res.ok) return { ok: true, value: true };
    if (res.status === 403) return { ok: false, error: "NO_GRANT" };
    return { ok: false, error: "UNAVAILABLE" };
  } catch {
    return { ok: false, error: "UNAVAILABLE" };
  }
}

/** Test seam — the module-level token cache would otherwise leak between
    cases and make the second one pass for the wrong reason. */
export function __resetManagementTokenCache() {
  cached = null;
}
