import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { todayInAu } from "@/lib/au-dates";
import { orgExpiryWindow } from "@/lib/org/query";
import { documentsForVehicles, type StoredDocument } from "@/lib/documents/query";
import type {
  AiValuation,
  FleetStaff,
  Vehicle,
  VehicleFinance,
  VehicleIdentity,
  VehicleLog,
  VehiclePolicy,
  VehicleWithFacts,
} from "@/components/fleet/logic";
import {
  getOwnVehicle,
  listFinance,
  listFleetStaff,
  listLogs,
  listPolicies,
  listVehiclePicker,
  listVehicles,
  staffProfileIdFor,
} from "./query";

/* WHAT A VEHICLE'S PAGE LOADS, decided on the server, the way the vehicle
   card's is (page-data.ts), so the page can't be sent more than the card.

   Two lenses, and they are two payloads rather than one payload filtered:

   - the REGISTER: whoever holds `assets_all` sees any vehicle in their org
     at the register's width, with its logs, paper, renewals, finance,
     Tiff's value and the roster to assign it to. This is what today's card
     opens on.
   - the DRIVER: someone without `assets_all` sees the vehicle assigned to
     them, at own-vehicle width, as /dashboard/my-vehicle sends it today: no
     money, no assignment, no paper, and the pool's identities so a fill on
     a borrowed ute can still be logged.

   Anything else is null, which the route turns into a 404: a vehicle in
   another org, a pool vehicle the driver isn't assigned, an id that isn't
   a vehicle at all. The id is matched inside the caller's org and nowhere
   else. */

export type RegisterVehiclePage = {
  lens: "register";
  vehicle: Vehicle;
  logs: VehicleLog[];
  documents: StoredDocument[];
  policies: VehiclePolicy[];
  finance: VehicleFinance[];
  valuation: AiValuation | null;
  staff: FleetStaff[];
  today: string;
  warnDays: number;
  viewerStaffId: string | null;
};

export type DriverVehiclePage = {
  lens: "driver";
  vehicle: VehicleWithFacts;
  logs: VehicleLog[];
  /** every vehicle the driver may log fuel against: theirs and the pool */
  pickable: VehicleIdentity[];
  today: string;
  warnDays: number;
  viewerStaffId: string | null;
};

export type VehiclePageData = RegisterVehiclePage | DriverVehiclePage;

/** "signed-out" when there is no session or workspace; null for a vehicle
    this viewer may not open. */
export async function loadVehiclePage(id: string): Promise<VehiclePageData | null | "signed-out"> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return "signed-out";

  const want = id.trim();
  if (!want) return null;
  const [staffId, register, { warnDays }] = await Promise.all([
    staffProfileIdFor(orgId, userId),
    can("assets_all"),
    orgExpiryWindow(orgId),
  ]);
  const today = todayInAu();

  if (register) {
    const { vehicles, aiValues } = await listVehicles(orgId);
    const vehicle = vehicles.find((v) => v.id === want);
    if (!vehicle) return null;
    const [logs, staff, policies, finance] = await Promise.all([
      listLogs(orgId, { vehicleId: vehicle.id }),
      listFleetStaff(orgId),
      listPolicies(orgId),
      listFinance(orgId),
    ]);
    const documents = await documentsForVehicles(orgId, [vehicle.id], new Map(logs.map((l) => [l.id, l.vehicleId])));
    return {
      lens: "register",
      vehicle,
      logs,
      documents: documents.get(vehicle.id) ?? [],
      policies: policies[vehicle.id] ?? [],
      finance: finance[vehicle.id] ?? [],
      valuation: aiValues[vehicle.id] ?? null,
      staff,
      today,
      warnDays,
      viewerStaffId: staffId,
    };
  }

  /* the driver's own, and only theirs */
  const own = await getOwnVehicle(orgId, staffId);
  if (!own || own.id !== want) return null;
  const [logs, pickable] = await Promise.all([listLogs(orgId, { vehicleId: own.id }), listVehiclePicker(orgId)]);
  return { lens: "driver", vehicle: own, logs, pickable, today, warnDays, viewerStaffId: staffId };
}
