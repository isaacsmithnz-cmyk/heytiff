/* Looking counts as looking — server only.

   Opening Home, the Workboard or the ServiceM8 screen tops ServiceM8 up
   behind the response: whatever is waiting to go is sent, then the mirror
   is synced if it has gone stale. Every check runs AFTER the response, so a
   page gains no query and no wait from it; the page only registers the
   after() and moves on.

   WRITES FIRST. A file somebody pressed Send on and that met a busy
   ServiceM8 goes before a sync walks its pages, so it is never stuck behind
   a 25-page walk. Each has its own bound: the writes stop claiming while a
   whole lease still fits in the function (backgroundBudgetMs), and the sync
   starts only while one of its leases still does. What doesn't fit goes on
   the next look.

   Only a connected workspace is touched: a grant that needs reconnecting
   can't sync or send, and asking it to only burns the attempt. On a
   deployment that doesn't write, only the sync runs. */

import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { runSm8Sync, sm8SyncIsStale } from "./sm8-sync";
import { runSm8Writes, sm8WritesDue, sm8WritesEnabled } from "./sm8-writes";
import { backgroundBudgetMs, FUNCTION_MAX_MS, WRITE_LEASE_MARGIN_MS } from "./sm8-write-plan";

/** A sync slice holds its lease this long; it starts only while that still
    fits in the function. */
const SYNC_LEASE_MS = 120_000;

/** Register one after() that sends what is due and then syncs a stale
    mirror, for a workspace the caller has already gated. Synchronous: the
    caller never awaits it, and nothing here reads before the response. */
export function freshenSm8AfterResponse(orgId: string): void {
  const calledAt = Date.now();
  after(async () => {
    try {
      const { data, error } = await supabaseAdmin
        .from("integration_connections")
        .select("status")
        .eq("org_id", orgId)
        .eq("provider", "servicem8")
        .maybeSingle();
      if (error || (data as { status: string | null } | null)?.status !== "connected") return;

      if (sm8WritesEnabled() && (await sm8WritesDue(orgId, Date.now()))) {
        const budgetMs = backgroundBudgetMs(calledAt, Date.now());
        if (budgetMs > 0) await runSm8Writes(orgId, "kick", { budgetMs });
      }

      if (Date.now() - calledAt > FUNCTION_MAX_MS - SYNC_LEASE_MS - WRITE_LEASE_MARGIN_MS) return;
      if (await sm8SyncIsStale(orgId, Date.now())) await runSm8Sync(orgId, "kick");
    } catch (err) {
      console.error(
        `[sm8] the page-load top-up for org ${orgId} threw: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });
}
