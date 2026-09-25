/* A `?job=` link to a job past the board's window (2026-09-24). ⌘K finds any
   job in the mirror and opens it on the Workboard, whose book only carries
   56 days of finished work — so the page used to land on the board with
   nothing open for exactly the jobs somebody had to search for. */

const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: () => getSession() } }));
const readMirrorJobRow = jest.fn();
jest.mock("@/lib/workboard/all-jobs-query", () => ({
  EMPTY_ALL_JOBS: { jobs: [], truncated: false, projectLinks: [] },
  loadAllJobs: jest.fn(),
  readMirrorJobRow: (...a: unknown[]) => readMirrorJobRow(...a),
}));
jest.mock("next/server", () => ({ after: jest.fn() }));
jest.mock("@/lib/permissions-server", () => ({ can: jest.fn() }));
jest.mock("@/lib/integrations/store", () => ({ getConnectionView: jest.fn() }));
jest.mock("@/lib/integrations/sm8-sync", () => ({ listSm8SyncStatus: jest.fn() }));
jest.mock("@/lib/integrations/sm8-freshness", () => ({ freshenSm8AfterResponse: jest.fn() }));
jest.mock("@/lib/workboard/notes-query", () => ({ listFlags: jest.fn() }));
jest.mock("@/lib/workboard/board-query", () => ({ loadMaintenanceBoard: jest.fn() }));
jest.mock("@/lib/workboard/projects-board-query", () => ({ loadProjectsBoard: jest.fn() }));
jest.mock("@/lib/workboard/visit-ensure", () => ({
  autoCompleteVisitsFromMirror: jest.fn(),
  ensureVisits: jest.fn(),
}));
jest.mock("@/lib/workboard/claim-mirror", () => ({ ensureMirrorClaims: jest.fn() }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: jest.fn() }));

import { linkedVisit, loadLinkedJob, type WorkboardData } from "@/lib/workboard/page-data";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";

const job = (remoteId: string): AllJobsMirrorJob => ({
  remoteId,
  jobNumber: "288",
  status: "Completed",
  clientName: "Kingsford Bakery",
  description: null,
  suburb: null,
  categoryName: null,
  categoryColour: null,
  date: null,
  quoteDate: null,
  completionDate: null,
  nextBooking: null,
  money: null,
  paidCents: 0,
});

const data = (jobs: AllJobsMirrorJob[], moneyVisible = false) =>
  ({
    today: "2026-09-24",
    moneyVisible,
    allJobs: { jobs, truncated: false, projectLinks: [] },
  }) as unknown as WorkboardData;

beforeEach(() => {
  getSession.mockReset();
  readMirrorJobRow.mockReset();
  getSession.mockResolvedValue({ orgId: "org-1" });
});

describe("loadLinkedJob", () => {
  it("answers from the book it already holds, without asking again", async () => {
    const held = job("j-7");
    expect(await loadLinkedJob(data([held]), "j-7")).toBe(held);
    expect(readMirrorJobRow).not.toHaveBeenCalled();
  });

  it("reads a job past the window from the mirror, in this org, under this load's money rule", async () => {
    const old = job("j-288");
    readMirrorJobRow.mockResolvedValue(old);

    expect(await loadLinkedJob(data([job("j-7")], true), "j-288")).toBe(old);
    expect(readMirrorJobRow).toHaveBeenCalledWith("org-1", "j-288", "2026-09-24", {
      includeMoney: true,
    });
  });

  it("lands on the board with nothing open when the org doesn't hold the job", async () => {
    readMirrorJobRow.mockResolvedValue(null);
    expect(await loadLinkedJob(data([]), "j-someone-elses")).toBeNull();
  });

  it("reads nothing without a session", async () => {
    getSession.mockResolvedValue(null);
    expect(await loadLinkedJob(data([]), "j-288")).toBeNull();
    expect(readMirrorJobRow).not.toHaveBeenCalled();
  });
});

/* `?visit=<id>` (Home's list). The sheet reads the maintenance board's own
   row, so the board this load holds is the whole answer: a visit it doesn't
   hold (a paused agreement's, another org's, a typo) has no sheet to open. */
describe("linkedVisit", () => {
  const withVisits = (...ids: string[]) =>
    ({ board: { visits: ids.map((id) => ({ id })) } }) as unknown as WorkboardData;

  it("names a visit the board holds, as a fresh object each time", () => {
    const d = withVisits("vis-1", "vis-2");
    const first = linkedVisit(d, "vis-2");
    expect(first).toEqual({ id: "vis-2" });
    // the screen takes a link by identity, so each naming must be new
    expect(linkedVisit(d, "vis-2")).not.toBe(first);
  });

  it("reads past stray space, the way a pasted link arrives", () => {
    expect(linkedVisit(withVisits("vis-1"), " vis-1 ")).toEqual({ id: "vis-1" });
  });

  it("answers null for a visit the board doesn't hold, or none", () => {
    expect(linkedVisit(withVisits("vis-1"), "vis-other-org")).toBeNull();
    expect(linkedVisit(withVisits("vis-1"), "  ")).toBeNull();
  });
});
