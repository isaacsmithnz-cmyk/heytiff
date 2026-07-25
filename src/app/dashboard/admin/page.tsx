import { redirect } from "next/navigation";
import { AdminIndex } from "@/components/admin/admin-index";
import { hasMinRole } from "@/lib/roles";
import { can, getDbRole } from "@/lib/permissions-server";

/* The Admin SECTION is admin+ — "Staff: Admin section hidden entirely" per
   docs/roles-and-permissions.md. Its ITEMS gate individually: the rate
   calculator needs `financials` — owner by default and grantable to an admin —
   while organisation settings and the owner tools are owner-INTRINSIC (co-owners
   included), which is why the flag passed down is the role, not a capability.
   (Inviting is gated the same way by `invites`, but it lives on the Team page
   now; the public-holiday calendar moved into the Time & Pay settings gear.)

   Section visibility stays role-based only while the manager-visible tools it
   lists as planned — compliance, documents, licences & insurances, training —
   don't exist. When the first one lands it gets a capability, and this becomes
   "has any admin-section capability", so an owner could grant a senior staff
   member compliance access without making them an admin. */

export default async function AdminPage() {
  const role = await getDbRole();
  if (!hasMinRole(role, "admin")) redirect("/dashboard");

  const canFinancials = await can("financials");
  return <AdminIndex isOwner={hasMinRole(role, "owner")} canFinancials={canFinancials} />;
}
