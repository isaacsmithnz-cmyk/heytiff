import type { AiValuation, FleetStaff, Vehicle, VehicleFinance, VehicleIdentity, VehiclePolicy, VehicleLog, VehicleWithFacts } from "./logic";
import type { StoredDocument } from "@/lib/documents/query";

/* What the fleet's pages are handed (they lived on the retired Assets screen,
   which Team's Vehicles view and a vehicle's own page replaced). Role rules
   (docs/roles-and-permissions.md): `assets_all` gets the whole register,
   valuations included; everyone else only their own vehicle. The two take
   DIFFERENT shapes, not the same one filtered: `register` is absent from a
   staff member's payload, so there is nothing for a render bug to leak. */

export type OwnFleet = {
  vehicle: VehicleWithFacts | null;
  pickable: VehicleIdentity[];
  logs: VehicleLog[];
};

export type Register = {
  vehicles: Vehicle[];
  logs: VehicleLog[];
  aiValues: Record<string, AiValuation>;
  staff: FleetStaff[];
  /** The paper trail, per vehicle: its own documents plus its logs' dockets. */
  documents: Record<string, StoredDocument[]>;
  /** Renewals on file, per vehicle, newest first. */
  policies: Record<string, VehiclePolicy[]>;
  /** Finance agreements on file, per vehicle, newest first. */
  finance: Record<string, VehicleFinance[]>;
};
