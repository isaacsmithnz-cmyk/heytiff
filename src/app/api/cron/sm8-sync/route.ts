import { authorised } from "@/lib/integrations/cron-auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { runSm8Sync } from "@/lib/integrations/sm8-sync";

/* The hourly ServiceM8 mirror top-up — the BACKSTOP, not the primary path.

   Freshness normally comes from the page-load kick: opening the Workboard or
   the ServiceM8 screen schedules a sync slice via after() when the mirrors
   are stale. This cron exists for the hours nobody is looking — overnight
   visits ticking into "overdue", and a rotating refresh token that would
   otherwise sit unexercised — so an unopened board still tells the truth at
   7am.

   WHY IT IS SAFE TO RUN AS NOBODY: it moves ServiceM8's data into that same
   org's own mirror rows and returns counts. No org ids, no client names, no
   job numbers leave it.

   WHY IT IS STILL LOCKED: it walks every connected workspace through the
   service-role client, so an open version would be a way to spend somebody
   else's ServiceM8 rate limit. CRON_SECRET is the only gate and it fails
   closed when unset — see lib/integrations/cron-auth.

   COST: a quiet hour is ~10 calls per org (one page per object answering
   "nothing changed"); the engine's own budgets (PAGE_BUDGET per run,
   DAILY_CALL_BUDGET per org per day) bound the loud ones. The engine's lease
   makes an overlap with a user-triggered sync a no-op, not a double-spend. */

/* SCHEDULE: daily at 20:00 UTC ("0 20 * * *") — 6am on the east-coast AU
   clock, so the board is true before anyone starts. It lives in vercel.json,
   which Vercel validates against a strict schema that rejects unknown keys
   (including the "//" comment idiom), so the reasoning lives here instead.

   DAILY BECAUSE THE PLAN SAYS SO, LITERALLY: Vercel's Hobby tier refuses any
   cron that would run more than once a day — "0 * * * *" fails the DEPLOYMENT
   outright, which is how this was found. That costs this route nothing,
   because it was never the freshness path: opening the Workboard tops the
   mirrors up behind the response (kickSm8SyncIfStale), and this run exists
   for the hours nobody is looking. Hobby also only promises the hour, not the
   minute (±59 min), which a backstop can afford. On Pro, one line here and
   one in vercel.json make it hourly again. */

/** Workspaces per run. Each org's slice is bounded by the engine's page
    budget, so the cap is about staying inside one serverless window even if
    every org has a loud hour. */
const ORG_CAP = 10;

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!authorised(request.headers.get("authorization"))) {
    // No detail: an unauthorised caller learns nothing about whether the
    // secret is set, only that they don't have it.
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }

  /* Connected orgs only — needs_reauth rows are skipped here because the
     engine would refuse them anyway, and each refusal costs a lease dance. */
  const { data } = await supabaseAdmin
    .from("integration_connections")
    .select("org_id")
    .eq("provider", "servicem8")
    .eq("status", "connected")
    .limit(ORG_CAP);

  const orgs = ((data ?? []) as { org_id: string }[]).map((r) => r.org_id);

  let ran = 0;
  let busy = 0;
  let completed = 0;
  let pages = 0;
  let rows = 0;
  let failed = 0;

  for (const orgId of orgs) {
    /* One workspace's failure must not end the run — one revoked grant would
       otherwise stop every customer after it from syncing, silently. */
    try {
      const outcome = await runSm8Sync(orgId, "cron");
      if (outcome.ran) {
        ran += 1;
        pages += outcome.pagesUsed;
        rows += outcome.rowsPulled;
        if (outcome.complete) completed += 1;
      } else {
        busy += 1;
      }
    } catch {
      failed += 1;
    }
  }

  /* Counts only — enough to see the top-up is alive in the Vercel logs, and
     useless to anybody else. */
  return Response.json({
    orgs: orgs.length,
    ran,
    completed,
    busy,
    failed,
    pages,
    rows,
    capped: orgs.length === ORG_CAP,
  });
}
