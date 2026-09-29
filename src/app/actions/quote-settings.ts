"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";
import { normaliseQuoteSettings, quoteSettingsRow, type QuoteSettings } from "@/lib/quotes/settings";

/* Quoting settings — the markup, the install day and the preferred items.
   Gated on `financials` like the Rate Calculator: markup and buy prices are
   the business's money. Every call re-checks for itself; a server function
   is reachable by direct POST. */

export type SaveResult = { ok: true; settings: QuoteSettings } | { ok: false; reason: string };

export async function saveQuoteSettings(input: unknown): Promise<SaveResult> {
  const { orgId, userId } = await requireOrg("financials");
  const settings = normaliseQuoteSettings(input);
  const { error } = await supabaseAdmin
    .from("quote_settings")
    .upsert(
      { org_id: orgId, ...quoteSettingsRow(settings), updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: "org_id" }
    );
  if (error) return { ok: false, reason: "The settings couldn't be saved. Try again." };
  revalidatePath("/dashboard/admin/quoting");
  return { ok: true, settings };
}
