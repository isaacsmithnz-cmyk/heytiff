import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";

/* QUOTES ON A TRIAL RUN OF THEIR OWN (Isaac, 2026-10-11: send to ServiceM8
   as a quote, "build it, Trial first", nothing to a live job until he
   says). The connection's write mode is every kind's at once, and Diamond
   Air's is live, so quotes carry their own: on trial, a quote row is
   checked and logged and never sent, however the connection is set. Every
   connection starts with quotes on trial (sm8_quote_trial.sql); the
   owner's On takes them off it. A read that fails is a trial run. */

export async function quotesOnTrial(orgId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from("integration_connections").select("trial_kinds").eq("org_id", orgId).eq("provider", "servicem8").maybeSingle();
  if (error) return true;
  const kinds = (data as { trial_kinds?: unknown } | null)?.trial_kinds;
  return Array.isArray(kinds) && kinds.includes("quote");
}

/** The owner's Trial or On for quotes; false when it didn't take. */
export async function setQuotesOnTrial(orgId: string, trial: boolean, now: number = Date.now()): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("sm8_set_trial_kind", { p_org: orgId, p_kind: "quote", p_trial: trial, p_at: new Date(now).toISOString() });
  return !error && data != null;
}
