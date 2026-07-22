import { notFound, redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { profileHtml, type PermissionsCtx } from "@/components/shell/profile";
import { ProfileBehaviors } from "@/components/shell/profile-behaviors";
import { can, getCapabilities, getOwnership } from "@/lib/permissions-server";
import {
  CAPABILITIES,
  canChangeRoleOf,
  canEditPermissionsOf,
  canSetCapability,
  resolve,
  type Capability,
} from "@/lib/permissions";
import { getStaff, permissionsOf } from "@/lib/staff/query";
import { saveStaffSection } from "@/app/actions/staff";
import type { StaffProfile } from "@/lib/staff/profile";

/* One staff member's card, as an admin sees it.

   Which sections render is decided HERE, from the viewer's capabilities, and
   the matching server action re-checks the same rules — the card never shows
   something the action would refuse, and never hides something by rendering
   it disabled when it could simply be omitted. */

export default async function StaffProfilePage({
  params,
}: {
  params: Promise<{ staff: string }>;
}) {
  if (!(await can("team"))) redirect("/dashboard");

  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const [{ staff: staffId }, caps, ownership] = await Promise.all([
    params,
    getCapabilities(),
    getOwnership(),
  ]);

  const canPay = caps.has("financials");
  // Scoped to the caller's org: an id from another org is indistinguishable
  // from one that doesn't exist, which is the point.
  const found = await getStaff(orgId, staffId, { pay: canPay, notes: true });
  if (!found) notFound();

  const { row, profile } = found;
  const isSelf = !!row.userId && row.userId === ownership.userId;

  const editable = canEditPermissionsOf(
    { role: ownership.role, userId: ownership.userId, caps },
    { role: row.orgRole, userId: row.userId }
  );
  const settable = new Set<Capability>(
    CAPABILITIES.filter((c) => canSetCapability(ownership.role, c))
  );
  const targetOverrides = row.userId ? await permissionsOf(orgId, row.userId) : null;

  const permissionsCtx: PermissionsCtx = {
    role: row.orgRole,
    caps: resolve(row.orgRole, targetOverrides),
    settable,
    canChangeRole: canChangeRoleOf(
      {
        role: ownership.role,
        userId: ownership.userId,
        primaryOwnerUserId: ownership.primaryOwnerUserId,
      },
      {
        role: row.orgRole,
        userId: row.userId ?? "",
        primaryOwnerUserId: ownership.primaryOwnerUserId,
      }
    ),
    editable,
    lockedReason: editable
      ? undefined
      : isSelf
        ? "You can't change your own access. Ask another owner."
        : row.isMaster
          ? "The owner's access can't be changed. Transfer ownership first."
          : "Only an owner, or someone granted Permissions, can change access.",
  };

  return (
    <ProfileBehaviors
      html={profileHtml(row, {
        mode: "admin",
        profile: profile as unknown as StaffProfile,
        sections: {
          // omitted entirely without `financials` — not rendered-then-hidden
          ...(canPay ? { payroll: profile } : {}),
          permissions: permissionsCtx,
          // notes are written ABOUT someone; you don't read your own
          ...(isSelf ? {} : { notes: profile as { notes?: string | null } }),
        },
      })}
      onSave={saveStaffSection.bind(null, staffId)}
    />
  );
}
