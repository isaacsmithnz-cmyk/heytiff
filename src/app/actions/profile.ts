"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";
import {
  buildPatch,
  isSelfSection,
  type StaffProfile,
} from "@/lib/staff/profile";
import { splitName, withDerivedFullName } from "@/lib/staff/name";
import { buildLicenceRow, type LicenceInput } from "@/lib/staff/licence";
import { buildLicenceTermRow, splitAddScan, type LicenceTermInput } from "@/lib/staff/licence-records";
import {
  fileLicenceDocument,
  recordTerm,
  removeTerm,
  seedFirstTerm,
} from "@/lib/staff/licence-writes";
import { WORK_RIGHTS_LOCKED, type WorkRightsCheckInput } from "@/lib/staff/work-rights-records";
import {
  attachCheckDocument,
  recordCheck,
  removeCheck,
} from "@/lib/staff/work-rights-writes";
import { resolvePhotoDocument } from "@/lib/staff/photo";

/* My profile persistence — your own staff card.

   Server Functions are reachable by direct POST, so this re-checks the session
   itself and never trusts the section key from the client. The allowlist in
   lib/staff/profile.ts contains no payroll, permissions or notes columns, so
   there is no section value that reaches them — hiding them in the UI is a
   convenience, not the control.

   Tables: staff_profiles / staff_licences (migration
   `create_staff_profiles_and_licences`). RLS on, no policies — service-role
   only, same posture as studio_designs / rate_calc_state. */

const COLUMNS =
  "id, org_id, user_id, first_name, last_name, full_name, preferred_name, phone, birthday, address, " +
  "start_date, employment_type, job_title, status, photo_url, " +
  "shirt_size, jacket_size, trousers_size, boot_size, boot_scale, " +
  "emergency_name, emergency_phone, emergency_relationship, emergency_alt_phone, " +
  "work_rights_status, visa_type, visa_expiry, hours_condition, vevo_checked_at, qualifications";
// NB: hourly_wage / contracted_hours / utilisation / cost_split / notes are
// intentionally absent — this module must never read or write them.

/* No capability on requireOrg here — your own card is intrinsic to being a
   signed-in member; the section allowlist above is the actual control. */

/** Load (or lazily create) the signed-in user's staff card. */
export async function loadMyProfile(): Promise<StaffProfile> {
  const { orgId, userId } = await requireOrg();

  const { data, error } = await supabaseAdmin
    .from("staff_profiles")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data as unknown as StaffProfile;

  // First visit — seed from the Auth0 identity we already have. Auth0 gives us
  // one `name` claim, so this is the one place a name is split: best effort,
  // once, and the person can correct both halves on their own card.
  const session = await auth0.getSession();
  const seedName =
    (session?.user.name as string | undefined) ??
    session?.user.email?.split("@")[0] ??
    null;
  const seedParts = splitName(seedName);

  const { data: created, error: insertError } = await supabaseAdmin
    .from("staff_profiles")
    .insert({
      org_id: orgId,
      user_id: userId,
      ...seedParts,
      full_name: seedName,
      photo_url: (session?.user.picture as string | undefined) ?? null,
    })
    .select(COLUMNS)
    .single();

  // A concurrent request may have won the insert — fall back to reading it.
  if (insertError) {
    const { data: existing } = await supabaseAdmin
      .from("staff_profiles")
      .select(COLUMNS)
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) return existing as unknown as StaffProfile;
    throw new Error(insertError.message);
  }

  return created as unknown as StaffProfile;
}

/* `fields` carries the `invalid` array buildPatch already computed, so the
   card can ring the input it choked on instead of only printing a sentence
   above itself. Additive and optional — a failure with nothing field-specific
   to say omits it, and every existing caller ignores it. */
export type SaveResult = { ok: true } | { ok: false; error: string; fields?: string[] };

/** Save one card of your own profile. */
export async function saveMyProfileSection(
  section: string,
  fields: Record<string, string>
): Promise<SaveResult> {
  const { orgId, userId } = await requireOrg();

  if (!isSelfSection(section)) {
    // Covers payroll / permissions / notes and anything invented.
    return { ok: false, error: "That section can't be edited here." };
  }

  const { patch, invalid } = buildPatch(section, Object.entries(fields ?? {}));

  if (invalid.length) {
    return { ok: false, error: "Check the date format — use dd/mm/yyyy.", fields: invalid };
  }
  if (Object.keys(patch).length === 0) {
    return { ok: true };
  }

  // Make sure the row exists before updating. It also supplies the half of the
  // name the form didn't send, so the derived full_name stays whole.
  const current = await loadMyProfile();

  if (section === "workrights" && (await workRightsLocked(orgId, current.id))) {
    return { ok: false, error: WORK_RIGHTS_LOCKED };
  }

  const { error } = await supabaseAdmin
    .from("staff_profiles")
    .update({
      ...withDerivedFullName(patch, current),
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId)
    .eq("user_id", userId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard/team");
  return { ok: true };
}

/* Your own photo. The twin of setStaffPhoto, and deliberately not routed
   through saveMyProfileSection: photo_url is NOT in the self section allowlist
   and must not be, or a forged post could point your card at any string it
   liked. The document is re-checked instead — see lib/staff/photo. */

export async function setMyPhoto(documentId: string): Promise<SaveResult> {
  const { orgId, userId } = await requireOrg();

  const doc = await resolvePhotoDocument(orgId, documentId);
  if (!doc.ok) return doc;

  // the row may not exist yet on a card nobody has saved
  await loadMyProfile();

  const { error } = await supabaseAdmin
    .from("staff_profiles")
    .update({ photo_url: doc.ref, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: "Couldn't save that photo." };

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard/team");
  return { ok: true };
}

export async function clearMyPhoto(): Promise<SaveResult> {
  const { orgId, userId } = await requireOrg();

  const { error } = await supabaseAdmin
    .from("staff_profiles")
    .update({ photo_url: null, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: "Couldn't remove that photo." };

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard/team");
  return { ok: true };
}

/* Licences are ROWS in staff_licences, not columns, so they never ride the flat
   section-save above — the Compliance card adds and removes them directly. Both
   re-resolve your own staff card server-side and scope every write to it: a
   forged post can only ever touch your own licences, never another person's. */

/** Add a licence to your own Compliance card — with its first TERM when the
    card was scanned on the way in, so one save records both what the ticket is
    and the period it is currently good for. A card with no expiry is scanned
    in too, and keeps its number and photo on the ticket (splitAddScan). */
export async function addMyLicence(
  input: LicenceInput,
  term?: LicenceTermInput
): Promise<SaveResult> {
  const { orgId } = await requireOrg();
  const scan = splitAddScan(input, term);
  const built = buildLicenceRow(scan.input);
  if ("error" in built) return { ok: false, error: built.error };

  /* The term is validated BEFORE the licence is written, so an impossible date
     cannot leave a nameless half-card behind. */
  const first = scan.term ? buildLicenceTermRow(scan.term) : null;
  if (first && "error" in first) return { ok: false, error: first.error };

  const row = { ...built.row };
  if (first) {
    // the two cached columns come from the term the ticket was born with
    row.expiry_date = first.row.expires_on;
    row.licence_number = first.row.number ?? row.licence_number;
  }

  const me = await loadMyProfile();
  const { data, error } = await supabaseAdmin
    .from("staff_licences")
    .insert({ org_id: orgId, staff_profile_id: me.id, ...row })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't add that licence." };

  if (first) await seedFirstTerm(orgId, me.id, me.id, String(data.id), first.row);
  else if (scan.cardDocumentId) {
    await fileLicenceDocument(orgId, me.id, me.id, String(data.id), null, scan.cardDocumentId);
  }

  revalidateMine();
  return { ok: true };
}

/* WHAT THE TICKET IS — its name and its colour. Its NUMBER and EXPIRY are not
   here once a term exists: they are a cache of the newest term
   (docs/migrations/staff_licence_records.sql), the modal stops offering them
   at that point, and writing them from an empty draft would blank the columns
   the dashboard chip and the completeness strip read. */
export async function updateMyLicence(
  licenceId: string,
  input: LicenceInput
): Promise<SaveResult> {
  const { orgId } = await requireOrg();
  const built = buildLicenceRow(input);
  if ("error" in built) return { ok: false, error: built.error };

  const me = await loadMyProfile();
  const { count } = await supabaseAdmin
    .from("staff_licence_records")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("licence_id", licenceId);

  const { type_name, color, ...cached } = built.row;
  const patch = (count ?? 0) > 0 ? { type_name, color } : { type_name, color, ...cached };

  const { error } = await supabaseAdmin
    .from("staff_licences")
    .update(patch)
    .eq("org_id", orgId)
    .eq("staff_profile_id", me.id)
    .eq("id", licenceId);
  if (error) return { ok: false, error: "Couldn't save that licence." };

  revalidateMine();
  return { ok: true };
}

/* ---- your own licence's terms ----

   Every one of these re-resolves your own staff card server-side and hands
   that id to the shared writer (lib/staff/licence-writes.ts), so a forged post
   can only ever reach your own ticket. The gate here is simply "this is your
   card"; the SQL is the same the admin path runs. */

export async function recordMyLicenceTerm(
  licenceId: string,
  input: LicenceTermInput
): Promise<SaveResult> {
  const { orgId } = await requireOrg();
  const me = await loadMyProfile();
  const res = await recordTerm(orgId, me.id, me.id, licenceId, input);
  if (res.ok) revalidateMine();
  return res;
}

/** A null term files it against the ticket itself — a white card holds no term
    to file under, and its photo is the only thing it will ever carry. */
export async function attachMyLicenceDocument(
  licenceId: string,
  termId: string | null,
  documentId: string
): Promise<SaveResult> {
  const { orgId } = await requireOrg();
  const me = await loadMyProfile();
  const res = await fileLicenceDocument(orgId, me.id, me.id, licenceId, termId, documentId);
  if (res.ok) revalidateMine();
  return res;
}

export async function removeMyLicenceTerm(termId: string): Promise<SaveResult> {
  const { orgId } = await requireOrg();
  const me = await loadMyProfile();
  const res = await removeTerm(orgId, me.id, termId);
  if (res.ok) revalidateMine();
  return res;
}

function revalidateMine() {
  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard/team");
}

/** Remove a licence from your own card — only ever your own. */
export async function removeMyLicence(licenceId: string): Promise<SaveResult> {
  const { orgId } = await requireOrg();
  const me = await loadMyProfile();
  const { error } = await supabaseAdmin
    .from("staff_licences")
    .delete()
    .eq("org_id", orgId)
    .eq("staff_profile_id", me.id) // scoped to you, not just the id
    .eq("id", licenceId);
  if (error) return { ok: false, error: "Couldn't remove that licence." };

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard/team");
  return { ok: true };
}

/* ---- your own right-to-work checks ----

   Intrinsic, like the rest of your own card: nothing here asks for a
   capability, and every call re-resolves YOUR staff id server-side and hands
   that to the shared writer, so a forged post can only ever reach your own
   record.

   Recording a check about yourself is a real thing people do — a student on a
   500 whose visa was just renewed, updating their own card before their
   manager asks. The evidence upload was already intrinsic
   (actions/documents.ts); this is the rest of that door. */

export async function recordMyWorkRightsCheck(input: WorkRightsCheckInput): Promise<SaveResult> {
  const { orgId } = await requireOrg();
  const me = await loadMyProfile();
  const res = await recordCheck(orgId, me.id, me.id, input);
  if (res.ok) revalidateMine();
  return res;
}

export async function attachMyWorkRightsDocument(
  recordId: string,
  documentId: string
): Promise<SaveResult> {
  const { orgId } = await requireOrg();
  const me = await loadMyProfile();
  const res = await attachCheckDocument(orgId, me.id, me.id, recordId, documentId);
  if (res.ok) revalidateMine();
  return res;
}

export async function removeMyWorkRightsCheck(recordId: string): Promise<SaveResult> {
  const { orgId } = await requireOrg();
  const me = await loadMyProfile();
  const res = await removeCheck(orgId, me.id, recordId);
  if (res.ok) revalidateMine();
  return res;
}

/* WORK RIGHTS BECOMES READ-ONLY ONCE A CHECK IS ON FILE, and this is the
   server half of that rule.

   Those five columns are a CACHE of the newest check
   (docs/migrations/staff_work_rights_records.sql). Editing them in place would
   write values no check supports, and the next check to be recorded would
   silently overwrite them — two doors telling different stories about whether
   somebody may legally work. The card stops offering the fields; a Server
   Function is reachable by direct POST, so it is refused here as well.

   Before the first check there is nothing to disagree with, so the card
   behaves exactly as it always has — which is what keeps every existing
   workspace working the day this ships. */
async function workRightsLocked(orgId: string, staffId: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from("staff_work_rights_records")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffId);
  return (count ?? 0) > 0;
}
