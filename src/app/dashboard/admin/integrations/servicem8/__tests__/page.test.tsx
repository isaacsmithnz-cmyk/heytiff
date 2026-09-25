/**
 * @jest-environment node
 *
 * The ServiceM8 screen's loader: what it hands the screen. The writes card
 * is drawn WHENEVER THERE IS A CONNECTION on a deployment that writes —
 * needs_reauth included, which is exactly when the owner needs to see what
 * is waiting and why — and a connect refused for settings that couldn't be
 * read says so. The screen itself is its own suite's.
 */

import type { ReactElement } from "react";

jest.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: jest.fn(async () => ({ orgId: "org-1" })) } }));
jest.mock("@/lib/permissions-server", () => ({ getDbRole: jest.fn(async () => "owner") }));
jest.mock("@/components/integrations/servicem8-screen", () => ({ Servicem8Screen: () => null }));

const getConnectionView = jest.fn();
jest.mock("@/lib/integrations/store", () => ({
  getConnectionView: (...a: unknown[]) => getConnectionView(...a),
  countConnectionsElsewhere: jest.fn(async () => 0),
}));
const readSm8Vendor = jest.fn(async () => ({ ok: true, data: { name: "Acme Air", timezoneName: null } }));
jest.mock("@/lib/integrations/sm8-read", () => ({ readSm8Vendor: () => readSm8Vendor() }));
jest.mock("@/lib/integrations/sm8-sync", () => ({
  listSm8SyncStatus: jest.fn(async () => ({ objects: [], lastRun: null })),
}));
/* Opening the screen tops ServiceM8 up behind the response; the loader only
   registers it. A promise that never settles proves the page doesn't wait. */
const freshen = jest.fn((_orgId: string): unknown => new Promise(() => {}));
jest.mock("@/lib/integrations/sm8-freshness", () => ({
  freshenSm8AfterResponse: (orgId: string) => freshen(orgId),
}));
jest.mock("@/lib/integrations/secrets", () => ({ tokenKey: () => "k" }));
jest.mock("@/lib/integrations/sm8", () => ({ sm8Config: () => ({}) }));
jest.mock("@/lib/integrations/sm8-store", () => ({ readSm8AccountChange: jest.fn(async () => null) }));
jest.mock("@/lib/integrations/sm8-write-cancel", () => ({ countSm8WritesCancelledSince: jest.fn(async () => 0) }));
jest.mock("@/app/actions/staff-import", () => ({ getSm8PeopleData: jest.fn(async () => null) }));

let kinds: string[] = ["attachment"];
const readSm8WriteState = jest.fn();
const countSm8Queue = jest.fn(async (..._a: unknown[]) => ({ waiting: 3, failed: 1 }));
jest.mock("@/lib/integrations/sm8-writes", () => ({
  sm8WriteKindsEnabled: () => kinds,
  readSm8WriteState: (...a: unknown[]) => readSm8WriteState(...a),
  countSm8Queue: (...a: unknown[]) => countSm8Queue(...a),
  countSm8WritesSentLately: jest.fn(async () => 14),
  listRecentSm8Writes: jest.fn(async () => []),
}));

import Servicem8IntegrationPage from "../page";

type Props = {
  connection: { writeMode: string; missing: string[] } | null;
  writes: Record<string, unknown> | null;
  waitingWrites: number;
  notice: { kind: string; text: string } | null;
  reach: unknown;
};

const view = (over: Record<string, unknown> = {}) => ({
  provider: "servicem8",
  status: "connected",
  tenantId: "vendor-1",
  tenantName: "Acme Air",
  tenants: [],
  scopes: ["vendor", "manage_attachments"],
  missing: [],
  connectedAt: "2026-09-01T00:00:00.000Z",
  connectedByName: null,
  lastError: null,
  writeMode: "live",
  ...over,
});

const state = (over: Record<string, unknown> = {}) => ({
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
  ...over,
});

const load = async (params: Record<string, string> = {}): Promise<Props> => {
  const el = (await Servicem8IntegrationPage({ searchParams: Promise.resolve(params) })) as ReactElement<Props>;
  return el.props;
};

beforeEach(() => {
  kinds = ["attachment"];
  getConnectionView.mockReset().mockResolvedValue(view());
  readSm8WriteState.mockReset().mockResolvedValue(state());
  freshen.mockClear();
  countSm8Queue.mockClear();
  readSm8Vendor.mockClear();
});

describe("the ServiceM8 screen's loader", () => {
  it("hands the writes card the setting, the queue and who paused it", async () => {
    readSm8WriteState.mockResolvedValue(state({ mode: "paused", pausedReason: "cap" }));
    const p = await load();
    expect(p.writes).toMatchObject({
      mode: "paused",
      pausedReason: "cap",
      hold: "paused",
      granted: ["attachment"],
      waiting: 3,
      failed: 1,
      sentLately: 14,
      hourlyCap: 60,
    });
    expect(p.waitingWrites).toBe(3);
  });

  it("counts the failures of the account connected now, the ones Retry failed files can reach", async () => {
    await load();
    expect(countSm8Queue).toHaveBeenCalledWith("org-1", "vendor-1");
  });

  it("draws the writes card while the connection needs reconnecting — when the owner needs it most", async () => {
    getConnectionView.mockResolvedValue(view({ status: "needs_reauth" }));
    readSm8WriteState.mockResolvedValue(state({ connected: false }));
    const p = await load();
    expect(p.writes).toMatchObject({ mode: "live", hold: "reconnect", waiting: 3 });
    // the live reads and the top-up still wait for a working grant
    expect(p.reach).toBeNull();
    expect(readSm8Vendor).not.toHaveBeenCalled();
    expect(freshen).not.toHaveBeenCalled();
  });

  it("tops ServiceM8 up behind the response for a working connection, and waits on none of it", async () => {
    const p = await load();
    expect(freshen).toHaveBeenCalledWith("org-1");
    // the page came back although the top-up never settled
    expect(p.writes).not.toBeNull();
  });

  it("draws no card rather than a wrong one when the settings can't be read", async () => {
    readSm8WriteState.mockResolvedValue(state({ readable: false }));
    expect((await load()).writes).toBeNull();
  });

  it("draws no card, and shows sending off, on a deployment that writes nothing", async () => {
    kinds = [];
    getConnectionView.mockResolvedValue(view({ missing: ["manage_attachments"] }));
    const p = await load();
    expect(p.writes).toBeNull();
    expect(p.connection).toMatchObject({ writeMode: "off", missing: [] });
  });

  it("says why a connect was refused for settings it couldn't read", async () => {
    expect((await load({ error: "settings" })).notice).toEqual({
      kind: "error",
      text: "HeyTiff couldn't read this workspace's ServiceM8 settings, so nothing changed. Try again.",
    });
  });
});
