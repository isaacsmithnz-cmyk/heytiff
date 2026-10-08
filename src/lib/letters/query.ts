import { supabaseAdmin } from "@/lib/supabase-server";
import { orgBrand } from "@/lib/org/query";
import { loadBusinessPapers } from "@/lib/certs/query";
import { addressLinesOf, type LetterheadFacts, type LetterSigner } from "./letterhead";

/* THE LETTERHEAD'S FACTS, as the business has them today: its brand (the
   logo signed for the page), its legal name, ACN and address, and the
   licences it holds. Scoped by org_id. */
export async function letterheadFacts(orgId: string, opts: { seconds?: number } = {}): Promise<LetterheadFacts> {
  const [brand, papers, org] = await Promise.all([
    orgBrand(orgId, opts),
    loadBusinessPapers(orgId),
    supabaseAdmin.from("organizations").select("legal_name, acn, address, suburb, state, postcode").eq("id", orgId).maybeSingle(),
  ]);
  const o = (org.data ?? {}) as {
    legal_name?: string | null;
    acn?: string | null;
    address?: string | null;
    suburb?: string | null;
    state?: string | null;
    postcode?: string | null;
  };
  return {
    brand,
    legalName: o.legal_name?.trim() || null,
    acn: o.acn?.trim() || null,
    address: addressLinesOf(o),
    licences: papers.licences,
  };
}

/** Who signs a letter: their name, job title and drawn signature, from
    their staff card. Null for a staff card this workspace doesn't hold. */
export async function letterSigner(orgId: string, staffId: string): Promise<LetterSigner | null> {
  const [card, sig] = await Promise.all([
    supabaseAdmin
      .from("staff_profiles")
      .select("full_name, preferred_name, first_name, last_name, job_title")
      .eq("org_id", orgId)
      .eq("id", staffId)
      .maybeSingle(),
    supabaseAdmin.from("staff_signatures").select("signature_svg").eq("org_id", orgId).eq("staff_profile_id", staffId).maybeSingle(),
  ]);
  const c = card.data as {
    full_name: string | null;
    preferred_name: string | null;
    first_name: string | null;
    last_name: string | null;
    job_title: string | null;
  } | null;
  if (!c) return null;
  /* a letter is signed with the full name, not the one they go by */
  const name = c.full_name?.trim() || [c.first_name, c.last_name].map((p) => p?.trim()).filter(Boolean).join(" ") || c.preferred_name?.trim() || "Unnamed";
  return {
    name,
    title: c.job_title?.trim() || null,
    signatureSvg: (sig.data as { signature_svg?: string } | null)?.signature_svg ?? null,
  };
}
