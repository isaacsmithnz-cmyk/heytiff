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
import { buildLicenceRow, type LicenceInput } from "@/lib/staff/licence";
import type { Role } from "@/lib/roles-shared";

/* Editing SOMEONE ELSE'S card, from Team.

   Everything the UI decided is re-decided here. A Server Function is reachable
   by direct POST, so "the button wasn't rendered" is not a control — the
   section must map to a capability the caller actually holds, and the
   permissions path re-runs the same ownership guards the card rendered with. */

export type SaveResult = { ok: true } | { ok: false; error: string };

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
    return { ok: false, error: "The cost split has to add up to 100%." };
  }
  if (invalid.length) {
    return {
      ok: false,
      error: invalid.some((k) => k.includes("date") || k === "birthday")
        ? "Check the date format — use dd/mm/yyyy."
        : "Check the numbers — they should be plain figures.",
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

  revalidatePath(`/dashboard/team/${staffId}`);
  revalidatePath("/dashboard/team");
  return { ok: true };
}

/* Someone else's licences — the Compliance card in Team. Managing another
   person's record is the `team` capability (same as their identity + the
   qualifications text), and every write is scoped to the org AND that person,
   resolved server-side, so a forged post can't reach a third party's licences. */

export async function addStaffLicence(staffId: string, input: LicenceInput): Promise<SaveResult> {
  const ctx = await context();
  if (!ctx) throw new Error("Not authenticated");
  if (!ctx.caps.has("team")) return { ok: false, error: "You don't have access to staff records." };
  if (!(await targetIn(ctx, staffId))) return { ok: false, error: "That staff member doesn't exist." };

  const built = buildLicenceRow(input);
  if ("error" in built) return { ok: false, error: built.error };

  const { error } = await supabaseAdmin
    .from("staff_licences")
    .insert({ org_id: ctx.orgId, staff_profile_id: staffId, ...built.row });
  if (error) return { ok: false, error: "Couldn't add that licence." };

  revalidatePath(`/dashboard/team/${staffId}`);
  revalidatePath("/dashboard/team");
  return { ok: true };
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
