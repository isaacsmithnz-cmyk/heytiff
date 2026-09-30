import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { pricedLinks } from "@/lib/quotes/links-server";

/* What a pack model costs at each supplier, for the unit it's picked from
   (the Studio's unit browser): GET ?models=A,B. Buy prices are the
   business's money, so a person without `financials` gets a 403 and the
   browser simply shows no prices. */

export async function GET(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("financials"))) return Response.json({ ok: false }, { status: 403 });
  const asked = new Set(
    (new URL(req.url).searchParams.get("models") ?? "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean)
      .slice(0, 400)
  );
  const links = await pricedLinks(orgId);
  const prices = Object.fromEntries(
    links
      .filter((l) => asked.size === 0 || asked.has(l.model))
      .map((l) => [l.model, { code: l.codes[0] ?? null, offers: l.offers, cheapest: l.cheapest, savesCents: l.savesCents, features: l.features, proposed: l.proposed.length > 0 }])
  );
  return Response.json({ ok: true, prices });
}
