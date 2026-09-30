import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { decideLink, pricedLinks } from "@/lib/quotes/links-server";

/* The equipment pack's models and the order codes they're priced by: the
   list (GET), and a person's answer on a near match (POST {model, code,
   decision}). `financials`, like the rest of Quoting. */

async function gate(): Promise<{ orgId: string; userId: string } | Response> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userId = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userId || !(await can("financials"))) {
    return Response.json({ ok: false, reason: "The price book needs money access." }, { status: 403 });
  }
  return { orgId, userId };
}

export async function GET() {
  const who = await gate();
  if (who instanceof Response) return who;
  return Response.json({ ok: true, links: await pricedLinks(who.orgId) });
}

export async function POST(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  const body = (await req.json().catch(() => ({}))) as { model?: unknown; code?: unknown; decision?: unknown };
  const model = typeof body.model === "string" ? body.model.trim().slice(0, 80) : "";
  const code = typeof body.code === "string" ? body.code.trim().slice(0, 80) : "";
  const decision = body.decision === "confirmed" || body.decision === "rejected" ? body.decision : null;
  if (!model || !code || !decision) return Response.json({ ok: false, reason: "Nothing to decide." }, { status: 400 });
  const ok = await decideLink(who.orgId, who.userId, model, code, decision);
  return Response.json(ok ? { ok: true } : { ok: false, reason: "That couldn't be saved. Try again." });
}
