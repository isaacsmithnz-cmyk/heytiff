import { auth0 } from "./auth0";

export type Role = "owner" | "admin" | "staff";

const hierarchy: Record<Role, number> = { owner: 3, admin: 2, staff: 1 };

export async function getOrgRole(): Promise<Role | null> {
  const session = await auth0.getSession();
  return (session?.orgRole as Role) ?? null;
}

export function hasMinRole(userRole: Role | null, min: Role): boolean {
  if (!userRole) return false;
  return hierarchy[userRole] >= hierarchy[min];
}
