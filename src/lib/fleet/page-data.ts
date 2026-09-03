import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { todayInAu } from "@/lib/au-dates";
import type { OwnFleet, Register } from "@/components/fleet/assets-screen";
import { documentsForVehicles } from "@/lib/documents/query";
import {
  getOwnVehicle,
  listFinance,
  listFleetStaff,
  listLogs,
  listVehiclePicker,
  listPolicies,
  listVehicles,
  staffProfileIdFor,
} from "./query";

/* What a fleet page loads, decided once so /dashboard/assets and
   /dashboard/my-vehicle can't disagree about it.

   `register` is undefined without `assets_all` — not empty, not filtered.
   The capability decides which QUERIES run, so the extra columns are never
   read, let alone serialised into the page. */

export type FleetPageData = {
  own: OwnFleet;
  register?: Register;
  today: string;
  /* Who is looking. Correcting your OWN entry needs no capability, so the
     screens have to be able to tell which rows are yours — and the answer is
     the server's staff-profile id, not anything the browser could assert.
     It is only ever compared, never displayed. */
  viewerStaffId: string | null;
};

const EMPTY: FleetPageData = {
  own: { vehicle: null, pickable: [], logs: [] },
  today: todayInAu(),
  viewerStaffId: null,
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

  if (!opts.withRegister || !(await can("assets_all")))
    return { own, today, viewerStaffId: staffId };

  const [{ vehicles, aiValues }, logs, staff, policies, finance] = await Promise.all([
    listVehicles(orgId),
    listLogs(orgId),
    listFleetStaff(orgId),
    listPolicies(orgId),
    listFinance(orgId),
  ]);
  /* The paper trail rides the register payload the way logs do: it is the
     same capability, and the detail modal should not have to fetch to show
     what the vehicle already owns. Dockets hang off logs, so the log→vehicle
     map is how they find their vehicle. */
  const documents = await documentsForVehicles(
    orgId,
    vehicles.map((v) => v.id),
    new Map(logs.map((l) => [l.id, l.vehicleId])),
  );
  return {
    own,
    register: { vehicles, logs, aiValues, staff, policies, finance, documents: Object.fromEntries(documents) },
    today,
    viewerStaffId: staffId,
  };
}
