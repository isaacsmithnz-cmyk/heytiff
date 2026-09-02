/**
 * @jest-environment node
 *
 * The valuation door. Issue #502 is the contract under test: the ROUTE owns
 * the run — it claims the lease before spending, reads the fleet itself,
 * persists what came back before responding, and releases in a finally. The
 * client is a viewer; nothing it does or fails to do may lose a paid-for
 * result. Ordering matters more than any single call here, so several tests
 * assert who was called and who was NOT.
 */

import { GET, POST } from "../value/route";
import type { Vehicle } from "@/components/fleet/logic";

const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: (...a: unknown[]) => getSession(...a) } }));

const can = jest.fn();
jest.mock("@/lib/permissions-server", () => ({ can: (...a: unknown[]) => can(...a) }));

const listVehicles = jest.fn();
jest.mock("@/lib/fleet/query", () => ({ listVehicles: (...a: unknown[]) => listVehicles(...a) }));

const runFleetValuation = jest.fn();
jest.mock("@/lib/fleet/valuation", () => ({
  runFleetValuation: (...a: unknown[]) => runFleetValuation(...a),
}));

const claim = jest.fn();
const release = jest.fn();
const persist = jest.fn();
const running = jest.fn();
jest.mock("@/lib/fleet/valuation-store", () => ({
  claimValuationLease: (...a: unknown[]) => claim(...a),
  releaseValuationLease: (...a: unknown[]) => release(...a),
  persistValuations: (...a: unknown[]) => persist(...a),
  valuationRunning: (...a: unknown[]) => running(...a),
}));

const revalidatePath = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

function vehicle(over: Partial<Vehicle>): Vehicle {
  return {
    id: "v1",
    name: "",
    make: "Toyota",
    model: "Hiace",
    year: 2022,
    plate: "EVD72G",
    plateState: "NSW",
    status: "active",
    odometer: 55500,
    regoDays: 100,
    insuranceDays: 100,
    ctpDays: 100,
    serviceIntervalKm: 10000,
    lastServiceOdo: 50000,
    serviceIntervalMonths: null,
    serviceDays: null,
    motorised: true,
    assignedTo: null,
    value: 45000,
    purchasePrice: 0,
    purchaseDateDays: 0,
    lastServiceDays: null,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "test-key";
  getSession.mockResolvedValue({ orgId: "org-1", user: { sub: "auth0|isaac" } });
  can.mockResolvedValue(true);
  claim.mockResolvedValue(true);
  running.mockResolvedValue(false);
  listVehicles.mockResolvedValue({ vehicles: [vehicle({})], aiValues: {} });
  runFleetValuation.mockResolvedValue({ ok: true, valuations: [], searched: true });
});

it("takes no instruction from the request — the fleet comes from the database", async () => {
  const sold = vehicle({ id: "v2", status: "sold" });
  listVehicles.mockResolvedValue({ vehicles: [vehicle({}), sold], aiValues: {} });

  await POST();

  expect(listVehicles).toHaveBeenCalledWith("org-1");
  const payload = runFleetValuation.mock.calls[0][0];
  expect(payload).toHaveLength(1); // sold vehicles aren't priced
  expect(payload[0]).toMatchObject({ id: "v1", odometerKm: 55500, status: "In service" });
});

it("persists what the run produced BEFORE responding, then refreshes both screens", async () => {
  runFleetValuation.mockResolvedValue({
    ok: true,
    searched: true,
    valuations: [
      { id: "v1", low: 38000, high: 46000, point: 42000, note: "8 listings" },
      { id: "not-a-vehicle", low: 1, high: 2, point: 1, note: "junk id from the model" },
    ],
  });

  const res = await POST();

  expect(persist).toHaveBeenCalledWith("org-1", {
    v1: expect.objectContaining({ point: 42000, atOdo: 55500 }), // parseValuations ran; junk id dropped
  });
  expect(revalidatePath).toHaveBeenCalledWith("/dashboard/assets");
  expect(revalidatePath).toHaveBeenCalledWith("/dashboard/my-vehicle");
  expect(await res.json()).toEqual({ ok: true, searched: true });
});

it("claims before spending, and a refused claim spends nothing", async () => {
  claim.mockResolvedValue(false);

  const res = await POST();

  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ ok: false, running: true });
  expect(runFleetValuation).not.toHaveBeenCalled();
  // releasing a lease you never claimed would free the REAL runner's lease
  expect(release).not.toHaveBeenCalled();
});

it("releases the lease whether the run succeeded or not", async () => {
  await POST();
  expect(release).toHaveBeenCalledWith("org-1");

  release.mockClear();
  persist.mockClear();
  runFleetValuation.mockResolvedValue({ ok: false, reason: "Tiff is busy — try again in a minute." });
  const res = await POST();
  expect(release).toHaveBeenCalledWith("org-1");
  expect(persist).not.toHaveBeenCalled();
  expect(await res.json()).toMatchObject({ ok: false });
});

it("is gated assets_all, and the gate spends nothing", async () => {
  can.mockResolvedValue(false);

  const post = await POST();
  expect(post.status).toBe(403);
  expect(claim).not.toHaveBeenCalled();
  expect(runFleetValuation).not.toHaveBeenCalled();

  const get = await GET();
  expect(get.status).toBe(403);
});

it("offline (no key) answers before touching the lease", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const res = await POST();
  expect(await res.json()).toMatchObject({ ok: false });
  expect(claim).not.toHaveBeenCalled();
});

it("GET reports the lease so a fresh page can wait on a run it didn't start", async () => {
  running.mockResolvedValue(true);
  expect(await (await GET()).json()).toEqual({ running: true });

  running.mockResolvedValue(false);
  expect(await (await GET()).json()).toEqual({ running: false });
});
