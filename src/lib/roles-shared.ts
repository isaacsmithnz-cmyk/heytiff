/* Pure role helpers — no server imports, safe in client components.
   `roles.ts` re-exports these for server code; role READS live in
   "@/lib/permissions-server" (can / getDbRole), which query the DB fresh. */

export type Role = "owner" | "admin" | "staff";

const hierarchy: Record<Role, number> = { owner: 3, admin: 2, staff: 1 };

export function hasMinRole(userRole: Role | null, min: Role): boolean {
  if (!userRole) return false;
  return hierarchy[userRole] >= hierarchy[min];
}

/* WHAT EACH ROLE MEANS, in one line, in one place.

   These sentences were written for the staff card's Access panel and lived
   inside that component, so the invite modal — the screen where the choice is
   actually MADE, by someone who may never have opened a staff card — offered
   the two bare words "Admin" and "Staff" and left the reader to guess. The
   guess is a permission grant, and it lands on somebody's account.

   Ordered least-privileged first, which is the order both screens list them
   in and the order the modal's default depends on. */
export const ROLE_COPY: Record<Role, { label: string; blurb: string }> = {
  staff: { label: "Staff", blurb: "Field worker — own data only" },
  admin: { label: "Admin", blurb: "Manage the team — approve & assign" },
  owner: { label: "Owner", blurb: "Full access incl. pay & financials" },
};

export const ROLE_ORDER: Role[] = ["staff", "admin", "owner"];
