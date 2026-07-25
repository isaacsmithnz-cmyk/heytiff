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

  // The staff record owns the name — the Auth0 session has no name claim here,
  // so trusting it showed people their own email address in the topbar.
  const viewer =
    orgId && userId
      ? await getViewerName(orgId, userId, (session.user.name as string) || email.split("@")[0] || "User")
      : { full: (session.user.name as string) || email.split("@")[0] || "User", first: "there" };
  const displayName = viewer.full;

  // Fresh from the DB, not the session-cached orgRole: a role change (or an
  // ownership transfer) must show on the next request, not the next login.
  const [ownership, caps] = await Promise.all([getOwnership(), getCapabilities()]);
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

  // The lockup under the logo: the trading name, and the business's own logo
  // when it has uploaded one. The ref rides the membership query that already
  // ran; the link is signed here because the bucket is private and a stored URL
  // would be one that stops working.
  const [orgName, logoRef] = await Promise.all([getOrgName(), getOrgLogoRef()]);

  return (
    <AppShell user={user} orgName={orgName} orgLogoUrl={await signOne(logoRef)}>
      {children}
    </AppShell>
  );
}
