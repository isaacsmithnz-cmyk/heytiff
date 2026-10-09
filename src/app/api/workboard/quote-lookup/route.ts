import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { lookupBook, lookupUnit } from "@/lib/quotes/lookups-server";

/* What a quote looks things up in (slice 1.1): `?q=flex&size=250` searches
   the business's own book, ranked as it buys; `?brand=…&model=…` reads a
   unit from its maker's data pack. Running the board and money access, as
   the quote's price: every book hit carries what it costs. A ROUTE, so a
   search never queues behind the card's server actions. */

export async function GET(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("workboard_manage")) || !(await can("financials"))) {
    return Response.json({ ok: false, reason: "Looking things up for a quote needs Workboard manage and money access." }, { status: 403 });
  }
  const p = new URL(req.url).searchParams;
  const model = (p.get("model") ?? "").trim().slice(0, 60);
  if (model) {
    const brand = (p.get("brand") ?? "").trim().slice(0, 60);
    if (!brand) return Response.json({ ok: false, reason: "A unit needs its brand." }, { status: 400 });
    return Response.json({ ok: true, unit: await lookupUnit(brand, model) });
  }
  const text = (p.get("q") ?? "").slice(0, 120);
  const size = Number(p.get("size"));
  const hits = await lookupBook(orgId, {
    text,
    sizeMm: Number.isFinite(size) && size > 0 && size < 2000 ? size : null,
    brand: (p.get("brand") ?? "").trim().slice(0, 60) || null,
    loose: true,
  });
  return Response.json({ ok: true, hits });
}
