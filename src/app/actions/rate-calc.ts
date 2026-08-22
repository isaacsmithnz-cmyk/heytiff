"use server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";
import { todayInAu } from "@/lib/au-dates";
import { getConnectionView } from "@/lib/integrations/store";
import { getFinancialYearEnd, getProfitAndLoss, listAccounts } from "@/lib/integrations/xero-read";
import { dormantAccounts, periodFor, type PeriodChoice } from "@/lib/integrations/xero-pl";
import type { XeroCostSnapshot } from "@/components/rate-calculator/state";

/* Rate Calculator persistence — server side. Follows the studio-action
   pattern: authenticate the Auth0 session, then read/write via the service
   role with an explicit org_id scope. Server Functions are reachable by
   direct POST, so every function re-checks for itself — on `financials`,
   because the whole rate model is wage-derived and the gate must hold in
   both directions (a member without it could otherwise read every wage).

   Table: docs/migrations/rate_calc_state.sql — org_id is a real uuid with an
   FK onto organizations (both corrected 2026-07-28; the DDL used to live only
   in this comment, org_id was text, and deleting an org orphaned the blob). */


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
  const { orgId } = await requireOrg("financials");
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
  const { orgId, userId } = await requireOrg("financials");
  if (!isRateCalcStateShape(state)) throw new Error("Invalid rate calculator state");
  const { error } = await supabaseAdmin
    .from("rate_calc_state")
    .upsert(
      { org_id: orgId, state, updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: "org_id" },
    );
  if (error) throw new Error(error.message);
}

/* "Start fresh" — the saved row is DELETED rather than overwritten with an
   empty blob, so the org reads as never-configured on the next load and gets
   the first-run onboarding back. Same `financials` gate as everything else
   here: wiping the pricing model is a financial act, and the gate has to hold
   in both directions (see the note at the top of the file). */
export async function resetRateCalcState(): Promise<void> {
  const { orgId } = await requireOrg("financials");
  const { error } = await supabaseAdmin
    .from("rate_calc_state")
    .delete()
    .eq("org_id", orgId);
  if (error) throw new Error(error.message);
}

/* ── business costs from a connected Xero organisation ─────────────────────

   Same `financials` gate as everything else here — this reads the company's
   profit & loss, which is the most sensitive thing the calculator touches.

   The result is handed back for the CLIENT to patch into state and save
   through the normal path, rather than written here. That keeps one writer for
   the state blob (saveRateCalcState) instead of two racing each other, and it
   means a fetch the user then cancels out of leaves nothing behind. */

export type XeroCostsResult =
  | { ok: true; snapshot: XeroCostSnapshot }
  | { ok: false; error: string };

export async function fetchXeroBusinessCosts(choice: PeriodChoice): Promise<XeroCostsResult> {
  const { orgId } = await requireOrg("financials");

  const connection = await getConnectionView(orgId, "xero");
  if (!connection || connection.status !== "connected") {
    return { ok: false, error: "Xero isn't connected." };
  }

  /* The year end comes from Xero rather than being assumed: a business on a
     non-June year end would otherwise get the wrong twelve months, silently.
     A failure here is not fatal — periodFor falls back to 30 June, which is
     right for almost every Australian business. */
  const fy = await getFinancialYearEnd(orgId);
  const period = periodFor(
    choice,
    todayInAu(),
    fy.ok ? fy.data.day : null,
    fy.ok ? fy.data.month : null
  );

  const report = await getProfitAndLoss(orgId, period);
  if (!report.ok) return { ok: false, error: report.error };

  if (report.data.lines.length === 0 && report.data.excluded.length === 0) {
    return {
      ok: false,
      error: `No expenses found in Xero for ${period.label}. Try the other period.`,
    };
  }

  /* The chart of accounts, so the panel can name what the report DIDN'T say. A
     P&L omits accounts with no transactions, so an account that would be
     imported wrongly stays invisible until the period it finally has a balance.

     Best-effort on purpose: this is a review aid layered over figures that are
     already correct, and nobody should lose their cost import because one extra
     read failed. */
  const accounts = await listAccounts(orgId);
  const dormant = accounts.ok ? dormantAccounts(accounts.data, report.data) : [];

  return {
    ok: true,
    snapshot: {
      fetchedAt: new Date().toISOString(),
      period,
      tenantName: connection.tenantName ?? "Xero",
      lines: report.data.lines,
      excluded: report.data.excluded,
      notes: report.data.notes,
      sections: report.data.sections,
      dormant,
      monthsCovered: report.data.monthsCovered,
      /* Scaling a part-year up to a year is ON by default, and deliberately.
         An unscaled five-month total is flatly wrong as an annual overhead;
         scaled it is an honest estimate. The panel says so in words and the
         user can switch it off — but the wrong-by-default version would have
         been the one nobody noticed. */
      annualise: true,
    },
  };
}
