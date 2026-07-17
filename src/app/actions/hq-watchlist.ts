"use server";

import { requireHq } from "@/lib/hq/guard";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { SaveResult } from "@/components/hq/edit-types";

/* Extraction watch-list — staff-curated items per brand ("look for the PUMY
   branch-box compatibility tables"). Auto-derived signals are computed pure
   (lib/hq/watchlist.ts); these actions manage only the manual items. Guarded
   like every HQ Server Function. */

export async function addWatchItem(
  brand: string,
  item: string,
  context?: string
): Promise<SaveResult> {
  const { email } = await requireHq();
  const trimmed = item.trim();
  if (!trimmed) return { ok: false, error: "Item is required" };
  const { error } = await supabaseAdmin.from("pack_watchlist").insert({
    brand,
    item: trimmed,
    context: context?.trim() || null,
    added_by: email,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function resolveWatchItem(id: string): Promise<SaveResult> {
  const { email } = await requireHq();
  const { error } = await supabaseAdmin
    .from("pack_watchlist")
    .update({ resolved_by: email, resolved_at: new Date().toISOString() })
    .eq("id", id)
    .is("resolved_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
