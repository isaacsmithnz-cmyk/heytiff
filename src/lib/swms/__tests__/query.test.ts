/* The SWMS reads the bell, the job card and the document stand on. */

import { fakeDb, type FakeDb } from "./fixtures/fake-db";

let mockDb: FakeDb;
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (t: string) => mockDb.client.from(t) },
}));
jest.mock("@/lib/integrations/links", () => ({ sm8StaffLinkMap: async () => new Map() }));

import { listJobSwms, loadSwmsDocument, pendingSignons } from "../query";

const ORG = "org-1";
const person = (id: string, version_id: string, who: { staff?: string; outside?: string }) => ({
  org_id: ORG, id, version_id, staff_profile_id: who.staff ?? null, outside_name: who.outside ?? null, outside_company: null, created_at: `2026-09-16T07:0${id.length % 10}:00.000Z`,
});
const version = (id: string, swms_id: string, n: number) => ({
  org_id: ORG, id, swms_id, version: n, jurisdiction: "NSW", answers: {}, content: {}, library_version: "hvac-2026.09",
  reason: n === 1 ? "First issue" : "Revised", material: true, responsible_staff_id: "troy", site_checked_by_staff_id: "troy",
  site_checked_at: "2026-09-16T07:40:00.000Z", issued_by_staff_id: "troy", issued_at: `2026-09-1${n}T07:42:00.000Z`,
});

beforeEach(() => {
  mockDb = fakeDb();
  Object.assign(mockDb.tables, {
    sm8_jobs: [
      { org_id: ORG, uuid: "job-1", generated_job_id: "2601", company_uuid: null, job_address: "14 Attunga Road, Miranda NSW 2228", geo_state: null, job_description: null, active: 1 },
      { org_id: ORG, uuid: "job-2", generated_job_id: "2602", company_uuid: null, job_address: "3 Palm Ave, Coorparoo QLD 4151", geo_state: null, job_description: null, active: 1 },
    ],
    staff_profiles: [
      { org_id: ORG, id: "troy", first_name: "Troy", last_name: "Porter", job_title: "Crew lead", status: "Active" },
      { org_id: ORG, id: "dane", first_name: "Dane", last_name: "Whitmore", job_title: null, status: "Active" },
    ],
    swms: [
      { org_id: ORG, id: "s-1", sm8_job_uuid: "job-1", created_at: "2026-09-16T07:00:00.000Z" },
      { org_id: ORG, id: "s-2", sm8_job_uuid: "job-2", created_at: "2026-09-16T08:00:00.000Z" },
    ],
    swms_versions: [version("v1", "s-1", 1), version("v2", "s-1", 2), version("w1", "s-2", 1)],
    swms_people: [
      person("p-old", "v1", { staff: "dane" }),
      person("p-troy", "v2", { staff: "troy" }),
      person("p-dane", "v2", { staff: "dane" }),
      person("p-kai", "v2", { outside: "Kai Lindqvist" }),
      person("q-dane", "w1", { staff: "dane" }),
    ],
    swms_signons: [
      { org_id: ORG, id: "g-1", version_id: "v2", person_id: "p-troy", signed_by_staff_id: "troy", briefed_by_staff_id: "troy", signature_svg: "<svg/>", issue_raised: null, signed_at: "2026-09-16T07:58:00.000Z" },
      { org_id: ORG, id: "g-2", version_id: "w1", person_id: "q-dane", signed_by_staff_id: "dane", briefed_by_staff_id: "troy", signature_svg: "<svg/>", issue_raised: null, signed_at: "2026-09-16T08:10:00.000Z" },
    ],
  });
});

describe("pendingSignons", () => {
  it("asks for the latest version you're on and haven't signed — never a replaced one", async () => {
    expect(await pendingSignons(ORG, "dane")).toEqual([
      { versionId: "v2", version: 2, jobNumber: "2601", site: "14 Attunga Road, Miranda NSW 2228", issuedAt: "2026-09-12T07:42:00.000Z" },
    ]);
  });

  it("asks nothing once you've signed on", async () => {
    expect(await pendingSignons(ORG, "troy")).toEqual([]);
  });

  it("asks nothing of someone on no SWMS, or in another workspace", async () => {
    expect(await pendingSignons(ORG, "nobody")).toEqual([]);
    expect(await pendingSignons("org-2", "dane")).toEqual([]);
  });
});

describe("listJobSwms", () => {
  it("summarises the job's SWMS at its latest version, with who it's still waiting on", async () => {
    expect(await listJobSwms(ORG, "job-1")).toEqual([
      { swmsId: "s-1", versionId: "v2", version: 2, issuedAt: "2026-09-12T07:42:00.000Z", responsible: "Troy Porter", signed: 1, total: 3, waitingOn: ["Dane Whitmore", "Kai Lindqvist"] },
    ]);
  });

  it("is empty for a job with none", async () => {
    expect(await listJobSwms(ORG, "job-9")).toEqual([]);
  });
});

describe("loadSwmsDocument", () => {
  it("reads a version with its people, their sign-ons and every version before it", async () => {
    const doc = await loadSwmsDocument(ORG, "v2");
    expect(doc).toMatchObject({ version: 2, latest: true, responsible: "Troy Porter", siteCheckedBy: "Troy Porter" });
    expect(doc?.job).toMatchObject({ number: "2601", jurisdiction: "NSW" });
    expect(doc?.people.map((p) => [p.name, p.role, p.team, !!p.signon])).toEqual([
      ["Troy Porter", "Crew lead", true, true],
      ["Dane Whitmore", "", true, false],
      ["Kai Lindqvist", "", false, false],
    ]);
    expect(doc?.versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it("knows a replaced version isn't the latest", async () => {
    expect((await loadSwmsDocument(ORG, "v1"))?.latest).toBe(false);
  });

  it("reads the site's state from the address when ServiceM8 has none", async () => {
    expect((await loadSwmsDocument(ORG, "w1"))?.job?.jurisdiction).toBe("QLD");
  });

  it("knows nothing about another workspace's version", async () => {
    expect(await loadSwmsDocument("org-2", "v2")).toBeNull();
  });
});
