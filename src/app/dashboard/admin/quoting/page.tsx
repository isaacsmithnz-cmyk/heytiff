import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { componentShortlists, readQuoteSettings } from "@/lib/quotes/settings-query";
import { readSuppliers } from "@/lib/quotes/price-book-server";
import { readCalcDay } from "@/lib/quotes/org-day-server";
import { rangeViews } from "@/lib/quotes/ranges-server";
import { QuotingScreen } from "@/components/admin/quoting-screen";
import { bookProducts } from "@/lib/quotes/book-view-server";
import { kitPriceList } from "@/lib/quotes/kits";
import { readRangeOffers } from "@/lib/quotes/kits-server";
import { habitsFrom } from "@/lib/quotes/habits";
import { readSwaps } from "@/lib/quotes/lines-server";
import { readPreferred } from "@/lib/quotes/price-book-server";

/* Quoting — the settings a quote is priced by: the charge-out rate and the
   working day (else the Rate Calculator's), markup on units and on
   materials, which price-book item prices each common component, and the
   business's ranges of the parts that come in sizes. Gated by `financials`, the Rate Calculator's grant, because
   this is the business's buying price and margin. */

export default async function QuotingPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!(await can("financials"))) redirect("/dashboard");
  const orgId = session.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const [settings, suppliers, calc] = await Promise.all([readQuoteSettings(orgId), readSuppliers(orgId), readCalcDay(orgId)]);
  const [components, ranges, products, swaps, preferred, rangeOffers] = await Promise.all([
    componentShortlists(orgId, settings, suppliers),
    rangeViews(orgId, suppliers),
    bookProducts(orgId).catch(() => []),
    readSwaps(orgId).catch(() => []),
    readPreferred(orgId).catch(() => new Set<string>()),
    readRangeOffers(orgId).catch(() => new Map()),
  ]);
  return (
    <QuotingScreen
      initial={settings}
      components={components}
      ranges={ranges}
      calc={calc}
      kits={kitPriceList(products, { ranges: rangeOffers, components: settings.preferred })}
      habits={habitsFrom(swaps, preferred)}
    />
  );
}
