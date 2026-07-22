import { AssetsScreen } from "@/components/fleet/assets-screen";
import { can } from "@/lib/permissions-server";
import { demoStaff, demoVehicleLogs, demoVehicles } from "@/mock/demo";

// NOTE: reads the demo fleet from mock/demo.ts for now — empty the mock and the
// register falls back to its "No vehicles yet" state. viewerId picks which demo
// staff member the "My vehicle" lens renders as; a real session → staff link
// arrives with the backend build.

export default async function AssetsPage() {
  // `assets_all` = the whole register; without it the screen renders the
  // own-vehicle lens only (My vehicle gets its own route in Stage 4).
  const manager = await can("assets_all");
  return (
    <AssetsScreen
      manager={manager}
      staff={demoStaff}
      vehicles={demoVehicles}
      logs={demoVehicleLogs}
      viewerId="jordan-mills"
    />
  );
}
