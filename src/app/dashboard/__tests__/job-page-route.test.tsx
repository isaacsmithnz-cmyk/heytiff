/* A JOB'S OWN PAGE, /dashboard/jobs/[id] (v2, step 5): the Workboard's gate,
   the job read inside the caller's org (a foreign id is a 404, not a leak),
   a claim's id sent to its parent's page, and `?tab=` naming the section. */

let held: Set<string> = new Set();
const can = jest.fn(async (c: string) => held.has(c));
const redirect = jest.fn((to: string): never => {
  throw new Error(`REDIRECT:${to}`);
});
jest.mock("@/lib/permissions-server", () => ({ can: (c: string) => can(c) }));
jest.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
  notFound: (): never => {
    throw new Error("NOT_FOUND");
  },
}));
let orgId: string | null = "org-1";
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: jest.fn(async () => (orgId ? { user: { sub: "auth0|me" }, orgId } : null)) } }));
const resolveJobCard = jest.fn(async (_org: string, id: string) => ({ parentRemoteId: id, focusRemoteId: null as string | null }));
jest.mock("@/lib/workboard/all-jobs-query", () => ({ resolveJobCard: (o: string, id: string) => resolveJobCard(o, id) }));
/* this org's mirror holds one job */
const openMirrorJob = jest.fn(async (id: string) => (id === "j-3209" ? { id, number: "3209", clientName: "Richards Building" } : null));
jest.mock("@/app/actions/workboard", () => ({ openMirrorJob: (id: string) => openMirrorJob(id) }));
jest.mock("@/components/jobs/job-page", () => ({ JobPage: () => null }));

import JobPageRoute from "../jobs/[id]/page";

type Props = { row: { id: string }; section: string; manage: boolean; moneyVisible: boolean; add: string | null };
const visit = async (id: string, search: Record<string, string | string[] | undefined> = {}) =>
  (await JobPageRoute({ params: Promise.resolve({ id }), searchParams: Promise.resolve(search) })) as { props: Props };

beforeEach(() => {
  held = new Set(["workboard"]);
  orgId = "org-1";
  can.mockClear();
  redirect.mockClear();
  resolveJobCard.mockClear();
  openMirrorJob.mockClear();
});

describe("the gate", () => {
  it("sends someone without the Workboard back to /dashboard before it reads anything", async () => {
    held = new Set();
    await expect(visit("j-3209")).rejects.toThrow("REDIRECT:/dashboard");
    expect(can).toHaveBeenCalledWith("workboard");
    expect(resolveJobCard).not.toHaveBeenCalled();
    expect(openMirrorJob).not.toHaveBeenCalled();
  });

  it("sends a session with no workspace back to /dashboard", async () => {
    orgId = null;
    await expect(visit("j-3209")).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("lets a tech in without manage and without the money", async () => {
    const page = await visit("j-3209");
    expect(page.props).toMatchObject({ row: { id: "j-3209" }, section: "overview", manage: false, moneyVisible: false });
    expect(resolveJobCard).toHaveBeenCalledWith("org-1", "j-3209");
  });
});

describe("the job", () => {
  it("is a 404 for an id this org's mirror doesn't hold", async () => {
    await expect(visit("someone-elses-job")).rejects.toThrow("NOT_FOUND");
  });

  it("is a 404 for an empty id", async () => {
    await expect(visit("   ")).rejects.toThrow("NOT_FOUND");
  });

  it("sends a claim's id to its parent job's page, on Billing for whoever sees the money", async () => {
    resolveJobCard.mockResolvedValueOnce({ parentRemoteId: "j-3209", focusRemoteId: "j-3209a" });
    held = new Set(["workboard", "workboard_money"]);
    await expect(visit("j-3209a")).rejects.toThrow("REDIRECT:/dashboard/jobs/j-3209?tab=billing");
  });
});

describe("?tab=", () => {
  it("opens the section it names", async () => {
    expect((await visit("j-3209", { tab: "photos" })).props.section).toBe("photos");
    expect((await visit("j-3209", { tab: "Documents" })).props.section).toBe("documents");
  });

  it("lands an invented one, a repeated one and Billing without the money on Overview", async () => {
    expect((await visit("j-3209", { tab: "ledger" })).props.section).toBe("overview");
    expect((await visit("j-3209", { tab: ["photos", "quote"] })).props.section).toBe("overview");
    expect((await visit("j-3209", { tab: "billing" })).props.section).toBe("overview");
    held = new Set(["workboard", "workboard_money"]);
    expect((await visit("j-3209", { tab: "billing" })).props.section).toBe("billing");
  });
});

describe("?add=", () => {
  it("hands Make a document's SWMS or Certificate to the page, and nothing else", async () => {
    expect((await visit("j-3209", { tab: "documents", add: "swms" })).props).toMatchObject({ section: "documents", add: "swms" });
    expect((await visit("j-3209", { tab: "documents", add: "certificate" })).props).toMatchObject({ add: "certificate" });
    expect((await visit("j-3209", { add: "quote" })).props).toMatchObject({ add: null });
    expect((await visit("j-3209")).props).toMatchObject({ add: null });
  });
});
