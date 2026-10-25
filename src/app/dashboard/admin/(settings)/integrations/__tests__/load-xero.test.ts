/**
 * @jest-environment node
 *
 * Xero's loader for Settings › Integrations: one live read, only through a
 * working grant, and the round trip's outcome as a sentence from the fixed
 * table, naming the organisation.
 */

const getConnectionView = jest.fn();
const countConnectionsElsewhere = jest.fn(async (..._a: unknown[]) => 0);
jest.mock("@/lib/integrations/store", () => ({
  getConnectionView: (...a: unknown[]) => getConnectionView(...a),
  countConnectionsElsewhere: (...a: unknown[]) => countConnectionsElsewhere(...a),
}));
const countPayrollEmployees = jest.fn(async (..._a: unknown[]): Promise<unknown> => ({ ok: true, data: 9 }));
jest.mock("@/lib/integrations/xero-read", () => ({ countPayrollEmployees: (...a: unknown[]) => countPayrollEmployees(...a) }));
const getXeroPeopleData = jest.fn(async () => ({ rows: [], linkable: [], error: null }));
jest.mock("@/app/actions/staff-import", () => ({ getXeroPeopleData: () => getXeroPeopleData(), getSm8PeopleData: jest.fn() }));
jest.mock("@/lib/integrations/xero", () => ({ xeroConfig: () => ({}) }));
jest.mock("@/lib/integrations/secrets", () => ({ tokenKey: () => "k" }));
// ServiceM8's half of the same module, never called by Xero's loader
jest.mock("@/lib/integrations/sm8", () => ({ sm8Config: () => null }));
jest.mock("@/lib/integrations/sm8-read", () => ({ readSm8Vendor: jest.fn() }));
jest.mock("@/lib/integrations/sm8-sync", () => ({ listSm8SyncStatus: jest.fn() }));
jest.mock("@/lib/integrations/sm8-freshness", () => ({ freshenSm8AfterResponse: jest.fn() }));
jest.mock("@/lib/integrations/sm8-store", () => ({ readSm8AccountChange: jest.fn() }));
jest.mock("@/lib/integrations/sm8-write-cancel", () => ({ countSm8WritesCancelledSince: jest.fn() }));
jest.mock("@/lib/integrations/sm8-writes", () => ({ sm8WriteKindsEnabled: () => [] }));
jest.mock("@/lib/integrations/sm8-quote-trial", () => ({ quotesOnTrial: jest.fn() }));

import { loadXero } from "../load";

const view = (over: Record<string, unknown> = {}) => ({
  provider: "xero",
  status: "connected",
  tenantId: "t1",
  tenantName: "Acme Air Pty Ltd",
  tenants: [],
  scopes: [],
  missing: [],
  connectedAt: null,
  connectedByName: null,
  lastError: null,
  writeMode: "off",
  ...over,
});

beforeEach(() => {
  getConnectionView.mockReset().mockResolvedValue(view());
  countPayrollEmployees.mockClear();
  getXeroPeopleData.mockClear();
});

describe("Xero's loader", () => {
  it("reads what the grant can see, the people and who else holds it, through a working grant", async () => {
    const p = await loadXero("org-1", {});
    expect(getConnectionView).toHaveBeenCalledWith("org-1", "xero");
    expect(p).toMatchObject({ configured: true, sealed: true, notice: null, reach: { ok: true, employees: 9 }, elsewhere: 0 });
    expect(p.people).toEqual({ rows: [], linkable: [], error: null });
    expect(countConnectionsElsewhere).toHaveBeenCalledWith("org-1", "xero", "t1");
  });

  it("reads nothing live through a grant that needs reconnecting, or none", async () => {
    getConnectionView.mockResolvedValue(view({ status: "needs_reauth" }));
    expect((await loadXero("org-1", {})).reach).toBeNull();
    getConnectionView.mockResolvedValue(null);
    expect(await loadXero("org-1", {})).toMatchObject({ connection: null, reach: null, people: null });
    expect(countPayrollEmployees).not.toHaveBeenCalled();
  });

  it("says a failed read, never a zero", async () => {
    countPayrollEmployees.mockResolvedValueOnce({ ok: false, error: "The Xero connection needs reconnecting." });
    expect((await loadXero("org-1", {})).reach).toEqual({ ok: false, error: "The Xero connection needs reconnecting." });
  });

  it("names the organisation a round trip connected, and says a refused one from the table", async () => {
    expect((await loadXero("org-1", { connected: "1" })).notice).toEqual({ kind: "ok", text: "Connected to Acme Air Pty Ltd." });
    expect((await loadXero("org-1", { error: "denied" })).notice).toEqual({
      kind: "error",
      text: "You cancelled the Xero connection, so nothing changed.",
    });
    // never the URL's own words
    expect((await loadXero("org-1", { error: "<b>pay here</b>" })).notice?.text).toBe("Something went wrong connecting Xero. Try again.");
  });
});
