/* Workboard reads — mirror queries only, org-scoped, server-only.

   Everything here reads the sm8_* mirrors, never ServiceM8 itself: the board
   renders from local rows whatever the upstream is doing, and freshness is
   the sync engine's job.

   Only the account's clock is left. The job counts and the seven-day run
   sheet lived here for the old overview's second card; the redesigned board
   answers both questions inside the card itself — the Calendar tab holds the
   week, and mirror health is one chip in the tab row — so their queries went
   with the card rather than lingering as unread rows.

   NO SESSION HERE — callers establish the right to ask and hand in orgId. */

import { supabaseAdmin } from "@/lib/supabase-server";

export async function getSm8Timezone(orgId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("sm8_vendor")
    .select("timezone_name")
    .eq("org_id", orgId)
    .maybeSingle();
  return (data as { timezone_name: string | null } | null)?.timezone_name ?? null;
}

/** The account's clock, and whether this workspace holds a ServiceM8 copy at
    all — one read of the same row `getSm8Timezone` reads, for a caller that
    has to tell "nothing booked" from "no ServiceM8 to book anything in".

    `connected` is the row existing. sm8_vendor is written by the first sync
    and outlives a disconnect (lib/integrations/sm8-store), so this answers
    "has a copy been made here", which is the question Home's day asks: a
    workspace that never had ServiceM8 must not be told nobody in it is
    linked.

    A READ THAT FAILS IS NOT AN ABSENT ROW (the sm8-store law). It comes back
    connected with no zone, so a screen keeps saying what it cannot see
    rather than calling a day it could not read complete. */
export async function sm8VendorOf(orgId: string): Promise<{ tz: string | null; connected: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("sm8_vendor")
    .select("timezone_name")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) {
    console.error(`[sm8] couldn't read the ServiceM8 account row for org ${orgId}:`, error);
    return { tz: null, connected: true };
  }
  const row = data as { timezone_name: string | null } | null;
  return { tz: row?.timezone_name ?? null, connected: row !== null };
}
