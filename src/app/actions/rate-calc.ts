"use server";

import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";

/* Rate Calculator persistence — server side. Follows the studio-action
   pattern: authenticate the Auth0 session, then read/write via the service
   role with an explicit org_id scope. Server Functions are reachable by
   direct POST, so every function re-checks the session itself.

   Table (created via Supabase migration `create_rate_calc_state`):
     create table if not exists public.rate_calc_state (
       org_id text primary key,
       state jsonb not null,
       schema_version integer not null default 1,
       updated_by text,
       updated_at timestamptz not null default now()
     );
     alter table public.rate_calc_state enable row level security;
     -- no policies: service-role access only, same posture as studio_designs
*/

async function requireOrg(): Promise<{ orgId: string; userId: string }> {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");
  const orgId = session.orgId as string | undefined;
  if (!orgId) throw new Error("No active organization");
  // The whole rate model is wage-derived — `financials` gates both directions.
  // Previously any signed-in member could POST these and read every wage.
  if (!(await can("financials"))) throw new Error("Insufficient permissions");
  return { orgId, userId: session.user.sub as string };
}

/* Cheap structural guard — full hydration/tolerance lives client-side in
   hydrateState(); this only rejects payloads that clearly aren't calculator
   state before they reach the database. */
function isRateCalcStateShape(v: unknown): boolean {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.staff)
    && o.settings != null && typeof o.settings === "object"
    && o.mode != null && typeof o.mode === "object";
}

export async function loadRateCalcState(): Promise<{ state: unknown; updatedAt: string } | null> {
  const { orgId } = await requireOrg();
  const { data, error } = await supabaseAdmin
    .from("rate_calc_state")
    .select("state, updated_at")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { state: data.state, updatedAt: data.updated_at as string };
}

export async function saveRateCalcState(state: unknown): Promise<void> {
  const { orgId, userId } = await requireOrg();
  if (!isRateCalcStateShape(state)) throw new Error("Invalid rate calculator state");
  const { error } = await supabaseAdmin
    .from("rate_calc_state")
    .upsert(
      { org_id: orgId, state, updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: "org_id" },
    );
  if (error) throw new Error(error.message);
}
