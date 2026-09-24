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
  deployment: true,
  mode: "live" as "off" | "trial" | "live",
  connected: true,
  tenantId: "vendor-1" as string | null,
  granted: true,
};
const readJobSends = jest.fn();
const enqueueAttachments = jest.fn();
const runSm8Writes = jest.fn();
jest.mock("@/lib/integrations/sm8-writes", () => ({
  readSm8WriteState: async () => ({ ...state }),
  readJobSends: (...a: unknown[]) => readJobSends(...a),
  enqueueAttachments: (...a: unknown[]) => enqueueAttachments(...a),
  runSm8Writes: (...a: unknown[]) => runSm8Writes(...a),
}));

const scheduled: (() => unknown)[] = [];
jest.mock("next/server", () => ({ after: (fn: () => unknown) => scheduled.push(fn) }));

import { readJobSm8, sendJobDocumentsToServiceM8 } from "../job-sm8";

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
  Object.assign(state, { deployment: true, mode: "live", connected: true, tenantId: "vendor-1", granted: true });
  scheduled.length = 0;
  outgoing.mockReset().mockResolvedValue({
    ok: true,
    labels: [],
    files: [out("p:paper-1", "doc-a", "Public liability.pdf"), out("d:doc-b", "doc-b", "Plan.pdf")],
  });
  enqueueAttachments.mockReset().mockResolvedValue({ ids: ["w1", "w2"], already: [] });
  runSm8Writes.mockReset().mockResolvedValue({ done: 2, sent: 2, trial: 0, failed: 0, stopped: null });
  readJobSends.mockReset().mockResolvedValue([sent("doc-a"), sent("doc-b")]);
});

describe("what the card reads", () => {
  it("is nothing for someone who can't open the job card", async () => {
    ctx = null;
    expect(await readJobSm8("job-1")).toBeNull();
  });

  it("offers the button to the office where an owner switched it on", async () => {
    expect(await readJobSm8("job-1")).toEqual({ send: "live", sends: [sent("doc-a"), sent("doc-b")] });
    state.mode = "trial";
    expect((await readJobSm8("job-1"))?.send).toBe("trial");
  });

  it("still gives the rows their words where the button isn't offered", async () => {
    ctx = { ...office, company: false };
    expect(await readJobSm8("job-1")).toEqual({ send: null, sends: [sent("doc-a"), sent("doc-b")] });
    ctx = office;
    state.mode = "off";
    expect((await readJobSm8("job-1"))?.send).toBeNull();
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
    state.granted = false;
    const res2 = await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1"] });
    expect(res2).toEqual({ ok: false, error: expect.stringMatching(/permission to add files/) });
    expect(enqueueAttachments).not.toHaveBeenCalled();
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
    expect(enqueueAttachments).toHaveBeenCalledWith("org-1", "vendor-1", "staff-isaac", [
      { jobUuid: "job-1", documentId: "doc-a", name: "Public liability.pdf", mimeType: "application/pdf", sizeBytes: 10, key: "p:paper-1" },
      { jobUuid: "job-1", documentId: "doc-b", name: "Plan.pdf", mimeType: "application/pdf", sizeBytes: 10, key: "d:doc-b" },
    ]);
  });

  it("waits for this press's files within a budget", async () => {
    await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1", "d:doc-b"] });
    expect(runSm8Writes).toHaveBeenCalledWith("org-1", "send", { ids: ["w1", "w2"], budgetMs: 20_000 });
    // both went: nothing left to hand on
    expect(scheduled).toHaveLength(0);
  });

  it("hands what the budget didn't reach to a sender behind the response", async () => {
    runSm8Writes.mockResolvedValueOnce({ done: 1, sent: 1, trial: 0, failed: 0, stopped: null });
    await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1", "d:doc-b"] });
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();
    expect(runSm8Writes).toHaveBeenLastCalledWith("org-1", "send", { ids: ["w1", "w2"] });
  });

  it("leaves a run ServiceM8 stopped to the retries it has already set", async () => {
    runSm8Writes.mockResolvedValueOnce({ done: 1, sent: 0, trial: 0, failed: 0, stopped: "ServiceM8 couldn't be reached." });
    await sendJobDocumentsToServiceM8({ jobUuid: "job-1", keys: ["p:paper-1", "d:doc-b"] });
    expect(scheduled).toHaveLength(0);
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
