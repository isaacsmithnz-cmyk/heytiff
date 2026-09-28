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
   deployment that doesn't write, only the sync runs.

   THEN THE ASKS. A sync that ran may have brought in a note that asks
   somebody something, and the new Home makes each ask one task
   (dashboard/mention-settle): settled in the same after(), right behind
   the sync, so the conversation and its task arrive on the same next
   load. Only after a sync that ran — a fresh mirror brought nothing new —
   and only in what is left of the function, which the settle measures
   each read against. It never sends anything to ServiceM8. */

import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { settleMentionAsks } from "@/lib/dashboard/mention-settle";
import { runSm8Sync, sm8SyncIsStale } from "./sm8-sync";
import { SYNC_LEASE_MS, whenSm8LeaseFree } from "./sm8-lease";
import { ENSURE_BUDGET_MS, functionDeadline } from "./sm8-hook-plan";
import { sm8WebhooksState } from "./sm8-hooks-switch";
import { runSm8Writes, sm8WritesDue, sm8WritesEnabled } from "./sm8-writes";
import { backgroundBudgetMs, FUNCTION_MAX_MS, WRITE_LEASE_MARGIN_MS } from "./sm8-write-plan";
import { sm8NotesAllowed } from "./sm8-kinds";
import { NOTE_TEXT_DAYS } from "./sm8-note-plan";
import { clearSm8NoteText, sm8NoteTextDue } from "./sm8-write-cancel";

/** A slice that finds a DRAIN holding the lease asks for it and tries
    again, this many times this far apart — never past the last moment its
    lease still fits the function, and only while the mirror is still stale.
    Any other holder: busy at once, as before. */
const KICK_TRIES = 10;
const KICK_WAIT_MS = 2_000;

/** Register one after() that sends what is due and then syncs a stale
    mirror, for a workspace the caller has already gated. Synchronous: the
    caller never awaits it, and nothing here reads before the response. */
export function freshenSm8AfterResponse(orgId: string): void {
  const calledAt = Date.now();
  after(async () => {
    try {
      /* A note's words leave the queue 30 days after it settles — before
         the connected check, so a workspace needing a reconnect is cleared
         too. Only where the deployment sends notes, and only after a
         one-row read finds something to clear: a page load that finds
         nothing gains no write, and on a files-only deployment no read. */
      if (sm8NotesAllowed() && (await sm8NoteTextDue(orgId, Date.now()))) {
        await clearSm8NoteText({ orgId, olderThanDays: NOTE_TEXT_DAYS }, Date.now());
      }

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

      const syncStartBy = calledAt + FUNCTION_MAX_MS - SYNC_LEASE_MS - WRITE_LEASE_MARGIN_MS;

      /* LIVE UPDATES OWED (two-way phase 4): with SM8_WEBHOOKS on, a
         rotation a connect couldn't finish, or six that aren't all
         subscribed, are reconciled here — at most hourly, in 30 s, and only
         while that still leaves the sync its start. Off, the machinery
         isn't loaded and nothing is read. */
      if (sm8WebhooksState() === "on" && Date.now() + ENSURE_BUDGET_MS <= syncStartBy) {
        const { ensureSm8WebhooksIfOwed } = await import("./sm8-hooks");
        await ensureSm8WebhooksIfOwed(orgId, { budgetMs: ENSURE_BUDGET_MS });
      }

      if (Date.now() > syncStartBy) return;
      if (!(await sm8SyncIsStale(orgId, Date.now()))) return;
      /* the page's function: no route sets a maxDuration, so the platform's
         default (FUNCTION_MAX_MS); the sync extends its lease while a whole
         one still ends inside it */
      const deadline = functionDeadline(calledAt, FUNCTION_MAX_MS / 1000);
      const synced = await whenSm8LeaseFree(() => runSm8Sync(orgId, "kick", Date.now(), { deadline }), {
        tries: KICK_TRIES,
        waitMs: KICK_WAIT_MS,
        startBy: syncStartBy,
        /* only a drain is waited for (it stands aside when asked); another
           sync's lease gives up at once, as the kick always has — and a
           mirror another run freshened meanwhile needs no second sync */
        onlyWhileHook: true,
        stillWanted: () => sm8SyncIsStale(orgId, Date.now()),
      });
      if (!synced.ran) return;

      /* what is left of the function, less the margin its writes keep */
      const budgetMs = calledAt + FUNCTION_MAX_MS - WRITE_LEASE_MARGIN_MS - Date.now();
      if (budgetMs > 0) await settleMentionAsks(orgId, { budgetMs });
    } catch (err) {
      console.error(
        `[sm8] the page-load top-up for org ${orgId} threw: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });
}
