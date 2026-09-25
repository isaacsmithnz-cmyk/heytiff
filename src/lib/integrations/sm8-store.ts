/* Reading and writing the ServiceM8 row of integration_connections — server
   only. store.ts's disciplined sibling, not a parameterization of it: the Xero
   module is entangled with tenants and the xero-node SDK, and ServiceM8 has
   neither — one account per grant, plain fetch. What it KEEPS is the whole
   point:

   - TOKENS NEVER LEAVE THIS MODULE. Callers get a token-free ConnectionView
     via store.ts's generic getConnectionView, or a short-lived access token
     from `sm8AccessResult()` — never a row. The access carries a `grant`, a
     fingerprint of the sealed refresh token it was issued under, so a later
     "this token was refused" can be pinned to the grant it came from.
   - Refresh is SINGLE-FLIGHT per instance (the Map), CLAIMED across
     instances (refresh_claimed_until), and CONDITIONAL on the token it spent,
     because ServiceM8 rotates the refresh token on every use: two servers
     redeeming one refresh token would spend it twice, and a lost race must
     not clobber the winner's newer pair.
   - A CONNECTION IS FLAGGED ONLY FOR THE GRANT THAT FAILED. Every
     needs_reauth write is conditional on the refresh token it judged, so a
     slow request that failed under an old grant can't flag the new one a
     sibling or a reconnect has stored since. A network blip is never a flag
     at all: only ServiceM8 saying the grant is dead is.
   - ONE SERVICEM8 ACCOUNT, ONE WORKSPACE. The callback refuses an account
     another workspace holds, and the unique index behind it is the backstop.
   - Every query is `.eq("org_id", orgId)` scoped. */

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { refIsOrgs } from "@/lib/documents/files";
import {
  accessTokenUsable,
  expiryFromTokenSet,
  type ConnectionRow,
} from "./connection";
import { open, seal, tokenKey } from "./secrets";
import { refreshSm8Tokens, sm8Config, type Sm8Tokens, type Sm8Vendor } from "./sm8";
import {
  chunk,
  SM8_ACCOUNT_RESET_TABLES,
  SM8_REVOKED,
  SM8_WIPE_TABLES,
} from "./sm8-sync-plan";
import {
  cancelWaitingSm8Writes,
  countSm8WritesInFlight,
  type CancelledWrite,
} from "./sm8-write-cancel";
import { WRITE_WORDS } from "./sm8-write-plan";

export { SM8_REVOKED };

const TABLE = "integration_connections";
const PROVIDER = "servicem8";

const COLUMNS =
  "id, org_id, provider, status, tenant_id, tenant_name, tenants, scopes, " +
  "access_token_enc, refresh_token_enc, expires_at, connected_by_user_id, " +
  "connected_at, updated_at, last_error, drift_count, drift_checked_at";

/** The sealed tokens couldn't be opened: the key changed. */
const SM8_UNREADABLE = "Stored credentials couldn't be read. Reconnect ServiceM8.";
/** The token endpoint said the refresh token is dead. */
const SM8_DECLINED = "ServiceM8 declined to renew the connection. Reconnect ServiceM8.";

type DbError = { code?: string; message?: string } | null;

/** A column this deployment's database doesn't have yet — the migration for
    it runs before the deploy, but the code must not break if it hasn't. */
const missingColumn = (e: DbError) => e?.code === "PGRST204" || e?.code === "42703";
/** A table this database doesn't have: nothing in it to clear. */
const missingTable = (e: DbError) => e?.code === "PGRST205" || e?.code === "42P01";
/** Another workspace already holds this ServiceM8 account (the unique index). */
const heldElsewhere = (e: DbError) => e?.code === "23505";

async function readRow(orgId: string): Promise<ConnectionRow | null> {
  const { data } = await supabaseAdmin
    .from(TABLE)
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  return (data as ConnectionRow | null) ?? null;
}

/** The fingerprint of a grant: a hash of the SEALED refresh token, never a
    token. Sealing uses a random IV, so it is taken from the exact string that
    was written, and two stores of one plaintext differ — which is right: they
    are two different writes. */
function grantOf(sealedRefresh: string | null): string {
  return sealedRefresh ? createHash("sha256").update(sealedRefresh).digest("hex").slice(0, 16) : "";
}

export type SaveResult = { ok: true } | { ok: false; error: string; elsewhere?: true };

const NO_KEY =
  "Token encryption isn't configured on this deployment, so the connection can't be stored.";

/** Store (or replace) a ServiceM8 grant. Upsert on (org_id, provider):
    reconnecting REPLACES the grant. `vendor` is the account identity read
    with the fresh token — nullable only for a FIRST connect, because a grant
    whose vendor read failed still reads jobs, and stranding it un-storable
    (with no revoke endpoint to clean up) would be worse than a nameless row
    the next sync names. A reconnect over a named row never comes here
    nameless: the callback refuses it rather than erase the one fact that
    tells a changed account from the same one.

    `switching` is a reconnect to a DIFFERENT account: sending goes off in the
    same write that stores the new account, so there is no moment where the
    new account is connected with the old account's switch still on.

    An account another workspace already holds is refused by the unique
    index, and comes back as `elsewhere`. */
export async function saveSm8Connection(input: {
  orgId: string;
  userId: string;
  tokens: Sm8Tokens;
  vendor: Sm8Vendor | null;
  switching?: boolean;
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
         sm8_vendor mirror is the queryable home. */
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
      ...(input.switching ? { write_mode: "off" } : {}),
    },
    { onConflict: "org_id,provider" }
  );

  if (heldElsewhere(error)) {
    return { ok: false, error: "That ServiceM8 account is connected to another workspace.", elsewhere: true };
  }
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

    `elsewhere` is the unique index refusing it: the account turned out to be
    one another workspace already holds. Tokens stay in this module: the
    caller hands in an already-read vendor and gets a word back. */
export async function nameSm8ConnectionIfNameless(
  orgId: string,
  vendor: Sm8Vendor,
  now: number = Date.now()
): Promise<"named" | "unchanged" | "elsewhere"> {
  const { data, error } = await supabaseAdmin
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
    .is("tenant_id", null)
    .select("id");
  if (heldElsewhere(error)) return "elsewhere";
  if (error) {
    console.error(`[sm8] couldn't name the connection for org ${orgId}:`, error);
    return "unchanged";
  }
  return (data ?? []).length > 0 ? "named" : "unchanged";
}

/** Which ServiceM8 account this workspace is connected to, and which one its
    copy came from — token-free. The two agree except across a change of
    account: the connection moves first, and the copy's own row (sm8_vendor)
    is cleared LAST, so while they differ the old copy is still here to
    clear. sm8_vendor outlives a disconnect for the same reason (see
    SM8_WIPE_TABLES): the cached photos do too. `connected` is null when there
    is no connection row; its tenantId is null while the grant is nameless.

    A READ THAT FAILS IS NOT AN ABSENT ROW. It comes back as `ok: false`, and
    every caller stops: taken as "no account", it would let a reconnect save
    nameless over a named row, or let a sync write the new account over the
    one record of which account's copy is still here. */
export type Sm8Accounts =
  | {
      ok: true;
      connected: { tenantId: string | null; tenantName: string | null } | null;
      mirrored: { uuid: string; name: string | null } | null;
    }
  | { ok: false };

export async function readSm8Accounts(orgId: string): Promise<Sm8Accounts> {
  const [conn, vendor] = await Promise.all([
    supabaseAdmin
      .from(TABLE)
      .select("tenant_id, tenant_name")
      .eq("org_id", orgId)
      .eq("provider", PROVIDER)
      .maybeSingle(),
    supabaseAdmin.from("sm8_vendor").select("uuid, name").eq("org_id", orgId).maybeSingle(),
  ]);
  if (conn.error || vendor.error) {
    console.error(`[sm8] couldn't read which ServiceM8 account org ${orgId} holds:`, conn.error ?? vendor.error);
    return { ok: false };
  }
  const c = conn.data as { tenant_id: string | null; tenant_name: string | null } | null;
  const v = vendor.data as { uuid: string | null; name: string | null } | null;
  return {
    ok: true,
    connected: c ? { tenantId: c.tenant_id ?? null, tenantName: c.tenant_name ?? null } : null,
    mirrored: v?.uuid ? { uuid: v.uuid, name: v.name ?? null } : null,
  };
}

/** The last change of account, for the owner's screen: the old account's
    name and when it went. Null when there has been none — and on any error,
    so a database without the columns yet reads as "no change". */
export async function readSm8AccountChange(
  orgId: string
): Promise<{ from: string | null; at: string } | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("account_changed_at, account_changed_from")
    .eq("org_id", orgId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as { account_changed_at: string | null; account_changed_from: string | null };
  return r.account_changed_at ? { from: r.account_changed_from ?? null, at: r.account_changed_at } : null;
}

/** HeyTiff's own copies of the old account's customer photos: the cached
    bytes (documents of kind job_file from servicem8, and their storage
    objects), what was read off them, and the stars on them. Photo search
    reads all three, so without this the old account's photos stay findable
    after the account has gone. The storage objects are best-effort and
    logged — an orphaned object is invisible, a row is not. False when a row
    delete failed. */
async function clearCachedCopies(orgId: string): Promise<boolean> {
  let cleared = true;
  for (const table of ["job_photo_favourites", "job_photo_readings"]) {
    const { error } = await supabaseAdmin.from(table).delete().eq("org_id", orgId);
    if (error && !missingTable(error)) {
      console.error(`[sm8] couldn't clear ${table} for org ${orgId}:`, error);
      cleared = false;
    }
  }

  const refs: string[] = [];
  const PAGE = 1000;
  for (let page = 0; page < 100; page++) {
    const { data, error } = await supabaseAdmin
      .from("documents")
      .select("storage_ref")
      .eq("org_id", orgId)
      .eq("kind", "job_file")
      .eq("source", PROVIDER)
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) {
      console.error(`[sm8] couldn't list the cached ServiceM8 files for org ${orgId}:`, error);
      break;
    }
    const rows = (data ?? []) as { storage_ref: string | null }[];
    for (const r of rows) if (r.storage_ref && refIsOrgs(r.storage_ref, orgId)) refs.push(r.storage_ref);
    if (rows.length < PAGE) break;
  }
  for (const part of chunk(refs, 500)) {
    const { error } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove(part);
    if (error) console.error(`[sm8] couldn't remove ${part.length} cached ServiceM8 files for org ${orgId}:`, error);
  }

  const { error: docError } = await supabaseAdmin
    .from("documents")
    .delete()
    .eq("org_id", orgId)
    .eq("kind", "job_file")
    .eq("source", PROVIDER);
  if (docError) {
    console.error(`[sm8] couldn't clear the cached ServiceM8 files for org ${orgId}:`, docError);
    cleared = false;
  }
  return cleared;
}

export type Sm8SwitchResult =
  /** `cleared` false: something of the old copy couldn't be deleted, so
      sm8_vendor still names the old account and the next sync repeats this. */
  | { ok: true; cancelled: number; cleared: boolean }
  /** Nothing was cleared. `moved`: the connection no longer holds `to`. */
  | { ok: false; reason: "elsewhere" | "moved" | "failed" };

/** Replace the account this workspace is connected to — the connection
    already holds `to` (the callback saved it, or the sync named it) — and
    clear everything HeyTiff holds of `from`:

    1. The connection: sending goes off, and the change is recorded for the
       owner's screen. CONDITIONAL on the row still holding `to`: a caller
       holding a stale view can't write over a newer reconnect.
    2. Writes waiting to go to the old account are cancelled (any already
       queued for `to` are its own, and stay).
    3. HeyTiff's cached copies of the old account's photos go (see
       clearCachedCopies).
    4. The mirrors and their cursors, org-scoped; then sm8_vendor LAST, and
       only while it still names `from`. It is the sentinel: an interrupted
       clear leaves it naming the old account, and the next sync repeats all
       of this; and a newer account's row is never the one deleted.
    sm8_sync_runs is never touched — see SM8_ACCOUNT_RESET_TABLES.

    ONLY UNDER THE SYNC LEASE (runSm8Sync, or switchSm8AccountUnderLease for
    the callback). A walker still reading the old account under the old grant
    could otherwise land a page, or an object's cursor, after the table it
    belongs to was cleared — and with sm8_vendor already naming the new
    account, nothing would ever clear it again.

    NEVER ON A MISSING VALUE. Both uuids must be present and different, or
    nothing happens; both are logged before anything is deleted. */
export async function switchSm8Account(
  orgId: string,
  input: { to: Sm8Vendor; from: { uuid: string | null; name: string | null }; now?: number }
): Promise<Sm8SwitchResult> {
  const { to, from } = input;
  const now = input.now ?? Date.now();
  if (!to.uuid || !from.uuid || to.uuid === from.uuid) {
    console.error(
      `[sm8] refused an account switch for org ${orgId} without two different accounts (from ${from.uuid ?? "none"} to ${to.uuid || "none"})`
    );
    return { ok: false, reason: "failed" };
  }
  console.warn(
    `[sm8] ServiceM8 account changed for org ${orgId}: from ${from.uuid} to ${to.uuid}. Clearing the old account's copy.`
  );

  const iso = new Date(now).toISOString();
  const base = {
    tenant_name: to.name,
    tenants: [{ tenantId: to.uuid, tenantName: to.name, timezoneName: to.timezoneName }],
    write_mode: "off",
    updated_at: iso,
  };
  const update = (patch: Record<string, unknown>) =>
    supabaseAdmin
      .from(TABLE)
      .update(patch)
      .eq("org_id", orgId)
      .eq("provider", PROVIDER)
      .eq("tenant_id", to.uuid)
      .select("id");

  let res = await update({ ...base, account_changed_at: iso, account_changed_from: from.name });
  if (missingColumn(res.error)) res = await update(base);
  if (res.error) {
    if (heldElsewhere(res.error)) return { ok: false, reason: "elsewhere" };
    console.error(`[sm8] couldn't record the account change for org ${orgId}:`, res.error);
    return { ok: false, reason: "failed" };
  }
  if ((res.data ?? []).length === 0) return { ok: false, reason: "moved" };

  const cancelled = await cancelWaitingSm8Writes(orgId, WRITE_WORDS.otherAccount, now, { exceptFor: to.uuid });

  let cleared = await clearCachedCopies(orgId);
  for (const table of SM8_ACCOUNT_RESET_TABLES) {
    const { error } = await supabaseAdmin.from(table).delete().eq("org_id", orgId);
    if (error && !missingTable(error)) {
      console.error(`[sm8] couldn't clear ${table} for org ${orgId}:`, error);
      cleared = false;
    }
  }
  if (cleared) {
    const { error } = await supabaseAdmin.from("sm8_vendor").delete().eq("org_id", orgId).eq("uuid", from.uuid);
    if (error) cleared = false;
  }
  return { ok: true, cancelled: cancelled.length, cleared };
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
    disconnected-with-leftovers, which nothing would ever clean.

    Writes still waiting to go are cancelled, and the record of what went is
    kept: sm8_writes is HeyTiff's own history, not a mirror. A send already
    mid-request is left to land or not — it is counted, not cancelled, and
    the owner is told it may still arrive. A reconnect starts with writing
    switched off (the row below goes, and write_mode with it).

    sm8_vendor STAYS (see SM8_WIPE_TABLES): the cached photos, their readings
    and their stars outlive a disconnect, and that row is what makes a later
    connect of a different account clear them. */
export async function disconnectSm8(
  orgId: string,
  now: number = Date.now()
): Promise<{ cancelled: CancelledWrite[]; inFlight: number }> {
  const cancelled = await cancelWaitingSm8Writes(orgId, WRITE_WORDS.disconnected, now);
  const inFlight = await countSm8WritesInFlight(orgId, now);
  for (const table of SM8_WIPE_TABLES) {
    await supabaseAdmin.from(table).delete().eq("org_id", orgId);
  }
  await supabaseAdmin.from(TABLE).delete().eq("org_id", orgId).eq("provider", PROVIDER);
  return { cancelled, inFlight };
}

/* ── the grant ── */

export type Sm8Access = {
  accessToken: string;
  /** The ServiceM8 account the connection said this token is for, when it
      was read. Null while the connection is nameless. */
  tenantId: string | null;
  /** A fingerprint of the grant the token was issued under — see grantOf. */
  grant: string;
};

export type Sm8AccessReason = "not_connected" | "reauth" | "unreachable";

export type Sm8AccessResult =
  | { ok: true; access: Sm8Access }
  | { ok: false; reason: Sm8AccessReason };

const NOT_CONNECTED: Sm8AccessResult = { ok: false, reason: "not_connected" };
const REAUTH: Sm8AccessResult = { ok: false, reason: "reauth" };
const UNREACHABLE: Sm8AccessResult = { ok: false, reason: "unreachable" };

/** Flag one grant as broken, so the screen prompts a reconnect — the grant
    whose sealed refresh token is `sealedRefresh`, and no other. The message
    is ours; ServiceM8's own error text never reaches this column. True when
    the row was flagged. */
async function flagRow(orgId: string, error: string, sealedRefresh: string | null): Promise<boolean> {
  let q = supabaseAdmin
    .from(TABLE)
    .update({ status: "needs_reauth", last_error: error, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("provider", PROVIDER);
  q = sealedRefresh === null ? q.is("refresh_token_enc", null) : q.eq("refresh_token_enc", sealedRefresh);
  const { data, error: dbError } = await q.select("id");
  return !dbError && (data ?? []).length > 0;
}

/** Flag the grant `access` was issued under as broken — a 401 that survived a
    renewal is the same verdict as a refused refresh. Nothing happens, and
    false comes back, when the connection has moved on since: a sibling
    refreshed, or the owner reconnected. */
export async function markSm8NeedsReauth(orgId: string, error: string, access: Sm8Access): Promise<boolean> {
  const row = await readRow(orgId);
  if (!row || grantOf(row.refresh_token_enc) !== access.grant) return false;
  return flagRow(orgId, error, row.refresh_token_enc);
}

/* One in-flight refresh per org, per server instance — the common-case guard;
   the claim and the conditional write below are the cross-instance ones. */
const inflightRefresh = new Map<string, Promise<Sm8AccessResult>>();

/** How long a refresh claim is held: the token request's own 10 s timeout,
    and the write after it. */
const REFRESH_CLAIM_MS = 15_000;
/** How long a server that found the claim taken waits for the sibling's
    rotation — at least the token request's timeout, or a slow sibling reads
    as a failure. */
const REFRESH_WAIT_MS = 12_000;
const REFRESH_POLL_MS = 1_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The access token a row already holds, if it is live and readable. */
function storedAccess(
  row: ConnectionRow,
  key: NonNullable<ReturnType<typeof tokenKey>>,
  at: number
): Sm8Access | null {
  if (row.status !== "connected" || !accessTokenUsable(row.expires_at, at)) return null;
  const accessToken = open(row.access_token_enc, key);
  return accessToken ? { accessToken, tenantId: row.tenant_id, grant: grantOf(row.refresh_token_enc) } : null;
}

/** A usable ServiceM8 access token for this org, refreshing first if the
    stored one is spent. THE ENTRY POINT for everything that reads or writes
    ServiceM8, so the refresh-and-rotate dance lives in exactly one place.

    Not ok says why, and the reasons are different decisions:
    - `not_connected`: no connection here (or this deployment can't hold one);
    - `reauth`: the grant is dead, and the row now says so;
    - `unreachable`: ServiceM8 couldn't be asked just now. Nothing was
      flagged, and the next attempt may well work. */
export async function sm8AccessResult(orgId: string, now: number = Date.now()): Promise<Sm8AccessResult> {
  const row = await readRow(orgId);
  if (!row) return NOT_CONNECTED;

  // A grant already marked broken is not retried — reconnect is the recovery
  // path, and the screen already says so.
  if (row.status === "needs_reauth") return REAUTH;

  const key = tokenKey();
  const cfg = sm8Config();
  if (!key || !cfg) return NOT_CONNECTED;

  if (accessTokenUsable(row.expires_at, now)) {
    const access = storedAccess(row, key, now);
    if (access) return { ok: true, access };
    // Sealed with a key we no longer hold — a refresh can't help.
    await flagRow(orgId, SM8_UNREADABLE, row.refresh_token_enc);
    return REAUTH;
  }

  return refreshOnce(orgId, row, key, cfg, now);
}

/** The same, as a token or nothing — for the callers that only ever needed
    to know whether there was one. */
export async function sm8Access(orgId: string, now: number = Date.now()): Promise<Sm8Access | null> {
  const r = await sm8AccessResult(orgId, now);
  return r.ok ? r.access : null;
}

/** A token ServiceM8 refused with a 401: find a better one. Spends a refresh
    only when nothing better is already stored — a sibling may have rotated
    since `rejected` was handed out, and its token is taken instead. The
    stored expiry is ignored: ServiceM8 has just said this token is done,
    whatever the clock says. */
export async function renewSm8Access(
  orgId: string,
  rejected: Sm8Access,
  now: number = Date.now()
): Promise<Sm8AccessResult> {
  const row = await readRow(orgId);
  if (!row) return NOT_CONNECTED;
  if (row.status === "needs_reauth") return REAUTH;

  const key = tokenKey();
  const cfg = sm8Config();
  if (!key || !cfg) return NOT_CONNECTED;

  if (grantOf(row.refresh_token_enc) !== rejected.grant) {
    const newer = storedAccess(row, key, now);
    if (newer && newer.accessToken !== rejected.accessToken) return { ok: true, access: newer };
  }
  return refreshOnce(orgId, row, key, cfg, now);
}

function refreshOnce(
  orgId: string,
  row: ConnectionRow,
  key: NonNullable<ReturnType<typeof tokenKey>>,
  cfg: NonNullable<ReturnType<typeof sm8Config>>,
  now: number
): Promise<Sm8AccessResult> {
  const inflight = inflightRefresh.get(orgId);
  if (inflight) return inflight;

  const flight = refreshAndStore(orgId, row, key, cfg, now).finally(() =>
    inflightRefresh.delete(orgId)
  );
  inflightRefresh.set(orgId, flight);
  return flight;
}

/** Take the right to redeem this refresh token, across every server: a
    conditional write that matches only while nobody else holds a live claim
    on the same token. `unsupported` is a database without the column yet,
    where the refresh goes ahead unclaimed, as it always did. */
async function claimRefresh(
  orgId: string,
  row: ConnectionRow,
  now: number
): Promise<"taken" | "busy" | "unsupported"> {
  const iso = new Date(now).toISOString();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ refresh_claimed_until: new Date(now + REFRESH_CLAIM_MS).toISOString() })
    .eq("org_id", orgId)
    .eq("provider", PROVIDER)
    .eq("refresh_token_enc", row.refresh_token_enc)
    .or(`refresh_claimed_until.is.null,refresh_claimed_until.lt.${iso}`)
    .select("id");
  if (error) {
    if (!missingColumn(error)) console.error(`[sm8] couldn't claim the refresh for org ${orgId}:`, error);
    return "unsupported";
  }
  return (data ?? []).length > 0 ? "taken" : "busy";
}

/** Somebody else holds the claim: wait for their rotation rather than redeem
    the same refresh token a second time. Their stored token is the answer;
    running out of patience is "unreachable", and flags nothing. */
async function awaitSiblingRotation(
  orgId: string,
  row: ConnectionRow,
  key: NonNullable<ReturnType<typeof tokenKey>>,
  now: number
): Promise<Sm8AccessResult> {
  for (let waited = REFRESH_POLL_MS; waited <= REFRESH_WAIT_MS; waited += REFRESH_POLL_MS) {
    await sleep(REFRESH_POLL_MS);
    const latest = await readRow(orgId);
    if (!latest) return NOT_CONNECTED;
    if (latest.refresh_token_enc === row.refresh_token_enc) {
      if (latest.status === "needs_reauth") return REAUTH;
      continue;
    }
    const access = storedAccess(latest, key, now + waited);
    return access ? { ok: true, access } : UNREACHABLE;
  }
  return UNREACHABLE;
}

async function refreshAndStore(
  orgId: string,
  row: ConnectionRow,
  key: NonNullable<ReturnType<typeof tokenKey>>,
  cfg: NonNullable<ReturnType<typeof sm8Config>>,
  now: number
): Promise<Sm8AccessResult> {
  const refresh = open(row.refresh_token_enc, key);
  if (!refresh) {
    await flagRow(orgId, SM8_UNREADABLE, row.refresh_token_enc);
    return REAUTH;
  }

  const claim = await claimRefresh(orgId, row, now);
  if (claim === "busy") return awaitSiblingRotation(orgId, row, key, now);

  const fresh = await refreshSm8Tokens(cfg, refresh);

  if (fresh.ok) {
    /* ServiceM8 rotates the refresh token on every use: this write is the
       only copy of the next one. The `.eq` on the OLD sealed refresh token is
       the cross-instance rotation guard — if a sibling instance redeemed and
       stored first, this older pair must not clobber its newer one. Our own
       access token is fresh-issued either way, so the caller still works.
       The claim is released in the same write, and only when it was taken:
       that is what proves the column is there to be written. */
    const sealedRefresh = seal(fresh.tokens.refreshToken, key);
    const { error } = await supabaseAdmin
      .from(TABLE)
      .update({
        status: "connected",
        access_token_enc: seal(fresh.tokens.accessToken, key),
        refresh_token_enc: sealedRefresh,
        expires_at: expiryFromTokenSet({ expires_in: fresh.tokens.expiresIn ?? undefined }, now),
        scopes: fresh.tokens.scope || row.scopes,
        last_error: null,
        updated_at: new Date(now).toISOString(),
        ...(claim === "taken" ? { refresh_claimed_until: null } : {}),
      })
      .eq("org_id", orgId)
      .eq("provider", PROVIDER)
      .eq("refresh_token_enc", row.refresh_token_enc);
    if (error) console.error(`[sm8] couldn't store the rotated grant for org ${orgId}:`, error);
    return {
      ok: true,
      access: { accessToken: fresh.tokens.accessToken, tenantId: row.tenant_id, grant: grantOf(sealedRefresh) },
    };
  }

  if (claim === "taken") {
    await supabaseAdmin
      .from(TABLE)
      .update({ refresh_claimed_until: null })
      .eq("org_id", orgId)
      .eq("provider", PROVIDER)
      .eq("refresh_token_enc", row.refresh_token_enc);
  }

  /* Before judging, look again. A refresh token that has changed since it was
     read was rotated by a sibling or replaced by a reconnect — the refusal
     was about a token nobody holds any more, and the row has a better one. */
  const latest = await readRow(orgId);
  if (!latest) return NOT_CONNECTED;
  if (latest.refresh_token_enc !== row.refresh_token_enc) {
    const access = storedAccess(latest, key, now);
    return access ? { ok: true, access } : UNREACHABLE;
  }

  if (fresh.failure === "revoked") {
    await flagRow(orgId, SM8_DECLINED, row.refresh_token_enc);
    return REAUTH;
  }
  // Not the grant's fault: a blip, a timeout, ServiceM8's own trouble.
  return UNREACHABLE;
}
