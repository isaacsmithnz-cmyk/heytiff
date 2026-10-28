/**
 * @jest-environment node
 */

/* Your vehicle on the phone (lib/mobile/vehicle): the web's vehicle page as
   its driver sees it, in the page's own words, drawn on Zucky (the 2022
   Hiace, EVD72G, serviced at 57,000 km on 25 Aug, filled 4 Aug at Coles
   Express Park Holme); and a reading, an issue and a correction through the
   web's own actions, run as the phone's person. The page's word helpers are
   the real ones; the reads and the actions are stand-ins that record. */

import type { VehicleLog, VehicleWithFacts } from "@/components/fleet/logic";

const asked: string[] = [];
jest.mock("server-only", () => ({}));
jest.mock("@/lib/mobile/auth", () => ({
  actAsPhoneUser: async (ctx: { userId: string }, fn: () => Promise<unknown>) => {
    asked.push(`as ${ctx.userId}`);
    return fn();
  },
}));
jest.mock("@/lib/au-dates", () => ({ ...jest.requireActual("@/lib/au-dates"), todayInAu: () => "2026-10-28" }));
jest.mock("@/lib/org/query", () => ({ orgExpiryWindow: async () => ({ warnDays: 30, email: false }) }));

let staffId: string | null = "card-isaac";
let assigned = true;
const zucky = {
  id: "v-zucky",
  name: "ZUCKY",
  make: "Toyota",
  model: "Hiace",
  year: 2022,
  plate: "EVD72G",
  plateState: "NSW",
  status: "active",
  odometer: 57000,
  regoDays: 44,
  insuranceDays: 269,
  ctpDays: null,
  serviceIntervalKm: 10000,
  lastServiceOdo: 57000,
  serviceIntervalMonths: null,
  serviceDays: null,
  motorised: true,
} as unknown as VehicleWithFacts;
const log = (over: Partial<VehicleLog>): VehicleLog => ({ id: "l", vehicleId: "v-zucky", staffId: "card-isaac", staffName: "Isaac Smith", kind: "fuel", when: "Tue 4 Aug", ago: 85, ...over });
jest.mock("@/lib/fleet/query", () => ({
  staffProfileIdFor: async () => staffId,
  getOwnVehicle: async (_o: string, s: string | null) => (assigned && s === "card-isaac" ? zucky : null),
  listVehiclePicker: async () => [
    zucky,
    { id: "v-hilux", name: "TOYOTA HILUX", make: "Toyota", model: "Hilux", year: 2019, plate: "DH06VY", plateState: "NSW", status: "active", odometer: 128088 },
    { id: "v-old", name: "OLD", make: "Ford", model: "Transit", year: 2010, plate: "OLD1", plateState: "NSW", status: "sold", odometer: 1 },
  ],
  listLogs: async () => [
    log({ id: "f1", kind: "fuel", litres: 90.05, cost: 106.17, station: "Coles Express Park Holme" }),
    log({ id: "s1", kind: "service", when: "Tue 25 Aug", ago: 64, odo: 57000 }),
    log({ id: "i1", kind: "issue", when: "Mon 26 Oct", ago: 2, note: "Sliding door won't latch", status: "open", staffId: "card-alex", staffName: "Alex Lorenz" }),
  ],
}));
let refuse: string | null = null;
jest.mock("@/app/actions/fleet", () => ({
  addLog: async (l: Record<string, unknown>) => (asked.push(`log ${JSON.stringify(l)}`), refuse ? { ok: false, error: refuse } : { ok: true }),
  editLog: async (id: string, p: Record<string, unknown>) => (asked.push(`fix ${id} ${JSON.stringify(p)}`), { ok: true }),
}));

import { fixEntry, logReading, readPhoneVehicle, reportIssue } from "@/lib/mobile/vehicle";

const ctx = { userId: "auth0|isaac", orgId: "org-diamond", role: "owner", caps: new Set(), orgIds: ["org-diamond"] } as never;

beforeEach(() => {
  asked.length = 0;
  staffId = "card-isaac";
  assigned = true;
  refuse = null;
});

describe("your vehicle on the phone", () => {
  it("is the vehicle page as its driver reads it, in the page's own words", async () => {
    const { vehicle } = await readPhoneVehicle(ctx);
    expect(vehicle).toMatchObject({
      title: "Toyota Hiace",
      plate: "EVD72G",
      plateState: "NSW",
      head: "2022, ZUCKY, You drive it",
      status: { word: "In service", tone: "good" },
      offroad: false,
      lastFuel: { when: "Tue 4 Aug", line: "90.05 litres, $106.17, Coles Express Park Holme" },
      issues: [{ id: "i1", name: "Sliding door won't latch" }],
    });
    expect(vehicle!.service.map((r) => `${r.label}: ${r.value}`)).toEqual([
      "Odometer: 57,000 km, read Tue 25 Aug",
      "Next service: At 67,000 km, 10,000 km to go",
      "Last service: Tue 25 Aug",
    ]);
    expect(vehicle!.renewals.map((r) => `${r.label}: ${r.word?.word} ${r.date ?? ""}`.trim())).toEqual([
      "Rego: Current to 11 Dec 2026",
      "Green slip: Not on file",
      "Insurance: Current to 24 Jul 2027",
    ]);
  });

  it("lists every entry newest first, yours to correct and others' only to read", async () => {
    const { vehicle } = await readPhoneVehicle(ctx);
    expect(vehicle!.entries.map((e) => `${e.word} ${e.when}: ${e.line}${e.mine ? " (yours)" : ""}`)).toEqual([
      "Issue Mon 26 Oct: Sliding door won't latch",
      "Service Tue 25 Aug: Service, at 57,000 km (yours)",
      "Fuel Tue 4 Aug: 90.05 litres, $106.17, Coles Express Park Holme (yours)",
    ]);
  });

  it("offers your vehicle first, then the pool, never a sold one", async () => {
    const { vehicles } = await readPhoneVehicle(ctx);
    expect(vehicles.map((v) => v.name)).toEqual(["EVD72G, Toyota Hiace", "DH06VY, Toyota Hilux"]);
  });

  it("with none of your own, still offers the pool to log against", async () => {
    assigned = false;
    const out = await readPhoneVehicle(ctx);
    expect(out.vehicle).toBeNull();
    expect(out.vehicles).toHaveLength(2);
    expect(out.canFile).toBe(true);
  });

  it("logs a reading and reports an issue through the web's addLog, as you", async () => {
    await logReading(ctx, { vehicleId: "v-zucky", odo: "57,912" });
    await reportIssue(ctx, { vehicleId: "v-zucky", note: "  Sliding door won't latch on the passenger side " });
    expect(asked).toEqual([
      "as auth0|isaac",
      `log ${JSON.stringify({ vehicleId: "v-zucky", kind: "odo", odo: 57912, source: "manual" })}`,
      "as auth0|isaac",
      `log ${JSON.stringify({ vehicleId: "v-zucky", kind: "issue", note: "Sliding door won't latch on the passenger side" })}`,
    ]);
  });

  it("says why, in the action's words, when a reading goes backwards", async () => {
    refuse = "That reading is below the last one (57,000 km).";
    expect(await logReading(ctx, { vehicleId: "v-zucky", odo: 56000 })).toEqual({ ok: false, status: 400, error: refuse });
    expect(await logReading(ctx, { vehicleId: "v-zucky", odo: "" })).toMatchObject({ ok: false });
    expect(await reportIssue(ctx, { vehicleId: "v-zucky", note: "  " })).toMatchObject({ ok: false });
  });

  it("corrects an entry through the web's editLog, only the fields sent", async () => {
    await fixEntry(ctx, { id: "f1", litres: "90.5", cost: 106.17, station: "Coles Express" });
    expect(asked).toEqual(["as auth0|isaac", `fix f1 ${JSON.stringify({ litres: 90.5, cost: 106.17, station: "Coles Express" })}`]);
    expect(await fixEntry(ctx, { id: "f1", litres: "lots" })).toMatchObject({ ok: false });
  });
});
