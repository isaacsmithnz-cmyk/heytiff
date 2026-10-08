import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { readSuppliers } from "@/lib/quotes/price-book-server";
import { setPreferred } from "@/lib/quotes/book-view-server";
import { preferRange } from "@/lib/quotes/ranges-server";

/* An item put forward in the price book, or taken back: POST {ref, on},
   ref "supplier|code". The part's other codes lose the preference — the
   server works out which they are. Put forward, an item that comes in
   sizes fills its range at every size its line comes in (slice 1.2, one
   preferred store); `was` is the name of the line it replaced, when a
   quote's line was swapped for it. `financials`, like the rest of the
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
  const body = (await req.json().catch(() => ({}))) as { ref?: unknown; on?: unknown; was?: unknown };
  const keys = new Set((await readSuppliers(who.orgId)).map((s) => s.key));
  const ref = refIn(body.ref, keys);
  if (!ref || typeof body.on !== "boolean") return Response.json({ ok: false, reason: "That item isn't in the price book." }, { status: 400 });
  const ok = await setPreferred(who.orgId, who.userId, ref, body.on);
  if (!ok) return Response.json({ ok: false, reason: "That couldn't be saved. Try again." }, { status: 500 });
  const [key, ...code] = ref.split("|");
  const range = body.on ? await preferRange(who.orgId, who.userId, key!, code.join("|"), typeof body.was === "string" ? body.was.slice(0, 200) : "").catch(() => null) : null;
  return Response.json({ ok: true, range });
}
