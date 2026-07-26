-- integration_connections — one row per (org, connected app).
--
-- WHAT IT HOLDS: the OAuth 2.0 grant a HeyTiff org has given a third-party app.
-- Xero is the first, and the only one the code knows about today; `provider` is
-- text (not an enum) so the next one is a row, not a migration.
--
-- WHY ONE ROW PER ORG, NOT PER USER: the grant belongs to the BUSINESS. The
-- owner authorises it once and Time & Pay, expenses and the Rate Calculator all
-- read through it. `connected_by_user_id` records who clicked Allow — that is
-- provenance, not ownership, and the connection survives that person leaving.
--
-- TOKENS ARE NEVER STORED IN PLAINTEXT. access_token_enc and refresh_token_enc
-- hold AES-256-GCM ciphertext sealed by INTEGRATIONS_TOKEN_KEY (see
-- src/lib/integrations/secrets.ts). The service-role key alone is therefore not
-- enough to spend someone's Xero grant — you need the app's key as well, and
-- that key never goes near the browser. Both columns are `_enc` suffixed so a
-- future `select *` reader can't mistake them for something usable.
--
-- POSTURE: RLS is ON with NO policies, like every other table here — the
-- anon/authenticated keys can read nothing and every access goes through the
-- service-role client behind an app-layer OWNER gate
-- (src/app/actions/integrations.ts, src/app/api/integrations/**). This table is
-- the strongest case in the schema for that posture: a leaked row is a leaked
-- accounting system.
--
-- APPLY THIS BEFORE MERGING THE PR. Nothing reads the table until it exists,
-- and the Integrations screen renders "not connected" rather than erroring, but
-- Connect fails at the final save without it.

create table if not exists public.integration_connections (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null,
  provider             text not null,

  -- 'connected'    — the grant works
  -- 'needs_reauth' — Xero rejected the refresh token (revoked, or 60 days idle)
  status               text not null default 'connected'
                         check (status in ('connected', 'needs_reauth')),

  -- The Xero ORGANISATION this connection points at. One authorisation can
  -- return several (a bookkeeper with more than one company), so the full list
  -- is kept and `tenant_id` names the active one — see setXeroTenant().
  tenant_id            text,
  tenant_name          text,
  tenants              jsonb not null default '[]'::jsonb,

  -- Space-separated, exactly as the provider granted them. Stored rather than
  -- assumed so the screen can show what was actually agreed to, and so a scope
  -- we add later shows up as missing instead of failing at the first API call.
  scopes               text,

  access_token_enc     text,
  refresh_token_enc    text,
  -- When the ACCESS token dies (Xero: 30 minutes). The refresh token's own
  -- 60-day idle expiry isn't tracked — nothing reports it, and a refresh that
  -- fails is what actually tells us, which is what `status` is for.
  expires_at           timestamptz,

  connected_by_user_id text,
  connected_at         timestamptz not null default now(),
  updated_at           timestamptz,
  -- Last failure, for the screen's "reconnect" prompt. Our own sentence, never
  -- the provider's response body.
  last_error           text
);

-- One connection per app per org: connecting again REPLACES the grant rather
-- than quietly stacking a second one that nothing would ever read.
create unique index if not exists integration_connections_org_provider_idx
  on public.integration_connections (org_id, provider);

alter table public.integration_connections enable row level security;
-- deliberately no policies: deny-all to the public keys (house posture)
