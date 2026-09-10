import { supabaseAdmin } from "@/lib/supabase-server";
import {
  LICENCE_DOC_KIND,
  buildLicenceTermRow,
  type LicenceTermInput,
  type LicenceTermRow,
} from "./licence-records";

/* THE WRITES BEHIND A STAFF LICENCE'S TERMS — the I/O half, shared.

   IT LIVES HERE BECAUSE THERE ARE TWO DOORS AND ONE TRUTH. Your own
   Compliance card writes through app/actions/profile.ts; a manager's view of
   your card writes through app/actions/staff.ts. The GATES are different and
   belong at those two boundaries — your own ticket is intrinsic, somebody
   else's needs `team` — but the SQL behind them must not be, or the two would
   drift and one of them would be the one that forgets to advance the cache.

   Every function here takes an already-resolved (orgId, staffId): the caller
   has decided who may do this before anything below runs. Nothing here checks
   a capability, and nothing here reads a session. */

export type WriteResult = { ok: true } | { ok: false; error: string };

const TABLE = "staff_licences";
const TERMS = "staff_licence_records";

/** The licence, if it belongs to that person in that org. Null is "not yours
    to touch" and "gone" at once, which is the same answer to the caller. */
async function licenceIn(
  orgId: string,
  staffId: string,
  licenceId: string,
): Promise<{ id: string; typeName: string; expiry: string | null } | null> {
  const { data } = await supabaseAdmin
    .from(TABLE)
    .select("id, type_name, expiry_date")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffId)
    .eq("id", licenceId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: String(data.id),
    typeName: String(data.type_name ?? ""),
    expiry: (data.expiry_date as string | null) ?? null,
  };
}

/* Adoption, on the codebase's standing contract: only the uploader's own,
   confirmed, still-unowned file of the RIGHT KIND may land. A file that
   refuses adoption must not be claimed by the term either, or the term would
   point at paperwork it does not own.

   `uploaderStaffId` is the person who UPLOADED, which is not always the person
   the licence belongs to: a manager can scan someone's ticket for them. */
async function adoptLicenceDocument(
  orgId: string,
  uploaderStaffId: string | null,
  licenceId: string,
  documentId: string,
  termId: string,
): Promise<void> {
  if (!uploaderStaffId) return;
  const { data } = await supabaseAdmin
    .from("documents")
    .update({ staff_licence_id: licenceId, licence_record_id: termId })
    .eq("org_id", orgId)
    .eq("id", documentId)
    .eq("uploaded_by", uploaderStaffId)
    .eq("kind", LICENCE_DOC_KIND)
    .not("uploaded_at", "is", null)
    .is("staff_licence_id", null)
    .select("id");
  if (!data || data.length === 0) {
    await supabaseAdmin.from(TERMS).update({ document_id: null }).eq("org_id", orgId).eq("id", termId);
  }
}

async function insertTerm(
  orgId: string,
  staffId: string,
  licenceId: string,
  uploaderStaffId: string | null,
  row: LicenceTermRow,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from(TERMS)
    .insert({ org_id: orgId, licence_id: licenceId, staff_profile_id: staffId, ...row })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't record that renewal." };

  const termId = String(data.id);
  if (row.document_id) await adoptLicenceDocument(orgId, uploaderStaffId, licenceId, row.document_id, termId);
  return { ok: true, id: termId };
}

/* RECORDING A RENEWAL never overwrites anything: a term is a new row, and the
   licence's two cached columns follow it only when it is genuinely newer.
   Filing a card you found in a drawer adds to the history without retiring the
   ticket the person actually holds. */
export async function recordTerm(
  orgId: string,
  staffId: string,
  uploaderStaffId: string | null,
  licenceId: string,
  input: LicenceTermInput,
): Promise<WriteResult> {
  const built = buildLicenceTermRow(input);
  if ("error" in built) return { ok: false, error: built.error };

  const licence = await licenceIn(orgId, staffId, licenceId);
  if (!licence) return { ok: false, error: "That licence is no longer on file." };

  const filed = await insertTerm(orgId, staffId, licenceId, uploaderStaffId, built.row);
  if (!filed.ok) return filed;

  if (!licence.expiry || built.row.expires_on > licence.expiry) {
    await supabaseAdmin
      .from(TABLE)
      .update({ expiry_date: built.row.expires_on, licence_number: built.row.number ?? null })
      .eq("org_id", orgId)
      .eq("staff_profile_id", staffId)
      .eq("id", licenceId);
  }
  return { ok: true };
}

/** Adding a licence WITH its first term — the card and the ticket in one save,
    the way scanning a certificate on the way in should work. The licence row
    itself is inserted by the caller (it is the caller's allowlisted shape);
    this files the term against it and seeds the cache. */
export async function seedFirstTerm(
  orgId: string,
  staffId: string,
  uploaderStaffId: string | null,
  licenceId: string,
  row: LicenceTermRow,
): Promise<void> {
  await insertTerm(orgId, staffId, licenceId, uploaderStaffId, row);
}

/* FILING A DOCUMENT AGAINST A TICKET: under a TERM when there is one, and
   against the ticket itself when there is not.

   THE TERM IS OPTIONAL BECAUSE A TICKET NEED NOT HAVE ONE. A term is a period
   and `expires_on` is NOT NULL, so a ticket that never lapses — a white card —
   can hold no term at all, and while this took only a term id that was the one
   kind of ticket whose photo had nowhere to go. `staff_licence_id` is the
   OWNER and `licence_record_id` the FILING; the second has always been allowed
   to be null, and looseTermDocuments already renders exactly those rows.

   Adoption is the codebase's standing contract either way: only the uploader's
   own, confirmed, still-unowned file of the right KIND may land. */
export async function fileLicenceDocument(
  orgId: string,
  staffId: string,
  uploaderStaffId: string | null,
  licenceId: string,
  /** null files it against the ticket itself. */
  termId: string | null,
  documentId: string,
): Promise<WriteResult> {
  if (!uploaderStaffId) return { ok: false, error: "Only a staff member can file documents." };

  const licence = await licenceIn(orgId, staffId, licenceId);
  if (!licence) return { ok: false, error: "That licence is no longer on file." };

  /* A term is checked against THIS licence and not merely against the org: a
     document filed under somebody else's term would sit in a history it does
     not belong to, and the term id comes from a client. */
  if (termId) {
    const { data: term } = await supabaseAdmin
      .from(TERMS)
      .select("id")
      .eq("org_id", orgId)
      .eq("staff_profile_id", staffId)
      .eq("licence_id", licenceId)
      .eq("id", termId)
      .maybeSingle();
    if (!term) return { ok: false, error: "That term is no longer on file." };
  }

  const { data } = await supabaseAdmin
    .from("documents")
    .update({ staff_licence_id: licenceId, licence_record_id: termId })
    .eq("org_id", orgId)
    .eq("id", documentId)
    .eq("uploaded_by", uploaderStaffId)
    .eq("kind", LICENCE_DOC_KIND)
    .not("uploaded_at", "is", null)
    .is("staff_licence_id", null)
    .select("id");
  if (!data || data.length === 0) return { ok: false, error: "That document couldn't be filed." };
  return { ok: true };
}

/* Removing a term. It exists because a scan can be filed against the wrong
   ticket, and a wrong expiry on the wrong ticket is worse than none: it
   silences the warning for the one that is actually lapsing. The cache is
   RECOMPUTED from what is left rather than assumed — deleting the current term
   must hand the licence back to the one underneath it, not leave it pointing
   at a date that no longer exists. */
export async function removeTerm(
  orgId: string,
  staffId: string,
  termId: string,
): Promise<WriteResult> {
  const { data: term } = await supabaseAdmin
    .from(TERMS)
    .select("id, licence_id")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffId)
    .eq("id", termId)
    .maybeSingle();
  if (!term) return { ok: true };
  const licenceId = String(term.licence_id);

  const { error } = await supabaseAdmin
    .from(TERMS)
    .delete()
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffId)
    .eq("id", termId);
  if (error) return { ok: false, error: "Couldn't remove that term." };

  const { data: rest } = await supabaseAdmin
    .from(TERMS)
    .select("expires_on, number")
    .eq("org_id", orgId)
    .eq("licence_id", licenceId)
    .order("expires_on", { ascending: false })
    .limit(1);

  const top = (rest ?? [])[0] as Record<string, unknown> | undefined;
  await supabaseAdmin
    .from(TABLE)
    .update({
      expiry_date: (top?.expires_on as string) ?? null,
      licence_number: (top?.number as string) ?? null,
    })
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffId)
    .eq("id", licenceId);
  return { ok: true };
}

