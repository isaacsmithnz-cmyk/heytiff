import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { AppShell } from "@/components/shell/app-shell";
import type { ShellUser } from "@/components/shell/sidebar";
import type { Role } from "@/lib/roles-shared";
import { getCapabilities, getOrgName, getOwnership } from "@/lib/permissions-server";
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
  const displayName =
    (session.user.name as string | undefined) ?? email.split("@")[0] ?? "User";

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

  return (
    <AppShell user={user} orgName={await getOrgName()}>
      {children}
    </AppShell>
  );
}
