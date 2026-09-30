import { supabaseAdmin } from "@/lib/supabase-server";
import { netCents } from "./price-book";
import { currentItems, readSameDecisions, readSuppliers, type BookItem } from "./price-book-server";
import { proposeSameItems, refOf, type SameDecision, type SameProposal } from "./same-items";

export { readSameDecisions, type SameDecisions } from "./price-book-server";

/* One part at two suppliers, on the database: the pairs a person has
   decided, their answer on a new one, and Tiff's proposals with each side's
   price. Service role; callers gate on `financials`. */

export async function decideSame(orgId: string, userId: string, aRef: string, bRef: string, decision: SameDecision) {
  const [a, b] = aRef < bRef ? [aRef, bRef] : [bRef, aRef];
  const { error } = await supabaseAdmin
    .from("quote_same_items")
    .upsert(
      { org_id: orgId, a_ref: a, b_ref: b, decision, decided_by: userId, decided_at: new Date().toISOString() },
      { onConflict: "org_id,a_ref,b_ref" }
    );
  return !error;
}

export type PricedSide = SameProposal["a"] & { supplierName: string; netCents: number; uom: string | null };
export type PricedProposal = Omit<SameProposal, "a" | "b"> & { a: PricedSide; b: PricedSide };

export type SameItemsView = { proposals: PricedProposal[]; confirmed: number };

/** Tiff's proposals, each side with what the business pays for it. */
export async function sameItemProposals(orgId: string): Promise<SameItemsView> {
  const [items, suppliers, decisions] = await Promise.all([currentItems(orgId), readSuppliers(orgId), readSameDecisions(orgId)]);
  const sup = new Map(suppliers.map((s) => [s.key, s]));
  const byRef = new Map<string, BookItem>(items.map((i) => [refOf(i), i]));
  const side = (x: SameProposal["a"]): PricedSide => {
    const s = sup.get(x.supplierKey);
    const i = byRef.get(refOf(x));
    return {
      ...x,
      supplierName: s?.name ?? x.supplierKey,
      netCents: s && i ? netCents(s, i.code, i.cents) : 0,
      uom: i?.uom ?? null,
    };
  };
  return {
    proposals: proposeSameItems(items, decisions.decided).map((p) => ({ ...p, a: side(p.a), b: side(p.b) })),
    confirmed: decisions.confirmed.length,
  };
}
