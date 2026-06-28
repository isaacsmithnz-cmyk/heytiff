import { Screen } from "@/components/shell/screen";
import { adminHtml } from "@/components/shell/screens";
import { getOrgRole, hasMinRole } from "@/lib/roles";

export default async function AdminPage() {
  const role = await getOrgRole();
  const canInvite = hasMinRole(role, "admin");
  return <Screen html={adminHtml(canInvite)} />;
}
