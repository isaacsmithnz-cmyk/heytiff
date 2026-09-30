import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { chooseUnitSupplier, pricedLinks, readUnitChoices } from "@/lib/quotes/links-server";

/* What a pack model costs at each supplier, for the unit it's picked from
   (the Studio's unit browser): GET ?models=A,B. A unit is bought from its
   lowest supplier unless a person overrides it (POST {model, supplierKey};
   supplierKey null goes back to the lowest). Buy prices are the business's
   money, so a person without `financials` gets a 403 and the browser simply
   shows no prices. */

async function gate(): Promise<{ orgId: string; userId: string } | Response> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userId = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userId || !(await can("financials"))) return Response.json({ ok: false }, { status: 403 });
  return { orgId, userId };
}

export async function GET(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  const asked = new Set(
    (new URL(req.url).searchParams.get("models") ?? "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean)
      .slice(0, 400)
  );
  const [links, choices] = await Promise.all([pricedLinks(who.orgId), readUnitChoices(who.orgId)]);
  const prices = Object.fromEntries(
    links
      .filter((l) => asked.size === 0 || asked.has(l.model))
      .map((l) => {
        const override = choices.get(l.model);
        const picked = override ? l.offers.find((o) => o.supplierKey === override) : undefined;
        return [
          l.model,
          {
            code: l.codes[0] ?? null,
            offers: l.offers,
            cheapest: l.cheapest,
            savesCents: l.savesCents,
            chosen: picked ?? l.cheapest,
            overridden: Boolean(picked),
            features: l.features,
            proposed: l.proposed.length > 0 && l.offers.length === 0,
          },
        ];
      })
  );
  return Response.json({ ok: true, prices });
}

export async function POST(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  const body = (await req.json().catch(() => ({}))) as { model?: unknown; supplierKey?: unknown };
  const model = typeof body.model === "string" ? body.model.trim().slice(0, 80) : "";
  const supplierKey = typeof body.supplierKey === "string" ? body.supplierKey.slice(0, 40) : null;
  if (!model) return Response.json({ ok: false }, { status: 400 });
  return Response.json({ ok: await chooseUnitSupplier(who.orgId, who.userId, model, supplierKey) });
}
