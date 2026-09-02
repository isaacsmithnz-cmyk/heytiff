import { serviceKmLeft, vehicleChips } from "@/components/fleet/logic";
import { dateFromDays, toIdentity, toLog, toValuation, toVehicle, vehicleRow, whenLabel } from "../map";

const TODAY = "2026-07-22";

const row = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  name: "VRF-04",
  plate: "MKT482",
  plate_state: "VIC",
  make: "Toyota",
  model: "Hiace ZR",
  year: 2022,
  status: "active",
  odometer: 84120,
  assigned_to: "22222222-2222-2222-2222-222222222222",
  value: "52000.00",
  purchase_price: "58900.00",
  purchase_date: "2022-05-19",
  rego_expiry: "2026-09-30",
  insurance_expiry: "2026-08-01",
  ctp_expiry: "2026-10-15",
  service_interval_km: 10000,
  last_service_odo: 80000,
  notes: "Pool ute",
  ...over,
});

describe("dates in, day-counts out", () => {
  it("derives day-counts from real expiry dates", () => {
    const v = toVehicle(row(), TODAY);
    expect(v.regoDays).toBe(70);
    expect(v.insuranceDays).toBe(10);
    expect(v.ctpDays).toBe(85);
    expect(v.purchaseDateDays).toBe(1525); // days SINCE purchase, never negative
  });

  it("an unset expiry reads as 'not soon', never as expired", () => {
    // the trap: null -> 0 days would render "Rego expires today" on every
    // vehicle whose paperwork simply hasn't been entered yet
    const v = toVehicle(
      row({ rego_expiry: null, insurance_expiry: null, ctp_expiry: null }),
      TODAY,
    );
    expect(v.regoDays).toBe(365);
    expect(v.insuranceDays).toBe(365);
    expect(v.ctpDays).toBe(365);
    expect(vehicleChips(v, 0)).toEqual([]);
  });

  it("a past expiry goes negative so the chip reads as expired", () => {
    const v = toVehicle(row({ rego_expiry: "2026-07-01" }), TODAY);
    expect(v.regoDays).toBe(-21);
    expect(vehicleChips(v, 0)).toContainEqual({ label: "Rego expired 3 weeks ago", state: "bad" });
  });

  it("chips land exactly on the 30-day warning boundary", () => {
    const at30 = toVehicle(row({ rego_expiry: dateFromDays(30, TODAY) }), TODAY);
    const at31 = toVehicle(row({ rego_expiry: dateFromDays(31, TODAY) }), TODAY);
    expect(vehicleChips(at30, 0)).toContainEqual({ label: "Rego expires in 4 weeks", state: "warn" });
    expect(vehicleChips(at31, 0).some((c) => c.label.startsWith("Rego"))).toBe(false);
  });

  it("numerics arrive from postgres as strings and still add up", () => {
    const v = toVehicle(row(), TODAY);
    expect(v.value).toBe(52000);
    expect(v.purchasePrice).toBe(58900);
    expect(serviceKmLeft(v)).toBe(5880);
  });

  it("round-trips a vehicle back to dates against the same anchor", () => {
    const v = toVehicle(row(), TODAY);
    const back = vehicleRow(v, TODAY);
    expect(back.rego_expiry).toBe("2026-09-30");
    expect(back.insurance_expiry).toBe("2026-08-01");
    expect(back.ctp_expiry).toBe("2026-10-15");
    expect(back.purchase_date).toBe("2022-05-19");
    expect(back.plate_state).toBe("VIC");
  });
});

describe("logs", () => {
  it("turns a logged_on date into an 'ago' count and a display label", () => {
    const l = toLog(
      { id: "l1", vehicle_id: "v1", staff_profile_id: "s1", kind: "fuel", logged_on: "2026-07-15", litres: "62.40", cost: "158.40", odo: 84120 },
      TODAY,
      () => "Jordan Mills",
    );
    expect(l.ago).toBe(7);
    expect(l.when).toBe(whenLabel("2026-07-15"));
    expect(l.litres).toBe(62.4);
    expect(l.staffName).toBe("Jordan Mills");
  });

  it("leaves optional columns undefined rather than zero", () => {
    // 0 litres would render as a real fill; undefined renders as nothing
    const l = toLog({ id: "l2", vehicle_id: "v1", kind: "issue", logged_on: TODAY, litres: null, cost: null, odo: null, status: "open" }, TODAY);
    expect(l.litres).toBeUndefined();
    expect(l.cost).toBeUndefined();
    expect(l.odo).toBeUndefined();
    expect(l.staffId).toBeNull();
    expect(l.status).toBe("open");
  });
});

describe("valuations", () => {
  it("reads a cached valuation and ignores junk", () => {
    expect(toValuation(row({ ai_value: { point: 47000, low: 44000, high: 50000, note: "n", atOdo: 84120 } }))?.point).toBe(47000);
    expect(toValuation(row({ ai_value: null }))).toBeNull();
    expect(toValuation(row({ ai_value: { note: "no numbers" } }))).toBeNull();
  });
});

describe("identity width", () => {
  it("carries nothing beyond the picker fields, even from a full row", () => {
    // toIdentity is handed a FULL row here on purpose: even if a wider query
    // ever feeds it, the mapped object must not grow sensitive keys
    expect(Object.keys(toIdentity(row())).sort()).toEqual(
      ["id", "make", "model", "name", "odometer", "plate", "plateState", "status", "year"].sort(),
    );
  });
});
