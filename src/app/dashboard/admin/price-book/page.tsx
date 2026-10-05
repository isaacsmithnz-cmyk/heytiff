import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { readSuppliers } from "@/lib/quotes/price-book-server";
import { PriceBookScreen } from "@/components/admin/price-book-screen";

/* The price book — the business's own: its suppliers' price lists and
   invoices, sorted into shelves and families, with the items it prefers
   put forward and what it uses most on top. What a quote is priced from.
   Gated by `financials`, like Quoting: these are its buying prices. */

export default async function PriceBookPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!(await can("financials"))) redirect("/dashboard");
  const orgId = session.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  return <PriceBookScreen suppliers={await readSuppliers(orgId)} />;
}
