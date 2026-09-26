/* Connection shapes + the pure rules about them.

   The load-bearing type here is ConnectionView: what a CONNECTION LOOKS LIKE
   to a screen. It is built from the DB row by `toView`, and it has no token
   fields at all — not sealed ones, not truncated ones. The store module never
   hands a raw row to a component, so a client bundle can't accidentally carry
   an access token even if someone spreads the object into a prop later. */

import { missingScopesFor } from "./providers";
import { readWriteMode, type Sm8WriteMode } from "./sm8-write-plan";

export type ConnectionStatus = "connected" | "needs_reauth";

/** A Xero organisation the grant can point at. */
export type Tenant = { tenantId: string; tenantName: string };

/** The row as it comes out of Supabase — server-side only. */
export type ConnectionRow = {
  id: string;
  org_id: string;
  provider: string;
  status: string;
  tenant_id: string | null;
  tenant_name: string | null;
  tenants: unknown;
  scopes: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: string | null;
  connected_by_user_id: string | null;
  connected_at: string | null;
  updated_at: string | null;
  last_error: string | null;
  drift_count?: number | null;
  drift_checked_at?: string | null;
  /** 'off' | 'trial' | 'live' — whether HeyTiff may write back. ServiceM8
      only today; every other provider's row reads 'off'. */
  write_mode?: string | null;
  /** The kinds the owner has switched on (ServiceM8 only). Absent on a
      database without the column: files alone, as before it existed. */
  write_kinds?: unknown;
};

/** What crosses to the browser. No tokens, ever. */
export type ConnectionView = {
  provider: string;
  status: ConnectionStatus;
  /** The linked Xero organisation, when one has been chosen. */
  tenantId: string | null;
  tenantName: string | null;
  /** Every organisation this authorisation covers — >1 means show a picker. */
  tenants: Tenant[];
  scopes: string[];
  /** Scopes the app now asks for that this grant predates. */
  missing: string[];
  connectedAt: string | null;
  connectedByName: string | null;
  lastError: string | null;
  /* What the last scheduled sweep found. A COUNT and a timestamp — never the
     rates themselves, which is why this view can stay ungated while the
     figures behind it need `financials`. */
  driftCount: number | null;
  driftCheckedAt: string | null;
  /** The owner's switch for writing back to the provider — see
      docs/migrations/sm8_writes.sql. Anything unreadable is "off". */
  writeMode: Sm8WriteMode;
};

export function isConnectionStatus(v: unknown): v is ConnectionStatus {
  return v === "connected" || v === "needs_reauth";
}

/** Parse the `tenants` jsonb defensively — it round-trips through the DB, and
    a row written by an older shape must degrade to "no picker", not a crash. */
export function parseTenants(raw: unknown): Tenant[] {
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

/** Row → the token-free view a screen may hold. `kinds` are the write kinds
    whose permission counts towards `missing` — for ServiceM8, the ones the
    deployment allows and the owner has on (store.ts). */
export function toView(
  row: ConnectionRow,
  connectedByName: string | null = null,
  kinds?: readonly string[]
): ConnectionView {
  return {
    provider: row.provider,
    status: isConnectionStatus(row.status) ? row.status : "needs_reauth",
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenants: parseTenants(row.tenants),
    scopes: (row.scopes ?? "").split(/\s+/).filter(Boolean),
    // Judged against the ROW's provider — a ServiceM8 grant measured with
    // Xero's list would prompt "reconnect to finish" forever — and the row's
    // own switch: writing on without the permission to write is missing it —
    // for the kinds that count, so a permission nobody asks for (notes, on a
    // deployment that sends files only) never reads as missing.
    missing: missingScopesFor(row.provider, row.scopes, row.write_mode, kinds),
    connectedAt: row.connected_at,
    connectedByName,
    lastError: row.last_error,
    driftCount: typeof row.drift_count === "number" ? row.drift_count : null,
    driftCheckedAt: row.drift_checked_at ?? null,
    writeMode: readWriteMode(row.write_mode),
  };
}

/* A Xero access token lasts 30 minutes. Treating anything inside the last
   minute as already dead means a request never leaves here holding a token
   that expires mid-flight — the refresh is cheap, an unauthorised call costs a
   round trip and a confusing error. */
export const EXPIRY_SKEW_MS = 60_000;

export function accessTokenUsable(
  expiresAt: string | null,
  now: number,
  skewMs: number = EXPIRY_SKEW_MS
): boolean {
  if (!expiresAt) return false;
  const ms = Date.parse(expiresAt);
  if (Number.isNaN(ms)) return false;
  return ms - skewMs > now;
}

/** Xero hands back `expires_in` seconds (or, sometimes, an absolute `expires_at`
    in epoch SECONDS). Normalise both to an ISO timestamp; anything unreadable
    becomes null, which `accessTokenUsable` treats as "refresh first". */
export function expiryFromTokenSet(
  tokenSet: { expires_in?: unknown; expires_at?: unknown },
  now: number
): string | null {
  const inSecs = tokenSet.expires_in;
  if (typeof inSecs === "number" && Number.isFinite(inSecs)) {
    return new Date(now + inSecs * 1000).toISOString();
  }
  const at = tokenSet.expires_at;
  if (typeof at === "number" && Number.isFinite(at)) {
    return new Date(at * 1000).toISOString();
  }
  return null;
}
