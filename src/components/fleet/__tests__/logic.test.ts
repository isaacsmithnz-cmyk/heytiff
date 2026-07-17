import {
  EMPTY_OVERLAY,
  type FleetOverlay,
  type Vehicle,
  type VehicleLog,
  daysUntil,
  filterVehicles,
  fleetValue,
  fmtKm,
  fmtMoney,
  mergeFleet,
  mergeLogs,
  openIssueCount,
  slugId,
  sortVehicles,
  vehicleChips,
  worstState,
} from "../logic";

const vehicle = (over: Partial<Vehicle> = {}): Vehicle => ({
  id: "vrf-04",
  callsign: "VRF-04",
  make: "Toyota",
  model: "Hiace ZR",
  year: 2022,
  plate: "MKT482",
  odometer: 84120,
  assignedTo: "jordan-mills",
  value: 52000,
  regoDays: 200,
  insuranceDays: 200,
  serviceDueKm: 95000,
  ...over,
});

const issue = (over: Partial<VehicleLog> = {}): VehicleLog => ({
  id: "vl-x",
  vehicleId: "vrf-04",
  staffId: "jordan-mills",
  kind: "issue",
  when: "Wed 15 Jul",
  ago: 2,
  status: "open",
  ...over,
});

describe("vehicleChips", () => {
  it("is empty when everything is healthy", () => {
    expect(vehicleChips(vehicle(), 0)).toEqual([]);
  });

  it("warns inside the rego/insurance windows and flags expiries as bad", () => {
    expect(vehicleChips(vehicle({ regoDays: 21 }), 0)).toEqual([{ label: "Rego 21d", state: "warn" }]);
    expect(vehicleChips(vehicle({ regoDays: -3 }), 0)).toEqual([
      { label: "Rego expired 3d ago", state: "bad" },
    ]);
    expect(vehicleChips(vehicle({ insuranceDays: 30 }), 0)).toEqual([
      { label: "Insurance 30d", state: "warn" },
    ]);
  });

  it("derives service state from km remaining", () => {
    expect(vehicleChips(vehicle({ odometer: 94100, serviceDueKm: 95000 }), 0)).toEqual([
      { label: "Service in 900 km", state: "warn" },
    ]);
    expect(vehicleChips(vehicle({ odometer: 95800, serviceDueKm: 95000 }), 0)).toEqual([
      { label: "Service overdue 800 km", state: "bad" },
    ]);
  });

  it("counts open issues and sorts bad chips first", () => {
    const chips = vehicleChips(vehicle({ regoDays: 10, odometer: 96000, serviceDueKm: 95000 }), 2);
    expect(chips[0].state).toBe("bad");
    expect(chips.map((c) => c.label)).toContain("2 issues open");
    expect(worstState(chips)).toBe("bad");
  });
});

describe("overlay merge", () => {
  const demo = [vehicle(), vehicle({ id: "ute-01", callsign: "UTE-01", assignedTo: null, value: 31500 })];

  it("passes demo data through untouched with an empty overlay", () => {
    expect(mergeFleet(demo, EMPTY_OVERLAY)).toEqual(demo);
  });

  it("applies edits, removals and additions", () => {
    const o: FleetOverlay = {
      ...EMPTY_OVERLAY,
      edited: { "vrf-04": vehicle({ odometer: 84800 }) },
      removed: ["ute-01"],
      added: [vehicle({ id: "van-09", callsign: "VAN-09" })],
    };
    const merged = mergeFleet(demo, o);
    expect(merged.map((v) => v.id)).toEqual(["vrf-04", "van-09"]);
    expect(merged[0].odometer).toBe(84800);
  });

  it("marks demo issues resolved and floats prototype logs to the top", () => {
    const demoLogs = [issue({ id: "vl-01", ago: 2 }), issue({ id: "vl-02", ago: 9 })];
    const o: FleetOverlay = {
      ...EMPTY_OVERLAY,
      resolved: ["vl-01"],
      logs: [issue({ id: "new-1", ago: 0 })],
    };
    const merged = mergeLogs(demoLogs, o);
    expect(merged.map((l) => l.id)).toEqual(["new-1", "vl-01", "vl-02"]);
    expect(merged[1].status).toBe("resolved");
    expect(openIssueCount(merged, "vrf-04")).toBe(2); // new-1 + vl-02 still open
  });
});

describe("register filters & sorting", () => {
  const fleet = [
    vehicle(), // healthy, assigned
    vehicle({ id: "srv-05", callsign: "SRV-05", plate: "KWD073", assignedTo: null, regoDays: 7, value: 27000 }),
    vehicle({ id: "ute-01", callsign: "UTE-01", assignedTo: null, odometer: 158300, serviceDueKm: 157500, value: 31500 }),
  ];
  const names = (id: string | null) => (id === "jordan-mills" ? "Jordan Mills" : "");

  it("tab filters: attention = has chips, pool = unassigned", () => {
    expect(filterVehicles(fleet, [], "all", "", names).length).toBe(3);
    expect(filterVehicles(fleet, [], "attention", "", names).map((v) => v.id)).toEqual(["srv-05", "ute-01"]);
    expect(filterVehicles(fleet, [], "pool", "", names).map((v) => v.id)).toEqual(["srv-05", "ute-01"]);
  });

  it("search matches callsign, plate and driver name", () => {
    expect(filterVehicles(fleet, [], "all", "kwd", names).map((v) => v.id)).toEqual(["srv-05"]);
    expect(filterVehicles(fleet, [], "all", "jordan", names).map((v) => v.id)).toEqual(["vrf-04"]);
  });

  it("sorts by attention severity then callsign, and by value", () => {
    expect(sortVehicles(fleet, [], "attention").map((v) => v.callsign)).toEqual([
      "UTE-01", // bad (service overdue)
      "SRV-05", // warn (rego 7d)
      "VRF-04",
    ]);
    expect(sortVehicles(fleet, [], "value")[0].id).toBe("vrf-04");
    expect(fleetValue(fleet)).toBe(52000 + 27000 + 31500);
  });
});

describe("helpers", () => {
  it("formats km and money", () => {
    expect(fmtKm(84120)).toBe("84,120");
    expect(fmtMoney(52000)).toBe("$52,000");
  });

  it("computes whole days between ISO dates", () => {
    expect(daysUntil("2026-08-07", "2026-07-17")).toBe(21);
    expect(daysUntil("2026-07-14", "2026-07-17")).toBe(-3);
  });

  it("slugs callsigns into unique ids", () => {
    expect(slugId("VAN 09", [])).toBe("van-09");
    expect(slugId("VAN-09", ["van-09"])).toBe("van-09-2");
    expect(slugId("###", [])).toBe("vehicle");
  });
});
