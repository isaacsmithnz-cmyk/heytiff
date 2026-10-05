import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { decideLinks, pricedLinks } from "@/lib/quotes/links-server";

/* The equipment pack's models and the order codes they're priced by: the
   list (GET), and a person's answers on near matches (POST {decisions:
   [{model, code, decision}]} — a unit's every code, or a whole group at
   once — or one {model, code, decision}). `financials`, like the rest of
   Quoting. */

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

const MAX_ANSWERS = 500;

/** An answer as the page sent it, only when it holds up. */
function answerOf(v: unknown): { model: string; code: string; decision: "confirmed" | "rejected" } | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const model = typeof r.model === "string" ? r.model.trim().slice(0, 80) : "";
  const code = typeof r.code === "string" ? r.code.trim().slice(0, 80) : "";
  const decision = r.decision === "confirmed" || r.decision === "rejected" ? r.decision : null;
  return model && code && decision ? { model, code, decision } : null;
}

export async function POST(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const answers = (Array.isArray(body.decisions) ? body.decisions.slice(0, MAX_ANSWERS) : [body]).map(answerOf).filter((a): a is NonNullable<typeof a> => a !== null);
  if (answers.length === 0) return Response.json({ ok: false, reason: "Nothing to decide." }, { status: 400 });
  const ok = await decideLinks(who.orgId, who.userId, answers);
  return Response.json(ok ? { ok: true } : { ok: false, reason: "That couldn't be saved. Try again." });
}
