import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { addSupplier } from "@/lib/quotes/price-book-server";

/* A supplier the business buys from that HeyTiff didn't know (POST {name}):
   its price list is any CSV or workbook, read by its headings or by the
   columns a person matches once. `financials`, like the rest of Quoting. */

export async function POST(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("financials"))) {
    return Response.json({ ok: false, reason: "The price book needs money access." }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  if (name.length < 2) return Response.json({ ok: false, reason: "Give the supplier a name." }, { status: 400 });
  const supplier = await addSupplier(orgId, name);
  return Response.json(supplier ? { ok: true, supplier } : { ok: false, reason: `There's already a supplier called ${name}.` });
}
