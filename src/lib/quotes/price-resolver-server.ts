import { readSameDecisions, currentItems, readSuppliers } from "./price-book-server";
import { makePriceOf } from "./price-resolver";
import { readPreferred } from "./book-view-server";
import type { PriceOf } from "./ducted-template";

/* The resolver on the live price book: loaded once per quote build, then
   every line the template asks for is answered from memory. Service role;
   callers gate on `financials`. */
export async function loadPriceOf(orgId: string, chosenSupplier?: Map<string, string>): Promise<PriceOf> {
  const [items, suppliers, same, preferred] = await Promise.all([currentItems(orgId), readSuppliers(orgId), readSameDecisions(orgId), readPreferred(orgId)]);
  return makePriceOf({ items, suppliers, confirmed: same.confirmed, chosenSupplier, preferred });
}
