/* Fleet actions. The point of these is that the server re-decides everything:
   register writes need `assets_all`, logging doesn't, and the odometer
   guardrail runs whatever the modal allowed. */

const insert = jest.fn().mockResolvedValue({ error: null });
const update = jest.fn();
const del = jest.fn();
const select = jest.fn();

let vehicleRow: Record<string, unknown> | null = null;
let staffRow: Record<string, unknown> | null = { id: "staff-1" };

const table = (name: string) => {
  const chain: Record<string, unknown> = { _table: name };
  const self = () => chain;
  chain.eq = self;
  // adoptReceipt filters on "not uploaded_at is null" and "vehicle_log_id is
  // null" — both are pass-throughs here; what the test cares about is the
  // update that reaches `documents`, not the shape of the filter.
  chain.not = self;
  chain.is = self;
  chain.select = (cols: string) => {
    select(name, cols);
    return chain;
  };
  /* An insert now reads its id back, so maybeSingle has to answer as the
     inserted row once one has been made on this chain. */
  let inserted = false;
  chain.maybeSingle = async () => ({
    data: inserted ? { id: "log-1" } : name === "vehicles" ? vehicleRow : staffRow,
  });
  chain.insert = (row: unknown) => {
    insert(name, row);
    inserted = true;
    return chain;
  };
  chain.update = (row: unknown) => {
    update(name, row);
    return chain;
  };
  chain.delete = () => {
    del(name);
    return chain;
  };
  chain.then = (res: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(res);
  return chain;
};

let caps = new Set<string>(["assets_all"]);

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn().mockResolvedValue({ user: { sub: "auth0|me" }, orgId: "org-1" }) },
}));
jest.mock("@/lib/permissions-server", () => ({
  can: jest.fn(async (c: string) => caps.has(c)),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { addLog, assignVehicle, removeVehicle, resolveIssue } from "../fleet";

const VEHICLE = { id: "v-1", status: "active", odometer: 84120, last_service_odo: 80000, assigned_to: null };

beforeEach(() => {
  [insert, update, del, select].forEach((m) => m.mockClear());
  caps = new Set(["assets_all"]);
  vehicleRow = { ...VEHICLE };
  staffRow = { id: "staff-1" };
});

describe("register actions need assets_all", () => {
  it("refuses assignment, removal and issue-closing without it", async () => {
    caps = new Set();
    expect((await assignVehicle("v-1", "staff-2")).ok).toBe(false);
    expect((await removeVehicle("v-1")).ok).toBe(false);
    expect((await resolveIssue("log-1")).ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("allows them with it", async () => {
    expect((await assignVehicle("v-1", "staff-2")).ok).toBe(true);
    expect(update).toHaveBeenCalledWith("vehicles", expect.objectContaining({ assigned_to: "staff-2" }));
  });
});

describe("logging is intrinsic", () => {
  it("a pool fuel log succeeds WITHOUT assets_all — the whole point of the picker", async () => {
    caps = new Set(); // no fleet capability at all
    const res = await addLog({ vehicleId: "v-1", kind: "fuel", litres: 62.4, cost: 158.4, odo: 84800 });
    expect(res).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith(
      "vehicle_logs",
      expect.objectContaining({ vehicle_id: "v-1", kind: "fuel", litres: 62.4, staff_profile_id: "staff-1" }),
    );
  });

  it("attributes the log to the caller's staff record, not to anything they sent", async () => {
    await addLog({ vehicleId: "v-1", kind: "odo", odo: 84800 });
    expect(insert.mock.calls[0][1]).toMatchObject({ staff_profile_id: "staff-1" });
  });

  it("rolls the odometer forward, and a service resets the cycle", async () => {
    await addLog({ vehicleId: "v-1", kind: "odo", odo: 84800 });
    expect(update).toHaveBeenCalledWith("vehicles", { odometer: 84800 });

    update.mockClear();
    await addLog({ vehicleId: "v-1", kind: "service", odo: 85000 });
    expect(update).toHaveBeenCalledWith("vehicles", { odometer: 85000, last_service_odo: 85000 });
  });

  it("rejects a backwards odometer even though the modal only warned", async () => {
    const res = await addLog({ vehicleId: "v-1", kind: "odo", odo: 1000 });
    expect(res.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses a vehicle outside the caller's org", async () => {
    vehicleRow = null; // the org-scoped lookup found nothing
    const res = await addLog({ vehicleId: "someone-elses", kind: "issue", note: "x" });
    expect(res.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("pauses fuel and odo on an off-road vehicle but never issue reports", async () => {
    vehicleRow = { ...VEHICLE, status: "offroad" };
    expect((await addLog({ vehicleId: "v-1", kind: "fuel", litres: 50 })).ok).toBe(false);
    expect((await addLog({ vehicleId: "v-1", kind: "odo", odo: 90000 })).ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();

    expect((await addLog({ vehicleId: "v-1", kind: "issue", note: "brakes" })).ok).toBe(true);
    expect(insert.mock.calls[0][1]).toMatchObject({ kind: "issue", status: "open" });
  });

  it("refuses a sold vehicle outright", async () => {
    vehicleRow = { ...VEHICLE, status: "sold" };
    expect((await addLog({ vehicleId: "v-1", kind: "issue", note: "x" })).ok).toBe(false);
  });
});

/* The tax half of a fuel log. The server re-decides these exactly as it
   re-decides the odometer: the modal's warnings are a courtesy, and a direct
   POST gets the same answer. */
describe("fuel logs carry their tax record", () => {
  it("writes the GST and the ABN off the docket", async () => {
    const res = await addLog({
      vehicleId: "v-1",
      kind: "fuel",
      litres: 62.4,
      cost: 158.4,
      gst: 14.4,
      abn: "51 824 753 556",
    });
    expect(res).toEqual({ ok: true });
    expect(insert.mock.calls[0][1]).toMatchObject({ gst: 14.4, supplier_abn: "51824753556" });
  });

  it("dates the row from the docket, not from today", async () => {
    await addLog({ vehicleId: "v-1", kind: "fuel", litres: 50, cost: 100, purchasedOn: "2026-07-31" });
    expect(insert.mock.calls[0][1]).toMatchObject({ logged_on: "2026-07-31" });
  });

  it("refuses a GST bigger than an eleventh, and writes nothing", async () => {
    const res = await addLog({ vehicleId: "v-1", kind: "fuel", litres: 50, cost: 158.4, gst: 40 });
    expect(res.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses a future docket date, and writes nothing", async () => {
    const res = await addLog({ vehicleId: "v-1", kind: "fuel", litres: 50, cost: 100, purchasedOn: "2099-01-01" });
    expect(res.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("binds the uploaded docket to the log it belongs to", async () => {
    await addLog({
      vehicleId: "v-1",
      kind: "fuel",
      litres: 62.4,
      cost: 158.4,
      receiptDocumentId: "doc-77",
    });
    expect(update).toHaveBeenCalledWith("documents", { vehicle_log_id: "log-1" });
  });

  it("never carries tax columns onto a log that isn't fuel", async () => {
    // a stale field on a reused form must not put a supplier on an odo reading
    await addLog({ vehicleId: "v-1", kind: "odo", odo: 84800, gst: 9, abn: "51824753556" });
    expect(insert.mock.calls[0][1]).toMatchObject({ gst: null, supplier_abn: null });
  });
});
