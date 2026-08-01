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
