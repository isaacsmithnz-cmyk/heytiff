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
const countSm8Queue = jest.fn(async (..._a: unknown[]) => ({
  waiting: 3,
  failed: 1,
  waitingKinds: { attachment: 3, note: 0, booking: 0 },
}));
jest.mock("@/lib/integrations/sm8-writes", () => ({
  sm8WriteKindsEnabled: () => kinds,
  readSm8WriteState: (...a: unknown[]) => readSm8WriteState(...a),
  countSm8Queue: (...a: unknown[]) => countSm8Queue(...a),
  countSm8WritesSentLately: jest.fn(async () => 14),
  listRecentSm8Writes: jest.fn(async () => []),
}));

/* live updates' health (two-way phase 4, PR F): loaded only with the
   switch on, so its factory running is itself the proof */
let hooksLoaded = false;
const readSm8HooksHealth = jest.fn(async (..._a: unknown[]): Promise<unknown> => null);
jest.mock("@/lib/integrations/sm8-hooks", () => {
  hooksLoaded = true;
  return { readSm8HooksHealth: (...a: unknown[]) => readSm8HooksHealth(...a) };
});

import Servicem8IntegrationPage from "../page";

type Props = {
  connection: { writeMode: string; missing: string[] } | null;
  writes: Record<string, unknown> | null;
  writeScopes: { scope: string }[];
  waitingWrites: number;
  waitingNotes: number;
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
  ownerKinds: ["attachment"],
  ownerKindsRead: true,
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

  /* two-way phase 2: "What HeyTiff asks ServiceM8 for" lists only the write
     permissions the consent will ask for — never the notes permission on a
     deployment that sends files alone, whatever the owner's switch says */
  it("(F) with files alone allowed, the asks list never holds the notes permission", async () => {
    readSm8WriteState.mockResolvedValue(state({ ownerKinds: ["attachment", "note"] }));
    const p = await load();
    expect(p.writeScopes.map((s) => s.scope)).toEqual(["manage_attachments"]);
    expect(p.writes).toMatchObject({ kinds: ["attachment"], holds: { attachment: null } });
  });

  it("with notes allowed: the notes permission only while the owner has Notes on, and holds per kind", async () => {
    kinds = ["attachment", "note"];
    readSm8WriteState.mockResolvedValue(state({ kinds, ownerKinds: ["attachment"] }));
    let p = await load();
    expect(p.writeScopes.map((s) => s.scope)).toEqual(["manage_attachments"]);
    expect(p.writes).toMatchObject({ kinds, ownerKinds: ["attachment"], holds: { attachment: null, note: "off" } });
    readSm8WriteState.mockResolvedValue(state({ kinds, ownerKinds: ["attachment", "note"] }));
    p = await load();
    expect(p.writeScopes.map((s) => s.scope)).toEqual(["manage_attachments", "publish_job_notes"]);
  });

  it("says why a connect was refused for settings it couldn't read", async () => {
    expect((await load({ error: "settings" })).notice).toEqual({
      kind: "error",
      text: "HeyTiff couldn't read this workspace's ServiceM8 settings, so nothing changed. Try again.",
    });
  });
});

/* two-way phase 4, PR F: live updates from ServiceM8. The owner sees nothing
   while they work, and one line when they don't; with the switch anything
   but on, the page reads nothing more than it did. */
describe("the ServiceM8 screen's loader, with live updates", () => {
  const env = { ...process.env };
  beforeEach(() => {
    readSm8HooksHealth.mockReset().mockResolvedValue(null);
  });
  afterEach(() => {
    process.env = { ...env };
  });
  const on = () => {
    process.env.VERCEL_ENV = "production";
    process.env.SM8_WEBHOOKS = "1";
  };

  /* first: the module registry keeps a module once any test loads it */
  it("off: reads nothing, loads nothing, and hands the screen today's props", async () => {
    for (const [vercel, hooks] of [["production", undefined], ["production", "gone"], ["preview", "1"]] as const) {
      process.env.VERCEL_ENV = vercel;
      if (hooks === undefined) delete process.env.SM8_WEBHOOKS;
      else process.env.SM8_WEBHOOKS = hooks;
      expect(await load()).not.toHaveProperty("liveUpdates");
    }
    expect(hooksLoaded).toBe(false);
    expect(readSm8HooksHealth).not.toHaveBeenCalled();
  });

  it("on and working: one read, and nothing said", async () => {
    on();
    expect(await load()).not.toHaveProperty("liveUpdates");
    expect(readSm8HooksHealth).toHaveBeenCalledWith("org-1");
  });

  it("on and not working: the one line, in words", async () => {
    on();
    readSm8HooksHealth.mockResolvedValue({ state: "partial", missing: ["job_notes"], errors: [] });
    expect(((await load()) as Props & { liveUpdates?: string }).liveUpdates).toBe(
      "ServiceM8 isn't sending live updates for Job notes, so those wait for the next sync."
    );
  });

  it("on, but the connection needs reconnecting: not read — the connection's own line says it", async () => {
    on();
    getConnectionView.mockResolvedValue(view({ status: "needs_reauth" }));
    readSm8WriteState.mockResolvedValue(state({ connected: false }));
    expect(await load()).not.toHaveProperty("liveUpdates");
    expect(readSm8HooksHealth).not.toHaveBeenCalled();
  });
});

/* two-way phase 3: bookings, the third kind. Where the deployment doesn't
   name booking the page asks nothing about bookings (A-1); where it does,
   the booking permissions are listed only while Bookings is On, and what is
   waiting and what a switch cancelled are counted apart. */
describe("the ServiceM8 screen's loader, with bookings", () => {
  const cancelledSince = (jest.requireMock("@/lib/integrations/sm8-write-cancel") as { countSm8WritesCancelledSince: jest.Mock })
    .countSm8WritesCancelledSince;
  const accountChange = (jest.requireMock("@/lib/integrations/sm8-store") as { readSm8AccountChange: jest.Mock }).readSm8AccountChange;
  const switched = { connected: "1", switched: "1" };

  beforeEach(() => {
    cancelledSince.mockReset().mockImplementation(async (_o: string, _r: string, _at: string, kind?: string) =>
      kind === "booking" ? 2 : kind === "note" ? 1 : 3
    );
    accountChange.mockReset().mockResolvedValue({ from: "Beta Cooling", at: "2026-09-26T00:00:00.000Z" });
  });
  afterEach(() => {
    accountChange.mockReset().mockResolvedValue(null);
  });

  it("(F) with files alone, or files and notes, a switch of account counts no booking, and nothing waits to be booked", async () => {
    for (const setting of [["attachment"], ["attachment", "note"]]) {
      kinds = setting;
      cancelledSince.mockClear();
      const p = (await load(switched)) as Props & { waitingBookings?: number };
      expect(cancelledSince.mock.calls.map((c) => c[3])).toEqual(setting.length === 1 ? [undefined] : ["attachment", "note"]);
      expect(p.notice?.text).not.toMatch(/booking/);
      expect(p.waitingBookings ?? 0).toBe(0);
    }
  });

  it("(F) with bookings allowed, a switch of account counts the bookings it cancelled", async () => {
    kinds = ["attachment", "note", "booking"];
    const p = await load(switched);
    expect(cancelledSince.mock.calls.map((c) => c[3])).toEqual(["attachment", "note", "booking"]);
    expect(p.notice?.text).toBe(
      "Connected to Acme Air. It replaced Beta Cooling. HeyTiff cleared its copy of Beta Cooling and switched sending to ServiceM8 off. " +
        "3 files, 1 note and 2 bookings waiting to go to Beta Cooling were cancelled."
    );
  });

  it("lists the booking permissions only while the owner has Bookings on, and says what holds each kind", async () => {
    kinds = ["attachment", "note", "booking"];
    readSm8WriteState.mockResolvedValue(state({ kinds, ownerKinds: ["attachment", "note"] }));
    let p = await load();
    expect(p.writeScopes.map((s) => s.scope)).toEqual(["manage_attachments", "publish_job_notes"]);
    expect(p.writes).toMatchObject({ kinds, holds: { attachment: null, note: "reconnect", booking: "off" } });
    readSm8WriteState.mockResolvedValue(state({ kinds, ownerKinds: ["attachment", "note", "booking"] }));
    p = await load();
    expect(p.writeScopes.map((s) => s.scope)).toEqual(["manage_attachments", "publish_job_notes", "manage_schedule", "manage_jobs"]);
  });

  it("hands the screen the bookings waiting, for the disconnect confirm", async () => {
    kinds = ["attachment", "note", "booking"];
    countSm8Queue.mockResolvedValueOnce({ waiting: 6, failed: 0, waitingKinds: { attachment: 3, note: 1, booking: 2 } });
    const p = (await load()) as Props & { waitingBookings?: number };
    expect([p.waitingWrites, p.waitingNotes, p.waitingBookings]).toEqual([3, 1, 2]);
  });
});
