"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { invalidRule, type RegularDayOff } from "@/lib/team/regular-days-off";
import { RDO_COLUMNS, RDO_TABLE, readRegularDaysOff, ruleOf } from "@/lib/team/regular-days-off-query";

/* Regular days off (v2, 18 October): TAFE, RDOs, uni. Set by whoever looks
   after the team (`team`), for anyone in the org. A rule, never leave. */

export type RuleInput = Omit<RegularDayOff, "id" | "staffProfileId">;
type Answer<T> = { ok: true } & T | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFUSED = "You can't change the team's days off.";
const MISSING = "Regular days off aren't set up in this workspace yet.";

async function gate(staffProfileId: string): Promise<{ ok: true; orgId: string } | { ok: false; error: string }> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) return { ok: false, error: REFUSED };
  if (!(await can("team"))) return { ok: false, error: REFUSED };
  if (!UUID.test(staffProfileId)) return { ok: false, error: "That person isn't here." };
  const { data } = await supabaseAdmin.from("staff_profiles").select("id").eq("org_id", orgId).eq("id", staffProfileId).maybeSingle();
  if (!data) return { ok: false, error: "That person isn't here." };
  return { ok: true, orgId };
}

const refresh = () => {
  revalidatePath("/dashboard/schedule");
  revalidatePath("/dashboard/team", "layout");
};

export async function listRegularDaysOff(staffProfileId: string): Promise<Answer<{ rules: RegularDayOff[] }>> {
  const g = await gate(staffProfileId);
  if (!g.ok) return g;
  return { ok: true, rules: await readRegularDaysOff(g.orgId, staffProfileId) };
}

/** Add a rule, or change one (`id`). */
export async function saveRegularDayOff(input: { staffProfileId: string; id?: string; rule: RuleInput }): Promise<Answer<{ rule: RegularDayOff }>> {
  const g = await gate(input?.staffProfileId);
  if (!g.ok) return g;
  const r = input.rule;
  const rule: RuleInput = {
    reason: String(r?.reason ?? "").trim(),
    weekdays: [...new Set((r?.weekdays ?? []).map(Number))].sort((a, b) => a - b),
    everyWeeks: r?.everyWeeks === 2 ? 2 : 1,
    fromDate: String(r?.fromDate ?? ""),
    toDate: r?.toDate ? String(r.toDate) : null,
    partFrom: r?.partFrom ? String(r.partFrom) : null,
    partTo: r?.partTo ? String(r.partTo) : null,
    skipDates: [...new Set((r?.skipDates ?? []).map(String))].sort(),
  };
  const bad = invalidRule(rule);
  if (bad) return { ok: false, error: bad };
  const row = {
    org_id: g.orgId,
    staff_profile_id: input.staffProfileId,
    reason: rule.reason,
    weekdays: rule.weekdays,
    every_weeks: rule.everyWeeks,
    from_date: rule.fromDate,
    to_date: rule.toDate,
    part_from: rule.partFrom,
    part_to: rule.partTo,
    skip_dates: rule.skipDates,
  };
  const q =
    input.id && UUID.test(input.id)
      ? supabaseAdmin.from(RDO_TABLE).update(row).eq("org_id", g.orgId).eq("id", input.id).select(RDO_COLUMNS).maybeSingle()
      : supabaseAdmin.from(RDO_TABLE).insert(row).select(RDO_COLUMNS).maybeSingle();
  const { data, error } = await q;
  if (error) {
    console.error("[regular-days-off] save failed:", error);
    return { ok: false, error: error.code === "42P01" ? MISSING : "That didn't save. Try again." };
  }
  if (!data) return { ok: false, error: "That day off isn't here any more." };
  refresh();
  return { ok: true, rule: ruleOf(data as Parameters<typeof ruleOf>[0]) };
}

export async function deleteRegularDayOff(input: { staffProfileId: string; id: string }): Promise<Answer<object>> {
  const g = await gate(input?.staffProfileId);
  if (!g.ok) return g;
  if (!UUID.test(input.id)) return { ok: false, error: "That day off isn't here any more." };
  const { error } = await supabaseAdmin
    .from(RDO_TABLE)
    .delete()
    .eq("org_id", g.orgId)
    .eq("staff_profile_id", input.staffProfileId)
    .eq("id", input.id);
  if (error) return { ok: false, error: error.code === "42P01" ? MISSING : "That didn't come off. Try again." };
  refresh();
  return { ok: true };
}
