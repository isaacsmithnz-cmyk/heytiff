"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  buildPatch,
  isSelfSection,
  type StaffProfile,
} from "@/lib/staff/profile";
import { splitName, withDerivedFullName } from "@/lib/staff/name";
import { buildLicenceRow, type LicenceInput } from "@/lib/staff/licence";

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
  "emergency_name, emergency_phone, emergency_relationship, emergency_alt_phone, " +
  "work_rights_status, visa_type, visa_expiry, hours_condition, vevo_checked_at, " +
  "work_rights_doc_url, work_rights_verified_at, qualifications";
// NB: hourly_wage / contracted_hours / utilisation / cost_split / notes are
// intentionally absent — this module must never read or write them.

async function requireOrg(): Promise<{ orgId: string; userId: string }> {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");
  const orgId = session.orgId as string | undefined;
  if (!orgId) throw new Error("No active organization");
  return { orgId, userId: session.user.sub as string };
}

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

export type SaveResult = { ok: true } | { ok: false; error: string };

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
    return { ok: false, error: "Check the date format — use dd/mm/yyyy." };
  }
  if (Object.keys(patch).length === 0) {
    return { ok: true };
  }

  // Make sure the row exists before updating. It also supplies the half of the
  // name the form didn't send, so the derived full_name stays whole.
  const current = await loadMyProfile();

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

/* Licences are ROWS in staff_licences, not columns, so they never ride the flat
   section-save above — the Compliance card adds and removes them directly. Both
   re-resolve your own staff card server-side and scope every write to it: a
   forged post can only ever touch your own licences, never another person's. */

/** Add a licence to your own Compliance card. */
export async function addMyLicence(input: LicenceInput): Promise<SaveResult> {
  const { orgId } = await requireOrg();
  const built = buildLicenceRow(input);
  if ("error" in built) return { ok: false, error: built.error };

  const me = await loadMyProfile();
  const { error } = await supabaseAdmin.from("staff_licences").insert({
    org_id: orgId,
    staff_profile_id: me.id,
    ...built.row,
  });
  if (error) return { ok: false, error: "Couldn't add that licence." };

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard/team");
  return { ok: true };
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
