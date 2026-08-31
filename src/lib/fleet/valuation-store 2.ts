import { supabaseAdmin } from "@/lib/supabase-server";
import type { AiValuation } from "@/components/fleet/logic";

/* The server side of issue #502: the valuation route owns its result.
   parseValuations stays pure in components/fleet/logic.ts; this module is the
   part that touches the database — the lease that says a run is in flight, and
   the write that lands what the run produced.

   THE LEASE RULE (same as kb_documents.lease_until): a serverless function
   can die without releasing anything, so nothing here is ever "held" — a run
   owns the org's fleet only while `lease_until` is in the future. Claiming is
   a conditional UPDATE, atomic in Postgres: of two simultaneous presses
   exactly one updates the row, and the loser is told a run is already going.
   That matters because each press bills real money. */

/** How long a claim lasts. The route's maxDuration is 300s; the extra minute
    means a function Vercel kills at the ceiling frees itself soon after,
    rather than wedging the button for anyone who reloads. */
export const VALUATION_LEASE_SECONDS = 360;

/** True while a valuation run owns this org's fleet. */
export async function valuationRunning(orgId: string, now = new Date()): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("fleet_valuation_leases")
    .select("lease_until")
    .eq("org_id", orgId)
    .maybeSingle();
  return !!data?.lease_until && new Date(data.lease_until as string) > now;
}

/** Claim the org's valuation lease. False means someone else's run is live —
    do not start another. */
export async function claimValuationLease(orgId: string, now = new Date()): Promise<boolean> {
  const until = new Date(now.getTime() + VALUATION_LEASE_SECONDS * 1000).toISOString();

  // The common case: a row exists and is free. One conditional UPDATE — of two
  // racers, Postgres lets exactly one through the WHERE.
  const { data: updated } = await supabaseAdmin
    .from("fleet_valuation_leases")
    .update({ lease_until: until })
    .eq("org_id", orgId)
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .select("org_id");
  if (updated && updated.length > 0) return true;

  // No row updated: either the org has never valued (insert the first row) or
  // the lease is live. An insert that hits the primary key lost a first-ever
  // race to another press — same answer as a live lease.
  const { error } = await supabaseAdmin
    .from("fleet_valuation_leases")
    .insert({ org_id: orgId, lease_until: until });
  return !error;
}

/** Release the lease — in a `finally`, success or not, so the button never
    stays wedged behind a run that already ended. */
export async function releaseValuationLease(orgId: string): Promise<void> {
  await supabaseAdmin
    .from("fleet_valuation_leases")
    .update({ lease_until: null })
    .eq("org_id", orgId);
}

/** Land the run's result on the rows it belongs to. This is the write that
    used to live in the saveValuations server action — moved here so the ROUTE
    performs it before responding, and the client is a viewer, not the courier
    a multi-minute result has to survive in. */
export async function persistValuations(
  orgId: string,
  values: Record<string, AiValuation>,
): Promise<void> {
  for (const [id, val] of Object.entries(values)) {
    await supabaseAdmin
      .from("vehicles")
      .update({ ai_value: val })
      .eq("org_id", orgId)
      .eq("id", id);
  }
}
