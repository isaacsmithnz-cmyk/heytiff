import { supabaseAdmin } from "@/lib/supabase-server";
import { getPaySettings } from "@/lib/timepay/query";
import type { Settings } from "@/components/timepay/logic";

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
  /** where superPct came from — the card says so out loud */
  superSource: "override" | "org" | "default";

  /* WHAT THE PAY RUN ACTUALLY DOES, not a restatement of it.

     This used to hand the card `otMultiplier: 1.5`, `dblMultiplier: 2` and a
     single `weekend: { sat, sun }` multiplier taken from `rules.sat.rate`.
     Every one of those was a second model of `splitDay`, and the weekend one
     was WRONG on the default settings: a Saturday is a STEPPED rule — 1.5×
     for the first `up` hours, then 2× — and reading only `.rate` reported the
     first rung as if it were the whole day. On the default 1.5×/first-2h
     Saturday, an eight-hour shift at $50 showed as $600 and paid $750.

     Public holidays were absent entirely, though `rules.ph` is ON by default
     at 2× all day and is the most valuable day anybody can work; night shift
     was absent too. The card's title is "the rates that apply to your hours",
     so a rule the engine applies and the card omits is the card being wrong.

     The rules travel whole now, and the card renders them through the same
     `ruleSummary` the settings screen uses. Nothing here re-derives a rate. */
  rules: Settings["rules"];
  /** the ordinary-time ladder: 1.5× past `otAfter` per `otUnit`, 2× past
      `dblAfter`. The card said "Overtime ×1.5" and never said after WHAT. */
  otAfter: number;
  otUnit: Settings["otUnit"];
  dblAfter: number;
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

  const s = pay.settings;
  return {
    rate: rate !== null && Number.isFinite(rate) ? rate : null,
    superPct,
    superSource,
    rules: s.rules,
    otAfter: s.otAfter,
    otUnit: s.otUnit,
    dblAfter: s.dblAfter,
  };
}
