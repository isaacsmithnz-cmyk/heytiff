import { MeScreen } from "@/components/me/me-screen";
import { loadMe } from "@/lib/me/page-data";

/* Ungated on purpose: your own vehicle is intrinsic, like your own timesheet.
   `assets_all` gates the register, never this. */
export default async function MyVehiclePage() {
  return <MeScreen initialTab="vehicle" data={await loadMe()} />;
}
