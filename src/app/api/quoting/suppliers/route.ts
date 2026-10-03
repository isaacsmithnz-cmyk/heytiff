import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { addSupplier, readSuppliers, saveSupplierDiscount } from "@/lib/quotes/price-book-server";

/* A supplier the business buys from that HeyTiff didn't know (POST {name}):
   its price list is any CSV or workbook, read by its headings or by the
   columns a person matches once. And a list-price supplier's discount, the
   business's own (PATCH {key, discountPct, rules}). `financials`, like the
   rest of Quoting. */

async function gate(): Promise<string | Response> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("financials"))) {
    return Response.json({ ok: false, reason: "The price book needs money access." }, { status: 403 });
  }
  return orgId;
}

export async function POST(req: Request) {
  const orgId = await gate();
  if (orgId instanceof Response) return orgId;
  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  if (name.length < 2) return Response.json({ ok: false, reason: "Give the supplier a name." }, { status: 400 });
  const supplier = await addSupplier(orgId, name);
  return Response.json(supplier ? { ok: true, supplier } : { ok: false, reason: `There's already a supplier called ${name}.` });
}

export async function PATCH(req: Request) {
  const orgId = await gate();
  if (orgId instanceof Response) return orgId;
  const body = (await req.json().catch(() => ({}))) as { key?: unknown; discountPct?: unknown; rules?: unknown };
  const supplier = (await readSuppliers(orgId)).find((s) => s.key === body.key);
  if (!supplier || supplier.pricing !== "list_less") {
    return Response.json({ ok: false, reason: "That supplier doesn't price from a list." }, { status: 400 });
  }
  const rules = Array.isArray(body.rules)
    ? body.rules
        .map((r) => r as { prefix?: unknown; discountPct?: unknown })
        .filter((r) => typeof r.prefix === "string")
        .map((r) => ({ prefix: String(r.prefix), discountPct: Number(r.discountPct) || 0 }))
    : [];
  const ok = await saveSupplierDiscount(orgId, supplier, Number(body.discountPct) || 0, rules);
  return Response.json(ok ? { ok: true } : { ok: false, reason: "The discount couldn't be saved. Try again." });
}
