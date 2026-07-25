import { redirect } from "next/navigation";
import { Screen } from "@/components/shell/screen";
import { adminHtml } from "@/components/shell/screens";
import { hasMinRole } from "@/lib/roles";
import { can, getDbRole } from "@/lib/permissions-server";

/* The Admin SECTION is admin+ — "Staff: Admin section hidden entirely" per
   docs/roles-and-permissions.md. Its ITEMS gate individually: the rate
   calculator needs `financials` — owner by default and grantable to an admin.
   (Inviting is gated the same way by `invites`, but it lives on the Team page
   now, not here.) Admins also get the section's manager-visible tools —
   compliance, documents, licences & insurances, training — once those are
   built.

   Section visibility stays role-based only while none of those manager tools
   exist. When the first one lands it gets a capability, and this becomes
   "has any admin-section capability", so an owner could grant a senior staff
   member compliance access without making them an admin. */

export default async function AdminPage() {
  const role = await getDbRole();
  if (!hasMinRole(role, "admin")) redirect("/dashboard");

  const canFinancials = await can("financials");
  return (
    <Screen
      html={adminHtml({
        canFinancials,
        // org settings are owner-intrinsic (co-owners included), not a capability
        canOrgSettings: hasMinRole(role, "owner"),
        // the holiday calendar is a manager tool — admin+, like the section
        canHolidays: hasMinRole(role, "admin"),
      })}
    />
  );
}
