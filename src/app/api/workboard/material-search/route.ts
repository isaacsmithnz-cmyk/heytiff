import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { findOffers, readSuppliers } from "@/lib/quotes/price-book-server";

/* Materials from the price book, for the job card's checklist (Isaac,
   2026-10-03). The business's OWN price book: whatever it has loaded, and
   nothing of anyone else's. Whoever may write on a job's checklist may find
   an item; its price is money, so it comes only with `financials`, the
   price book's own grant. */

export type MaterialHit = { code: string; name: string; supplier: string; priceCents: number | null };

const MAX_HITS = 6;

export async function GET(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("workboard"))) {
    return Response.json({ ok: false, reason: "The checklist needs Workboard access." }, { status: 403 });
  }
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return Response.json({ ok: true, hits: [] });
  const [suppliers, money] = await Promise.all([readSuppliers(orgId), can("financials")]);
  const found = await findOffers(orgId, q, suppliers);
  const hits: MaterialHit[] = found.slice(0, MAX_HITS).map((m) => {
    const o = m.cheapest ?? m.offers[0] ?? null;
    return {
      code: o?.code ?? m.code,
      name: o?.name ?? m.name,
      supplier: o?.supplierName ?? "",
      priceCents: money && o ? o.netCents : null,
    };
  });
  return Response.json({ ok: true, hits });
}
