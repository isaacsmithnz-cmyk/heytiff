import {
  SERVICE_WARN_DAYS,
  SERVICE_WARN_KM,
  serviceDaysUntil,
  serviceDue,
  serviceDueKm,
  serviceDueText,
  vehicleChips,
  vehicleFacts,
  type Vehicle,
} from "../logic";

/* A service falls due on distance OR time, whichever arrives first.
   Isaac's words: "vehicle intervals are by date/kms whichever is first. kms
   are updated at fuel fill to keep track. anything without a motor can just
   have service date."

   The distance-only model let a low-km van go for years without coming due,
   and a trailer — no motor, no odometer — could never come due at all. The
   thing to protect here is that a limit which does NOT apply says nothing,
   rather than reading as a limit that is comfortably fine. */

const van: Vehicle = {
  id: "v1",
  name: "WORK TRITON",
  make: "Mitsubishi",
  model: "Triton",
  year: 2022,
  plate: "YLI59V",
  plateState: "NSW",
  status: "active",
  odometer: 100000,
  regoDays: 200,
  insuranceDays: 200,
  serviceIntervalKm: 10000,
  lastServiceOdo: 95000,
  serviceIntervalMonths: 12,
  serviceDays: 200,
  motorised: true,
  assignedTo: null,
  value: 27000,
  purchasePrice: 0,
  purchaseDateDays: 0,
  lastServiceDays: null,
  notes: undefined,
};

const trailer: Vehicle = {
  ...van,
  id: "t1",
  name: "TRAILER",
  motorised: false,
  odometer: 0,
  serviceIntervalKm: null,
  lastServiceOdo: 0,
  serviceIntervalMonths: 12,
  serviceDays: 200,
};

describe("whichever arrives first", () => {
  it("is fine while both limits are far off", () => {
    expect(serviceDue(van).state).toBe("ok");
    expect(vehicleChips(van, 0)).toEqual([]);
  });

  it("warns on distance while the date is still far away", () => {
    const v = { ...van, odometer: 105000 - SERVICE_WARN_KM }; // 1,500 km left
    expect(serviceDue(v).state).toBe("warn");
    expect(vehicleChips(v, 0)[0].label).toBe("Service in 1,500 km");
  });

  it("warns on the date while the distance is still far away", () => {
    // THE CASE THE OLD MODEL COULD NOT SEE: a van that barely moves still has
    // oil ageing in it, and would have read "in 5,000 km" forever
    const v = { ...van, serviceDays: 10 };
    expect(serviceDue(v).kmLeft).toBe(5000);
    expect(serviceDue(v).state).toBe("warn");
    expect(vehicleChips(v, 0)[0].label).toMatch(/^Service in/);
  });

  it("takes the worse of the two, not the first one it looks at", () => {
    const v = { ...van, odometer: 106000, serviceDays: 10 }; // km overdue, date only warn
    expect(serviceDue(v).state).toBe("bad");
    expect(vehicleChips(v, 0)[0].label).toBe("Service overdue 1,000 km");
  });

  it("words the chip after the limit that is actually the reason", () => {
    // overdue on TIME and comfortably fine on distance — saying "overdue by
    // kilometres" here would be a sentence about the wrong measurement
    const v = { ...van, serviceDays: -20 };
    const chip = vehicleChips(v, 0)[0];
    expect(chip.state).toBe("bad");
    expect(chip.label).not.toMatch(/km/);
    expect(chip.label).toMatch(/overdue/);
  });

  it("raises ONE chip for the cycle even when both limits have gone", () => {
    const v = { ...van, odometer: 120000, serviceDays: -40 };
    expect(vehicleChips(v, 0).filter((c) => c.label.startsWith("Service"))).toHaveLength(1);
  });

  it("reads both limits out when both apply", () => {
    expect(serviceDueText(van)).toBe("in 5,000 km or in 6 months");
  });
});

describe("anything without a motor", () => {
  it("has no distance limit at all — not a limit that happens to be met", () => {
    expect(serviceDueKm(trailer)).toBeNull();
    expect(serviceDue(trailer).kmLeft).toBeNull();
  });

  it("still falls due on its date", () => {
    expect(serviceDue({ ...trailer, serviceDays: -1 }).state).toBe("bad");
    expect(serviceDue({ ...trailer, serviceDays: SERVICE_WARN_DAYS }).state).toBe("warn");
  });

  it("never reads as 0 km from due, however stale its odometer column is", () => {
    // the trailer sits at odometer 0 / lastServiceOdo 0. Under a distance rule
    // that is "due now"; the truth is that distance does not apply to it
    expect(serviceDue(trailer).state).toBe("ok");
    expect(serviceDueText(trailer)).toBe("in 6 months");
  });

  it("shows no odometer fact — a figure it does not have", () => {
    expect(vehicleFacts(trailer).map((f) => f.key)).not.toContain("odo");
    expect(vehicleFacts(van).map((f) => f.key)).toContain("odo");
  });
});

describe("a cycle nobody has set", () => {
  it("says so rather than reading as fine", () => {
    const v = { ...van, serviceIntervalKm: null, serviceIntervalMonths: null, serviceDays: null };
    expect(serviceDueText(v)).toBeNull();
    expect(vehicleFacts(v).find((f) => f.key === "service")!.text).toBe("No cycle set");
    expect(vehicleChips(v, 0)).toEqual([]); // nothing known, so nothing claimed
  });

  it("ignores a time interval with nothing anchoring it", () => {
    // an interval with no last-service date starts a countdown from nowhere
    expect(serviceDaysUntil(null, 12, "2026-08-25")).toBeNull();
    expect(serviceDaysUntil("2026-08-25", null, "2026-08-25")).toBeNull();
  });
});

describe("the time limit counts months, not 30-day blocks", () => {
  it("lands on the calendar date a year later", () => {
    expect(serviceDaysUntil("2026-08-25", 12, "2026-08-25")).toBe(365);
    expect(serviceDaysUntil("2026-08-25", 6, "2026-08-25")).toBe(184); // Aug→Feb
  });

  it("counts a service already past its months as overdue", () => {
    expect(serviceDaysUntil("2025-01-01", 12, "2026-08-25")).toBeLessThan(0);
  });

  it("keeps the km warn threshold and the day one apart", () => {
    expect(SERVICE_WARN_KM).toBe(1500);
    expect(SERVICE_WARN_DAYS).toBe(30);
  });
});
