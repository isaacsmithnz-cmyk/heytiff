/* The Xero OAuth 2.0 client — server only.

   Everything the `xero-node` SDK is used for lives behind these four
   functions, so the SDK's stateful-instance model can't leak into the app: a
   XeroClient carries its token set on the instance, which is fine per request
   and wrong the moment one is shared. Every call here builds a fresh one.

   NOTHING FROM XERO IS FORWARDED VERBATIM. A refused exchange or refresh comes
   back as our own sentence, the same posture as the Google proxy in
   app/api/address — an upstream error body can name the client id, the
   redirect URI, or the reason a key was rejected, and none of that belongs in
   a page or a log line.

   The credentials come from XERO_CLIENT_ID / XERO_CLIENT_SECRET with no
   NEXT_PUBLIC_ prefix, so Next cannot inline them into client code even by
   accident. Unset means the integration is simply not available in this
   deployment — `xeroConfig()` returns null and the screen says so. */

import { XeroClient, type TokenSet } from "xero-node";
import { XERO_SCOPE_LIST } from "./providers";
import type { Tenant } from "./connection";

/** Where Xero sends the browser back. Derived from APP_BASE_URL so localhost
    and production can't drift — this exact string must also be registered on
    the Xero app, which is why it is built in one place. */
export const XERO_CALLBACK_PATH = "/api/integrations/xero/callback";

export type XeroConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function xeroConfig(): XeroConfig | null {
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  const base = process.env.APP_BASE_URL;
  if (!clientId || !clientSecret || !base) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: new URL(XERO_CALLBACK_PATH, base).toString(),
  };
}

/* The SDK defaults to a 3.5s HTTP timeout, which a cold serverless invocation
   doing OpenID discovery can genuinely exceed — a first Connect of the day
   would fail for no reason a user could act on. */
const HTTP_TIMEOUT_MS = 10_000;

function client(cfg: XeroConfig, state?: string): XeroClient {
  return new XeroClient({
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    redirectUris: [cfg.redirectUri],
    scopes: XERO_SCOPE_LIST,
    state,
    httpTimeout: HTTP_TIMEOUT_MS,
  });
}

/** The token fields we keep. Deliberately narrower than the SDK's TokenSet:
    the id_token is read once for the connector's name and then dropped. */
export type XeroTokens = {
  accessToken: string;
  refreshToken: string;
  /** Space-separated, as granted. */
  scope: string;
  expiresIn: number | null;
};

function readTokens(set: TokenSet): XeroTokens | null {
  const accessToken = set.access_token;
  const refreshToken = set.refresh_token;
  if (!accessToken || !refreshToken) return null;
  // Xero documents `scope` as an array in the token JSON but openid-client
  // normalises to a space-separated string; accept both rather than betting.
  const rawScope: unknown = set.scope;
  const scope = Array.isArray(rawScope)
    ? rawScope.join(" ")
    : typeof rawScope === "string"
      ? rawScope
      : "";
  return {
    accessToken,
    refreshToken,
    scope,
    expiresIn: typeof set.expires_in === "number" ? set.expires_in : null,
  };
}

/** The URL that starts consent. `state` is minted and cookie-bound by the
    caller — the SDK only echoes it, it does not verify anything for us. */
export async function buildConsentUrl(cfg: XeroConfig, state: string): Promise<string | null> {
  try {
    return await client(cfg, state).buildConsentUrl();
  } catch {
    return null;
  }
}

export type ExchangeResult =
  | { ok: true; tokens: XeroTokens; tenants: Tenant[]; userName: string | null }
  | { ok: false; error: string };

/** Swap the callback URL's `code` for a token set, then ask Xero which
    organisations the grant covers. Both halves happen here because a grant
    with no tenant is useless — there would be nothing to point a query at —
    so a connection is only ever stored complete. */
export async function exchangeCallback(
  cfg: XeroConfig,
  callbackUrl: string,
  state: string
): Promise<ExchangeResult> {
  const xero = client(cfg, state);
  let set: TokenSet;
  try {
    // The SDK checks the echoed `state` against config.state in here; the
    // cookie check in the route is the half that proves it was OURS.
    set = await xero.apiCallback(callbackUrl);
  } catch {
    return { ok: false, error: "Xero didn't accept that authorisation. Try connecting again." };
  }

  const tokens = readTokens(set);
  if (!tokens) {
    return { ok: false, error: "Xero returned an incomplete authorisation. Try connecting again." };
  }

  let tenants: Tenant[];
  try {
    // `false` — skip the per-tenant getOrganisations() round trip. The
    // /connections response already carries tenantName, which is all the
    // screen shows, and the full form costs one accounting call per org.
    tenants = readTenants(await xero.updateTenants(false));
  } catch {
    return { ok: false, error: "Connected, but Xero wouldn't say which organisation. Try again." };
  }
  if (tenants.length === 0) {
    return { ok: false, error: "That Xero login has no organisation we can connect to." };
  }

  return { ok: true, tokens, tenants, userName: readUserName(set) };
}

/** Trade the stored refresh token for a fresh pair. Xero ROTATES the refresh
    token on every use, so the caller must persist what comes back — dropping
    it strands the connection at the next refresh. */
export async function refreshTokens(
  cfg: XeroConfig,
  refreshToken: string
): Promise<XeroTokens | null> {
  try {
    const set = await client(cfg).refreshWithRefreshToken(
      cfg.clientId,
      cfg.clientSecret,
      refreshToken
    );
    return readTokens(set);
  } catch {
    return null;
  }
}

/** Tell Xero the grant is over. Best effort: the local row is deleted either
    way, because a disconnect that fails upstream must still leave HeyTiff
    holding no tokens. */
export async function revokeRefreshToken(
  cfg: XeroConfig,
  refreshToken: string,
  accessToken: string
): Promise<boolean> {
  try {
    const xero = client(cfg);
    await xero.initialize(); // revoke() goes through the OpenID client
    xero.setTokenSet({ access_token: accessToken, refresh_token: refreshToken });
    await xero.revokeToken();
    return true;
  } catch {
    return false;
  }
}

/* ── shaping what Xero hands back ── */

/** `/connections` rows → the two fields we keep. Anything without a tenantId
    is dropped rather than stored as a tenant we could never query. */
function readTenants(raw: unknown): Tenant[] {
  if (!Array.isArray(raw)) return [];
  const out: Tenant[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    const tenantId = typeof r.tenantId === "string" ? r.tenantId : "";
    if (!tenantId) continue;
    out.push({
      tenantId,
      tenantName: typeof r.tenantName === "string" ? r.tenantName : tenantId,
    });
  }
  return out;
}

/** The Xero user's name, off the id_token, for "connected by …". Read without
    verifying: the SDK already verified the id_token's signature during
    `apiCallback`, and this is a display string either way. */
function readUserName(set: TokenSet): string | null {
  try {
    const claims = set.claims() as Record<string, unknown>;
    const name = claims.name ?? claims.preferred_username ?? claims.email;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}
