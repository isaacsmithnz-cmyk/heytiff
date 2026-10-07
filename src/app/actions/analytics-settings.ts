"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";
import { normaliseSettings, settingsRow, type AnalyticsSettings } from "@/lib/analytics/settings";

/* HOW A BUSINESS'S JOBS ARE COUNTED (Isaac, 2026-10-07: "Settings options
   maybe?"). Admin, Analytics saves the whole row at once. Money is the
   grant, the same as the page: every setting moves a figure of job money.
   Every call re-checks for itself; a server function is reachable by
   direct POST. */

export type SaveSettings = { ok: true; settings: AnalyticsSettings } | { ok: false; reason: string };

const NOT_ALLOWED = "Only someone who sees the jobs' money can change how they're counted.";
const NO_TABLE = "These can't be kept until the database is updated for them.";
const DIDNT_SAVE = "That didn't save. Try again.";

export async function saveAnalyticsSettings(input: unknown): Promise<SaveSettings> {
  let orgId: string;
  let userId: string;
  try {
    ({ orgId, userId } = await requireOrg("workboard_money"));
  } catch {
    return { ok: false, reason: NOT_ALLOWED };
  }
  const settings = normaliseSettings(input);
  const { error } = await supabaseAdmin
    .from("analytics_settings")
    .upsert({ org_id: orgId, ...settingsRow(settings), updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "org_id" });
  if (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code === "PGRST205" || code === "42P01") return { ok: false, reason: NO_TABLE };
    console.error(`[analytics] couldn't save org ${orgId}'s settings:`, error);
    return { ok: false, reason: DIDNT_SAVE };
  }
  revalidatePath("/dashboard/admin/analytics");
  revalidatePath("/dashboard/analytics");
  return { ok: true, settings };
}
