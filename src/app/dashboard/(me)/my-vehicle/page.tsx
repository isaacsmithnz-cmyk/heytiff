import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { Empty } from "@/components/parts/states";
import { getOwnVehicle, staffProfileIdFor } from "@/lib/fleet/query";

/* YOUR VEHICLE: Your name › Your vehicle opens your vehicle's own page,
   the one every vehicle has (/dashboard/vehicles/<id>), titled with the
   vehicle (Isaac, 24 October 2026). Ungated: your own vehicle is
   intrinsic, like your own timesheet; `assets_all` gates the register,
   never this, and the vehicle's page lets its driver in. The menu only
   offers the row to someone with one assigned, so the empty view is for
   an old link or a vehicle since handed back. */
export default async function MyVehiclePage() {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  const staffId = orgId && userId ? await staffProfileIdFor(orgId, userId) : null;
  const own = orgId && staffId ? await getOwnVehicle(orgId, staffId) : null;
  if (own) redirect(`/dashboard/vehicles/${own.id}`);
  return (
    <div className="wrap yp">
      <h1 className="yp-h1">Your vehicle</h1>
      <Empty what="No vehicle is assigned to you" line="When one is, its page opens here." action={null} />
    </div>
  );
}
