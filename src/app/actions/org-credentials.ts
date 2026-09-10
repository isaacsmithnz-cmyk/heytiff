"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { refIsOrgs } from "@/lib/documents/files";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { buildOrgCredentialRow, isCredKind, type OrgCredKind, type OrgCredentialInput } from "@/lib/org/credentials";
import {
  CREDENTIAL_DOC_KIND,
  ORG_CREDENTIAL_DOC_KINDS,
  buildCredentialRecordRow,
  splitAddScan,
  type CredentialRecordInput,
  type CredentialRecordRow,
} from "@/lib/org/credential-records";

/* The business's own licences and insurance policies.

   Owner-only, exactly like saveOrgSection — these are the company's papers, not
   a staff record, and a delegated admin has no business editing what the
   business is licensed to do. A Server Function is reachable by direct POST, so
   the role is re-checked here on every call and every write carries `.eq(
   "org_id", orgId)` — an id from the client can only ever address a row in the
   caller's own org.

   UPDATE exists here, unlike staff licences, because these cards are EDITED:
   a policy renews and the expiry moves, where a staff ticket is replaced. */

export type CredResult = { ok: true } | { ok: false; error: string };

const NOT_OWNER = "Only an owner can change organisation settings.";
const TABLE = "org_credentials";
const RECORDS = "org_credential_records";

type Ctx = { orgId: string; userId: string; staffId: string | null };

/* The staff id is what a document adoption and a reminder are hung off — a
   document belongs to whoever uploaded it, and a reminder is a task assigned
   to a person. An owner with no staff card can still edit the company's
   papers; they simply cannot file one or set a reminder, and the two actions
   that need it say so rather than writing a row nobody owns. */
async function ownerOrgId(): Promise<Ctx | { error: string }> {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");
  const orgId = session.orgId as string | undefined;
  const userId = session.user?.sub as string | undefined;
  if (!orgId || !userId) throw new Error("No active organization");
  if (!hasMinRole(await getDbRole(), "owner")) return { error: NOT_OWNER };
  return { orgId, userId, staffId: await staffProfileIdFor(orgId, userId) };
}

/* The org page shows the cards; the dashboard shows the expiry chip that comes
   off them. Both are revalidated, so a renewed policy stops nagging the whole
   team on the next render rather than at the next deploy. */
function revalidate() {
  revalidatePath("/dashboard/admin/organization");
  revalidatePath("/dashboard");
}

/* Adding one, with its first TERM if the certificate was scanned on the way in
   — the same two-in-one save the fleet's Add vehicle makes when a rego
   certificate is read. Without a record it is exactly what it always was: a
   card with a name, a number and a date typed by hand.

   A scan with NO EXPIRY cannot be a term, and still keeps its certificate:
   splitAddScan puts its number and issuer on the card and files the document
   against the card itself. */
export async function addOrgCredential(
  input: OrgCredentialInput,
  record?: CredentialRecordInput,
): Promise<CredResult> {
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const scan = splitAddScan(input, record);

  const built = buildOrgCredentialRow(scan.input);
  if ("error" in built) return { ok: false, error: built.error };

  /* A term is validated BEFORE the credential is written, so an impossible
     date cannot leave a nameless half-card behind. */
  const term = scan.term ? buildCredentialRecordRow(scan.term) : null;
  if (term && "error" in term) return { ok: false, error: term.error };

  const row = { ...built.row };
  if (term) {
    // the credential's three cached columns come from the term it was born with
    row.expiry_date = term.row.expires_on;
    row.number = term.row.number ?? row.number;
    row.issuer = term.row.issuer ?? row.issuer;
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({ org_id: ctx.orgId, ...row })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't add that." };

  if (term) await fileTerm(ctx, String(data.id), built.row.kind, term.row);
  else if (scan.cardDocumentId) {
    await adoptCredentialDocument(ctx, String(data.id), scan.cardDocumentId, built.row.kind, null);
  }

  revalidate();
  return { ok: true };
}

export async function updateOrgCredential(
  id: string,
  input: OrgCredentialInput
): Promise<CredResult> {
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const built = buildOrgCredentialRow(input);
  if ("error" in built) return { ok: false, error: built.error };

  /* ONCE A TERM EXISTS, number/issuer/expiry_date are a CACHE of it — the
     newest record owns them (docs/migrations/org_credential_records.sql). The
     identity form stops offering those three fields at that point, so writing
     them here from an empty draft would blank the very columns the dashboard
     chip and the card wall read. Name, kind and colour are the credential's
     own either way. */
  const { count } = await supabaseAdmin
    .from(RECORDS)
    .select("id", { count: "exact", head: true })
    .eq("org_id", ctx.orgId)
    .eq("credential_id", id);

  const { kind, name, color, ...cached } = built.row;
  const patch = (count ?? 0) > 0 ? { kind, name, color } : { kind, name, color, ...cached };

  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", id);
  if (error) return { ok: false, error: "Couldn't save that." };

  revalidate();
  return { ok: true };
}

export async function removeOrgCredential(id: string): Promise<CredResult> {
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  /* THE PAPERWORK GOES WITH THE CARD, and it goes FIRST. The card's terms and
     reminder tasks cascade, but `documents.org_credential_id` is ON DELETE SET
     NULL — so dropping the card alone left every certificate ever scanned
     onto it sitting in the bucket owned by nothing: unreachable from any
     screen, still billable, and the same orphan shape as the bug that lost a
     real certificate on 2026-09-08, through a different door — found on the
     signed-in prod walk of 2026-09-10. Done before the delete because afterwards there is nothing
     left to read the refs from — the same ordering deleteNotice keeps. */
  await removeCredentialFiles(ctx.orgId, id);

  const { error } = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", id);
  if (error) return { ok: false, error: "Couldn't remove that." };

  revalidate();
  return { ok: true };
}

/* The stored objects AND the rows behind a card's paperwork. Objects first,
   from the refs the rows still hold; then the rows, which would otherwise
   survive as `org_credential_id = null` — a document row pointing at a file
   that no longer exists is the other half of the same orphan. Kept in one
   named place so the cascade's blind spot is closed exactly once. A storage
   failure is logged and swallowed, as it is for a notice: a billable object
   left behind is a smaller harm than refusing to let an owner delete their
   own card. */
async function removeCredentialFiles(orgId: string, credentialId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("documents")
    .select("storage_ref")
    .eq("org_id", orgId)
    .eq("org_credential_id", credentialId);

  const refs = ((data ?? []) as Record<string, unknown>[])
    .map((r) => String(r.storage_ref))
    .filter((ref) => refIsOrgs(ref, orgId));
  if (refs.length > 0) {
    const { error } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove(refs);
    if (error) console.error("Couldn't remove a credential's documents from storage:", error);
  }

  await supabaseAdmin
    .from("documents")
    .delete()
    .eq("org_id", orgId)
    .eq("org_credential_id", credentialId);
}

/* ---------------- terms: the renewal history ---------------- */

/* RECORDING A RENEWAL is the whole point of the redesign. It never overwrites
   anything: a term is a new row, "current" is the latest expiry, and the three
   columns on the credential are advanced to match — never backwards, so filing
   a certificate you found in a drawer from 2023 adds it to the history without
   retiring the cover you actually hold.

   Same shape as the fleet's fileRenewal (app/actions/fleet.ts), because it is
   the same job one level up. */
async function fileTerm(
  ctx: Ctx,
  credentialId: string,
  kind: OrgCredKind,
  row: CredentialRecordRow,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from(RECORDS)
    .insert({ org_id: ctx.orgId, credential_id: credentialId, ...row })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't record that renewal." };

  const recordId = String(data.id);
  if (row.document_id) await adoptCredentialDocument(ctx, credentialId, row.document_id, kind, recordId);
  return { ok: true, id: recordId };
}

/** Adoption, on the same contract as every other document in this codebase:
    only the uploader's own, confirmed, still-unowned file OF THE ORG'S OWN
    KIND may land. The kind check is what stops a staff licence scan being
    filed as the company's. A file that refuses adoption must not be claimed by
    the record either, or the term would point at paperwork it doesn't own.

    EITHER org kind is taken and the stamp is CORRECTED here, because the file
    is uploaded before the card is named and the Type box can still move under
    it — see ORG_CREDENTIAL_DOC_KINDS for the certificate this lost. */
async function adoptCredentialDocument(
  ctx: Ctx,
  credentialId: string,
  documentId: string,
  kind: OrgCredKind,
  /** null files it against the card itself, with no term to disown it. */
  recordId: string | null,
): Promise<void> {
  if (!ctx.staffId) return;
  const { data } = await supabaseAdmin
    .from("documents")
    .update({
      org_credential_id: credentialId,
      credential_record_id: recordId,
      kind: CREDENTIAL_DOC_KIND[kind],
    })
    .eq("org_id", ctx.orgId)
    .eq("id", documentId)
    .eq("uploaded_by", ctx.staffId)
    .in("kind", ORG_CREDENTIAL_DOC_KINDS)
    .not("uploaded_at", "is", null)
    .is("org_credential_id", null)
    .select("id");
  if ((!data || data.length === 0) && recordId) {
    await supabaseAdmin
      .from(RECORDS)
      .update({ document_id: null })
      .eq("org_id", ctx.orgId)
      .eq("id", recordId);
  }
}

export async function recordCredentialTerm(
  credentialId: string,
  input: CredentialRecordInput,
): Promise<CredResult> {
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const built = buildCredentialRecordRow(input);
  if ("error" in built) return { ok: false, error: built.error };

  const { data: cred } = await supabaseAdmin
    .from(TABLE)
    .select("id, kind, name, expiry_date")
    .eq("org_id", ctx.orgId)
    .eq("id", credentialId)
    .maybeSingle();
  if (!cred || !isCredKind(cred.kind)) return { ok: false, error: "That card is no longer on file." };
  const kind = cred.kind as OrgCredKind;

  const filed = await fileTerm(ctx, credentialId, kind, built.row);
  if (!filed.ok) return filed;

  // advance the cache — never backwards
  const current = (cred.expiry_date as string | null) ?? null;
  if (!current || built.row.expires_on > current) {
    await supabaseAdmin
      .from(TABLE)
      .update({
        expiry_date: built.row.expires_on,
        number: built.row.number ?? null,
        issuer: built.row.issuer ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", ctx.orgId)
      .eq("id", credentialId);
  }

  revalidate();
  return { ok: true };
}

/* FILING A DOCUMENT AGAINST A CARD: under a TERM when there is one — the
   certificate that turned up a week after the renewal notice — and against the
   card itself when there is not.

   THE TERM IS OPTIONAL BECAUSE A CARD NEED NOT HAVE ONE. A term is a period
   and `expires_on` is NOT NULL, so a licence with no renewal date can hold no
   term at all, and while this took only a record id that was the one kind of
   card whose certificate had nowhere to go. `org_credential_id` is the OWNER
   and `credential_record_id` the FILING; the second has always been allowed to
   be null, and looseDocuments already renders exactly those rows.

   Adoption is the same contract either way: only the uploader's own,
   confirmed, still-unowned file OF THE RIGHT KIND may land. The kind check is
   what stops a staff licence scan being filed as the company's. */
export async function fileCredentialDocument(
  credentialId: string,
  /** null files it against the card itself. */
  recordId: string | null,
  documentId: string,
): Promise<CredResult> {
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!ctx.staffId) return { ok: false, error: "Only a staff member can file documents." };

  const { data: cred } = await supabaseAdmin
    .from(TABLE)
    .select("id, kind")
    .eq("org_id", ctx.orgId)
    .eq("id", credentialId)
    .maybeSingle();
  if (!cred || !isCredKind(cred.kind)) return { ok: false, error: "That card is no longer on file." };

  /* A term is checked against THIS card and not merely against the org: a
     certificate filed under another card's term would sit in a history it does
     not belong to, and the record id comes from a client. */
  if (recordId) {
    const { data: record } = await supabaseAdmin
      .from(RECORDS)
      .select("id")
      .eq("org_id", ctx.orgId)
      .eq("credential_id", credentialId)
      .eq("id", recordId)
      .maybeSingle();
    if (!record) return { ok: false, error: "That term is no longer on file." };
  }

  const { data } = await supabaseAdmin
    .from("documents")
    .update({
      org_credential_id: credentialId,
      credential_record_id: recordId,
      kind: CREDENTIAL_DOC_KIND[cred.kind as OrgCredKind],
    })
    .eq("org_id", ctx.orgId)
    .eq("id", documentId)
    .eq("uploaded_by", ctx.staffId)
    .in("kind", ORG_CREDENTIAL_DOC_KINDS)
    .not("uploaded_at", "is", null)
    .is("org_credential_id", null)
    .select("id");
  if (!data || data.length === 0) return { ok: false, error: "That document couldn't be filed." };

  revalidate();
  return { ok: true };
}

/* Deleting a term. It exists because a scan can be filed against the wrong
   card, and a wrong expiry on the wrong card is worse than none: it silences
   the warning for the one that is actually lapsing. The cache is recomputed
   from what is left rather than assumed — deleting the current term must hand
   the credential back to the one underneath it, not leave it pointing at a
   date that no longer exists. */
export async function removeCredentialTerm(recordId: string): Promise<CredResult> {
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const { data: record } = await supabaseAdmin
    .from(RECORDS)
    .select("id, credential_id")
    .eq("org_id", ctx.orgId)
    .eq("id", recordId)
    .maybeSingle();
  if (!record) return { ok: true };
  const credentialId = String(record.credential_id);

  const { error } = await supabaseAdmin
    .from(RECORDS)
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", recordId);
  if (error) return { ok: false, error: "Couldn't remove that term." };

  const { data: rest } = await supabaseAdmin
    .from(RECORDS)
    .select("expires_on, number, issuer")
    .eq("org_id", ctx.orgId)
    .eq("credential_id", credentialId)
    .order("expires_on", { ascending: false })
    .limit(1);

  const top = (rest ?? [])[0] as Record<string, unknown> | undefined;
  await supabaseAdmin
    .from(TABLE)
    .update({
      expiry_date: (top?.expires_on as string) ?? null,
      number: (top?.number as string) ?? null,
      issuer: (top?.issuer as string) ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", ctx.orgId)
    .eq("id", credentialId);

  revalidate();
  return { ok: true };
}

/* ---------------- remind me ---------------- */

