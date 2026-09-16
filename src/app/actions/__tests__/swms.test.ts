/* Issuing a SWMS, adopting its library, and signing on.

   Server Functions are reachable by direct POST, so "the wizard only offered
   real choices" is not a control. These tests send what the wizard never
   would, against a small in-memory database, and check what gets written. */

import { fakeDb, type FakeDb } from "@/lib/swms/__tests__/fixtures/fake-db";
import { DEFAULT_ANSWERS, LIBRARY_VERSION, type SwmsContent } from "@/lib/swms/library";

/* jest.setup stubs this module for every screen that contains the job card;
   this suite is the one that wants it real. */
jest.unmock("../swms");

let mockDb: FakeDb;
let mockCaps = new Set<string>(["workboard"]);
let mockRole: string | null = "staff";
let mockMe: string | null = "troy";

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (t: string) => mockDb.client.from(t) },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/permissions-server", () => ({
  requireOrg: async (c?: string) => {
    if (c && !mockCaps.has(c)) throw new Error("Insufficient permissions");
    return { orgId: "org-1", userId: "auth0|me" };
  },
  getDbRole: async () => mockRole,
}));
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: async () => mockMe }));
jest.mock("@/lib/integrations/links", () => ({
  sm8StaffLinkMap: async () => new Map([["sm8-troy", "troy"]]),
}));

import { approveSwmsLibrary, issueSwms, signOnSwms, swmsWizardContext, type IssueSwmsInput } from "../swms";

const ORG = "org-1";
const staff = (id: string, first: string, last: string, status = "Active", org = ORG) => ({
  org_id: org, id, first_name: first, last_name: last, full_name: null, preferred_name: null, job_title: null, status,
});

beforeEach(() => {
  mockDb = fakeDb();
  mockCaps = new Set(["workboard"]);
  mockRole = "staff";
  mockMe = "troy";
  Object.assign(mockDb.tables, {
    sm8_jobs: [{ org_id: ORG, uuid: "job-1", generated_job_id: "2601", company_uuid: "co-1", job_address: "14 Attunga Road, Miranda NSW 2228", geo_state: "NSW", job_description: "Supply and install a 5.0 kW split system", active: 1 }],
    sm8_companies: [{ org_id: ORG, uuid: "co-1", name: "M. and J. Rowe" }],
    staff_profiles: [
      staff("troy", "Troy", "Porter"),
      staff("dane", "Dane", "Whitmore"),
      staff("sam", "Sam", "Ikpeba"),
      staff("lena", "Lena", "Vukovic", "Inactive"),
      staff("stranger", "Someone", "Else", "Active", "org-2"),
    ],
    sm8_job_activities: [{ org_id: ORG, job_uuid: "job-1", staff_uuid: "sm8-troy", active: 1, activity_was_scheduled: 1 }],
    staff_licences: [{ org_id: ORG, staff_profile_id: "troy", type_name: "White Card", expiry_date: null }],
    swms_library_approvals: [{ org_id: ORG, library_version: LIBRARY_VERSION }],
  });
});

const input = (over: Partial<IssueSwmsInput> = {}): IssueSwmsInput => ({
  jobUuid: "job-1",
  answers: { ...DEFAULT_ANSWERS, isolation: "Main switchboard, garage wall", hospital: "Sutherland Hospital, Caringbah" },
  staffIds: ["troy", "dane", "sam"],
  outsiders: [{ name: "Kai Lindqvist", company: "Lindqvist Plumbing" }],
  responsibleStaffId: "troy",
  electrician: "staff:sam",
  firstAider: "staff:troy",
  siteChecked: true,
  ...over,
});

const written = (table: string) => mockDb.tables[table] ?? [];

describe("swmsWizardContext", () => {
  it("opens on the job, the active team with who's booked first, and the library's state", async () => {
    const ctx = await swmsWizardContext("job-1");
    expect(ctx?.job).toMatchObject({ number: "2601", clientName: "M. and J. Rowe", jurisdiction: "NSW" });
    expect(ctx?.team.map((t) => [t.name, t.booked])).toEqual([
      ["Troy Porter", true],
      ["Dane Whitmore", false],
      ["Sam Ikpeba", false],
    ]);
    expect(ctx?.team[0].tickets).toEqual([{ name: "White Card", expires: null, current: true }]);
    expect(ctx).toMatchObject({ libraryApproved: true, canApprove: false, viewerStaffId: "troy" });
  });

  it("knows nothing about a job outside this workspace", async () => {
    mockDb.tables.sm8_jobs[0].org_id = "org-2";
    expect(await swmsWizardContext("job-1")).toBeNull();
  });

  it("is behind the workboard gate", async () => {
    mockCaps = new Set();
    await expect(swmsWizardContext("job-1")).rejects.toThrow("Insufficient permissions");
  });
});

describe("issueSwms", () => {
  it("writes version 1 from the library, with everyone it covers and who checked the site", async () => {
    const res = await issueSwms(input());
    expect(res).toMatchObject({ ok: true, version: 1 });

    const [v] = written("swms_versions");
    expect(v).toMatchObject({
      org_id: ORG,
      version: 1,
      jurisdiction: "NSW",
      reason: "First issue",
      library_version: LIBRARY_VERSION,
      responsible_staff_id: "troy",
      site_checked_by_staff_id: "troy",
      issued_by_staff_id: "troy",
    });
    const content = v.content as SwmsContent;
    expect(content.work).toBe("Supply and install a 5.0 kW split system");
    expect(content.categories.map((c) => c.n)).toEqual([1, 10, 11, 16]);
    expect(content.emergency.firstAider).toBe("Troy Porter");
    expect(JSON.stringify(content.steps)).toContain("licensed electrician — Sam Ikpeba");
    expect(content.riskScores).toBeNull();

    expect(written("swms_people").map((p) => p.staff_profile_id ?? p.outside_name)).toEqual(["troy", "dane", "sam", "Kai Lindqvist"]);
    expect(written("swms")[0]).toMatchObject({ sm8_job_uuid: "job-1", created_by_staff_id: "troy" });
  });

  it("adds the risk score appendix only when it was asked for", async () => {
    await issueSwms(input({ answers: { ...(input().answers as object), riskAppendix: true } }));
    const content = written("swms_versions")[0].content as SwmsContent;
    expect(content.riskScores?.length).toBe(content.steps.length);
  });

  it("stores the answers as the library reads them, not as they were sent", async () => {
    await issueSwms(input({ answers: { ...(input().answers as object), jurisdiction: "VIC", content: "forged", steps: { ...DEFAULT_ANSWERS.steps, roof: "yes" } } }));
    const [v] = written("swms_versions");
    expect(v.jurisdiction).toBe("NSW");
    expect((v.answers as Record<string, unknown>).content).toBeUndefined();
    expect((v.content as SwmsContent).steps.some((s) => s.key === "roof")).toBe(false);
  });

  it("writes nothing until the site has been walked", async () => {
    const res = await issueSwms(input({ siteChecked: false }));
    expect(res).toEqual({ ok: false, problems: ["Confirm you've walked the site and this SWMS matches it."] });
    expect(written("swms")).toEqual([]);
    expect(written("swms_versions")).toEqual([]);
  });

  it("refuses until the owner has adopted the library", async () => {
    mockDb.tables.swms_library_approvals = [];
    expect(await issueSwms(input())).toEqual({ ok: false, problems: ["The owner needs to adopt the SWMS library first."] });
  });

  it("refuses a team member who isn't active in this workspace", async () => {
    for (const id of ["stranger", "lena", "nobody"]) {
      expect(await issueSwms(input({ staffIds: ["troy", id] }))).toEqual({ ok: false, problems: ["Someone chosen isn't an active member of this team."] });
    }
    expect(written("swms_versions")).toEqual([]);
  });

  it("needs the electrician and the person responsible to be on it", async () => {
    const res = await issueSwms(input({ staffIds: ["troy", "dane"], electrician: "staff:sam", responsibleStaffId: "sam" }));
    expect(res.ok).toBe(false);
    expect(!res.ok && res.problems).toEqual(expect.arrayContaining(["Choose the electrician doing the connection.", "Choose who's responsible for it on site."]));
  });

  it("takes an electrician from outside the business", async () => {
    const res = await issueSwms(input({ electrician: "outside:0" }));
    expect(res.ok).toBe(true);
    expect(JSON.stringify(written("swms_versions")[0].content)).toContain("licensed electrician — Kai Lindqvist");
  });

  it("refuses a job outside this workspace", async () => {
    expect(await issueSwms(input({ jobUuid: "job-elsewhere" }))).toEqual({ ok: false, problems: ["That job isn't on this workspace's board."] });
  });

  it("is behind the workboard gate", async () => {
    mockCaps = new Set();
    await expect(issueSwms(input())).rejects.toThrow("Insufficient permissions");
  });

  it("issues a revision as the next version, and only with a reason", async () => {
    const first = await issueSwms(input());
    const swmsId = first.ok ? first.swmsId : "";

    const noReason = await issueSwms(input({ swmsId }));
    expect(noReason).toEqual({ ok: false, problems: ["Say what changed and why."] });

    const second = await issueSwms(input({ swmsId, reason: "Crane lift instead of a hoist", answers: { ...(input().answers as object), lift: "crane" } }));
    expect(second).toMatchObject({ ok: true, version: 2, swmsId });
    expect(written("swms")).toHaveLength(1);
    expect(written("swms_versions").map((v) => [v.version, v.reason])).toEqual([
      [1, "First issue"],
      [2, "Crane lift instead of a hoist"],
    ]);
  });

  it("won't revise a SWMS from another job", async () => {
    mockDb.tables.swms = [{ org_id: ORG, id: "other", sm8_job_uuid: "job-2" }];
    expect(await issueSwms(input({ swmsId: "other", reason: "x" }))).toEqual({ ok: false, problems: ["That SWMS isn't on this job."] });
  });

  it("takes back a version nobody could be put on", async () => {
    mockDb.failInsert.swms_people = { message: "boom" };
    expect(await issueSwms(input())).toEqual({ ok: false, problems: ["Couldn't save who the SWMS covers. Try again."] });
    expect(written("swms_versions")).toEqual([]);
    expect(written("swms")).toEqual([]);
  });
});

describe("approveSwmsLibrary", () => {
  it("records the owner adopting this library version", async () => {
    mockDb.tables.swms_library_approvals = [];
    mockRole = "owner";
    expect(await approveSwmsLibrary()).toEqual({ ok: true });
    expect(written("swms_library_approvals")[0]).toMatchObject({ org_id: ORG, library_version: LIBRARY_VERSION, approved_by_staff_id: "troy" });
  });

  it("is the owner's alone", async () => {
    mockDb.tables.swms_library_approvals = [];
    mockRole = "admin";
    expect(await approveSwmsLibrary()).toEqual({ ok: false, error: "Only the owner can adopt the SWMS library." });
    expect(written("swms_library_approvals")).toEqual([]);
  });
});

describe("signOnSwms", () => {
  const drawn = "M10 20 L30 40 L50 35";
  const personFor = (key: string) => written("swms_people").find((p) => (p.staff_profile_id ?? p.outside_name) === key)!.id as string;

  beforeEach(async () => {
    await issueSwms(input());
  });

  it("signs a team member on as themselves, briefed by the person responsible", async () => {
    mockMe = "dane";
    const res = await signOnSwms({ personId: personFor("dane"), pathData: drawn, briefed: true, issue: "  " });
    expect(res).toEqual({ ok: true, signedAt: "2026-09-16T07:58:00.000Z" });
    expect(written("swms_signons")[0]).toMatchObject({
      person_id: personFor("dane"),
      signed_by_user_id: "auth0|me",
      signed_by_staff_id: "dane",
      briefed_by_staff_id: "troy",
      issue_raised: null,
    });
    expect(String(written("swms_signons")[0].signature_svg)).toContain(`d="${drawn}"`);
  });

  it("won't sign someone else on", async () => {
    mockMe = "dane";
    expect(await signOnSwms({ personId: personFor("sam"), pathData: drawn, briefed: true })).toEqual({ ok: false, error: "Only they can sign on for themselves." });
    expect(written("swms_signons")).toEqual([]);
  });

  it("signs a helper on the phone of someone on the same SWMS, and nobody else's", async () => {
    mockDb.tables.staff_profiles.push(staff("hugo", "Hugo", "Trimble"));
    mockMe = "hugo";
    expect(await signOnSwms({ personId: personFor("Kai Lindqvist"), pathData: drawn, briefed: true })).toEqual({ ok: false, error: "Only someone on this SWMS can sign on a helper." });

    mockMe = "troy";
    expect(await signOnSwms({ personId: personFor("Kai Lindqvist"), pathData: drawn, briefed: true })).toMatchObject({ ok: true });
    expect(written("swms_signons")[0]).toMatchObject({ signed_by_staff_id: "troy" });
  });

  it("needs the briefing ticked and a real signature", async () => {
    mockMe = "dane";
    const id = personFor("dane");
    expect(await signOnSwms({ personId: id, pathData: drawn, briefed: false })).toEqual({ ok: false, error: "Tick that the briefing happened first." });
    expect(await signOnSwms({ personId: id, pathData: '"/><script>x</script>', briefed: true })).toEqual({ ok: false, error: "Sign in the box first." });
    expect(written("swms_signons")).toEqual([]);
  });

  it("signs on once", async () => {
    mockMe = "dane";
    const id = personFor("dane");
    await signOnSwms({ personId: id, pathData: drawn, briefed: true });
    expect(await signOnSwms({ personId: id, pathData: drawn, briefed: true })).toEqual({ ok: false, error: "Already signed on." });
  });

  it("won't sign on to a version a revision has replaced", async () => {
    mockMe = "dane";
    const old = personFor("dane");
    const swmsId = written("swms")[0].id as string;
    await issueSwms(input({ swmsId, reason: "New isolation point" }));
    expect(await signOnSwms({ personId: old, pathData: drawn, briefed: true })).toEqual({ ok: false, error: "This version has been replaced. Sign on to the latest one." });
  });

  it("knows nothing about a sign-on in another workspace", async () => {
    mockDb.tables.swms_people.forEach((p) => (p.org_id = "org-2"));
    expect(await signOnSwms({ personId: personFor("troy"), pathData: drawn, briefed: true })).toEqual({ ok: false, error: "That sign-on isn't on this workspace." });
  });
});
