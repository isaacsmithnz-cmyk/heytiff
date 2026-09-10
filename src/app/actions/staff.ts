"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getCapabilities, getOwnership } from "@/lib/permissions-server";
import {
  CAPABILITIES,
  canChangeRoleOf,
  canEditPermissionsOf,
  canSetCapability,
  isCapability,
  resolve,
  type Capability,
} from "@/lib/permissions";
import { buildAdminPatch, capabilityFor, isAdminSection } from "@/lib/staff/admin-sections";
import { withDerivedFullName } from "@/lib/staff/name";
import { clearDrift } from "@/lib/integrations/drift-sweep";
import { buildLicenceRow, type LicenceInput } from "@/lib/staff/licence";
import { WORK_RIGHTS_LOCKED } from "@/lib/staff/work-rights-records";
import { buildLicenceTermRow, type LicenceTermInput } from "@/lib/staff/licence-records";
import {
  fileLicenceDocument,
  recordTerm,
  removeTerm,
  seedFirstTerm,
} from "@/lib/staff/licence-writes";
import type { WorkRightsCheckInput } from "@/lib/staff/work-rights-records";
import {
  attachCheckDocument,
  recordCheck,
  removeCheck,
} from "@/lib/staff/work-rights-writes";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { resolvePhotoDocument } from "@/lib/staff/photo";
import type { Role } from "@/lib/roles-shared";

/* Editing SOMEONE ELSE'S card, from Team.

   Everything the UI decided is re-decided here. A Server Function is reachable
   by direct POST, so "the button wasn't rendered" is not a control — the
   section must map to a capability the caller actually holds, and the
   permissions path re-runs the same ownership guards the card rendered with. */

/* `fields` carries the `invalid` array buildAdminPatch already computed, so the
   card can ring the input it choked on instead of only printing a sentence
   above itself. Additive and optional — a failure with nothing field-specific
   to say omits it, and every existing caller ignores it. */
export type SaveResult = { ok: true } | { ok: false; error: string; fields?: string[] };

type Ctx = {
  orgId: string;
  actorId: string;
  actorRole: Role | null;
  caps: ReadonlySet<Capability>;
  primaryOwnerUserId: string;
};

async function context(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) return null;
  const [caps, ownership] = await Promise.all([getCapabilities(), getOwnership()]);
  if (!ownership.role) return null;
  return {
    orgId,
    actorId: ownership.userId,
    actorRole: ownership.role,
    caps,
    primaryOwnerUserId: ownership.primaryOwnerUserId,
  };
}

type Target = {
  userId: string | null;
  role: Role | null;
  permissions: unknown;
  name: { first_name: string | null; last_name: string | null };
};

/** The target, resolved inside the caller's org — never by id alone. */
async function targetIn(
  ctx: Ctx,
  staffId: string
): Promise<Target | null> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    // the name halves ride along so a one-field save can still derive the
    // whole full_name — see lib/staff/name.ts
    .select("user_id, first_name, last_name")
    .eq("org_id", ctx.orgId)
    .eq("id", staffId)
    .maybeSingle();
  if (!data) return null;
  const name = {
    first_name: (data.first_name as string) ?? null,
    last_name: (data.last_name as string) ?? null,
  };
  const userId = (data.user_id as string) ?? null;
  if (!userId) return { userId: null, role: null, permissions: null, name };
  const { data: m } = await supabaseAdmin
    .from("memberships")
    .select("role, permissions")
    .eq("org_id", ctx.orgId)
    .eq("user_id", userId)
    .maybeSingle();
  return {
    userId,
    role: (m?.role as Role) ?? null,
    permissions: m?.permissions ?? null,
    name,
  };
}

/** Save one card of someone else's profile. */
export async function saveStaffSection(
  staffId: string,
  section: string,
  fields: Record<string, string>
): Promise<SaveResult> {
  const ctx = await context();
  if (!ctx) throw new Error("Not authenticated");
  if (!ctx.caps.has("team")) {
    return { ok: false, error: "You don't have access to staff records." };
  }

  const target = await targetIn(ctx, staffId);
  if (!target) return { ok: false, error: "That staff member doesn't exist." };

  if (section === "permissions") {
    return savePermissions(ctx, staffId, target, fields);
  }

  if (!isAdminSection(section)) {
    return { ok: false, error: "That section can't be edited here." };
  }
  /* The admin half of the work-rights lock — see actions/profile.ts for the
     argument. Those five columns are a cache of the newest check, and a direct
     POST must not be able to write values no check supports. */
  if (section === "workrights") {
    const { count } = await supabaseAdmin
      .from("staff_work_rights_records")
      .select("id", { count: "exact", head: true })
      .eq("org_id", ctx.orgId)
      .eq("staff_profile_id", staffId);
    if ((count ?? 0) > 0) return { ok: false, error: WORK_RIGHTS_LOCKED };
  }
  const needed = capabilityFor(section);
  if (!ctx.caps.has(needed)) {
    return {
      ok: false,
      error:
        needed === "financials"
          ? "Only an owner can change pay."
          : "You don't have access to change that.",
    };
  }

  const { patch, invalid } = buildAdminPatch(section, Object.entries(fields ?? {}));
  if (invalid.includes("cost_split")) {
    return { ok: false, error: "The cost split has to add up to 100%.", fields: invalid };
  }
  if (invalid.length) {
    return {
      ok: false,
      error: invalid.some((k) => k.includes("date") || k === "birthday")
        ? "Check the date format — use dd/mm/yyyy."
        : "Check the numbers — they should be plain figures.",
      fields: invalid,
    };
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabaseAdmin
    .from("staff_profiles")
    .update({
      ...withDerivedFullName(patch, target.name),
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", ctx.orgId)
    .eq("id", staffId);
  if (error) return { ok: false, error: error.message };

  /* Editing a Xero-linked person's wage invalidates the stored drift count —
     it was computed against the old wage, and the rates it compared aren't
     kept (a count is all we store, deliberately), so it can't be corrected in
     place. It is forgotten; the next Check pay rates or Monday sweep
     recomputes. A few days of silence beats a banner asserting a difference
     the admin may have just resolved. */
  if (section === "payroll" && "hourly_wage" in patch) {
    const { data: linked } = await supabaseAdmin
      .from("integration_links")
      .select("id")
      .eq("org_id", ctx.orgId)
      .eq("provider", "xero")
      .eq("kind", "payroll_employee")
      .eq("staff_profile_id", staffId)
      .limit(1);
    if (linked?.length) {
      await clearDrift(ctx.orgId);
      revalidatePath("/dashboard/timepay");
    }
  }

  revalidatePath(`/dashboard/team/${staffId}`);
  revalidatePath("/dashboard/team");
  return { ok: true };
}

/* Someone else's licences — the Compliance card in Team. Managing another
   person's record is the `team` capability (same as their identity + the
   qualifications text), and every write is scoped to the org AND that person,
   resolved server-side, so a forged post can't reach a third party's licences. */

export async function addStaffLicence(
  staffId: string,
  input: LicenceInput,
  term?: LicenceTermInput,
): Promise<SaveResult> {
  const ctx = await context();
  if (!ctx) throw new Error("Not authenticated");
  if (!ctx.caps.has("team")) return { ok: false, error: "You don't have access to staff records." };
  if (!(await targetIn(ctx, staffId))) return { ok: false, error: "That staff member doesn't exist." };

  const built = buildLicenceRow(input);
  if ("error" in built) return { ok: false, error: built.error };

  // validated before the licence is written, so an impossible date cannot
  // leave a half-card behind on someone else's record
  const first = term ? buildLicenceTermRow(term) : null;
  if (first && "error" in first) return { ok: false, error: first.error };

  const row = { ...built.row };
  if (first) {
    row.expiry_date = first.row.expires_on;
    row.licence_number = first.row.number ?? row.licence_number;
  }

  const { data, error } = await supabaseAdmin
    .from("staff_licences")
    .insert({ org_id: ctx.orgId, staff_profile_id: staffId, ...row })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't add that licence." };

  if (first) {
    await seedFirstTerm(ctx.orgId, staffId, await actorStaffId(ctx), String(data.id), first.row);
  }

  revalidateStaff(staffId);
  return { ok: true };
}

/* WHAT THE TICKET IS — its name and its colour. Number and expiry are a cache
   of the newest term once one exists; see the self-side twin in
   actions/profile.ts for the argument. */
export async function updateStaffLicence(
  staffId: string,
  licenceId: string,
  input: LicenceInput,
): Promise<SaveResult> {
  const ctx = await context();
  if (!ctx) throw new Error("Not authenticated");
  if (!ctx.caps.has("team")) return { ok: false, error: "You don't have access to staff records." };

  const built = buildLicenceRow(input);
  if ("error" in built) return { ok: false, error: built.error };

  const { count } = await supabaseAdmin
    .from("staff_licence_records")
    .select("id", { count: "exact", head: true })
    .eq("org_id", ctx.orgId)
    .eq("licence_id", licenceId);

  const { type_name, color, ...cached } = built.row;
  const patch = (count ?? 0) > 0 ? { type_name, color } : { type_name, color, ...cached };

  const { error } = await supabaseAdmin
    .from("staff_licences")
    .update(patch)
    .eq("org_id", ctx.orgId)
    .eq("staff_profile_id", staffId)
    .eq("id", licenceId);
  if (error) return { ok: false, error: "Couldn't save that licence." };

  revalidateStaff(staffId);
  return { ok: true };
}

/* ---- someone else's licence terms ----

   `team` for all of them, and every one scoped to the org AND that person,
   resolved server-side, so a forged post can't reach a third party's record.
   The SQL is the shared writer's — the same one your own card runs — because
   two copies of "advance the cache, move the reminders" is one copy too many.

   The UPLOADER is the actor, not the subject: a manager scanning Bob's ticket
   uploaded that file, and adoption only ever accepts the uploader's own. */

async function actorStaffId(ctx: Ctx): Promise<string | null> {
  return staffProfileIdFor(ctx.orgId, ctx.actorId);
}

export async function recordStaffLicenceTerm(
  staffId: string,
  licenceId: string,
  input: LicenceTermInput,
): Promise<SaveResult> {
  const ctx = await context();
  if (!ctx) throw new Error("Not authenticated");
  if (!ctx.caps.has("team")) return { ok: false, error: "You don't have access to staff records." };

  const res = await recordTerm(ctx.orgId, staffId, await actorStaffId(ctx), licenceId, input);
  if (res.ok) revalidateStaff(staffId);
  return res;
}

/** A null term files it against the ticket itself — a white card holds no term
    to file under, and its photo is the only thing it will ever carry. */
export async function attachStaffLicenceDocument(
  staffId: string,
  licenceId: string,
  termId: string | null,
  documentId: string,
): Promise<SaveResult> {
  const ctx = await context();
  if (!ctx) throw new Error("Not authenticated");
  if (!ctx.caps.has("team")) return { ok: false, error: "You don't have access to staff records." };

  const res = await fileLicenceDocument(
    ctx.orgId,
    staffId,
    await actorStaffId(ctx),
    licenceId,
    termId,
    documentId,
  );
  if (res.ok) revalidateStaff(staffId);
  return res;
}

export async function removeStaffLicenceTerm(staffId: string, termId: string): Promise<SaveResult> {
  const ctx = await context();
  if (!ctx) throw new Error("Not authenticated");
  if (!ctx.caps.has("team")) return { ok: false, error: "You don't have access to staff records." };

  const res = await removeTerm(ctx.orgId, staffId, termId);
  if (res.ok) revalidateStaff(staffId);
  return res;
}

function revalidateStaff(staffId: string) {
  revalidatePath(`/dashboard/team/${staffId}`);
  revalidatePath("/dashboard/team");
}

export async function removeStaffLicence(staffId: string, licenceId: string): Promise<SaveResult> {
  const ctx = await context();
  if (!ctx) throw new Error("Not authenticated");
  if (!ctx.caps.has("team")) return { ok: false, error: "You don't have access to staff records." };

  const { error } = await supabaseAdmin
    .from("staff_licences")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("staff_profile_id", staffId)
    .eq("id", licenceId);
  if (error) return { ok: false, error: "Couldn't remove that licence." };

  revalidatePath(`/dashboard/team/${staffId}`);
  revalidatePath("/dashboard/team");
  return { ok: true };
}

/* The staff photo. Not part of any section save: picking a file writes it
   immediately, because the avatar you are looking at IS the confirmation. The
   card's open draft is untouched by the revalidate that follows — the draft is
   the mode (see profile/section-card), so whatever else was being typed stays
   where it was.

   Gated on `team` like every other write here, and `staff_photo` uploads are
   already allowed to any member by beginUpload — so the control that matters
   is targetIn() below, which resolves the person inside the caller's org. */

export async function setStaffPhoto(staffId: string, documentId: string): Promise<SaveResult> {
  const ctx = await context();
  if (!ctx) throw new Error("Not authenticated");
  if (!ctx.caps.has("team")) return { ok: false, error: "You don't have access to staff records." };
  if (!(await targetIn(ctx, staffId))) return { ok: false, error: "That staff member doesn't exist." };

  const doc = await resolvePhotoDocument(ctx.orgId, documentId);
  if (!doc.ok) return doc;

  const { error } = await supabaseAdmin
    .from("staff_profiles")
    .update({ photo_url: doc.ref, updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", staffId);
  if (error) return { ok: false, error: "Couldn't save that photo." };

  revalidatePath(`/dashboard/team/${staffId}`);
  revalidatePath("/dashboard/team");
  return { ok: true };
}

/** Take the photo off the card. The column is cleared and the file is left:
    a document nothing points at is invisible everywhere, and deleting the
    object here would take it out from under any other card that was pointed
    at the same upload. */
export async function clearStaffPhoto(staffId: string): Promise<SaveResult> {
  const ctx = await context();
  if (!ctx) throw new Error("Not authenticated");
  if (!ctx.caps.has("team")) return { ok: false, error: "You don't have access to staff records." };
  if (!(await targetIn(ctx, staffId))) return { ok: false, error: "That staff member doesn't exist." };

  const { error } = await supabaseAdmin
    .from("staff_profiles")
    .update({ photo_url: null, updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", staffId);
  if (error) return { ok: false, error: "Couldn't remove that photo." };

  revalidatePath(`/dashboard/team/${staffId}`);
  revalidatePath("/dashboard/team");
  return { ok: true };
}

/* Role + capability changes. Writes memberships, not staff_profiles, and
   every change lands in permission_audit — the log is what makes "why can
   they see that?" answerable six months later. */
async function savePermissions(
  ctx: Ctx,
  staffId: string,
  target: Target,
  fields: Record<string, string>
): Promise<SaveResult> {
  if (!target.userId) {
    return { ok: false, error: "They haven't accepted their invite yet." };
  }

  const allowed = canEditPermissionsOf(
    { role: ctx.actorRole, userId: ctx.actorId, caps: ctx.caps },
    { role: target.role, userId: target.userId }
  );
  if (!allowed) {
    return { ok: false, error: "You can't change this person's access." };
  }

  const audits: {
    org_id: string;
    actor_user_id: string;
    target_user_id: string;
    change_type: "role" | "capability";
    detail: Record<string, unknown>;
  }[] = [];

  const update: { role?: Role; permissions?: Record<string, boolean> } = {};

  // --- role -------------------------------------------------------------
  const wantedRole = fields.org_role;
  if (wantedRole && wantedRole !== target.role) {
    if (!["owner", "admin", "staff"].includes(wantedRole)) {
      return { ok: false, error: "That isn't a role." };
    }
    const mayChange = canChangeRoleOf(
      { role: ctx.actorRole, userId: ctx.actorId, primaryOwnerUserId: ctx.primaryOwnerUserId },
      { role: target.role, userId: target.userId, primaryOwnerUserId: ctx.primaryOwnerUserId }
    );
    if (!mayChange) {
      return { ok: false, error: "You can't change this person's role." };
    }
    update.role = wantedRole as Role;
    // a role change resets overrides — the role means what it says, with no
    // invisible leftovers from the position they used to hold
    update.permissions = {};
    audits.push({
      org_id: ctx.orgId,
      actor_user_id: ctx.actorId,
      target_user_id: target.userId,
      change_type: "role",
      detail: { from: target.role, to: wantedRole, cleared_overrides: true },
    });
  }

  // --- capabilities -----------------------------------------------------
  if (update.permissions === undefined) {
    const effectiveRole = update.role ?? target.role;
    const current = resolve(effectiveRole, target.permissions);
    const defaults = resolve(effectiveRole, null);
    const overrides: Record<string, boolean> = {};

    for (const cap of CAPABILITIES) {
      const raw = fields[`cap_${cap}`];
      if (raw === undefined) continue;
      const wanted = raw === "on";
      if (wanted === current.has(cap)) {
        // unchanged — carry any existing explicit override through
        const prev = (target.permissions as Record<string, unknown> | null) ?? {};
        if (Object.hasOwn(prev, cap) && typeof prev[cap] === "boolean") {
          overrides[cap] = prev[cap] as boolean;
        }
        continue;
      }
      if (!isCapability(cap) || !canSetCapability(ctx.actorRole, cap)) {
        return { ok: false, error: `Only an owner can grant ${cap}.` };
      }
      // store only what differs from the role default, so defaults can change
      // later without rewriting everyone's row
      if (wanted !== defaults.has(cap)) overrides[cap] = wanted;
      audits.push({
        org_id: ctx.orgId,
        actor_user_id: ctx.actorId,
        target_user_id: target.userId,
        change_type: "capability",
        detail: { capability: cap, from: current.has(cap), to: wanted },
      });
    }
    if (audits.length) update.permissions = overrides;
  }

  if (Object.keys(update).length === 0) return { ok: true };

  const { error } = await supabaseAdmin
    .from("memberships")
    .update(update)
    .eq("org_id", ctx.orgId)
    .eq("user_id", target.userId);
  if (error) return { ok: false, error: error.message };

  if (audits.length) {
    // best effort: a failed audit insert must not roll back a change the
    // owner already saw succeed, but it should be loud in the logs
    const { error: auditError } = await supabaseAdmin.from("permission_audit").insert(audits);
    if (auditError) console.error("permission_audit insert failed:", auditError);
  }

  revalidatePath(`/dashboard/team/${staffId}`);
  revalidatePath("/dashboard/team");
  return { ok: true };
}

/* ---- somebody else's right-to-work checks ----

   `team`, the same gate the rest of their card carries — a deliberate choice
   over a tighter one, so the tab appears for exactly the admins who can
   already open the record rather than for a subset nobody could predict.

   The UPLOADER is the actor, not the subject: a manager scanning a grant
   notice uploaded that file, and adoption only ever accepts the uploader's
   own. */

export async function recordStaffWorkRightsCheck(
  staffId: string,
  input: WorkRightsCheckInput,
): Promise<SaveResult> {
  const ctx = await context();
  if (!ctx) throw new Error("Not authenticated");
  if (!ctx.caps.has("team")) return { ok: false, error: "You don't have access to staff records." };

  const res = await recordCheck(ctx.orgId, staffId, await actorStaffId(ctx), input);
  if (res.ok) revalidateStaff(staffId);
  return res;
}

export async function attachStaffWorkRightsDocument(
  staffId: string,
  recordId: string,
  documentId: string,
): Promise<SaveResult> {
  const ctx = await context();
  if (!ctx) throw new Error("Not authenticated");
  if (!ctx.caps.has("team")) return { ok: false, error: "You don't have access to staff records." };

  const res = await attachCheckDocument(ctx.orgId, staffId, await actorStaffId(ctx), recordId, documentId);
  if (res.ok) revalidateStaff(staffId);
  return res;
}

export async function removeStaffWorkRightsCheck(
  staffId: string,
  recordId: string,
): Promise<SaveResult> {
  const ctx = await context();
  if (!ctx) throw new Error("Not authenticated");
  if (!ctx.caps.has("team")) return { ok: false, error: "You don't have access to staff records." };

  const res = await removeCheck(ctx.orgId, staffId, recordId);
  if (res.ok) revalidateStaff(staffId);
  return res;
}

