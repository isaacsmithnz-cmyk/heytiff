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

import { loadLinkedJob, type WorkboardData } from "@/lib/workboard/page-data";
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
