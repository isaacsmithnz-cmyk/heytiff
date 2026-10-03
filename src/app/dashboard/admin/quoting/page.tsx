import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { componentShortlists, readQuoteSettings } from "@/lib/quotes/settings-query";
import { readSuppliers } from "@/lib/quotes/price-book-server";
import { readCalcDay } from "@/lib/quotes/org-day-server";
import { QuotingScreen } from "@/components/admin/quoting-screen";

/* Quoting — the settings a quote is priced by: the charge-out rate and the
   working day (else the Rate Calculator's), markup on units and on
   materials, and which price-book item prices each common
   component. Gated by `financials`, the Rate Calculator's grant, because
   this is the business's buying price and margin. */

export default async function QuotingPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!(await can("financials"))) redirect("/dashboard");
  const orgId = session.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const [settings, suppliers, calc] = await Promise.all([readQuoteSettings(orgId), readSuppliers(orgId), readCalcDay(orgId)]);
  const components = await componentShortlists(orgId, settings, suppliers);
  return <QuotingScreen initial={settings} components={components} suppliers={suppliers} calc={calc} />;
}
