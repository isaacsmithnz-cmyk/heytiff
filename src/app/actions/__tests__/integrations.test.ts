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
const setSm8WriteKind = jest.fn();
const readSm8WriteState = jest.fn();
const retryFailedSm8Writes = jest.fn();
const runSm8Writes = jest.fn();
let allowed = ["attachment"];
jest.mock("@/lib/integrations/sm8-writes", () => ({
  setSm8WriteMode: (...a: unknown[]) => setSm8WriteMode(...a),
  setSm8WriteKind: (...a: unknown[]) => setSm8WriteKind(...a),
  sm8WriteKindsEnabled: () => allowed,
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
  setServiceM8WriteKindAction,
  setServiceM8WriteModeAction,
  syncServiceM8NowAction,
} from "../integrations";

const runSm8Sync = (jest.requireMock("@/lib/integrations/sm8-sync") as { runSm8Sync: jest.Mock }).runSm8Sync;

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
  ownerKinds: ["attachment"],
  ownerKindsRead: true,
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

  it("drains what was waiting when sending goes on", async () => {
    for (const mode of ["live"]) {
      scheduled.length = 0;
      runSm8Writes.mockClear();
      expect(await setServiceM8WriteModeAction(mode)).toEqual({ ok: true });
      expect(scheduled).toHaveLength(1);
      await scheduled[0]();
      expect(runSm8Writes).toHaveBeenCalledWith("org-1", "send", { budgetMs: 90_000 });
    }
  });

  it("drains nothing when sending goes off or is paused", async () => {
    await setServiceM8WriteModeAction("off");
    await setServiceM8WriteModeAction("paused");
    expect(scheduled).toHaveLength(0);
  });

  it("refuses a trial run: it is retired, and nothing is changed", async () => {
    setSm8WriteMode.mockClear();
    expect(await setServiceM8WriteModeAction("trial")).toEqual({
      ok: false,
      error: "Trial run has been retired. Choose Off, Paused or On.",
    });
    expect(setSm8WriteMode).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(0);
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
    // the drain: everything due in the workspace, not only the retried
    expect(runSm8Writes).toHaveBeenCalledWith("org-1", "send", { budgetMs: 90_000 });
  });

  it("says when the hour has no room, queues nothing more, and still drains what was waiting", async () => {
    retryFailedSm8Writes.mockResolvedValue({ queued: 0, left: 3, capped: true, byHour: true });
    expect(await retryFailedServiceM8WritesAction()).toEqual({
      ok: true,
      note: "60 have gone to ServiceM8 in the last hour. Try again in an hour.",
    });
    expect(scheduled).toHaveLength(1);
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

describe("syncServiceM8NowAction", () => {
  it("syncs in the foreground, and drains what is waiting to go behind the answer", async () => {
    runSm8Sync.mockResolvedValue({ ran: true, note: "Synced 3 changes across 13 objects.", pagesUsed: 1, rowsPulled: 3, complete: true });
    expect(await syncServiceM8NowAction()).toEqual({ ok: true, note: "Synced 3 changes across 13 objects." });
    expect(runSm8Sync).toHaveBeenCalledWith("org-1", "manual", expect.any(Number), { deadline: expect.any(Number) });
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();
    expect(runSm8Writes).toHaveBeenCalledWith("org-1", "send", { budgetMs: 90_000 });
  });

  it("is an owner's", async () => {
    role = "admin";
    expect(await syncServiceM8NowAction()).toEqual({ ok: false, error: "Only an owner can change connected apps." });
    expect(scheduled).toHaveLength(0);
  });

  it("lets the sync run until its page's function ends: the platform's 300 s, less the 20 s margin", async () => {
    const pressed = Date.parse("2026-09-28T03:00:00Z");
    const now = jest.spyOn(Date, "now").mockReturnValue(pressed);
    try {
      runSm8Sync.mockClear();
      runSm8Sync.mockResolvedValueOnce({ ran: true, note: "Synced.", pagesUsed: 1, rowsPulled: 0, complete: true });
      await syncServiceM8NowAction();
      expect(runSm8Sync).toHaveBeenCalledWith("org-1", "manual", pressed, { deadline: pressed + 280_000 });
    } finally {
      now.mockRestore();
    }
  });

  /* Two-way phase 4, PR B: a press that meets the lease held (a live update
     being read) asks for it and tries again, rather than answering busy. */
  it("meets a lease held by a drain, and syncs once it is given back", async () => {
    const { SM8_SYNC_BUSY } = jest.requireActual("@/lib/integrations/sm8-lease") as { SM8_SYNC_BUSY: string };
    jest.useFakeTimers({ doNotFake: ["Date"] });
    runSm8Sync.mockClear();
    try {
      runSm8Sync
        .mockResolvedValueOnce({ ran: false, note: SM8_SYNC_BUSY, pagesUsed: 0, rowsPulled: 0, complete: false })
        .mockResolvedValueOnce({ ran: true, note: "Synced 1 change across 13 objects.", pagesUsed: 1, rowsPulled: 1, complete: true });
      const pending = syncServiceM8NowAction();
      await jest.advanceTimersByTimeAsync(2_000);
      expect(await pending).toEqual({ ok: true, note: "Synced 1 change across 13 objects." });
      expect(runSm8Sync).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
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

  it("counts cancelled notes apart from the files it names", async () => {
    disconnectSm8.mockResolvedValue({
      cancelled: [
        { id: "w1", name: "Public liability.pdf", kind: "attachment" },
        { id: "w2", name: "Reply", kind: "note" },
        { id: "w3", name: "Note", kind: "note" },
      ],
      inFlight: 0,
    });
    expect((await disconnectServiceM8Action()) as { note: string }).toMatchObject({
      note: expect.stringContaining("1 file and 2 notes waiting to go to ServiceM8 were cancelled: Public liability.pdf."),
    });
  });
});

/* THE OWNER'S SWITCH PER KIND (two-way phase 2): Files and Notes, each Off
   or On, under the one Off / Trial run / Paused / On. */
describe("setServiceM8WriteKindAction", () => {
  beforeEach(() => {
    allowed = ["attachment", "note"];
    setSm8WriteKind.mockReset().mockResolvedValue({ ok: true, cancelled: [] });
  });
  afterEach(() => {
    allowed = ["attachment"];
  });

  it("is an owner's", async () => {
    role = "admin";
    expect(await setServiceM8WriteKindAction("note", true)).toEqual({ ok: false, error: "Only an owner can change connected apps." });
    expect(setSm8WriteKind).not.toHaveBeenCalled();
  });

  it("refuses a kind the deployment doesn't allow, and anything that isn't a kind", async () => {
    allowed = ["attachment"];
    expect(await setServiceM8WriteKindAction("note", true)).toEqual({ ok: false, error: "Notes can't be sent from this deployment yet." });
    expect(await setServiceM8WriteKindAction("photo", true)).toEqual({ ok: false, error: "That isn't something HeyTiff sends." });
    expect(setSm8WriteKind).not.toHaveBeenCalled();
  });

  it("(F) with files alone allowed (production today) changes nothing, Files included: the card draws no switch to put it back", async () => {
    allowed = ["attachment"];
    expect(await setServiceM8WriteKindAction("attachment", false)).toEqual({ ok: false, error: "That isn't a setting." });
    expect(await setServiceM8WriteKindAction("attachment", true)).toEqual({ ok: false, error: "That isn't a setting." });
    expect(setSm8WriteKind).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(0);
  });

  it("switches Files off where notes are allowed beside them", async () => {
    setSm8WriteKind.mockResolvedValue({ ok: true, cancelled: [{ id: "w1", name: "a.pdf", kind: "attachment" }] });
    expect(await setServiceM8WriteKindAction("attachment", false)).toEqual({ ok: true, note: "Files are off. 1 file that was waiting won't go." });
    expect(setSm8WriteKind).toHaveBeenCalledWith("org-1", "attachment", false);
  });

  it("switches Notes on and drains while sending is On", async () => {
    expect(await setServiceM8WriteKindAction("note", true)).toEqual({ ok: true });
    expect(setSm8WriteKind).toHaveBeenCalledWith("org-1", "note", true);
    expect(scheduled).toHaveLength(1);
  });

  it("switches Notes off and says what it cancelled, draining nothing", async () => {
    setSm8WriteKind.mockResolvedValue({ ok: true, cancelled: [{ id: "w1", name: "Reply", kind: "note" }, { id: "w2", name: "Note", kind: "note" }] });
    expect(await setServiceM8WriteKindAction("note", false)).toEqual({ ok: true, note: "Notes are off. 2 notes that were waiting won't go." });
    expect(scheduled).toHaveLength(0);
  });
});

/* THE THIRD KIND (two-way phase 3, A-10): Bookings, Off or On, beside Files
   and Notes — only where the deployment names it, and wherever it allows
   more than one kind. */
describe("setServiceM8WriteKindAction, for bookings", () => {
  beforeEach(() => {
    allowed = ["attachment", "note", "booking"];
    setSm8WriteKind.mockReset().mockResolvedValue({ ok: true, cancelled: [] });
  });
  afterEach(() => {
    allowed = ["attachment"];
  });

  it("is an owner's", async () => {
    role = "admin";
    expect(await setServiceM8WriteKindAction("booking", true)).toEqual({ ok: false, error: "Only an owner can change connected apps." });
    expect(setSm8WriteKind).not.toHaveBeenCalled();
  });

  it("(F) is refused unless the deployment names booking — files alone, and files and notes, change nothing", async () => {
    for (const kinds of [["attachment"], ["attachment", "note"]]) {
      allowed = kinds;
      expect(await setServiceM8WriteKindAction("booking", true)).toEqual({
        ok: false,
        error: "Bookings can't be sent from this deployment yet.",
      });
    }
    expect(setSm8WriteKind).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(0);
  });

  it("(F) switches on attachment,booking: the gate is more than one kind, not notes", async () => {
    allowed = ["attachment", "booking"];
    expect(await setServiceM8WriteKindAction("booking", true)).toEqual({ ok: true });
    expect(setSm8WriteKind).toHaveBeenCalledWith("org-1", "booking", true);
    // and a deployment that names bookings alone draws no row, so it switches nothing
    allowed = ["booking"];
    setSm8WriteKind.mockClear();
    expect(await setServiceM8WriteKindAction("booking", true)).toEqual({ ok: false, error: "That isn't a setting." });
    expect(setSm8WriteKind).not.toHaveBeenCalled();
  });

  it("(F) Bookings Off says how many that were waiting won't go, in bookings' words, and drains nothing", async () => {
    setSm8WriteKind.mockResolvedValue({ ok: true, cancelled: [{ id: "w1", name: "Booking", kind: "booking" }] });
    expect(await setServiceM8WriteKindAction("booking", false)).toEqual({
      ok: true,
      note: "Bookings are off. 1 booking that was waiting won't go.",
    });
    setSm8WriteKind.mockResolvedValue({
      ok: true,
      cancelled: [
        { id: "w1", name: "Booking", kind: "booking" },
        { id: "w2", name: "Quote made a Work Order", kind: "booking" },
        { id: "w3", name: "Leftover booking cleared", kind: "booking" },
      ],
    });
    expect(await setServiceM8WriteKindAction("booking", false)).toEqual({
      ok: true,
      note: "Bookings are off. 3 bookings that were waiting won't go.",
    });
    expect(setSm8WriteKind).toHaveBeenLastCalledWith("org-1", "booking", false);
    expect(scheduled).toHaveLength(0);
    // with nothing waiting, nothing to say
    setSm8WriteKind.mockResolvedValue({ ok: true, cancelled: [] });
    expect(await setServiceM8WriteKindAction("booking", false)).toEqual({ ok: true });
  });

  it("switches Bookings on and drains while sending is On", async () => {
    expect(await setServiceM8WriteKindAction("booking", true)).toEqual({ ok: true });
    expect(scheduled).toHaveLength(1);
  });
});

describe("what the owner is told, counting bookings", () => {
  it("(F) a disconnect counts cancelled bookings apart from the files it names", async () => {
    disconnectSm8.mockResolvedValue({
      cancelled: [
        { id: "w1", name: "Public liability.pdf", kind: "attachment" },
        { id: "w2", name: "Reply", kind: "note" },
        { id: "w3", name: "Booking", kind: "booking" },
        { id: "w4", name: "Quote made a Work Order", kind: "booking" },
      ],
      inFlight: 0,
    });
    expect(((await disconnectServiceM8Action()) as { note: string }).note).toBe(
      "Disconnected here. 1 file, 1 note and 2 bookings waiting to go to ServiceM8 were cancelled: Public liability.pdf. " +
        "To fully revoke access, also remove HeyTiff from your ServiceM8 account's add-ons."
    );
  });

  it("(F) the owner's Off counts bookings apart, and says today's words without them", async () => {
    setSm8WriteMode.mockResolvedValue({
      ok: true,
      cancelled: [
        { id: "w1", name: "a.pdf", kind: "attachment" },
        { id: "w2", name: "Booking", kind: "booking" },
      ],
    });
    expect(await setServiceM8WriteModeAction("off")).toEqual({
      ok: true,
      note: "Sending is off. 1 file and 1 booking that were waiting won't go.",
    });
    setSm8WriteMode.mockResolvedValue({ ok: true, cancelled: [{ id: "w1", name: "a.pdf", kind: "attachment" }] });
    expect(await setServiceM8WriteModeAction("off")).toEqual({ ok: true, note: "Sending is off. 1 file that was waiting won't go." });
  });
});
