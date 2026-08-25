/* Fleet actions. The point of these is that the server re-decides everything:
   register writes need `assets_all`, logging doesn't, and the odometer
   guardrail runs whatever the modal allowed. */

const insert = jest.fn().mockResolvedValue({ error: null });
const update = jest.fn();
const del = jest.fn();
const select = jest.fn();

let vehicleRow: Record<string, unknown> | null = null;
let staffRow: Record<string, unknown> | null = { id: "staff-1" };
/* The row editLog/deleteLog fetch before deciding anything. Whose it is
   decides whether the caller may touch it, so tests move it around. */
let logRow: Record<string, unknown> | null = null;
/* What the surviving-logs read returns, for the odometer resync. */
let survivingLogs: Record<string, unknown>[] = [];

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
    data: inserted
      ? { id: "log-1" }
      : name === "vehicles"
        ? vehicleRow
        : name === "vehicle_logs"
          ? logRow
          : staffRow,
  });
  /* A select that is awaited rather than narrowed to one row — the surviving
     logs the odometer is recomputed from. */
  chain.then = (res: (v: { data: unknown; error: null }) => unknown) =>
    Promise.resolve({ data: name === "vehicle_logs" ? survivingLogs : [], error: null }).then(res);
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

import { addLog, assignVehicle, deleteLog, editLog, removeVehicle, resolveIssue } from "../fleet";

const VEHICLE = { id: "v-1", status: "active", odometer: 84120, last_service_odo: 80000, assigned_to: null };

beforeEach(() => {
  [insert, update, del, select].forEach((m) => m.mockClear());
  caps = new Set(["assets_all"]);
  vehicleRow = { ...VEHICLE };
  staffRow = { id: "staff-1" };
  logRow = null;
  survivingLogs = [];
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

  it("rolls the odometer forward, and a service resets BOTH limits", async () => {
    await addLog({ vehicleId: "v-1", kind: "odo", odo: 84800 });
    expect(update).toHaveBeenCalledWith("vehicles", { odometer: 84800 });

    update.mockClear();
    await addLog({ vehicleId: "v-1", kind: "service", odo: 85000 });
    /* The date anchor moves too. A cycle that falls due on distance OR time
       has to be reset on both by the one service, or a serviced vehicle stays
       overdue on time for good. */
    expect(update).toHaveBeenCalledWith("vehicles", {
      odometer: 85000,
      last_service_odo: 85000,
      last_service_on: "2026-08-25",
    });
  });

  it("anchors the date even when the service came with no reading", async () => {
    // a trailer has no odometer to quote, and it was still serviced that day
    update.mockClear();
    await addLog({ vehicleId: "v-1", kind: "service" });
    expect(update).toHaveBeenCalledWith("vehicles", { last_service_on: "2026-08-25" });
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

/* WHOSE MONEY BOUGHT IT. A company card stops at the vehicle log. A personal
   card leaves someone out of pocket, so the same action also raises an expense
   claim — and links it back to the log, which is what stops the tax screen
   counting one tank of diesel twice (see lib/tax/query.ts). */
describe("fuel paid from your own pocket", () => {
  const own = (over: Record<string, unknown> = {}) =>
    addLog({ vehicleId: "v-1", kind: "fuel", litres: 62.4, cost: 158.4, paidWith: "own", ...over });

  const claimInsert = () =>
    insert.mock.calls.find((c) => c[0] === "expense_claims")?.[1] as Record<string, unknown>;

  it("records who paid on the log", async () => {
    await own();
    expect(insert.mock.calls[0][1]).toMatchObject({ paid_with: "own" });
  });

  it("defaults to the company when nobody was asked", async () => {
    // every fuel log written before the question existed, and the common case
    await addLog({ vehicleId: "v-1", kind: "fuel", litres: 50, cost: 100 });
    expect(insert.mock.calls[0][1]).toMatchObject({ paid_with: "company" });
    expect(insert.mock.calls.some((c) => c[0] === "expense_claims")).toBe(false);
  });

  it("raises a reimbursement claim, linked to the log", async () => {
    /* The link is the whole mechanism: the tax read skips any claim carrying a
       vehicle_log_id, because the log is already that purchase's tax line. */
    const res = await own({ station: "BP Kingsford", gst: 14.4, purchasedOn: "2026-07-31" });
    expect(res).toEqual({ ok: true });
    expect(claimInsert()).toMatchObject({
      vehicle_log_id: "log-1",
      category: "fuel",
      amount: 158.4,
      gst_amount: 14.4,
      supplier: "BP Kingsford",
      description: "Fuel — BP Kingsford",
      expense_date: "2026-07-31",
      status: "pending",
      staff_profile_id: "staff-1",
    });
  });

  it("refuses without a cost, and writes nothing at all", async () => {
    // a reimbursement for an unknown amount is not a reimbursement
    const res = await own({ cost: undefined });
    expect(res.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses when the account has no staff record, and writes nothing", async () => {
    /* Checked BEFORE the insert on purpose: a log that saves and then fails to
       raise the claim leaves someone out of pocket with no trace of it. */
    staffRow = null;
    const res = await own();
    expect(res.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("never raises a claim from a company card", async () => {
    await addLog({ vehicleId: "v-1", kind: "fuel", litres: 50, cost: 100, paidWith: "company" });
    expect(insert.mock.calls.some((c) => c[0] === "expense_claims")).toBe(false);
  });

  it("never raises one from a kind that isn't fuel", async () => {
    // a stale field on a reused form must not turn an odo reading into money
    await addLog({ vehicleId: "v-1", kind: "odo", odo: 84800, paidWith: "own" });
    expect(insert.mock.calls.some((c) => c[0] === "expense_claims")).toBe(false);
    expect(insert.mock.calls[0][1]).toMatchObject({ paid_with: null });
  });
});

/* Correcting an entry. The rules that matter are who may do it, that the tax
   figures are re-decided rather than trusted, and that the vehicle is put back
   where the SURVIVING logs say it is. */
describe("editing and removing a log", () => {
  const FUEL_LOG = {
    id: "log-1",
    vehicle_id: "v-1",
    kind: "fuel",
    staff_profile_id: "staff-1",
    cost: 158.4,
    deleted_at: null,
  };

  it("lets you correct your own entry without any capability", async () => {
    caps = new Set();
    logRow = { ...FUEL_LOG };
    const res = await editLog("log-1", { litres: 60 });
    expect(res).toEqual({ ok: true });
    expect(update.mock.calls[0][1]).toMatchObject({ litres: 60, edited_by: "staff-1" });
  });

  it("refuses someone else's entry unless you hold assets_all", async () => {
    caps = new Set();
    logRow = { ...FUEL_LOG, staff_profile_id: "staff-9" };
    expect((await editLog("log-1", { litres: 60 })).ok).toBe(false);
    expect((await deleteLog("log-1")).ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("lets the register fix anyone's entry", async () => {
    caps = new Set(["assets_all"]);
    logRow = { ...FUEL_LOG, staff_profile_id: "staff-9" };
    expect((await editLog("log-1", { litres: 60 })).ok).toBe(true);
  });

  it("re-runs the GST rule against the EDITED cost, not the stored one", async () => {
    // 14.40 was fine against $158.40; it is not fine once the total drops to $40
    logRow = { ...FUEL_LOG };
    const res = await editLog("log-1", { cost: 40, gst: 14.4 });
    expect(res.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a future receipt date on an edit too", async () => {
    logRow = { ...FUEL_LOG };
    expect((await editLog("log-1", { purchasedOn: "2099-01-01" })).ok).toBe(false);
  });

  it("allows an odometer correction DOWNWARD — the main reason anyone edits one", async () => {
    /* The add-time guardrail refuses readings below the vehicle's current one,
       and the vehicle's current one may have come from this very log. Applying
       it here would make a fat-fingered 848000 permanently uncorrectable. */
    logRow = { ...FUEL_LOG, kind: "odo" };
    vehicleRow = { ...VEHICLE, odometer: 848000 };
    const res = await editLog("log-1", { odo: 84800 });
    expect(res).toEqual({ ok: true });
  });

  it("still refuses a negative reading", async () => {
    logRow = { ...FUEL_LOG, kind: "odo" };
    expect((await editLog("log-1", { odo: -5 })).ok).toBe(false);
  });

  it("hides a removed entry rather than destroying it", async () => {
    logRow = { ...FUEL_LOG };
    const res = await deleteLog("log-1");
    expect(res).toEqual({ ok: true });
    expect(del).not.toHaveBeenCalled();
    expect(update.mock.calls[0][1]).toMatchObject({ deleted_by: "staff-1" });
    expect(update.mock.calls[0][1]).toHaveProperty("deleted_at");
  });

  it("winds the odometer back to the highest surviving reading", async () => {
    logRow = { ...FUEL_LOG };
    vehicleRow = { ...VEHICLE, odometer: 90000 };
    survivingLogs = [{ kind: "fuel", odo: 84800 }, { kind: "fuel", odo: 84120 }];
    await deleteLog("log-1");
    expect(update).toHaveBeenCalledWith("vehicles", expect.objectContaining({ odometer: 84800 }));
  });

  it("leaves the odometer alone when no reading survives", async () => {
    // the number a vehicle was added with exists nowhere else, so it cannot be
    // recovered — and reading high is the safe direction
    logRow = { ...FUEL_LOG };
    vehicleRow = { ...VEHICLE, odometer: 90000 };
    survivingLogs = [];
    await deleteLog("log-1");
    const vehicleUpdates = update.mock.calls.filter((c) => c[0] === "vehicles");
    expect(vehicleUpdates).toHaveLength(0);
  });

  it("refuses an entry that is already gone", async () => {
    logRow = { ...FUEL_LOG, deleted_at: "2026-08-01T00:00:00Z" };
    expect((await editLog("log-1", { litres: 60 })).ok).toBe(false);
    expect((await deleteLog("log-1")).ok).toBe(false);
  });
});
