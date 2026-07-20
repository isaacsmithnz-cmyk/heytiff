/* Pure role helpers — no server imports, safe in client components.
   `roles.ts` re-exports these for server code; role READS live in
   "@/lib/permissions-server" (can / getDbRole), which query the DB fresh. */

export type Role = "owner" | "admin" | "staff";

const hierarchy: Record<Role, number> = { owner: 3, admin: 2, staff: 1 };

export function hasMinRole(userRole: Role | null, min: Role): boolean {
  if (!userRole) return false;
  return hierarchy[userRole] >= hierarchy[min];
}
