/* Reading and writing integration_connections — server only.

   The one rule this module exists to enforce: TOKENS NEVER LEAVE IT. Callers
   get a ConnectionView (no token fields at all) or, for the future sync jobs,
   a short-lived access token from `xeroAccess()` — never a row. Every query is
   `.eq("org_id", orgId)` scoped, like every other query module here. */

import { supabaseAdmin } from "@/lib/supabase-server";
import {
  accessTokenUsable,
  expiryFromTokenSet,
  toView,
  type ConnectionRow,
  type ConnectionView,
  type Tenant,
} from "./connection";
import { open, seal, tokenKey } from "./secrets";
import { refreshTokens, revokeRefreshToken, xeroConfig, type XeroTokens } from "./xero";

const TABLE = "integration_connections";

const COLUMNS =
  "id, org_id, provider, status, tenant_id, tenant_name, tenants, scopes, " +
  "access_token_enc, refresh_token_enc, expires_at, connected_by_user_id, " +
  "connected_at, updated_at, last_error, drift_count, drift_checked_at";

async function readRow(orgId: string, provider: string): Promise<ConnectionRow | null> {
  const { data } = await supabaseAdmin
    .from(TABLE)
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("provider", provider)
    .maybeSingle();
  return (data as ConnectionRow | null) ?? null;
}

/** The screen's view of a connection, or null when there isn't one. Also null
    when the table doesn't exist yet — an unapplied migration should render
    "not connected", not a 500. */
export async function getConnectionView(
  orgId: string,
  provider: string
): Promise<ConnectionView | null> {
  const row = await readRow(orgId, provider);
  if (!row) return null;
  return toView(row, await connectorName(row.connected_by_user_id));
}

/** "Connected by" — the HeyTiff staff name behind the stored user id, so the
    screen shows a colleague rather than an Auth0 sub. */
async function connectorName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("full_name")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  const name = (data?.full_name as string | undefined) ?? "";
  return name.trim() || null;
}

export type SaveResult = { ok: true } | { ok: false; error: string };

const NO_KEY =
  "Token encryption isn't configured on this deployment, so the connection can't be stored.";

/** Store (or replace) a Xero grant. Upsert on (org_id, provider): reconnecting
    REPLACES the grant — a second row would be a token nothing ever reads. */
export async function saveXeroConnection(input: {
  orgId: string;
  userId: string;
  tokens: XeroTokens;
  tenants: Tenant[];
  now?: number;
}): Promise<SaveResult> {
  const key = tokenKey();
  if (!key) return { ok: false, error: NO_KEY };

  const now = input.now ?? Date.now();
  // The SDK's TokenSet carries expires_in; expiryFromTokenSet also understands
  // the absolute form, so this stays right if the SDK ever normalises.
  const expiresAt = expiryFromTokenSet({ expires_in: input.tokens.expiresIn ?? undefined }, now);

  // tenants[0] is Xero's most-recently-active organisation (the SDK sorts by
  // updatedDateUtc). It is a DEFAULT, not a decision — when there is more than
  // one, the screen shows a picker and setXeroTenant() moves it.
  const active = input.tenants[0];

  const { error } = await supabaseAdmin.from(TABLE).upsert(
    {
      org_id: input.orgId,
      provider: "xero",
      status: "connected",
      tenant_id: active.tenantId,
      tenant_name: active.tenantName,
      tenants: input.tenants,
      scopes: input.tokens.scope,
      access_token_enc: seal(input.tokens.accessToken, key),
      refresh_token_enc: seal(input.tokens.refreshToken, key),
      expires_at: expiresAt,
      connected_by_user_id: input.userId,
      connected_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
      last_error: null,
    },
    { onConflict: "org_id,provider" }
  );

  if (error) return { ok: false, error: "Couldn't save the connection." };
  return { ok: true };
}

/** Point an existing grant at a different Xero organisation. Only ids that
    came back with the grant are accepted — the id arrives from a browser. */
export async function setXeroTenant(orgId: string, tenantId: string): Promise<SaveResult> {
  const row = await readRow(orgId, "xero");
  if (!row) return { ok: false, error: "Xero isn't connected." };

  const match = (Array.isArray(row.tenants) ? (row.tenants as Tenant[]) : []).find(
    (t) => t?.tenantId === tenantId
  );
  if (!match) return { ok: false, error: "That organisation isn't part of this connection." };

  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({
      tenant_id: match.tenantId,
      tenant_name: match.tenantName,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId)
    .eq("provider", "xero");

  if (error) return { ok: false, error: "Couldn't switch organisation." };
  return { ok: true };
}

/** End the grant. Xero is told first, but the row goes either way — a
    disconnect that leaves tokens behind because an upstream call failed is
    not a disconnect. */
export async function disconnectXero(orgId: string): Promise<{ revoked: boolean }> {
  const row = await readRow(orgId, "xero");
  let revoked = false;

  if (row) {
    const key = tokenKey();
    const cfg = xeroConfig();
    const refresh = key ? open(row.refresh_token_enc, key) : null;
    const access = key ? open(row.access_token_enc, key) : null;
    if (cfg && refresh && access) revoked = await revokeRefreshToken(cfg, refresh, access);
  }

  await supabaseAdmin.from(TABLE).delete().eq("org_id", orgId).eq("provider", "xero");
  return { revoked };
}

/** Flag a grant as broken so the screen prompts a reconnect. The message is
    ours; a provider's own error text never reaches this column.

    Exported for the read layer (xero-read.ts): a grant can die BETWEEN this
    module handing out a token and that token being used — someone revoking the
    app from Xero's own Connected Apps screen — and a 401 over there is the same
    verdict as a refused refresh over here. */
export async function markNeedsReauth(orgId: string, error: string): Promise<void> {
  await supabaseAdmin
    .from(TABLE)
    .update({ status: "needs_reauth", last_error: error, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("provider", "xero");
}

export type XeroAccess = { accessToken: string; tenantId: string };

/** A usable Xero access token for this org, refreshing first if the stored one
    is spent. THE ENTRY POINT for everything that will later read Xero — Time &
    Pay, expenses, the Rate Calculator — so the refresh-and-rotate dance lives
    in exactly one place.

    Null means "not connected, or the grant is dead": the caller shows the
    integration as needing attention, it does not retry. */
export async function xeroAccess(orgId: string, now: number = Date.now()): Promise<XeroAccess | null> {
  const row = await readRow(orgId, "xero");
  if (!row || !row.tenant_id) return null;

  const key = tokenKey();
  const cfg = xeroConfig();
  if (!key || !cfg) return null;

  if (row.status === "connected" && accessTokenUsable(row.expires_at, now)) {
    const access = open(row.access_token_enc, key);
    if (access) return { accessToken: access, tenantId: row.tenant_id };
    // Sealed with a key we no longer hold — a refresh can't help, and the only
    // honest state is "reconnect".
    await markNeedsReauth(orgId, "Stored credentials couldn't be read. Reconnect Xero.");
    return null;
  }

  const refresh = open(row.refresh_token_enc, key);
  if (!refresh) {
    await markNeedsReauth(orgId, "Stored credentials couldn't be read. Reconnect Xero.");
    return null;
  }

  const fresh = await refreshTokens(cfg, refresh);
  if (!fresh) {
    await markNeedsReauth(orgId, "Xero declined to renew the connection. Reconnect Xero.");
    return null;
  }

  // Xero rotates the refresh token on every use: this write is not a cache
  // update, it is the only copy of the next one.
  await supabaseAdmin
    .from(TABLE)
    .update({
      status: "connected",
      access_token_enc: seal(fresh.accessToken, key),
      refresh_token_enc: seal(fresh.refreshToken, key),
      expires_at: expiryFromTokenSet({ expires_in: fresh.expiresIn ?? undefined }, now),
      scopes: fresh.scope || row.scopes,
      last_error: null,
      updated_at: new Date(now).toISOString(),
    })
    .eq("org_id", orgId)
    .eq("provider", "xero");

  return { accessToken: fresh.accessToken, tenantId: row.tenant_id };
}
