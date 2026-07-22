import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { todayInAu } from "@/lib/au-dates";
import type { OwnFleet, Register } from "@/components/fleet/assets-screen";
import {
  getOwnVehicle,
  listFleetStaff,
  listLogs,
  listVehiclePicker,
  listVehicles,
  staffProfileIdFor,
} from "./query";

/* What a fleet page loads, decided once so /dashboard/assets and
   /dashboard/my-vehicle can't disagree about it.

   `register` is undefined without `assets_all` — not empty, not filtered.
   The capability decides which QUERIES run, so the extra columns are never
   read, let alone serialised into the page. */

export type FleetPageData = { own: OwnFleet; register?: Register; today: string };

const EMPTY: FleetPageData = {
  own: { vehicle: null, pickable: [], logs: [] },
  today: todayInAu(),
};

export async function loadFleetPage(opts: { withRegister: boolean }): Promise<FleetPageData> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return EMPTY;

  const staffId = await staffProfileIdFor(orgId, userId);
  const [vehicle, pickable] = await Promise.all([
    getOwnVehicle(orgId, staffId),
    listVehiclePicker(orgId),
  ]);
  const own: OwnFleet = {
    vehicle,
    pickable,
    logs: vehicle ? await listLogs(orgId, { vehicleId: vehicle.id }) : [],
  };
  const today = todayInAu();

  if (!opts.withRegister || !(await can("assets_all"))) return { own, today };

  const [{ vehicles, aiValues }, logs, staff] = await Promise.all([
    listVehicles(orgId),
    listLogs(orgId),
    listFleetStaff(orgId),
  ]);
  return { own, register: { vehicles, logs, aiValues, staff }, today };
}
