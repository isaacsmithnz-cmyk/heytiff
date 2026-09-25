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
jest.mock("@/lib/integrations/sm8-writes", () => ({ setSm8WriteMode: jest.fn(), sm8WritesEnabled: () => true }));

const disconnectSm8 = jest.fn();
jest.mock("@/lib/integrations/sm8-store", () => ({ disconnectSm8: (...a: unknown[]) => disconnectSm8(...a) }));

import { disconnectServiceM8Action } from "../integrations";

beforeEach(() => {
  role = "owner";
  disconnectSm8.mockReset().mockResolvedValue({ cancelled: [], inFlight: 0 });
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
