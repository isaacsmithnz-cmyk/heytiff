import { MyVehicleScreen } from "@/components/fleet/my-vehicle-screen";
import { loadFleetPage } from "@/lib/fleet/page-data";

/* Ungated on purpose: your own vehicle is intrinsic, like your own timesheet.
   `assets_all` gates the register, never this. */

export default async function MyVehiclePage() {
  const { own, today, viewerStaffId } = await loadFleetPage({ withRegister: false });
  return <MyVehicleScreen own={own} today={today} viewerStaffId={viewerStaffId} />;
}
