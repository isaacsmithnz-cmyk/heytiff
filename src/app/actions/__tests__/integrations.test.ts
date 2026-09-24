/**
 * @jest-environment node
 *
 * Disconnecting ServiceM8 says what it cancelled. The store is a fake: what
 * is under test is the owner gate and the note built from what the store did.
 */

let role = "owner";
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: jest.fn(async () => ({ orgId: "org-1" })) } }));
jest.mock("@/lib/permissions-server", () => ({ getDbRole: jest.fn(async () => role) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/integrations/store", () => ({ disconnectXero: jest.fn(), setXeroTenant: jest.fn() }));
jest.mock("@/lib/integrations/sm8-sync", () => ({ runSm8Sync: jest.fn() }));

const setSm8WriteMode = jest.fn();
const readSm8WriteState = jest.fn();
const retryFailedSm8Writes = jest.fn();
const runSm8Writes = jest.fn();
jest.mock("@/lib/integrations/sm8-writes", () => ({
  setSm8WriteMode: (...a: unknown[]) => setSm8WriteMode(...a),
  sm8WritesEnabled: () => true,
  readSm8WriteState: (...a: unknown[]) => readSm8WriteState(...a),
  retryFailedSm8Writes: (...a: unknown[]) => retryFailedSm8Writes(...a),
  runSm8Writes: (...a: unknown[]) => runSm8Writes(...a),
}));

const PRESS = { orgId: "org-1", userId: "auth0|isaac", staffId: "staff-isaac", at: 0 };
let press: typeof PRESS | null = PRESS;
jest.mock("@/lib/integrations/sm8-press", () => ({ sm8PressFromSession: async () => press }));

const scheduled: (() => unknown)[] = [];
jest.mock("next/server", () => ({ after: (fn: () => unknown) => scheduled.push(fn) }));

const disconnectSm8 = jest.fn();
jest.mock("@/lib/integrations/sm8-store", () => ({ disconnectSm8: (...a: unknown[]) => disconnectSm8(...a) }));

import {
  disconnectServiceM8Action,
  retryFailedServiceM8WritesAction,
  setServiceM8WriteModeAction,
} from "../integrations";

const LIVE = {
  readable: true,
  kinds: ["attachment"],
  deployment: true,
  mode: "live",
  modeStored: "live",
  pausedReason: null,
  pausedAt: null,
  linked: true,
  connected: true,
  tenantId: "vendor-1",
  granted: ["attachment"],
  refused: [],
  timezoneName: null,
};

beforeEach(() => {
  role = "owner";
  press = PRESS;
  scheduled.length = 0;
  disconnectSm8.mockReset().mockResolvedValue({ cancelled: [], inFlight: 0 });
  setSm8WriteMode.mockReset().mockResolvedValue({ ok: true, cancelled: [] });
  readSm8WriteState.mockReset().mockResolvedValue(LIVE);
  retryFailedSm8Writes.mockReset().mockResolvedValue({ queued: 2, left: 0, capped: false, byHour: false });
  runSm8Writes.mockReset().mockResolvedValue({});
});

describe("setServiceM8WriteModeAction", () => {
  it("takes Paused as a setting", async () => {
    expect(await setServiceM8WriteModeAction("paused")).toEqual({ ok: true });
    expect(setSm8WriteMode).toHaveBeenCalledWith("org-1", "paused");
  });

  it("says what Off cancelled", async () => {
    setSm8WriteMode.mockResolvedValue({
      ok: true,
      cancelled: [
        { id: "w1", name: "a.pdf" },
        { id: "w2", name: null },
      ],
    });
    expect(await setServiceM8WriteModeAction("off")).toEqual({
      ok: true,
      note: "Sending is off. 2 files that were waiting won't go.",
    });
  });

  it("refuses what isn't a setting, and says a change that didn't take", async () => {
    expect(await setServiceM8WriteModeAction("banana")).toEqual({ ok: false, error: "That isn't a setting." });
    setSm8WriteMode.mockResolvedValue({ ok: false });
    expect(await setServiceM8WriteModeAction("live")).toEqual({
      ok: false,
      error: "Couldn't change it. Reload the page and try again.",
    });
  });
});

describe("retryFailedServiceM8WritesAction", () => {
  it("queues the failed files again as the owner's press, and sends behind the answer", async () => {
    expect(await retryFailedServiceM8WritesAction()).toEqual({ ok: true, note: "2 files will go again." });
    expect(retryFailedSm8Writes).toHaveBeenCalledWith(PRESS, LIVE);
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();
    expect(runSm8Writes).toHaveBeenCalledWith("org-1", "kick", { budgetMs: 90_000 });
  });

  it("says when the hour has no room, and sends nothing", async () => {
    retryFailedSm8Writes.mockResolvedValue({ queued: 0, left: 3, capped: true, byHour: true });
    expect(await retryFailedServiceM8WritesAction()).toEqual({
      ok: true,
      note: "60 have gone to ServiceM8 in the last hour. Try again in an hour.",
    });
    expect(scheduled).toHaveLength(0);
  });

  it("says why sending can't take them, in the press's words", async () => {
    readSm8WriteState.mockResolvedValue({ ...LIVE, mode: "paused" });
    expect(await retryFailedServiceM8WritesAction()).toEqual({
      ok: false,
      error: "Sending to ServiceM8 is paused. An owner can change that in Integrations, ServiceM8.",
    });
    expect(retryFailedSm8Writes).not.toHaveBeenCalled();
  });

  it("is an owner's, pressed in this workspace", async () => {
    role = "admin";
    expect(await retryFailedServiceM8WritesAction()).toEqual({ ok: false, error: "Only an owner can change connected apps." });
    role = "owner";
    press = null;
    expect((await retryFailedServiceM8WritesAction()).ok).toBe(false);
    expect(retryFailedSm8Writes).not.toHaveBeenCalled();
  });
});

describe("disconnectServiceM8Action", () => {
  it("names the files it cancelled and says what may still arrive", async () => {
    disconnectSm8.mockResolvedValue({
      cancelled: [
        { id: "w1", name: "Public liability.pdf" },
        { id: "w2", name: "Quote 2380.pdf" },
        { id: "w3", name: null },
      ],
      inFlight: 1,
    });
    const res = await disconnectServiceM8Action();
    expect(res).toEqual({
      ok: true,
      note:
        "Disconnected here. 3 files waiting to go to ServiceM8 were cancelled: Public liability.pdf, Quote 2380.pdf and 1 more. " +
        "1 file was already on its way to ServiceM8, and may still arrive. " +
        "To fully revoke access, also remove HeyTiff from your ServiceM8 account's add-ons.",
    });
    expect(disconnectSm8).toHaveBeenCalledWith("org-1");
  });

  it("with nothing waiting, says only what it always said", async () => {
    expect(await disconnectServiceM8Action()).toEqual({
      ok: true,
      note: "Disconnected here. To fully revoke access, also remove HeyTiff from your ServiceM8 account's add-ons.",
    });
  });

  it("only an owner can disconnect", async () => {
    role = "admin";
    expect(await disconnectServiceM8Action()).toEqual({ ok: false, error: "Only an owner can change connected apps." });
    expect(disconnectSm8).not.toHaveBeenCalled();
  });
});
