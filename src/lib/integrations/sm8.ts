/* The ServiceM8 OAuth 2.0 client — server only.

   Xero's sibling (xero.ts), minus the SDK: ServiceM8 is plain OAuth 2.0 over
   two endpoints and a REST base, so this module is fetch + URLSearchParams and
   nothing stateful can leak. Endpoints and parameter names were verified
   against developer.servicem8.com/docs/authentication on 2026-07-28 — check
   the doc before changing one, not memory.

   NOTHING FROM SERVICEM8 IS FORWARDED VERBATIM. A refused exchange or refresh
   comes back as our own sentence or a classification — an upstream error body
   can name the client id or the redirect URI, and none of that belongs in a
   page. The body does go to the server log, truncated, with the secret and the
   token we sent struck out of it: which of "revoked" and "unavailable" a
   refusal was is decided from that body, and the log is the only witness when
   the decision is wrong.

   TWO THINGS THE CALLER MUST KNOW:
   - The refresh token ROTATES on every refresh. Whoever calls
     `refreshSm8Tokens` must persist what comes back under the single-flight +
     conditional-write discipline in sm8-store.ts, or the connection strands.
   - ServiceM8 documents NO revocation endpoint. A disconnect here deletes our
     sealed tokens; fully ending the grant on their side means removing the
     HeyTiff add-on inside ServiceM8 itself, and the screen says so.

   The credentials come from SM8_CLIENT_ID / SM8_CLIENT_SECRET with no
   NEXT_PUBLIC_ prefix, so Next cannot inline them into client code. Unset
   means the integration simply isn't available on this deployment —
   `sm8Config()` returns null and the screen says so. */

import { SM8_SCOPE_LIST } from "./providers";
import { sm8Request, type Sm8Call } from "./sm8-http";

const AUTHORIZE_URL = "https://go.servicem8.com/oauth/authorize";
const TOKEN_URL = "https://go.servicem8.com/oauth/access_token";
/* The REST base lives with the one door to it (sm8-http); the token
   endpoint above is a different host, and the only fetch this file makes. */
export { SM8_API_BASE } from "./sm8-http";

/** Where ServiceM8 sends the browser back. Derived from APP_BASE_URL so
    localhost and production can't drift — ServiceM8 additionally requires the
    HOST of this URL to match the add-on's Store Connect "Return URL", which is
    why it is built in exactly one place. */
export const SM8_CALLBACK_PATH = "/api/integrations/servicem8/callback";

export type Sm8Config = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function sm8Config(): Sm8Config | null {
  const clientId = process.env.SM8_CLIENT_ID;
  const clientSecret = process.env.SM8_CLIENT_SECRET;
  const base = process.env.APP_BASE_URL;
  if (!clientId || !clientSecret || !base) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: new URL(SM8_CALLBACK_PATH, base).toString(),
  };
}

/* Generous for a cold serverless start, short enough that a wedged upstream
   fails the page rather than hanging it — the same 10s xero.ts settled on. */
const HTTP_TIMEOUT_MS = 10_000;

/** The token fields we keep — the response also carries token_type, which is
    always "bearer" and not worth storing. */
export type Sm8Tokens = {
  accessToken: string;
  refreshToken: string;
  /** Space-separated, as granted. */
  scope: string;
  expiresIn: number | null;
};

/** The URL that starts consent. `state` is minted and cookie-bound by the
    caller; ServiceM8's documented parameters are response_type, client_id,
    scope (space-separated) and redirect_uri — `state` rides along under the
    OAuth 2.0 rule that the server echoes it back untouched.

    `scopes` is the read list unless the caller says otherwise: the connect
    route adds the write scopes while the owner has writing switched on
    (providers.ts, sm8ScopesWanted), so a reconnect never drops a permission
    a switch depends on. */
export function buildSm8ConsentUrl(
  cfg: Sm8Config,
  state: string,
  scopes: readonly string[] = SM8_SCOPE_LIST
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    scope: scopes.join(" "),
    redirect_uri: cfg.redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Parse a token-endpoint response body. Null when either token is missing —
    a pair with no refresh token would work for an hour and then strand the
    connection, which is worse than failing the connect visibly now. */
export function readSm8Tokens(body: unknown): Sm8Tokens | null {
  if (!body || typeof body !== "object") return null;
  const r = body as Record<string, unknown>;
  const accessToken = typeof r.access_token === "string" ? r.access_token : "";
  const refreshToken = typeof r.refresh_token === "string" ? r.refresh_token : "";
  if (!accessToken || !refreshToken) return null;
  return {
    accessToken,
    refreshToken,
    scope: typeof r.scope === "string" ? r.scope : "",
    expiresIn: typeof r.expires_in === "number" && Number.isFinite(r.expires_in)
      ? r.expires_in
      : null,
  };
}

/** Why a token request failed, as the one decision it forces:
    - `revoked` — the grant is dead. The connection is flagged for a reconnect.
    - `unavailable` — not right now, or not the owner's doing. Nothing is
      flagged; the next attempt may work. */
export type Sm8TokenFailure = "revoked" | "unavailable";

export type Sm8TokenResult =
  | { ok: true; tokens: Sm8Tokens }
  | { ok: false; failure: Sm8TokenFailure; status: number | null };

/* RFC 6749 §5.2's error codes that mean OUR request is wrong — the add-on's
   credentials, or a grant type ServiceM8 won't take — rather than the owner's
   grant. A reconnect can't fix any of them, so they must never tell the owner
   to try. */
const CONFIG_ERRORS: ReadonlySet<string> = new Set([
  "invalid_client",
  "unauthorized_client",
  "unsupported_grant_type",
]);

function namedError(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") {
      const e = (parsed as Record<string, unknown>).error;
      return typeof e === "string" ? e : null;
    }
  } catch {
    // not JSON: an HTML error page, or nothing at all
  }
  return null;
}

/** A refused token request, sorted. ServiceM8 documents only its success
    bodies, so the rule leans on RFC 6749 §5.2 and on what a refusal is
    likely to MEAN:
    - `invalid_grant` is a dead grant, whatever the status.
    - A 400 or 401 is a dead grant too, unless the body names one of OUR
      configuration errors (invalid_client and its two siblings).
    - Everything else — 408, 429, a 5xx, an unnamed 403 — is "not right now".
    Leaning towards revoked on a 400/401 is deliberate: a removed add-on that
    reads as "couldn't be reached" forever never prompts the reconnect that
    would fix it, while a wrong "reconnect" costs one click. */
export function classifySm8TokenFailure(status: number, body: string): Sm8TokenFailure {
  const error = namedError(body);
  if (error === "invalid_grant") return "revoked";
  if (status === 400 || status === 401) {
    return error !== null && CONFIG_ERRORS.has(error) ? "unavailable" : "revoked";
  }
  return "unavailable";
}

/** The body as it may be logged: truncated, and with every value we sent in
    the form struck out, in case a server ever echoes one back. */
function loggable(body: string, form: Record<string, string>): string {
  // struck out BEFORE the cut, so a value can't survive as a half at the end
  let out = body.slice(0, 4000);
  for (const [k, v] of Object.entries(form)) {
    if (k === "grant_type" || v.length < 6) continue;
    out = out.split(v).join("[redacted]");
  }
  return out.slice(0, 300);
}

async function tokenRequest(form: Record<string, string>): Promise<Sm8TokenResult> {
  const what = `[sm8] token ${form.grant_type}`;
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (err) {
    // DNS, TLS, a dropped connection or the 10 s timeout: never the grant
    console.error(`${what} request failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, failure: "unavailable", status: null };
  }

  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      body = "";
    }
    const failure = classifySm8TokenFailure(res.status, body);
    console.error(`${what} ${res.status}: ${loggable(body, form) || "<empty body>"}`);
    const error = namedError(body);
    if (error !== null && CONFIG_ERRORS.has(error)) {
      /* Loud on purpose: every workspace's refresh is failing the same way,
         and nothing on any owner's screen will say so. */
      console.error(
        `${what} was refused as ${error}. This is the add-on's configuration (SM8_CLIENT_ID, SM8_CLIENT_SECRET), not the owner's grant.`
      );
    }
    return { ok: false, failure, status: res.status };
  }

  try {
    const tokens = readSm8Tokens(await res.json());
    if (tokens) return { ok: true, tokens };
    console.error(`${what} ${res.status} but the body carried no usable token pair`);
  } catch {
    console.error(`${what} ${res.status} but the body wasn't JSON`);
  }
  return { ok: false, failure: "unavailable", status: res.status };
}

export type Sm8ExchangeResult =
  | { ok: true; tokens: Sm8Tokens }
  | { ok: false; error: string };

/** Swap the callback's `code` for a token pair. */
export async function exchangeSm8Code(cfg: Sm8Config, code: string): Promise<Sm8ExchangeResult> {
  const result = await tokenRequest({
    grant_type: "authorization_code",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    redirect_uri: cfg.redirectUri,
  });
  if (!result.ok) {
    return { ok: false, error: "ServiceM8 didn't accept that authorisation. Try connecting again." };
  }
  return { ok: true, tokens: result.tokens };
}

/** Trade the stored refresh token for a fresh pair. ServiceM8 ROTATES the
    refresh token on every use — persist what comes back or strand the grant.
    A failure says whether the grant is dead or merely unreachable, and only
    the first may flag the connection. */
export async function refreshSm8Tokens(
  cfg: Sm8Config,
  refreshToken: string
): Promise<Sm8TokenResult> {
  return tokenRequest({
    grant_type: "refresh_token",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
  });
}

/* ── the one read this module owns: who is this account? ──────────────────

   vendor.json is the ServiceM8 account's own identity row. It lives here
   rather than in sm8-read.ts because the CALLBACK needs it before any
   connection row exists — the name is stored as tenant_name so the
   integrations index can say "Connected to Acme Air" — and sm8-read.ts wraps
   it for the screen's proof-of-life read afterwards. */

export type Sm8Vendor = {
  uuid: string;
  name: string;
  email: string | null;
  /** IANA zone, e.g. Australia/Brisbane — the clock every ServiceM8 timestamp
      in this account is written against. */
  timezoneName: string | null;
  currency: string | null;
};

export type Sm8VendorResult =
  | { ok: true; vendor: Sm8Vendor }
  | {
      ok: false;
      unauthorized: boolean;
      paymentRequired?: boolean;
      throttled?: boolean;
      /** No request reached ServiceM8: the counter refused the turn. */
      called?: false;
    };

/** Read the account identity through the one door (sm8-http). `unauthorized`
    is the one failure worth distinguishing: a 401 means the GRANT is dead
    (revoked from ServiceM8's own side), which the read layer records as
    needs_reauth — everything else is "not right now" and harms nothing.
    `throttled`: the account's call limit had no room (a turn refused, or
    ServiceM8's own 429). */
export async function fetchSm8Vendor(call: Sm8Call): Promise<Sm8VendorResult> {
  try {
    const answer = await sm8Request(call, "vendor.json", { timeoutMs: HTTP_TIMEOUT_MS });
    if (answer.kind === "throttled") return { ok: false, unauthorized: false, throttled: true, called: false };
    const res = answer.res;
    if (res.status === 429) {
      console.error(`[sm8] GET vendor.json 429: ServiceM8's ${answer.limit ?? "minute"} limit`);
      return { ok: false, unauthorized: false, throttled: true };
    }
    if (res.status === 401) return { ok: false, unauthorized: true };
    /* 402 = the ServiceM8 account isn't in good standing (an expired trial
       answers with it too). Distinguished because no amount of retrying or
       reconnecting clears it — only the account holder can. */
    if (res.status === 402) {
      console.error("[sm8] GET vendor.json 402: account not in good standing");
      return { ok: false, unauthorized: false, paymentRequired: true };
    }
    if (!res.ok) {
      /* The status is the diagnosis, and it used to be discarded — see the
         note on logSm8Failure in sm8-read.ts. Body truncated, server log
         only: an upstream error text can name the client id. */
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 500);
      } catch {
        detail = "<unreadable body>";
      }
      console.error(`[sm8] GET vendor.json ${res.status} ${res.statusText}: ${detail}`);
      return { ok: false, unauthorized: false };
    }
    const body: unknown = await res.json();
    const row = Array.isArray(body) ? body[0] : null;
    if (!row || typeof row !== "object") {
      console.error(
        `[sm8] GET vendor.json 200 but no usable row: ${JSON.stringify(body).slice(0, 300)}`
      );
      return { ok: false, unauthorized: false };
    }
    const r = row as Record<string, unknown>;
    const uuid = typeof r.uuid === "string" ? r.uuid : "";
    if (!uuid) {
      console.error(`[sm8] GET vendor.json 200 but the row carries no uuid`);
      return { ok: false, unauthorized: false };
    }
    return {
      ok: true,
      vendor: {
        uuid,
        name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : "ServiceM8 account",
        email: typeof r.email === "string" && r.email ? r.email : null,
        timezoneName:
          typeof r.timezone_name === "string" && r.timezone_name ? r.timezone_name : null,
        currency: typeof r.currency === "string" && r.currency ? r.currency : null,
      },
    };
  } catch (err) {
    console.error(
      `[sm8] GET vendor.json request failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return { ok: false, unauthorized: false };
  }
}
