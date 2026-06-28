import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { AppShell } from "@/components/shell/app-shell";
import type { ShellUser } from "@/components/shell/sidebar";
import "./shell.css";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
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
  const orgRole = (session.orgRole as string | undefined) ?? "";

  const user: ShellUser = {
    name: displayName,
    roleLabel: ROLE_LABEL[orgRole] ?? "Member",
    initials: initialsFrom(displayName || email || "U"),
  };

  return <AppShell user={user}>{children}</AppShell>;
}
