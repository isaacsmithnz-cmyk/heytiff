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

   2. The org's default super rate is pay_settings.super_pct — Time & Pay
      settings owns it. It USED to be read out of the Rate Calculator's state
      blob, which meant a pricing edit changed what every staff member saw as
      their super; the audit moved it home, and this module deliberately no
      longer touches rate_calc_state at all. */

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

/** Super rate used when the org has never set one. */
export const DEFAULT_SUPER_PCT = 12;

export async function getMyPay(orgId: string, userId: string): Promise<MyPay> {
  const [mine, pay] = await Promise.all([
    supabaseAdmin
      .from("staff_profiles")
      .select("hourly_wage, super_override")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle(),
    getPaySettings(orgId),
  ]);

  const row = (mine.data ?? null) as Record<string, unknown> | null;
  const rawRate = row?.hourly_wage;
  const rawOverride = row?.super_override;

  const rate = rawRate == null ? null : Number(rawRate);
  const override = rawOverride == null ? null : Number(rawOverride);

  const raw = pay.settings.superPct;
  const orgPct = typeof raw === "number" && Number.isFinite(raw) ? raw : null;

  const superPct =
    override !== null && Number.isFinite(override)
      ? override
      : orgPct !== null
        ? orgPct
        : DEFAULT_SUPER_PCT;
  const superSource: MyPay["superSource"] =
    override !== null && Number.isFinite(override) ? "override" : orgPct !== null ? "org" : "default";

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
