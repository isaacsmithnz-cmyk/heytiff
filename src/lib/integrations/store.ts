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
import {
  refreshTokens,
  revokeRefreshToken,
  xeroConfig,
  type XeroConfig,
  type XeroTokens,
} from "./xero";

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

/** "Is this provider live?" and nothing else — one narrow column, no tokens,
    no connector lookup. `getConnectionView` reads eighteen columns and then
    resolves a user's name to draw the Integrations card; a screen deciding
    only whether to OFFER something should not pay for that. */
export async function isProviderConnected(
  orgId: string,
  provider: string
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from(TABLE)
    .select("status")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .maybeSingle();
  return (data as { status: string } | null)?.status === "connected";
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

/** How many OTHER HeyTiff workspaces hold a connection to this same provider
    account. Zero for the ordinary case.

    WHY THIS IS VISIBLE RATHER THAN BLOCKED. Every uniqueness rule in the
    integrations area is scoped to one workspace — one connection per
    (org_id, provider), mirrors keyed (org_id, uuid), links unique within an
    org — so two workspaces connecting one ServiceM8 account both work, and
    neither is told. That is deliberate: a bookkeeper and an operations team
    running separate workspaces off one account is a real arrangement, and
    refusing it would break them with no way past. But the same property means
    somebody who can authenticate to the account can mirror the whole client
    book into a workspace the owner cannot see, and NOTHING said so. This
    count is what says so.

    Counts, never names: another workspace's identity is not this caller's to
    read, and a bare number is enough to prompt the question. The comparison
    is on tenant_id — the ServiceM8 vendor uuid or the Xero tenant id — so it
    means "the same account over there", not merely "the same provider". A
    connection with no tenant_id yet (a grant whose vendor read failed) can't
    be compared to anything and counts nothing.

    Deliberately NOT org-scoped: this is the one read here that crosses the
    boundary on purpose, which is exactly why it returns a number and nothing
    else. */
export async function countConnectionsElsewhere(
  orgId: string,
  provider: string,
  tenantId: string | null
): Promise<number> {
  if (!tenantId) return 0;
  const { count } = await supabaseAdmin
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("provider", provider)
    .eq("tenant_id", tenantId)
    .neq("org_id", orgId);
  return count ?? 0;
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

  /* Reconnecting must not silently move the books. tenants[0] is Xero's
     most-recently-active organisation — a fine DEFAULT for a first connect,
     but on a reconnect this workspace already chose a tenant, and every
     staff↔employee link is scoped to it. If the chosen tenant is still in the
     grant it stays active; only when it's gone does the default apply — and
     then the drift flag resets with it, because a count computed against one
     tenant's payroll means nothing over another's. */
  const prior = await readRow(input.orgId, "xero");
  const kept = prior?.tenant_id
    ? input.tenants.find((t) => t?.tenantId === prior.tenant_id)
    : undefined;
  const active = kept ?? input.tenants[0];
  const tenantChanged = !!prior && prior.tenant_id !== active.tenantId;

  const { error } = await supabaseAdmin.from(TABLE).upsert(
    {
      org_id: input.orgId,
      provider: "xero",
      status: "connected",
      tenant_id: active.tenantId,
      tenant_name: active.tenantName,
      ...(tenantChanged ? { drift_count: null, drift_checked_at: null } : {}),
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
      /* The drift flag was computed against the OLD tenant's payroll, and the
         timestamp doubles as the If-Modified-Since cursor — carried across, it
         would show the old tenant's count over the new tenant's links AND let
         the first sweep of the new tenant answer "unchanged" without ever
         having looked at it. Both start over. */
      drift_count: null,
      drift_checked_at: null,
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

/* One in-flight refresh per org, per server instance. Two concurrent reads
   both finding the access token spent would both redeem the SAME refresh
   token — Xero rotates it on every use, so the loser's write used to clobber
   the winner's newer pair (adoptWage fans out exactly this shape: two reads
   in one Promise.all). A serverless instance can't see its siblings, so this
   map is the common-case guard and the conditional write in refreshAndStore
   is the cross-instance backstop. */
const inflightRefresh = new Map<string, Promise<XeroAccess | null>>();

/** A usable Xero access token for this org, refreshing first if the stored one
    is spent. THE ENTRY POINT for everything that will later read Xero — Time &
    Pay, expenses, the Rate Calculator — so the refresh-and-rotate dance lives
    in exactly one place.

    Null means "not connected, or the grant is dead": the caller shows the
    integration as needing attention, it does not retry. */
export async function xeroAccess(orgId: string, now: number = Date.now()): Promise<XeroAccess | null> {
  const row = await readRow(orgId, "xero");
  if (!row || !row.tenant_id) return null;

  /* A grant already marked broken is not retried. The refresh token Xero
     refused doesn't get better with repetition — retrying used to cost an
     upstream round trip on EVERY read, forever, until someone reconnected.
     Reconnect is the recovery path, and the screen already says so. */
  if (row.status === "needs_reauth") return null;

  const key = tokenKey();
  const cfg = xeroConfig();
  if (!key || !cfg) return null;

  if (accessTokenUsable(row.expires_at, now)) {
    const access = open(row.access_token_enc, key);
    if (access) return { accessToken: access, tenantId: row.tenant_id };
    // Sealed with a key we no longer hold — a refresh can't help, and the only
    // honest state is "reconnect".
    await markNeedsReauth(orgId, "Stored credentials couldn't be read. Reconnect Xero.");
    return null;
  }

  const inflight = inflightRefresh.get(orgId);
  if (inflight) return inflight;

  const flight = refreshAndStore(orgId, row, row.tenant_id, key, cfg, now).finally(() =>
    inflightRefresh.delete(orgId)
  );
  inflightRefresh.set(orgId, flight);
  return flight;
}

async function refreshAndStore(
  orgId: string,
  row: ConnectionRow,
  tenantId: string,
  key: NonNullable<ReturnType<typeof tokenKey>>,
  cfg: XeroConfig,
  now: number
): Promise<XeroAccess | null> {
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

  /* Xero rotates the refresh token on every use: this write is not a cache
     update, it is the only copy of the next one. The extra `.eq` on the OLD
     sealed refresh token is the cross-instance rotation guard: if a sibling
     instance redeemed and stored first, this (older) pair must not clobber
     its newer one — the update simply doesn't match, and the row keeps the
     winner's tokens. Our own access token is fresh-issued either way, so the
     caller still gets a working one. */
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
    .eq("provider", "xero")
    .eq("refresh_token_enc", row.refresh_token_enc);

  return { accessToken: fresh.accessToken, tenantId };
}
