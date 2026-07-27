import { authorised } from "@/lib/integrations/cron-auth";
import { sweepableOrgs, sweepOrg } from "@/lib/integrations/drift-sweep";

/* The weekly wage-drift sweep.

   WHY IT EXISTS: Xero publishes no payroll webhook, so a pay rise entered over
   there is invisible here until somebody happens to look. This is the looking.

   WHY IT IS SAFE TO RUN AS NOBODY: it never writes a wage and never returns
   one. Its entire output is a count per workspace — "2 differ" — and the
   figures behind that count still require a signed-in `financials` holder to
   press Check pay rates. A leak of this endpoint's response tells an attacker
   how many numbers disagree, and nothing else.

   WHY IT IS STILL LOCKED: it walks every connected workspace through the
   service-role client, so an open version would be a way to make somebody
   else's Xero quota disappear. `CRON_SECRET` is the only gate and it fails
   closed when unset — see lib/integrations/cron-auth.

   COST: one call per organisation on a quiet week (If-Modified-Since answers
   empty), and one-per-linked-employee only when Xero says something moved.
   ORG_CAP bounds a single run so a slow sweep can never queue behind itself
   or spend an afternoon of somebody's rate limit; the oldest-checked
   workspaces go first, so a capped run still makes progress. */

/* SCHEDULE: Monday 06:00 UTC — Monday afternoon in AU, before the week's
   timesheets matter. It lives in vercel.json, which Vercel validates against a
   strict schema that rejects unknown keys (including the "//" comment idiom),
   so the reasoning lives here instead. Weekly, not nightly: a wage change is a
   rare event and this flag is advisory, so six extra "nothing happened" calls a
   week would be quota spent to learn nothing. */

/** Workspaces per run. Comfortably above the Xero starter tier's 5-connection
    ceiling, and low enough that one invocation stays well inside a serverless
    timeout even when several orgs need a full recompute. */
const ORG_CAP = 25;

export async function GET(request: Request) {
  if (!authorised(request.headers.get("authorization"))) {
    // No detail: an unauthorised caller learns nothing about whether the
    // secret is set, only that they don't have it.
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }

  const orgs = await sweepableOrgs(ORG_CAP);

  let unchanged = 0;
  let checked = 0;
  let drifting = 0;
  let skipped = 0;
  let calls = 0;

  for (const org of orgs) {
    /* One workspace's failure must not end the run — a revoked grant or a
       Xero outage for one customer would otherwise stop every customer after
       them from being swept, silently, forever. */
    try {
      const result = await sweepOrg(org.orgId, org.tenantId, org.checkedAt);
      if (result.kind === "unchanged") {
        unchanged += 1;
        calls += result.calls;
      } else if (result.kind === "checked") {
        checked += 1;
        drifting += result.count > 0 ? 1 : 0;
        calls += result.calls;
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }

  /* Counts only — no org ids, no names, no rates. Enough to see the sweep is
     alive in the Vercel logs, and useless to anybody else. */
  return Response.json({
    swept: orgs.length,
    unchanged,
    checked,
    withDrift: drifting,
    skipped,
    xeroCalls: calls,
    // Named so a capped run is visible rather than looking like a full one.
    capped: orgs.length === ORG_CAP,
  });
}
