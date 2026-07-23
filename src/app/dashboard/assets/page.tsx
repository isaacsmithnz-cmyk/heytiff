import { redirect } from "next/navigation";
import { AssetsScreen } from "@/components/fleet/assets-screen";
import { loadFleetPage } from "@/lib/fleet/page-data";

/* Assets is the register, so it gates on `assets_all`. It was ungated until
   now only because it was also a staff member's single path to their own
   vehicle; /dashboard/my-vehicle is that path from this stage on, so someone
   without the capability is sent there rather than to a lens-shaped Assets. */

export default async function AssetsPage() {
  const { own, register, today } = await loadFleetPage({ withRegister: true });
  if (!register) redirect("/dashboard/my-vehicle");
  return <AssetsScreen own={own} register={register} today={today} />;
}
