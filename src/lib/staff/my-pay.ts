import { supabaseAdmin } from "@/lib/supabase-server";
import { getPaySettings } from "@/lib/timepay/query";

/* YOUR pay, and only ever yours.

   THE MONEY BOUNDARY, restated for this module. Two rules, both structural:

   1. The wage read is keyed on org_id AND user_id — the signed-in user's own
      row. It is the same shape as getMyWeek's own-row read (lib/timepay), and
      it deliberately does NOT go through the `financials`-gated paths in
      lib/staff/query.ts. Your own rate is intrinsic; someone else's needs a
      capability, and there is no argument to this function that could fetch
      one.

   2. The org's default super rate lives inside rate_calc_state.state, a blob
      that also holds EVERY staff member's modelled wage. So this selects the
      single scalar out of it in the database — `state->settings->super_pct` —
      and never `state`. Pulling the whole column to read one number would put
      the entire payroll in this request's memory to render a percentage. */

export type MyPay = {
  /** hourly_wage, or null when an admin hasn't set one yet */
  rate: number | null;
  superPct: number;
  otMultiplier: 1.5;
  dblMultiplier: 2;
  /** where superPct came from — the card says so out loud */
  superSource: "override" | "org" | "default";
  /** penalty multipliers, null when the org has that rule switched off */
  weekend: { sat: number | null; sun: number | null };
};

/** Super rate used when the org has never opened the Rate Calculator. */
export const DEFAULT_SUPER_PCT = 12;

export async function getMyPay(orgId: string, userId: string): Promise<MyPay> {
  const [mine, org, pay] = await Promise.all([
    supabaseAdmin
      .from("staff_profiles")
      .select("hourly_wage, super_override")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("rate_calc_state")
      // one scalar out of the blob — see the note above
      .select("super_pct:state->settings->super_pct")
      .eq("org_id", orgId)
      .maybeSingle(),
    getPaySettings(orgId),
  ]);

  const row = (mine.data ?? null) as Record<string, unknown> | null;
  const rawRate = row?.hourly_wage;
  const rawOverride = row?.super_override;

  const rate = rawRate == null ? null : Number(rawRate);
  const override = rawOverride == null ? null : Number(rawOverride);

  const orgPct = Number((org.data as Record<string, unknown> | null)?.super_pct);
  const hasOrgPct = Number.isFinite(orgPct);

  const superPct =
    override !== null && Number.isFinite(override)
      ? override
      : hasOrgPct
        ? orgPct
        : DEFAULT_SUPER_PCT;
  const superSource: MyPay["superSource"] =
    override !== null && Number.isFinite(override) ? "override" : hasOrgPct ? "org" : "default";

  const rules = pay.settings.rules;
  return {
    rate: rate !== null && Number.isFinite(rate) ? rate : null,
    superPct,
    otMultiplier: 1.5,
    dblMultiplier: 2,
    superSource,
    weekend: {
      sat: rules.sat.on ? rules.sat.rate : null,
      sun: rules.sun.on ? rules.sun.rate : null,
    },
  };
}
