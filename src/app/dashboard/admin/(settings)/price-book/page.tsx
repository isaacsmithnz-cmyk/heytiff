import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { readPreferred, readSuppliers } from "@/lib/quotes/price-book-server";
import { componentShortlists, readQuoteSettings } from "@/lib/quotes/settings-query";
import { rangeViews } from "@/lib/quotes/ranges-server";
import { readSwaps } from "@/lib/quotes/lines-server";
import { habitsFrom } from "@/lib/quotes/habits";
import { bookFirst } from "@/lib/quotes/book-view-server";
import { PriceBookScreen, type PricedPartsData } from "@/components/admin/price-book-screen";

/* SETTINGS › PRICE BOOK — the business's own: its suppliers' price lists
   and invoices, sorted into shelves and families, with the items it prefers
   put forward and what it uses most on top; what a quote is priced from.
   Its own section (Isaac, 25 October 2026: "The price book will be fairly
   detailed. So it will need its own section"), and what prices each part
   moved here from Quoting. Gated by `financials`, like Quoting: these are
   its buying prices.

   The suppliers and the settings are read before the page is drawn; what
   prices each part (the shortlists, the ranges, the habits) is read over
   the whole book, so it is handed over unawaited and streams into its own
   tab, never holding the Items the page opens on. */

export default async function PriceBookPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!(await can("financials"))) redirect("/dashboard");
  const orgId = session.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const [suppliers, settings] = await Promise.all([readSuppliers(orgId), readQuoteSettings(orgId)]);
  /* the kits are priced in the tab, at the business's example (quoting-kits.tsx) */
  const parts: Promise<PricedPartsData> = Promise.all([
    componentShortlists(orgId, settings, suppliers),
    rangeViews(orgId, suppliers),
    readSwaps(orgId).catch(() => []),
    readPreferred(orgId).catch(() => new Set<string>()),
  ]).then(([components, ranges, swaps, preferred]) => ({ settings, components, ranges, habits: habitsFrom(swaps, preferred) }));

  /* what the Items tab opens on, started now and streamed in behind the
     page: the Most used parts, not the whole book (27 October 2026: the
     whole of it was 2.8 MB here, and Items waited for every byte). The book
     follows from its route, packed, for a shelf or a search. */
  const first = bookFirst(orgId);

  return <PriceBookScreen suppliers={suppliers} markupPct={settings.materialMarkupPct} parts={parts} first={first} />;
}
