import { supabaseAdmin } from "@/lib/supabase-server";
import { productsFrom, type Product } from "./families";
import { currentItems, matchingItems, readPreferred, readSameDecisions, readSuppliers } from "./price-book-server";
import { sameProductRefs } from "./same-items";

/* THE PRICE BOOK PAGE'S READS, and the one write: an item put forward.

   Every read is the one business's book — its suppliers' items, its
   confirmed same items, its preferred items, its own job lines and
   invoices for how often each is used. Service role; callers gate on
   `financials`, because these are buying prices. */

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

/** The codes a ServiceM8 catalogue item counts for: its own item number,
    and — ServiceM8's catalogue holds a Reece item as "REC" + Reece's code —
    the code after a REC. */
export const codesOfCatalogueItem = (itemNumber: string): string[] => {
  const code = itemNumber.trim();
  if (!code) return [];
  return /^REC./.test(code) ? [code, code.slice(3)] : [code];
};

const IN_CHUNK = 300;

/** How many of the business's job lines were each code: ServiceM8's job
    lines through the catalogue item each one names. Every code, or only
    `codes` — the catalogue items holding them are found first, so a search
    reads only its own lines. Paged by the line's own key, so a page never
    starts or ends inside a run of lines for one item. */
export async function jobLinesByCode(orgId: string, codes?: string[]): Promise<Map<string, number>> {
  /* the catalogue items asked about, by uuid; all of them when no codes */
  let itemOf: Map<string, string> | null = null;
  if (codes) {
    itemOf = new Map();
    const asked = [...new Set(codes.flatMap((c) => [c, `REC${c}`]))];
    for (let i = 0; i < asked.length; i += IN_CHUNK) {
      const { data } = await supabaseAdmin
        .from("sm8_materials")
        .select("uuid, item_number")
        .eq("org_id", orgId)
        .in("item_number", asked.slice(i, i + IN_CHUNK));
      for (const r of (data ?? []) as { uuid: string; item_number: string | null }[]) itemOf.set(r.uuid, r.item_number ?? "");
    }
    if (itemOf.size === 0) return new Map();
  }

  const byMaterial = new Map<string, number>();
  const uuidSets = itemOf ? chunks([...itemOf.keys()], IN_CHUNK) : [null];
  for (const uuids of uuidSets) {
    for (let from = 0; ; from += 1000) {
      let q = supabaseAdmin
        .from("sm8_job_materials")
        .select("material_uuid")
        .eq("org_id", orgId)
        .eq("active", 1)
        .not("material_uuid", "is", null);
      if (uuids) q = q.in("material_uuid", uuids);
      const { data, error } = await q.order("uuid").range(from, from + 999);
      if (error || !data) break;
      for (const r of data as { material_uuid: string }[]) byMaterial.set(r.material_uuid, (byMaterial.get(r.material_uuid) ?? 0) + 1);
      if (data.length < 1000) break;
    }
  }

  /* every catalogue item a line named, when they weren't read above */
  if (!itemOf) {
    itemOf = new Map();
    for (const uuids of chunks([...byMaterial.keys()], IN_CHUNK)) {
      const { data } = await supabaseAdmin.from("sm8_materials").select("uuid, item_number").eq("org_id", orgId).in("uuid", uuids);
      for (const r of (data ?? []) as { uuid: string; item_number: string | null }[]) itemOf.set(r.uuid, r.item_number ?? "");
    }
  }
  const out = new Map<string, number>();
  for (const [uuid, n] of byMaterial) {
    for (const code of codesOfCatalogueItem(itemOf.get(uuid) ?? "")) out.set(code, (out.get(code) ?? 0) + n);
  }
  return out;
}

const chunks = <T,>(xs: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
};

/** the most a search reads before narrowing in memory */
const SEARCH_ROWS = 3000;

/** The business's book as products, preferred and use counted: the whole
    book, or — for a search — only the items holding every word, so a key
    pressed in the search box reads what it can show and no more. */
export async function bookProducts(orgId: string, words: string[] | null = null): Promise<Product[]> {
  const book = words ? null : currentItems(orgId);
  const [suppliers, same, preferred] = await Promise.all([readSuppliers(orgId), readSameDecisions(orgId), readPreferred(orgId)]);
  const items = book ? await book : await matchingItems(orgId, words!, same.confirmed, SEARCH_ROWS);
  const lines = await jobLinesByCode(orgId, words ? [...new Set(items.map((i) => i.code))] : undefined);
  return productsFrom(items, suppliers, same.confirmed, preferred, lines);
}
