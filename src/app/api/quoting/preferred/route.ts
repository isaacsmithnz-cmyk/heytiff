import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { readSuppliers } from "@/lib/quotes/price-book-server";
import { setPreferred } from "@/lib/quotes/book-view-server";

/* An item put forward in the price book, or taken back: POST {ref, on,
   others} — "supplier|code" each, `others` the part's codes at the other
   suppliers, which lose the preference. `financials`, like the rest of the
   price book. */

async function gate(): Promise<{ orgId: string; userId: string } | Response> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userId = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userId || !(await can("financials"))) {
    return Response.json({ ok: false, reason: "The price book needs money access." }, { status: 403 });
  }
  return { orgId, userId };
}

/** "supplier|code" from one of the business's suppliers, or null. */
const refIn = (v: unknown, keys: Set<string>): string | null => {
  if (typeof v !== "string") return null;
  const [key, ...rest] = v.split("|");
  const code = rest.join("|").trim();
  return key && keys.has(key) && code && code.length <= 80 ? `${key}|${code}` : null;
};

export async function POST(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  const body = (await req.json().catch(() => ({}))) as { ref?: unknown; on?: unknown; others?: unknown };
  const keys = new Set((await readSuppliers(who.orgId)).map((s) => s.key));
  const ref = refIn(body.ref, keys);
  if (!ref || typeof body.on !== "boolean") return Response.json({ ok: false, reason: "That item isn't in the price book." }, { status: 400 });
  const others = (Array.isArray(body.others) ? body.others : [])
    .slice(0, 50)
    .map((r) => refIn(r, keys))
    .filter((r): r is string => r !== null);
  const ok = await setPreferred(who.orgId, who.userId, ref, body.on, others);
  return ok ? Response.json({ ok: true }) : Response.json({ ok: false, reason: "That couldn't be saved. Try again." }, { status: 500 });
}
