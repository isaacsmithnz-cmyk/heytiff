/* Minimum-identity projections — the data boundary for "you may act, but you
   may not manage".

   A capability gates a management surface and its sensitive fields, never the
   reference data someone needs to complete an action they're allowed to
   perform. Motivating case: a driver with no assigned vehicle (or one that's
   off-road) still logs fuel against a pool/borrowed vehicle, so without
   `assets_all` they must still get a picker list — enough to identify a
   vehicle and drive the odometer guardrail, and nothing else.

   These lists are the contract; the fleet queries select exactly the picker
   fields for non-managers when vehicles move to the database. (Field names
   follow the fleet-screen Vehicle type; date-ish fields become snake_case
   date columns in the migration, e.g. regoDays -> rego_expiry.) */

export const VEHICLE_PICKER_FIELDS = [
  "id",
  "name",
  "plate",
  "plateState", // an AU plate doesn't identify a vehicle without its state
  "make",
  "model",
  "year", // part of naming the vehicle: "MKT482 — Toyota Hiace ZR 2022"
  "status", // active/offroad — the picker excludes sold and flags off-road
  "odometer", // drives the can't-go-backwards guardrail in the log modal
] as const;

export const VEHICLE_SENSITIVE_FIELDS = [
  "value",
  "purchasePrice",
  "purchaseDateDays",
  "regoDays",
  "insuranceDays",
  "ctpDays",
  "serviceIntervalKm",
  "lastServiceOdo",
  "assignedTo", // who drives what is register knowledge; your own is on My vehicle
  "notes",
  /* The certificate's specs. Not money, but not the picker's business either:
     a driver fuelling a pool ute needs its plate, not its engine number. */
  "bodyType",
  "colour",
  "vin",
  "engineNumber",
  "engineCapacityCc",
  "seating",
  "tareKg",
  "gvmKg",
  "atmKg",
  "variant",
  "regoCustomerNo",
  "photoDocumentId",
  /* The invoice's fields. Money, and the register's business like the price
     they detail. */
  "purchaseSupplier",
  "purchaseInvoiceNo",
  "purchaseExGst",
  "purchaseGst",
  "purchaseOnRoad",
  "purchaseDeposit",
  "purchaseOdometer",
] as const;
