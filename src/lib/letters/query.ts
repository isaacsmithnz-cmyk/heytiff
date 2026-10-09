import { supabaseAdmin } from "@/lib/supabase-server";
import { orgBrand } from "@/lib/org/query";
import { loadBusinessPapers } from "@/lib/certs/query";
import { addressLinesOf, type LetterheadFacts, type LetterSigner } from "./letterhead";
import { bodyText, normaliseBody } from "./body";
import { titleOf, type Letter } from "./letter";
import { orgTemplates } from "@/lib/templates/query";
import { staffDisplayNames } from "@/lib/workboard/job-notes-query";

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

/* ── letters ───────────────────────────────────────────────────────────── */

type LetterRow = {
  id: string;
  title: string;
  letter_date: string | null;
  recipient: string;
  subject: string;
  body: unknown;
  signer_staff_id: string | null;
  with_signature: boolean;
  created_by_staff_id: string | null;
  updated_at: string;
};
const LETTER_COLUMNS = "id, title, letter_date, recipient, subject, body, signer_staff_id, with_signature, created_by_staff_id, updated_at";

function letterOf(r: LetterRow): Letter {
  return {
    id: r.id,
    title: r.title ?? "",
    date: r.letter_date ?? "",
    recipient: r.recipient ?? "",
    subject: r.subject ?? "",
    body: normaliseBody(r.body),
    signerStaffId: r.signer_staff_id,
    withSignature: !!r.with_signature,
    createdById: r.created_by_staff_id,
    updatedAt: r.updated_at,
  };
}

/** Who is looking: their staff card, and whether they own the business. */
export type LetterViewer = { staffId: string | null; isOwner: boolean };

/* WHO SEES A LETTER: whoever wrote it, whoever signs it, and the owner. A
   letter about someone's employment holds their personal details. */
export function mayOpenLetter(l: Pick<Letter, "createdById" | "signerStaffId">, v: LetterViewer): boolean {
  if (v.isOwner) return true;
  return !!v.staffId && (l.createdById === v.staffId || l.signerStaffId === v.staffId);
}

/** One letter, or null when it isn't this workspace's. */
export async function loadLetter(orgId: string, id: string): Promise<Letter | null> {
  const { data } = await supabaseAdmin.from("letters").select(LETTER_COLUMNS).eq("org_id", orgId).eq("id", id).maybeSingle();
  return data ? letterOf(data as LetterRow) : null;
}

export type LetterSummary = {
  id: string;
  title: string;
  /** The body's first words. */
  preview: string;
  date: string;
  signer: string | null;
  writer: string | null;
  updatedAt: string;
};

/** The letters this viewer may open, last changed first. */
export async function listLetters(orgId: string, v: LetterViewer): Promise<LetterSummary[]> {
  const { data } = await supabaseAdmin
    .from("letters")
    .select(LETTER_COLUMNS)
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(300);
  const letters = ((data ?? []) as LetterRow[]).map(letterOf).filter((l) => mayOpenLetter(l, v));
  const ids = [...new Set(letters.flatMap((l) => [l.signerStaffId, l.createdById]).filter((x): x is string => !!x))];
  const names = await staffDisplayNames(orgId, ids);
  return letters.map((l) => ({
    id: l.id,
    title: titleOf(l),
    preview: bodyText(l.body),
    date: l.date,
    signer: l.signerStaffId ? names.get(l.signerStaffId) ?? null : null,
    writer: l.createdById ? names.get(l.createdById) ?? null : null,
    updatedAt: l.updatedAt,
  }));
}

/** Someone who can sign a letter: every current staff card. */
export type SignerChoice = { staffId: string; name: string; title: string | null; hasSignature: boolean };

export async function letterSigners(orgId: string): Promise<SignerChoice[]> {
  const [cards, sigs] = await Promise.all([
    supabaseAdmin
      .from("staff_profiles")
      .select("id, full_name, preferred_name, first_name, last_name, job_title, status")
      .eq("org_id", orgId),
    supabaseAdmin.from("staff_signatures").select("staff_profile_id").eq("org_id", orgId),
  ]);
  const signed = new Set(((sigs.data ?? []) as { staff_profile_id: string }[]).map((s) => s.staff_profile_id));
  return (
    (cards.data ?? []) as {
      id: string;
      full_name: string | null;
      preferred_name: string | null;
      first_name: string | null;
      last_name: string | null;
      job_title: string | null;
      status: string | null;
    }[]
  )
    .filter((c) => (c.status ?? "Active").toLowerCase() === "active")
    .map((c) => ({
      staffId: c.id,
      name:
        c.full_name?.trim() || [c.first_name, c.last_name].map((p) => p?.trim()).filter(Boolean).join(" ") || c.preferred_name?.trim() || "Unnamed",
      title: c.job_title?.trim() || null,
      hasSignature: signed.has(c.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Everything the paper is drawn from, for one letter: the letterhead and
    its facts, the letter, and its signer (with the signature only when the
    signer put it on). */
export async function letterPaperProps(orgId: string, id: string, opts: { seconds?: number } = {}) {
  const letter = await loadLetter(orgId, id);
  if (!letter) return null;
  const [facts, templates, signer] = await Promise.all([
    letterheadFacts(orgId, opts),
    orgTemplates(orgId),
    letter.signerStaffId ? letterSigner(orgId, letter.signerStaffId) : Promise.resolve(null),
  ]);
  return {
    letter,
    facts,
    letterhead: templates.letterhead,
    signer: signer ? { ...signer, signatureSvg: letter.withSignature ? signer.signatureSvg : null } : null,
  };
}
