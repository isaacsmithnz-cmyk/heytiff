/**
 * @jest-environment node
 */
/* The New job form's actions, and the board's offer of it, ask nothing —
   not the session, not the database — where the deployment doesn't send
   new jobs (SM8_WRITES not naming `job`). */

const requireOrg = jest.fn();
jest.mock("@/lib/permissions-server", () => ({ requireOrg: (...a: unknown[]) => requireOrg(...a) }));
const from = jest.fn();
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (...a: unknown[]) => from(...a) } }));
const readSm8WriteState = jest.fn();
jest.mock("@/lib/integrations/sm8-writes", () => ({ readSm8WriteState: (...a: unknown[]) => readSm8WriteState(...a) }));
jest.mock("@/lib/integrations/sm8-press", () => ({ sm8PressFromSession: jest.fn() }));
jest.mock("@/lib/integrations/sm8-drain", () => ({ settlePressedWrites: jest.fn() }));
jest.mock("@/lib/integrations/sm8-freshness", () => ({ syncSm8AfterSend: jest.fn() }));
jest.mock("@/app/actions/sm8-job-queue", () => ({ queueNewJob: jest.fn() }));
jest.mock("server-only", () => ({}));

import { createNewJob, matchPreviousSite, newJobLine, readNewJobCategories, searchClientSites, searchNewJobClients } from "../job-new";
import { newJobOffered } from "@/lib/workboard/new-job-offer";
import { JOB_WORDS } from "@/lib/integrations/sm8-job-words";

const U = "0b1e0b1e-0000-4000-8000-000000000001";

afterAll(() => {
  delete process.env.SM8_WRITES;
});

describe.each(["1", "attachment,note", "attachment,note,booking", "attachment,note,booking,leave", ""])("with SM8_WRITES=%j", (setting) => {
  beforeEach(() => {
    process.env.SM8_WRITES = setting;
    requireOrg.mockReset();
    from.mockReset();
    readSm8WriteState.mockReset();
  });

  it("answers every action before the session or the database", async () => {
    expect(await searchNewJobClients("Built")).toEqual([]);
    expect(await searchClientSites(U, "")).toEqual([]);
    expect(await matchPreviousSite("41 Waverley St")).toBeNull();
    expect(await readNewJobCategories()).toEqual([]);
    expect(await newJobLine(U)).toEqual({ ok: false, error: JOB_WORDS.card.jobsUnavailable });
    expect(
      await createNewJob({ pressId: U, clientName: "x", client: { kind: "existing", uuid: U }, jobAddress: "a", description: "b", categoryUuid: null, contact: null, via: null, next: null })
    ).toEqual({ ok: false, error: JOB_WORDS.card.jobsUnavailable });
    expect(requireOrg).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("never offers the form, and reads nothing to decide", async () => {
    expect(await newJobOffered("org-1", true)).toBe(false);
    expect(readSm8WriteState).not.toHaveBeenCalled();
  });
});

describe("where the deployment sends new jobs", () => {
  beforeEach(() => {
    process.env.SM8_WRITES = "attachment,job";
    requireOrg.mockReset();
  });

  it("asks that the reader runs the board", async () => {
    requireOrg.mockRejectedValue(new Error("no"));
    expect(await newJobLine(U)).toEqual({ ok: false, error: JOB_WORDS.press.noManage });
    expect(requireOrg).toHaveBeenCalledWith("workboard_manage");
  });

  it("offers the form only to someone who runs the board, where the owner has New jobs on", async () => {
    expect(await newJobOffered("org-1", false)).toBe(false);
    readSm8WriteState.mockResolvedValue({ readable: true, kinds: ["attachment", "job"], ownerKinds: ["job"], tenantId: "t", mode: "live" });
    expect(await newJobOffered("org-1", true)).toBe(true);
    readSm8WriteState.mockResolvedValue({ readable: true, kinds: ["attachment", "job"], ownerKinds: [], tenantId: "t", mode: "live" });
    expect(await newJobOffered("org-1", true)).toBe(false);
  });
});

describe("the job's own words", () => {
  /* #3387, 10-03: the card's one-line glance folds the blank line away, and
     "safe to archive Came in by phone" ran together */
  const { sm8PressFromSession } = jest.requireMock("@/lib/integrations/sm8-press") as { sm8PressFromSession: jest.Mock };
  const { queueNewJob } = jest.requireMock("@/app/actions/sm8-job-queue") as { queueNewJob: jest.Mock };

  beforeEach(() => {
    process.env.SM8_WRITES = "attachment,job";
    requireOrg.mockReset().mockResolvedValue({ orgId: "org-1" });
    sm8PressFromSession.mockReset().mockResolvedValue({ orgId: "org-1" });
    readSm8WriteState.mockReset().mockResolvedValue({ readable: true, kinds: ["attachment", "job"], ownerKinds: ["job"], tenantId: "t", mode: "live" });
    queueNewJob.mockReset().mockResolvedValue({ ok: false, error: "stop" });
  });

  const descriptionSent = async (description: string, via: string | null, next: string | null) => {
    await createNewJob({ pressId: U, clientName: "Test", client: { kind: "new", name: "Test", address: "" }, jobAddress: "1 Test St", description, categoryUuid: null, contact: null, via, next });
    return (queueNewJob.mock.calls[0]![2] as { draft: { description: string } }).draft.description;
  };

  it("closes the office's words with a stop before how it came in", async () => {
    expect(await descriptionSent("Safe to archive", "phone", "start the quote")).toBe("Safe to archive.\n\nCame in by phone. Next: start the quote.");
  });

  it("leaves words that already end a sentence, and words with nothing after them, alone", async () => {
    expect(await descriptionSent("Unit not cooling?", "email", null)).toBe("Unit not cooling?\n\nCame in by email.");
    queueNewJob.mockClear();
    expect(await descriptionSent("Safe to archive", null, null)).toBe("Safe to archive");
  });
});
