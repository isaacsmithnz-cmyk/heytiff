import { supabaseAdmin } from "@/lib/supabase-server";
import { productsFrom, type Product } from "./families";
import { currentItems, readSameDecisions, readSuppliers } from "./price-book-server";

/* THE PRICE BOOK PAGE'S READS, and the one write: an item put forward.

   Every read is the one business's book — its suppliers' items, its
   confirmed same items, its preferred items, its own job lines and
   invoices for how often each is used. Service role; callers gate on
   `financials`, because these are buying prices. */

/** The items the business put forward, "supplier|code" each. */
export async function readPreferred(orgId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin.from("quote_preferred_items").select("supplier_key, code").eq("org_id", orgId);
  return new Set(((data ?? []) as { supplier_key: string; code: string }[]).map((r) => `${r.supplier_key}|${r.code}`));
}

const splitRef = (ref: string) => {
  const at = ref.indexOf("|");
  return { supplier_key: ref.slice(0, at), code: ref.slice(at + 1) };
};

/** Put one supplier's item forward, or take it back. A product has one
    preferred item: putting one forward clears the product's others, which
    the caller names (`others`, every other supplier's code for the part). */
export async function setPreferred(orgId: string, userId: string, ref: string, on: boolean, others: string[]): Promise<boolean> {
  const clear = on ? others.filter((r) => r !== ref) : [ref];
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

/** How many of the business's job lines were each code: ServiceM8's job
    lines through the catalogue item each one names. ServiceM8's catalogue
    holds a Reece item as "REC" + Reece's code. */
export async function jobLinesByCode(orgId: string): Promise<Map<string, number>> {
  const byMaterial = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("sm8_job_materials")
      .select("material_uuid")
      .eq("org_id", orgId)
      .eq("active", 1)
      .not("material_uuid", "is", null)
      .order("material_uuid")
      .range(from, from + 999);
    if (error || !data) break;
    for (const r of data as { material_uuid: string }[]) byMaterial.set(r.material_uuid, (byMaterial.get(r.material_uuid) ?? 0) + 1);
    if (data.length < 1000) break;
  }
  const out = new Map<string, number>();
  const uuids = [...byMaterial.keys()];
  for (let i = 0; i < uuids.length; i += 300) {
    const { data } = await supabaseAdmin
      .from("sm8_materials")
      .select("uuid, item_number")
      .eq("org_id", orgId)
      .in("uuid", uuids.slice(i, i + 300));
    for (const r of (data ?? []) as { uuid: string; item_number: string | null }[]) {
      const code = (r.item_number ?? "").trim();
      if (!code) continue;
      const n = byMaterial.get(r.uuid) ?? 0;
      out.set(code, (out.get(code) ?? 0) + n);
      if (/^REC./.test(code)) out.set(code.slice(3), (out.get(code.slice(3)) ?? 0) + n);
    }
  }
  return out;
}

/** The business's whole book as products, preferred and use counted. */
export async function bookProducts(orgId: string): Promise<Product[]> {
  const [items, suppliers, same, preferred, lines] = await Promise.all([
    currentItems(orgId),
    readSuppliers(orgId),
    readSameDecisions(orgId),
    readPreferred(orgId),
    jobLinesByCode(orgId),
  ]);
  return productsFrom(items, suppliers, same.confirmed, preferred, lines);
}
