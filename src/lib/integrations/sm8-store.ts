/* Reading and writing the ServiceM8 row of integration_connections — server
   only. store.ts's disciplined sibling, not a parameterization of it: the Xero
   module is entangled with tenants and the xero-node SDK, and ServiceM8 has
   neither — one account per grant, plain fetch. What it KEEPS is the whole
   point:

   - TOKENS NEVER LEAVE THIS MODULE. Callers get a token-free ConnectionView
     via store.ts's generic getConnectionView, or a short-lived access token
     from `sm8Access()` — never a row.
   - Refresh is SINGLE-FLIGHT per instance (the Map) with a CONDITIONAL WRITE
     as the cross-instance backstop, because ServiceM8 rotates the refresh
     token on every use: the update only lands while the row still holds the
     token this call redeemed, so a lost race can't clobber the winner's newer
     pair. Same dance as store.ts:refreshAndStore, and the test pins it.
   - Every query is `.eq("org_id", orgId)` scoped. */

import { supabaseAdmin } from "@/lib/supabase-server";
import {
  accessTokenUsable,
  expiryFromTokenSet,
  type ConnectionRow,
} from "./connection";
import { open, seal, tokenKey } from "./secrets";
import { refreshSm8Tokens, sm8Config, type Sm8Tokens, type Sm8Vendor } from "./sm8";
import { SM8_WIPE_TABLES } from "./sm8-sync-plan";

const TABLE = "integration_connections";
const PROVIDER = "servicem8";

const COLUMNS =
  "id, org_id, provider, status, tenant_id, tenant_name, tenants, scopes, " +
  "access_token_enc, refresh_token_enc, expires_at, connected_by_user_id, " +
  "connected_at, updated_at, last_error, drift_count, drift_checked_at";

async function readRow(orgId: string): Promise<ConnectionRow | null> {
  const { data } = await supabaseAdmin
    .from(TABLE)
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  return (data as ConnectionRow | null) ?? null;
}

export type SaveResult = { ok: true } | { ok: false; error: string };

const NO_KEY =
  "Token encryption isn't configured on this deployment, so the connection can't be stored.";

/** Store (or replace) a ServiceM8 grant. Upsert on (org_id, provider):
    reconnecting REPLACES the grant. `vendor` is the account identity read
    with the fresh token — nullable, because a grant whose vendor read failed
    still reads jobs, and stranding it un-storable (with no revoke endpoint to
    clean up) would be worse than a nameless row the next sync names — see
    nameSm8ConnectionIfNameless, which is the half of that promise the sync
    engine calls. */
export async function saveSm8Connection(input: {
  orgId: string;
  userId: string;
  tokens: Sm8Tokens;
  vendor: Sm8Vendor | null;
  now?: number;
}): Promise<SaveResult> {
  const key = tokenKey();
  if (!key) return { ok: false, error: NO_KEY };

  const now = input.now ?? Date.now();
  const { error } = await supabaseAdmin.from(TABLE).upsert(
    {
      org_id: input.orgId,
      provider: PROVIDER,
      status: "connected",
      /* One ServiceM8 account per grant — tenant_id/tenants exist because the
         table is shared with multi-tenant providers, so the single account is
         stored in the same slots the screens already read. The extra
         timezoneName key rides in the jsonb (parseTenants ignores it); the
         PR-2 sm8_vendor mirror becomes the queryable home. */
      tenant_id: input.vendor?.uuid ?? null,
      tenant_name: input.vendor?.name ?? null,
      tenants: input.vendor
        ? [
            {
              tenantId: input.vendor.uuid,
              tenantName: input.vendor.name,
              timezoneName: input.vendor.timezoneName,
            },
          ]
        : [],
      scopes: input.tokens.scope,
      access_token_enc: seal(input.tokens.accessToken, key),
      refresh_token_enc: seal(input.tokens.refreshToken, key),
      expires_at: expiryFromTokenSet({ expires_in: input.tokens.expiresIn ?? undefined }, now),
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

/** Fill in the identity of a grant that connected without one — the other
    half of saveSm8Connection's nullable `vendor`. The sync engine reads the
    account row on every run anyway (timezone_name); when that read succeeds
    and the connection is still nameless, this is what keeps the promise.

    CONDITIONAL ON STILL BEING NAMELESS, and that is the whole design: an
    unguarded write would let a slow sync that started before a reconnect
    stamp a stale account over the fresh one the reconnect just stored. This
    repairs an ABSENT name, never a present one — a named row costs the round
    trip and matches no rows. tenant_id is the flag because connect writes all
    three slots together or none.

    Tokens stay in this module: the caller hands in an already-read vendor and
    gets nothing back. */
export async function nameSm8ConnectionIfNameless(
  orgId: string,
  vendor: Sm8Vendor,
  now: number = Date.now()
): Promise<void> {
  await supabaseAdmin
    .from(TABLE)
    .update({
      tenant_id: vendor.uuid,
      tenant_name: vendor.name,
      tenants: [
        { tenantId: vendor.uuid, tenantName: vendor.name, timezoneName: vendor.timezoneName },
      ],
      updated_at: new Date(now).toISOString(),
    })
    .eq("org_id", orgId)
    .eq("provider", PROVIDER)
    .is("tenant_id", null);
}

/** End the grant locally. ServiceM8 documents no revocation endpoint, so
    there is nothing upstream to call — the sealed tokens are deleted here and
    the screen tells the owner how to finish the job on ServiceM8's side
    (remove the HeyTiff add-on in their account).

    THE MIRRORS GO TOO. They are a disposable cache of somebody's entire
    client book, and holding that after the owner revoked the grant is
    liability with no upside — a reconnect rebuilds them in minutes. Overlay
    rows (projects, agreements) survive on their own cached labels; the
    connection row goes LAST so a wipe interrupted mid-way still reads as
    connected-with-holes, which the next sync repairs, rather than
    disconnected-with-leftovers, which nothing would ever clean. */
export async function disconnectSm8(orgId: string): Promise<void> {
  for (const table of SM8_WIPE_TABLES) {
    await supabaseAdmin.from(table).delete().eq("org_id", orgId);
  }
  await supabaseAdmin.from(TABLE).delete().eq("org_id", orgId).eq("provider", PROVIDER);
}

/** Flag the grant as broken so the screen prompts a reconnect. The message is
    ours; ServiceM8's own error text never reaches this column. Exported for
    the read layer: a 401 over there is the same verdict as a refused refresh
    over here. */
export async function markSm8NeedsReauth(orgId: string, error: string): Promise<void> {
  await supabaseAdmin
    .from(TABLE)
    .update({ status: "needs_reauth", last_error: error, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("provider", PROVIDER);
}

export type Sm8Access = { accessToken: string };

/* One in-flight refresh per org, per server instance — the common-case guard;
   the conditional write below is the cross-instance backstop. */
const inflightRefresh = new Map<string, Promise<Sm8Access | null>>();

/** A usable ServiceM8 access token for this org, refreshing first if the
    stored one is spent. THE ENTRY POINT for everything that reads ServiceM8 —
    the vendor proof-of-life today, the sync engine next PR — so the
    refresh-and-rotate dance lives in exactly one place.

    Null means "not connected, or the grant is dead": the caller shows the
    integration as needing attention, it does not retry. */
export async function sm8Access(orgId: string, now: number = Date.now()): Promise<Sm8Access | null> {
  const row = await readRow(orgId);
  if (!row) return null;

  // A grant already marked broken is not retried — reconnect is the recovery
  // path, and the screen already says so.
  if (row.status === "needs_reauth") return null;

  const key = tokenKey();
  const cfg = sm8Config();
  if (!key || !cfg) return null;

  if (accessTokenUsable(row.expires_at, now)) {
    const access = open(row.access_token_enc, key);
    if (access) return { accessToken: access };
    // Sealed with a key we no longer hold — a refresh can't help.
    await markSm8NeedsReauth(orgId, "Stored credentials couldn't be read. Reconnect ServiceM8.");
    return null;
  }

  const inflight = inflightRefresh.get(orgId);
  if (inflight) return inflight;

  const flight = refreshAndStore(orgId, row, key, cfg, now).finally(() =>
    inflightRefresh.delete(orgId)
  );
  inflightRefresh.set(orgId, flight);
  return flight;
}

async function refreshAndStore(
  orgId: string,
  row: ConnectionRow,
  key: NonNullable<ReturnType<typeof tokenKey>>,
  cfg: NonNullable<ReturnType<typeof sm8Config>>,
  now: number
): Promise<Sm8Access | null> {
  const refresh = open(row.refresh_token_enc, key);
  if (!refresh) {
    await markSm8NeedsReauth(orgId, "Stored credentials couldn't be read. Reconnect ServiceM8.");
    return null;
  }

  const fresh = await refreshSm8Tokens(cfg, refresh);
  if (!fresh) {
    await markSm8NeedsReauth(orgId, "ServiceM8 declined to renew the connection. Reconnect ServiceM8.");
    return null;
  }

  /* ServiceM8 rotates the refresh token on every use: this write is the only
     copy of the next one. The extra `.eq` on the OLD sealed refresh token is
     the cross-instance rotation guard — if a sibling instance redeemed and
     stored first, this older pair must not clobber its newer one. Our own
     access token is fresh-issued either way, so the caller still works. */
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
    .eq("provider", PROVIDER)
    .eq("refresh_token_enc", row.refresh_token_enc);

  return { accessToken: fresh.accessToken };
}
