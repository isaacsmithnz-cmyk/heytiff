import {
  RECEIPT_STATIONS,
  type Vehicle,
  type VehicleLog,
  daysUntil,
  displayName,
  filterVehicles,
  fleetAiValue,
  fleetValue,
  fmtCost,
  fmtKm,
  fmtMoney,
  fuelEconomy,
  modelLabel,
  odoEffect,
  odoRejection,
  parseValuations,
  readReceiptOffline,
  serviceDueKm,
  serviceKmLeft,
  sortVehicles,
  valuationStale,
  vehicleChips,
  vehicleFacts,
  worstState,
} from "../logic";

const vehicle = (over: Partial<Vehicle> = {}): Vehicle => ({
  id: "vrf-04",
  name: "VRF-04",
  make: "Toyota",
  model: "Hiace ZR",
  year: 2022,
  plate: "MKT482",
  plateState: "VIC",
  status: "active",
  odometer: 84120,
  assignedTo: "jordan-mills",
  value: 52000,
  purchasePrice: 58900,
  purchaseDateDays: 1524,
  lastServiceDays: null,
  regoDays: 200,
  insuranceDays: 200,
  serviceIntervalKm: 10000,
  lastServiceOdo: 80000,
  serviceIntervalMonths: null,
  serviceDays: null,
  motorised: true,
  ...over,
});

const log = (over: Partial<VehicleLog> = {}): VehicleLog => ({
  id: "vl-x",
  vehicleId: "vrf-04",
  staffId: "jordan-mills",
  kind: "issue",
  when: "Wed 15 Jul",
  ago: 2,
  status: "open",
  ...over,
});

describe("identity & service cycle", () => {
  it("displayName falls back to the rego plate when no name is set", () => {
    expect(displayName(vehicle())).toBe("VRF-04");
    expect(displayName(vehicle({ name: "" }))).toBe("MKT482");
    expect(modelLabel(vehicle({ year: 0 }))).toBe("Toyota Hiace ZR");
  });

  it("derives the next service from last-service odo + interval", () => {
    const v = vehicle({ lastServiceOdo: 75500, serviceIntervalKm: 10000, odometer: 84120 });
    expect(serviceDueKm(v)).toBe(85500);
    expect(serviceKmLeft(v)).toBe(1380);
  });
});

describe("vehicleChips", () => {
  it("is empty when everything is healthy, and always empty for sold vehicles", () => {
    expect(vehicleChips(vehicle(), 0)).toEqual([]);
    expect(vehicleChips(vehicle({ status: "sold", regoDays: -30 }), 3)).toEqual([]);
  });

  it("warns inside expiry windows, flags expiries and off-road as bad", () => {
    expect(vehicleChips(vehicle({ regoDays: 21 }), 0)).toEqual([{ label: "Rego expires in 3 weeks", state: "warn" }]);
    expect(vehicleChips(vehicle({ regoDays: -3 }), 0)).toEqual([
      { label: "Rego expired 3 days ago", state: "bad" },
    ]);
    const off = vehicleChips(vehicle({ status: "offroad" }), 0);
    expect(off).toEqual([{ label: "Off road", state: "bad" }]);
  });

  it("derives service state from the cycle and sorts bad first", () => {
    expect(vehicleChips(vehicle({ odometer: 85000, lastServiceOdo: 75500 }), 0)).toEqual([
      { label: "Service in 500 km", state: "warn" },
    ]);
    const chips = vehicleChips(vehicle({ odometer: 86300, lastServiceOdo: 75500, regoDays: 10 }), 2);
    expect(chips[0]).toEqual({ label: "Service overdue 800 km", state: "bad" });
    expect(chips.map((c) => c.label)).toContain("2 issues open");
    expect(worstState(chips)).toBe("bad");
  });
});

describe("vehicleFacts", () => {
  it("returns the four shared facts with severity states", () => {
    const facts = vehicleFacts(vehicle({ regoDays: 21, insuranceDays: -1 }));
    expect(facts.map((f) => f.key)).toEqual(["odo", "service", "rego", "insurance"]);
    expect(facts.find((f) => f.key === "rego")).toMatchObject({ state: "warn", text: "renews in 3 weeks" });
    expect(facts.find((f) => f.key === "insurance")).toMatchObject({ state: "bad", text: "expired" });
  });
});

describe("Tiff valuations", () => {
  const fleet = [vehicle(), vehicle({ id: "ute-01", name: "UTE-01", odometer: 158300 })];

  it("parses valid model output, clamps and rounds, stamps atOdo", () => {
    const parsed = parseValuations(
      {
        valuations: [
          { id: "vrf-04", low: 47120, high: 41980, point: 60000, note: "Hiaces hold value" },
          { id: "ute-01", low: 22000, high: 27000, point: 24850, note: "High kms" },
        ],
      },
      fleet,
    );
    // low/high were swapped and point clamped into the ordered range
    expect(parsed["vrf-04"]).toEqual({
      low: 42000,
      high: 47100,
      point: 47100,
      note: "Hiaces hold value",
      atOdo: 84120,
    });
    expect(parsed["ute-01"].point).toBe(24900);
    expect(parsed["ute-01"].atOdo).toBe(158300);
  });

  it("drops unknown ids and junk entries", () => {
    const parsed = parseValuations(
      {
        valuations: [
          { id: "not-a-vehicle", low: 1, high: 2, point: 1 },
          { id: "vrf-04", low: NaN, high: 2, point: 1 },
          "garbage",
          null,
        ],
      },
      fleet,
    );
    expect(parsed).toEqual({});
    expect(parseValuations(null, fleet)).toEqual({});
    expect(parseValuations({ valuations: "nope" }, fleet)).toEqual({});
  });

  it("staleness triggers once the odometer moves well past the valuation", () => {
    const val = { point: 45000, low: 42000, high: 48000, note: "", atOdo: 84120 };
    expect(valuationStale(vehicle(), val)).toBe(false);
    expect(valuationStale(vehicle({ odometer: 86000 }), val)).toBe(false); // within 2,000 km
    expect(valuationStale(vehicle({ odometer: 86200 }), val)).toBe(true);
    expect(valuationStale(vehicle(), undefined)).toBe(false);
  });
});

describe("readReceiptOffline (demo fallback)", () => {
  it("is deterministic per file size with plausible AU numbers", () => {
    const a = readReceiptOffline(123456);
    expect(readReceiptOffline(123456)).toEqual(a);
    expect(a.litres).toBeGreaterThanOrEqual(45);
    expect(a.litres).toBeLessThan(75);
    expect(a.cost).toBeGreaterThan(a.litres * 1.7);
    expect(a.cost).toBeLessThan(a.litres * 2.2);
    expect(Math.round(a.cost * 100)).toBe(a.cost * 100); // cents precision
    expect(RECEIPT_STATIONS).toContain(a.station);
  });
});

describe("odometer guardrail", () => {
  it("rejects a reading below the current one and accepts one at or above", () => {
    expect(odoRejection(84120, 84119)).toMatch(/84,120 km/);
    expect(odoRejection(84120, -1)).toMatch(/negative/);
    expect(odoRejection(84120, 84120)).toBeNull();
    expect(odoRejection(84120, 90000)).toBeNull();
    expect(odoRejection(84120, undefined)).toBeNull(); // issues carry no reading
  });

  it("rolls the odometer forward only when a log carries a higher reading", () => {
    const v = { odometer: 84120, lastServiceOdo: 80000 };
    expect(odoEffect(v, { kind: "fuel", odo: 84800 })).toEqual({ odometer: 84800 });
    expect(odoEffect(v, { kind: "fuel", odo: 84120 })).toBeNull();
    expect(odoEffect(v, { kind: "issue" })).toBeNull();
  });

  it("a completed service resets the cycle from its own reading", () => {
    const v = { odometer: 84120, lastServiceOdo: 80000 };
    expect(odoEffect(v, { kind: "service", odo: 84000 })).toEqual({
      // the service happened at 84,000 but the clock stays at its high-water mark
      odometer: 84120,
      lastServiceOdo: 84000,
    });
    expect(odoEffect(v, { kind: "service", odo: 90000 })).toEqual({
      odometer: 90000,
      lastServiceOdo: 90000,
    });
  });
});

describe("fuel economy", () => {
  it("computes L/100km between consecutive fills and skips bad data", () => {
    const logs = [
      log({ id: "f3", kind: "fuel", ago: 1, litres: 62.4, odo: 84120, status: undefined }),
      log({ id: "f2", kind: "fuel", ago: 10, litres: 58.1, odo: 83540, status: undefined }),
      log({ id: "f1", kind: "fuel", ago: 20, litres: 60, odo: 83000, status: undefined }),
      log({ id: "bad", kind: "fuel", ago: 30, litres: 55, odo: undefined, status: undefined }),
    ];
    const eco = fuelEconomy(logs);
    expect(eco["f2"]).toBeCloseTo(10.8, 1); // 58.1L over 540km
    expect(eco["f3"]).toBeCloseTo(10.8, 1); // 62.4L over 580km
    expect(eco["f1"]).toBeUndefined(); // nothing before it
    expect(eco["bad"]).toBeUndefined();
  });
});

describe("register filters & sorting", () => {
  const fleet = [
    vehicle(), // healthy, assigned
    vehicle({ id: "srv-05", name: "SRV-05", plate: "KWD073", assignedTo: null, regoDays: 7, value: 27000 }),
    vehicle({ id: "ute-01", name: "UTE-01", assignedTo: null, status: "offroad", value: 31500 }),
    vehicle({ id: "van-01", name: "VAN-01", assignedTo: null, status: "sold", value: 14000 }),
  ];
  const names = (id: string | null) => (id === "jordan-mills" ? "Jordan Mills" : "");

  it("tabs: sold is its own bucket and excluded everywhere else", () => {
    expect(filterVehicles(fleet, [], "all", "", names).map((v) => v.id)).toEqual([
      "vrf-04",
      "srv-05",
      "ute-01",
    ]);
    expect(filterVehicles(fleet, [], "attention", "", names).map((v) => v.id)).toEqual([
      "srv-05",
      "ute-01",
    ]);
    expect(filterVehicles(fleet, [], "pool", "", names).map((v) => v.id)).toEqual(["srv-05", "ute-01"]);
    expect(filterVehicles(fleet, [], "sold", "", names).map((v) => v.id)).toEqual(["van-01"]);
  });

  it("search matches name, plate and driver", () => {
    expect(filterVehicles(fleet, [], "all", "kwd", names).map((v) => v.id)).toEqual(["srv-05"]);
    expect(filterVehicles(fleet, [], "all", "jordan", names).map((v) => v.id)).toEqual(["vrf-04"]);
  });

  it("sorts attention-first (off-road = bad) and totals exclude sold", () => {
    expect(sortVehicles(fleet.slice(0, 3), [], "attention").map((v) => v.name)).toEqual([
      "UTE-01",
      "SRV-05",
      "VRF-04",
    ]);
    expect(fleetValue(fleet)).toBe(52000 + 27000 + 31500);
    const aiValues = {
      "vrf-04": { point: 45000, low: 42000, high: 48000, note: "", atOdo: 84120 },
      "van-01": { point: 12000, low: 11000, high: 13000, note: "", atOdo: 248900 }, // sold — ignored
    };
    expect(fleetAiValue(fleet, aiValues)).toBe(45000);
    expect(fleetAiValue(fleet, {})).toBeNull();
  });
});

describe("helpers", () => {
  it("formats km, money and cents in en-AU", () => {
    expect(fmtKm(84120)).toBe("84,120");
    expect(fmtMoney(52000)).toBe("$52,000");
    expect(fmtCost(158.4)).toBe("$158.40");
  });

  it("computes whole days between ISO dates", () => {
    expect(daysUntil("2026-08-07", "2026-07-17")).toBe(21);
    expect(daysUntil("2026-07-14", "2026-07-17")).toBe(-3);
  });
});
