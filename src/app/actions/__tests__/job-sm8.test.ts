/**
 * @jest-environment node
 */

/* Send to ServiceM8 from a job's Documents face — the gates and the answer.
   What this pins: only `workboard_manage` sends, and only where an owner has
   switched sending on; ServiceM8's own files are answered "already there"
   rather than sent back; the ticks are resolved by the same rules email
   uses (lib/compliance/send, stubbed here); the press waits for its own
   files within a budget and hands the rest to the queue; and each tick
   comes back as sent, waiting, refused or already there. The queue itself
   is lib/integrations/sm8-writes, stubbed here and tested on its own. */

jest.unmock("@/app/actions/job-sm8");

type Ctx = { orgId: string; userId: string; staffId: string | null; company: boolean; team: boolean };
let ctx: Ctx | null = null;
let jobReal = true;
const outgoing = jest.fn();

jest.mock("@/lib/compliance/send", () => ({
  complianceContext: async () => ctx,
  jobIsReal: async () => jobReal,
  outgoing: (...a: unknown[]) => outgoing(...a),
  trimId: (v: unknown) => String(v ?? "").trim().slice(0, 80),
}));

const state = {
  readable: true,
  kinds: ["attachment"] as "attachment"[],
  deployment: true,
  mode: "live" as "off" | "trial" | "live" | "paused",
  modeStored: "live" as string | null,
  pausedReason: null as "owner" | "cap" | null,
  pausedAt: null as string | null,
  linked: true,
  connected: true,
  tenantId: "vendor-1" as string | null,
  granted: ["attachment"] as "attachment"[],
  refused: [] as "attachment"[],
  timezoneName: null as string | null,
  /* the owner's per-kind switch (two-way phase 2): files on */
  ownerKinds: ["attachment"] as "attachment"[],
  ownerKindsRead: true,
};
const FRESH = { ...state };

/* the press is minted from the session in the real module; here it is a
   token the queue (stubbed) receives */
const PRESS = { orgId: "org-1", userId: "auth0|isaac", staffId: "staff-isaac", at: 0 };
let press: typeof PRESS | null = PRESS;
jest.mock("@/lib/integrations/sm8-press", () => ({ sm8PressFromSession: async () => press }));

const readJobSends = jest.fn();
const enqueueAttachments = jest.fn();
const runSm8Writes = jest.fn();
jest.mock("@/lib/integrations/sm8-writes", () => ({
  sm8WritesEnabled: () => true,
  readSm8WriteState: async () => ({ ...state }),
  readJobSends: (...a: unknown[]) => readJobSends(...a),
  enqueueAttachments: (...a: unknown[]) => enqueueAttachments(...a),
  runSm8Writes: (...a: unknown[]) => runSm8Writes(...a),
}));

const scheduled: (() => unknown)[] = [];
jest.mock("next/server", () => ({ after: (fn: () => unknown) => scheduled.push(fn) }));

import { readJobSm8, sendJobDocumentsToServiceM8 } from "../job-sm8";
import { WRITE_WORDS } from "@/lib/integrations/sm8-write-plan";

const office: Ctx = { orgId: "org-1", userId: "auth0|isaac", staffId: "staff-isaac", company: true, team: true };

const out = (key: string, documentId: string, name: string) => ({
  ref: `org/org-1/${documentId}`,
  size: 10,
  name,
  documentId,
  mimeType: "application/pdf",
  key,
});

const sent = (documentId: string, status = "sent", error: string | null = null) => ({
  documentId,
  status,
  error,
  attempts: 1,
  remoteUuid: `r-${documentId}`,
});

beforeEach(() => {
  ctx = office;
  jobReal = true;
  press = PRESS;
  Object.assign(state, FRESH, { granted: ["attachment"], refused: [] });
  scheduled.length = 0;
  outgoing.mockReset().mockResolvedValue({
    ok: true,
    labels: [],
    files: [out("p:paper-1", "doc-a", "Public liability.pdf"), out("d:doc-b", "doc-b", "Plan.pdf")],
  });
  enqueueAttachments.mockReset().mockResolvedValue({ ids: ["w1", "w2"], already: [], capped: false });
  runSm8Writes
    .mockReset()
    .mockResolvedValue({ done: 2, sent: 2, trial: 0, failed: 0, again: 0, lost: 0, stopped: null });
  readJobSends.mockReset().mockResolvedValue([sent("doc-a"), sent("doc-b")]);
});

describe("what the card reads", () => {
  it("is nothing for someone who can't open the job card", async () => {
    ctx = null;
    expect(await readJobSm8("job-1")).toBeNull();
  });

  it("offers the button to the office where an owner switched it on", async () => {
    expect(await readJobSm8("job-1")).toEqual({ send: "live", sends: [sent("doc-a"), sent("doc-b")], hold: null });
    state.mode = "trial";
    expect((await readJobSm8("job-1"))?.send).toBe("trial");
  });

  it("still gives the rows their words where the button isn't offered", async () => {
    ctx = { ...office, company: false };
    expect(await readJobSm8("job-1")).toEqual({ send: null, sends: [sent("doc-a"), sent("doc-b")], hold: null });
    ctx = office;
    state.mode = "off";
    expect((await readJobSm8("job-1"))?.send).toBeNull();
  });

  it("keeps the button while paused, and says what holds the files waiting", async () => {
    state.mode = "paused";
    expect(await readJobSm8("job-1")).toMatchObject({ send: "live", hold: "paused" });
    state.mode = "live";
    state.connected = false;
    expect(await readJobSm8("job-1")).toMatchObject({ send: "live", hold: "reconnect" });
    state.connected = true;
    state.refused = ["attachment"];
    expect((await readJobSm8("job-1"))?.hold).toBe("reconnect");
  });
});

describe("who may send, and when", () => {
  it("refuses anyone without workboard_manage", async () => {
    ctx = { ...office, company: false };
    expect(await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1"] })).toEqual({
      ok: false,
      error: "You can't send documents from jobs.",
    });
    expect(enqueueAttachments).not.toHaveBeenCalled();
  });

  it("refuses a job this workspace doesn't hold", async () => {
    jobReal = false;
    const res = await sendJobDocumentsToServiceM8({ jobUuid: "job-x", keys: ["p:paper-1"] });
    expect(res).toEqual({ ok: false, error: "That job isn't in ServiceM8's copy any more." });
  });

  it("says why sending is off, in the owner's terms", async () => {
    state.mode = "off";
    const res = await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1"] });
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/^Sending to ServiceM8 is switched off/) });
    state.mode = "live";
    state.granted = [];
    const res2 = await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1"] });
    expect(res2).toEqual({ ok: false, error: expect.stringMatching(/permission to add files/) });
    expect(enqueueAttachments).not.toHaveBeenCalled();
  });

  it("says sending is paused, and queues nothing", async () => {
    state.mode = "paused";
    expect(await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1"] })).toEqual({
      ok: false,
      error: "Sending to ServiceM8 is paused. An owner can change that in Integrations, ServiceM8.",
    });
    expect(enqueueAttachments).not.toHaveBeenCalled();
  });

  it("queues nothing without a press from this workspace's session", async () => {
    press = null;
    expect(await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1"] })).toEqual({
      ok: false,
      error: "You can't send documents from jobs.",
    });
    press = { ...PRESS, orgId: "org-2" };
    expect(await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1"] })).toEqual({
      ok: false,
      error: "You can't send documents from jobs.",
    });
    expect(enqueueAttachments).not.toHaveBeenCalled();
  });

  it("says sending is paused when this press would pass the hourly cap", async () => {
    enqueueAttachments.mockResolvedValue({ ids: [], already: [], capped: true });
    expect(await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1"] })).toEqual({
      ok: false,
      error: "Sending to ServiceM8 is paused. An owner can change that in Integrations, ServiceM8.",
    });
    expect(runSm8Writes).not.toHaveBeenCalled();
  });
});

describe("what goes", () => {
  it("answers ServiceM8's own files 'already there', and sends none of them back", async () => {
    const res = await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["f:sm8-1"] });
    expect(res).toEqual({ ok: false, error: "Those came from ServiceM8, so they're there already." });
    expect(outgoing).not.toHaveBeenCalled();
  });

  it("resolves ours by the email's rules, with ServiceM8's own left out of the ask", async () => {
    await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1", "d:doc-b", "f:sm8-1"] });
    expect(outgoing).toHaveBeenCalledWith(office, "job-1", { papers: ["paper-1"], documents: ["doc-b"], files: [] });
  });

  it("passes the email's refusal straight through — an expired paper goes nowhere either way", async () => {
    outgoing.mockResolvedValue({ ok: false, error: "Public liability on this job has expired." });
    expect(await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1"] })).toEqual({
      ok: false,
      error: "Public liability on this job has expired.",
    });
  });

  it("queues each file for the connected account, as the person who pressed", async () => {
    await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1", "d:doc-b"] });
    expect(enqueueAttachments).toHaveBeenCalledWith(PRESS, expect.objectContaining({ tenantId: "vendor-1" }), [
      { jobUuid: "job-1", documentId: "doc-a", name: "Public liability.pdf", mimeType: "application/pdf", sizeBytes: 10, key: "p:paper-1" },
      { jobUuid: "job-1", documentId: "doc-b", name: "Plan.pdf", mimeType: "application/pdf", sizeBytes: 10, key: "d:doc-b" },
    ]);
  });

  it("waits for this press's files within a budget", async () => {
    await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1", "d:doc-b"] });
    expect(runSm8Writes).toHaveBeenCalledWith("org-1", "send", { ids: ["w1", "w2"], budgetMs: 20_000 });
  });

  /* EVERY PRESS DRAINS. Behind the answer, one sender takes whatever is due
     for the workspace — this press's leftovers, a file due again at once
     under a new uuid, and anything an earlier press left waiting — however
     this press's own run ended. */
  const pressThenDrain = async () => {
    await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1", "d:doc-b"] });
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();
    expect(runSm8Writes).toHaveBeenLastCalledWith("org-1", "send", { budgetMs: 90_000 });
  };

  it("drains the workspace behind the answer when the press's files all went", async () => {
    await pressThenDrain();
  });

  it("drains when the budget didn't reach every file", async () => {
    runSm8Writes.mockResolvedValueOnce({ done: 1, sent: 1, trial: 0, failed: 0, again: 0, lost: 0, stopped: null });
    await pressThenDrain();
  });

  it("drains when a file is due again at once — a dead record under its new uuid", async () => {
    runSm8Writes.mockResolvedValueOnce({ done: 2, sent: 1, trial: 0, failed: 0, again: 1, lost: 0, stopped: null });
    await pressThenDrain();
  });

  it("doesn't drain when the press's own run stopped — an unreachable ServiceM8 would take the next file's attempt too", async () => {
    /* unreachable holds nothing back: the press's other files are due at
       once, and a drain would upload the next into the same outage */
    runSm8Writes.mockResolvedValueOnce({
      done: 1,
      sent: 0,
      trial: 0,
      failed: 0,
      again: 0,
      lost: 0,
      stopped: WRITE_WORDS.unreachable,
    });
    await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1", "d:doc-b"] });
    for (const fn of scheduled) await fn();
    expect(runSm8Writes).toHaveBeenCalledTimes(1);
  });

  it("doesn't drain behind a run still going at the answer that then stops", async () => {
    jest.useFakeTimers();
    try {
      let finish: (r: unknown) => void = () => {};
      runSm8Writes.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
      readJobSends.mockResolvedValue([sent("doc-a", "sending"), sent("doc-b", "queued")]);
      const pressing = sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1", "d:doc-b"] });
      await jest.advanceTimersByTimeAsync(21_000);
      await pressing;
      expect(scheduled).toHaveLength(1);
      const behind = Promise.resolve(scheduled[0]());
      finish({ done: 1, sent: 0, trial: 0, failed: 0, again: 0, lost: 0, stopped: WRITE_WORDS.unreachable });
      await behind;
      expect(runSm8Writes).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("drains when every tick was already on its way, and nothing was queued", async () => {
    enqueueAttachments.mockResolvedValue({ ids: [], already: ["doc-a", "doc-b"], capped: false });
    await pressThenDrain();
    expect(runSm8Writes).toHaveBeenCalledTimes(1);
  });

  it("answers within its budget however long ServiceM8 takes, and drains only once the send behind the answer ends", async () => {
    jest.useFakeTimers();
    try {
      let finish: (r: unknown) => void = () => {};
      runSm8Writes.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
      readJobSends.mockResolvedValue([sent("doc-a", "sending"), sent("doc-b", "queued")]);
      let answered: unknown = null;
      const pressing = sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1", "d:doc-b"] }).then(
        (r) => (answered = r)
      );
      await jest.advanceTimersByTimeAsync(21_000);
      await pressing;
      expect(answered).toMatchObject({ ok: true, sent: [], waiting: ["p:paper-1", "d:doc-b"] });
      expect(scheduled).toHaveLength(1);

      // behind the answer: the run still going is waited for — nothing else keeps it alive — then the drain
      const behind = Promise.resolve(scheduled[0]());
      await jest.advanceTimersByTimeAsync(0);
      expect(runSm8Writes).toHaveBeenCalledTimes(1);
      finish({ done: 1, sent: 1, trial: 0, failed: 0, again: 0, lost: 0, stopped: null });
      await behind;
      expect(runSm8Writes).toHaveBeenCalledTimes(2);
      expect(runSm8Writes).toHaveBeenLastCalledWith("org-1", "send", { budgetMs: 90_000 });
    } finally {
      jest.useRealTimers();
    }
  });

  /* The drain runs inside this action's function, which ends 300 s after the
     press: its last claim must end a lease (120 s) and a margin (15 s)
     before that, so it may claim until 165 s in and no later. */
  const slowFirstRun = async (msBehind: number) => {
    let finish: (r: unknown) => void = () => {};
    runSm8Writes.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    readJobSends.mockResolvedValue([sent("doc-a", "sending"), sent("doc-b", "queued")]);
    const pressing = sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1", "d:doc-b"] });
    await jest.advanceTimersByTimeAsync(20_000);
    await pressing;
    const behind = Promise.resolve(scheduled[0]());
    // the first run's last send holds its row this long past the answer
    await jest.advanceTimersByTimeAsync(msBehind);
    finish({ done: 1, sent: 1, trial: 0, failed: 0, again: 0, lost: 0, stopped: null });
    await behind;
  };

  it("gives the drain only what the function has left", async () => {
    jest.useFakeTimers();
    try {
      await slowFirstRun(130_000); // 150 s in
      expect(runSm8Writes).toHaveBeenLastCalledWith("org-1", "send", { budgetMs: 15_000 });
    } finally {
      jest.useRealTimers();
    }
  });

  it("drains nothing once the function has no time for another send", async () => {
    jest.useFakeTimers();
    try {
      await slowFirstRun(150_000); // 170 s in
      expect(runSm8Writes).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("what comes back, tick by tick", () => {
  it("says what went", async () => {
    expect(await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1", "d:doc-b"] })).toEqual({
      ok: true,
      trial: false,
      sent: ["p:paper-1", "d:doc-b"],
      waiting: [],
      failed: [],
      already: [],
      sends: [sent("doc-a"), sent("doc-b")],
    });
  });

  it("says what is still to go, what was refused and why, and what was there already", async () => {
    outgoing.mockResolvedValue({
      ok: true,
      labels: [],
      files: [
        out("p:paper-1", "doc-a", "Public liability.pdf"),
        out("d:doc-b", "doc-b", "Plan.pdf"),
        out("d:doc-c", "doc-c", "Photo.jpg"),
      ],
    });
    enqueueAttachments.mockResolvedValue({ ids: ["w1", "w2"], already: ["doc-c"] });
    readJobSends.mockResolvedValue([
      sent("doc-a", "queued"),
      sent("doc-b", "failed", "ServiceM8 said the file is too big."),
      sent("doc-c"),
    ]);
    const res = await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1", "d:doc-b", "d:doc-c", "f:sm8-1"] });
    expect(res).toMatchObject({
      ok: true,
      sent: [],
      waiting: ["p:paper-1"],
      failed: [{ key: "d:doc-b", error: "ServiceM8 said the file is too big." }],
      already: ["f:sm8-1", "d:doc-c"],
    });
  });

  it("judges a two-file licence over both its files", async () => {
    outgoing.mockResolvedValue({
      ok: true,
      labels: [],
      files: [out("p:lic", "front", "ARC licence 1.jpg"), out("p:lic", "back", "ARC licence 2.jpg")],
    });
    readJobSends.mockResolvedValue([sent("front"), sent("back", "queued")]);
    const res = await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:lic"] });
    expect(res).toMatchObject({ sent: [], waiting: ["p:lic"] });
  });

  it("counts a trial run's files as what would have gone", async () => {
    state.mode = "trial";
    readJobSends.mockResolvedValue([sent("doc-a", "trial"), sent("doc-b", "trial")]);
    const res = await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1", "d:doc-b"] });
    expect(res).toMatchObject({ ok: true, trial: true, sent: ["p:paper-1", "d:doc-b"] });
  });

  it("says so when the queue couldn't be written", async () => {
    enqueueAttachments.mockResolvedValue(null);
    expect(await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1"] })).toEqual({
      ok: false,
      error: "Couldn't queue those for ServiceM8. Try again.",
    });
    expect(runSm8Writes).not.toHaveBeenCalled();
  });
});
