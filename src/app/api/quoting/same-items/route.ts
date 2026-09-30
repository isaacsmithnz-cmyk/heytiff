import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { DEFAULT_SUPPLIERS } from "@/lib/quotes/price-book";
import { decideSame, sameItemProposals } from "@/lib/quotes/same-items-server";

/* One part at two suppliers: Tiff's proposals (GET), and a person's answer
   on one (POST {a, b, decision}, each side "supplier|code"). `financials`,
   like the rest of Quoting. */

async function gate(): Promise<{ orgId: string; userId: string } | Response> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userId = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userId || !(await can("financials"))) {
    return Response.json({ ok: false, reason: "The price book needs money access." }, { status: 403 });
  }
  return { orgId, userId };
}

const SUPPLIER_KEYS = new Set(DEFAULT_SUPPLIERS.map((s) => s.key));

/** "supplier|code" from a known supplier, or null. */
const refIn = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const [key, ...rest] = v.split("|");
  const code = rest.join("|").trim();
  return key && SUPPLIER_KEYS.has(key) && code && code.length <= 80 ? `${key}|${code}` : null;
};

export async function GET() {
  const who = await gate();
  if (who instanceof Response) return who;
  return Response.json({ ok: true, ...(await sameItemProposals(who.orgId)) });
}

export async function POST(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  const body = (await req.json().catch(() => ({}))) as { a?: unknown; b?: unknown; decision?: unknown };
  const a = refIn(body.a);
  const b = refIn(body.b);
  const decision = body.decision === "confirmed" || body.decision === "rejected" ? body.decision : null;
  if (!a || !b || a === b || !decision) return Response.json({ ok: false, reason: "Nothing to decide." }, { status: 400 });
  const ok = await decideSame(who.orgId, who.userId, a, b, decision);
  return Response.json(ok ? { ok: true } : { ok: false, reason: "That couldn't be saved. Try again." });
}
