import { serviceKmLeft, vehicleChips, vehicleFacts } from "@/components/fleet/logic";
import {
  dateFromDays,
  policyDetail,
  toIdentity,
  toLog,
  toValuation,
  toVehicle,
  vehicleRow,
  whenLabel,
} from "../map";

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

  /* Two traps, one either side of the answer. Null -> 0 days would render
     "Rego expires today" on every vehicle whose paperwork simply hasn't been
     entered. Null -> 365 (what this used to do) reads as a real date a year
     out: harmless on the chip, and a fabricated fact everywhere it is shown or
     written back. The honest answer is null, and every consumer treats it as
     silent. */
  it("an unset expiry stays unset — neither expired nor a date a year out", () => {
    const v = toVehicle(
      row({ rego_expiry: null, insurance_expiry: null, ctp_expiry: null }),
      TODAY,
    );
    expect(v.regoDays).toBeNull();
    expect(v.insuranceDays).toBeNull();
    expect(v.ctpDays).toBeNull();
    expect(vehicleChips(v, 0)).toEqual([]);
    // and it says so rather than counting down to something nobody entered
    expect(vehicleFacts(v).find((f) => f.key === "rego")).toMatchObject({
      text: "Not set",
      state: "ok",
    });
  });

  /* The write half, and the whole point of the change: an unset expiry used to
     come back out as today+365, so merely opening a vehicle's form and saving
     it stamped an invented renewal date on the column. */
  it("writes an unset expiry back as null, not as a date it made up", () => {
    const v = toVehicle(
      row({ rego_expiry: null, insurance_expiry: null, ctp_expiry: null }),
      TODAY,
    );
    const back = vehicleRow(v, TODAY);
    expect(back.rego_expiry).toBeNull();
    expect(back.insurance_expiry).toBeNull();
    expect(back.ctp_expiry).toBeNull();
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

  /* The certificate's specs. Every one nullable, and the read must keep the
     null: `num()` defaults a missing NOT NULL column to 0 because that row is
     malformed, but a spec nobody entered is ABSENT, and "0 kg" is a claim. */
  it("reads the specs the registration certificate carries, and keeps an unset one unset", () => {
    const v = toVehicle(
      row({
        body_type: "ute",
        colour: "White",
        vin: "MMAWLKL10NH035826",
        engine_number: "4N15ULB0443",
        engine_capacity_cc: 2442,
        seating: 4,
        tare_kg: 2180,
        gvm_kg: 2900,
        atm_kg: null,
        variant: "MR4W30-",
        rego_customer_no: "21970756",
        photo_document_id: null,
      }),
      TODAY,
    );
    expect(v).toMatchObject({
      bodyType: "ute",
      colour: "White",
      vin: "MMAWLKL10NH035826",
      engineNumber: "4N15ULB0443",
      engineCapacityCc: 2442,
      seating: 4,
      tareKg: 2180,
      gvmKg: 2900,
      atmKg: null,
      variant: "MR4W30-",
      regoCustomerNo: "21970756",
      photoDocumentId: null,
    });
    // a row from before the columns existed reads as nothing recorded, not as zeros
    const bare = toVehicle(row(), TODAY);
    expect(bare.vin).toBeNull();
    expect(bare.tareKg).toBeNull();
    expect(bare.bodyType).toBeNull();
    // and an unknown body type is not a body type
    expect(toVehicle(row({ body_type: "spaceship" }), TODAY).bodyType).toBeNull();
  });

  it("writes the specs back as columns, and never the photo pointer", () => {
    const v = toVehicle(row({ vin: "MMAWLKL10NH035826", gvm_kg: 2900, photo_document_id: "doc-1" }), TODAY);
    const back = vehicleRow(v, TODAY);
    expect(back.vin).toBe("MMAWLKL10NH035826");
    expect(back.gvm_kg).toBe(2900);
    expect(back.tare_kg).toBeNull();
    /* The photo is set by its own action, which adopts the document at the
       same time; a form save carrying the pointer would let a stale form
       detach a photo somebody just set. */
    expect("photo_document_id" in back).toBe(false);
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

describe("policyDetail", () => {
  it("reads what the certificate said, and leaves what it didn't print as null", () => {
    expect(
      policyDetail({
        policy_number: "36-01023321955",
        cover: null,
        excess: null,
        term_months: 12,
        garaging_postcode: "2031",
        inspection_on: null,
        source: "scan",
      }),
    ).toEqual({
      policyNumber: "36-01023321955",
      cover: null,
      excess: null,
      termMonths: 12,
      garagingPostcode: "2031",
      inspectionOn: null,
      source: "scan",
    });
  });

  it("refuses a cover or source that isn't one of ours", () => {
    const d = policyDetail({ cover: "gold", source: "guessed", excess: "800.00" });
    expect(d.cover).toBeNull();
    expect(d.source).toBeNull();
    expect(d.excess).toBe(800); // numeric arrives as a string from postgres
  });

  it("reads a row from before the columns existed as all-null, not as an error", () => {
    expect(policyDetail({})).toEqual({
      policyNumber: null,
      cover: null,
      excess: null,
      termMonths: null,
      garagingPostcode: null,
      inspectionOn: null,
      source: null,
    });
  });
});
