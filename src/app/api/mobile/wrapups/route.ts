import { ok, requireMobile } from "@/lib/mobile/auth";
import { readOps } from "@/lib/mobile/wrapups";
import { applyWrapOps, readOwedDays } from "@/lib/mobile/wrapups-store";

/* YOUR DAYS TO WRAP UP, KEPT IN HEYTIFF (lib/mobile/wrapups; Isaac,
   9 November 2026: "Build it", after a reinstall lost Friday's from the
   phone). Your own days need no grant beyond being a member, as your day
   doesn't.

   GET: every day you still owe, oldest first. POST { ops }: the phone's
   changes, in order (owe, noted, wrapped, settle), then the same list. */

const no = (error: string, status = 400) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  try {
    return ok({ owed: await readOwedDays(ctx.orgId, ctx.userId) });
  } catch (e) {
    return no(e instanceof Error ? e.message : "Couldn't read the days to wrap up.", 500);
  }
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const ops = readOps(await request.json().catch(() => null));
  if (!ops) return no("Those aren't days to wrap up.");
  try {
    return ok({ owed: await applyWrapOps(ctx.orgId, ctx.userId, ops) });
  } catch (e) {
    return no(e instanceof Error ? e.message : "Couldn't keep the days to wrap up.", 500);
  }
}
