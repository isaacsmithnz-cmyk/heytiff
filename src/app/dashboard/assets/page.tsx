import { AssetsScreen } from "@/components/fleet/assets-screen";
import { getOrgRole, hasMinRole } from "@/lib/roles";
import { demoStaff, demoVehicleLogs, demoVehicles } from "@/mock/demo";

// NOTE: reads the demo fleet from mock/demo.ts for now — empty the mock and the
// register falls back to its "No vehicles yet" state. viewerId picks which demo
// staff member the "My vehicle" lens renders as; a real session → staff link
// arrives with the backend build.

export default async function AssetsPage() {
  const role = await getOrgRole();
  return (
    <AssetsScreen
      manager={hasMinRole(role, "admin")}
      staff={demoStaff}
      vehicles={demoVehicles}
      logs={demoVehicleLogs}
      viewerId="jordan-mills"
    />
  );
}
