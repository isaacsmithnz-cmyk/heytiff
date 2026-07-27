import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { AppShell } from "@/components/shell/app-shell";
import type { ShellUser } from "@/components/shell/sidebar";
import type { Role } from "@/lib/roles-shared";
import { getCapabilities, getOrgLogoRef, getOrgName, getOwnership } from "@/lib/permissions-server";
import { signOne } from "@/lib/documents/query";
import { getViewerName } from "@/lib/staff/query";
import { ownerLabel } from "@/lib/permissions";
import "./shell.css";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner", // overridden to "Co-owner" for owners who aren't the master
  admin: "Admin",
  staff: "Staff",
};

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");

  const email = session.user.email ?? "";
  const orgId = session.orgId as string | undefined;
  const userId = session.user.sub as string | undefined;
  const fallbackName = (session.user.name as string) || email.split("@")[0] || "User";

  /* The name read and the membership read are INDEPENDENT — one asks
     staff_profiles who this is, the other asks memberships what they may do —
     so they go out together. They used to be awaited one after the other, and
     this layout blocks the whole screen on a hard load: two serial trips to a
     database in another region is most of a second before anything renders.
     getOwnership/getCapabilities share one request-cached membership query, so
     the pair below is a single round trip, not two.

     The staff record owns the name: the Auth0 session has no name claim here,
     and trusting it showed people their own email address in the topbar. */
  const [viewer, ownership, caps] = await Promise.all([
    orgId && userId
      ? getViewerName(orgId, userId, fallbackName)
      : Promise.resolve({ full: fallbackName, first: "there" }),
    // Fresh from the DB, not the session-cached orgRole: a role change (or an
    // ownership transfer) must show on the next request, not the next login.
    getOwnership(),
    getCapabilities(),
  ]);
  const displayName = viewer.full;
  const orgRole = ownership.role ?? "";

  const user: ShellUser = {
    name: displayName,
    roleLabel: ownerLabel(ownership) ?? ROLE_LABEL[orgRole] ?? "Member",
    initials: initialsFrom(displayName || email || "U"),
    role: (orgRole as Role) || null,
    // resolved per request, so a granted capability shows its nav entry on the
    // very next navigation — no re-login
    caps: [...caps],
  };

  /* The lockup under the logo: the trading name, and the business's own logo
     when it has uploaded one. Both ride the membership query that already ran,
     so neither costs a trip; the link is signed here because the bucket is
     private and a stored URL would be one that stops working. Signing is the
     only real await left, and it is skipped entirely when there is no logo
     (signOne returns null on a null ref). */
  const [orgName, logoRef] = await Promise.all([getOrgName(), getOrgLogoRef()]);
  const orgLogoUrl = await signOne(logoRef);

  return (
    <AppShell user={user} orgName={orgName} orgLogoUrl={orgLogoUrl}>
      {children}
    </AppShell>
  );
}
