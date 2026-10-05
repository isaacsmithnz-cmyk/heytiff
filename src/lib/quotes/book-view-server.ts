import { supabaseAdmin } from "@/lib/supabase-server";
import { productsFrom, type Product } from "./families";
import { currentItems, readPreferred, readSameDecisions, readSuppliers } from "./price-book-server";
import { sameProductRefs } from "./same-items";

/* THE PRICE BOOK PAGE'S READS, and its writes: an item put forward, and
   the items a quote pulled in.

   Every read is the one business's book — its suppliers' items, its
   confirmed same items, its preferred items, and its quotes for how often
   each is used. Service role; callers gate on `financials`, because these
   are buying prices. */

const splitRef = (ref: string) => {
  const at = ref.indexOf("|");
  return { supplier_key: ref.slice(0, at), code: ref.slice(at + 1) };
};

/** Put one supplier's item forward, or take it back. A product has one
    preferred item: putting one forward takes the preference off every other
    code the part has — worked out here from the book and the confirmed
    same items, never from what the page sent, so a stale page can't leave
    one part preferred twice. */
export async function setPreferred(orgId: string, userId: string, ref: string, on: boolean): Promise<boolean> {
  let clear = [ref];
  if (on) {
    const [items, same, put] = await Promise.all([currentItems(orgId), readSameDecisions(orgId), readPreferred(orgId)]);
    const part = new Set(sameProductRefs(items, same.confirmed, ref));
    clear = [...put].filter((r) => r !== ref && part.has(r));
  }
  for (const r of clear) {
    const { error } = await supabaseAdmin.from("quote_preferred_items").delete().eq("org_id", orgId).match(splitRef(r));
    if (error) return false;
  }
  if (!on) return true;
  const { error } = await supabaseAdmin
    .from("quote_preferred_items")
    .upsert({ org_id: orgId, ...splitRef(ref), chosen_by: userId, chosen_at: new Date().toISOString() }, { onConflict: "org_id,supplier_key,code" });
  return !error;
}

/** How many of the business's quotes each code has been on — ServiceM8's
    quoted jobs and HeyTiff's own quotes, counted in the database
    (quote_item_uses.sql) in one call. */
export async function quotesByCode(orgId: string): Promise<Map<string, number>> {
  const { data, error } = await supabaseAdmin.rpc("quote_item_counts", { p_org: orgId });
  if (error || !Array.isArray(data)) return new Map();
  return new Map((data as { code: string; quotes: number | string }[]).map((r) => [r.code, Number(r.quotes) || 0]));
}

/** What a quote holds now: the price-book items its options were priced
    from, replacing what it held the last time it was priced. A quote is its
    ServiceM8 job. Never throws: counting is not worth failing a price for. */
export async function recordQuoteItems(orgId: string, jobUuid: string, lines: { supplierKey: string | null; code: string | null }[]): Promise<void> {
  try {
    const refs = new Map<string, { supplier_key: string; code: string }>();
    for (const l of lines) if (l.supplierKey && l.code) refs.set(`${l.supplierKey}|${l.code}`, { supplier_key: l.supplierKey, code: l.code });
    const { error } = await supabaseAdmin.from("quote_item_uses").delete().eq("org_id", orgId).eq("sm8_job_uuid", jobUuid);
    if (error || refs.size === 0) return;
    const now = new Date().toISOString();
    await supabaseAdmin
      .from("quote_item_uses")
      .insert([...refs.values()].map((r) => ({ org_id: orgId, sm8_job_uuid: jobUuid, ...r, used_at: now })));
  } catch {
    /* the quote is priced either way */
  }
}

/** The business's whole book as products, preferred and quote counted. The
    page sorts and searches it in the browser, so it's read once a visit. */
export async function bookProducts(orgId: string): Promise<Product[]> {
  const [items, suppliers, same, preferred, quotes] = await Promise.all([
    currentItems(orgId),
    readSuppliers(orgId),
    readSameDecisions(orgId),
    readPreferred(orgId),
    quotesByCode(orgId),
  ]);
  return productsFrom(items, suppliers, same.confirmed, preferred, quotes);
}
