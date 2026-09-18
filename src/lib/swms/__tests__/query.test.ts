/* The SWMS reads the bell, the job card and the document stand on. */

import { fakeDb, type FakeDb } from "./fixtures/fake-db";

let mockDb: FakeDb;
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (t: string) => mockDb.client.from(t) },
}));
jest.mock("@/lib/integrations/links", () => ({ sm8StaffLinkMap: async () => new Map() }));

import { hasStandingSignon, libraryApproval, listJobSwms, loadSwmsDocument, loadSwmsJob, nearbyHospital, ownerName, pendingSignons } from "../query";

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
      { org_id: ORG, uuid: "job-1", generated_job_id: "2601", company_uuid: null, category_uuid: "cat-1", job_address: "14 Attunga Road, Miranda NSW 2228", geo_state: null, job_description: null, active: 1 },
      { org_id: ORG, uuid: "job-2", generated_job_id: "2602", company_uuid: null, job_address: "3 Palm Ave, Coorparoo QLD 4151", geo_state: null, job_description: null, active: 1 },
    ],
    sm8_categories: [{ org_id: ORG, uuid: "cat-1", name: "Install" }],
    organizations: [{ id: ORG, primary_owner_user_id: "auth0|isaac" }],
    staff_profiles: [
      { org_id: ORG, id: "isaac", user_id: "auth0|isaac", first_name: "Isaac", last_name: "Smith", job_title: "Owner", status: "Active" },
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
      { versionId: "v2", version: 2, again: true, jobNumber: "2601", site: "14 Attunga Road, Miranda NSW 2228", issuedAt: "2026-09-12T07:42:00.000Z" },
    ]);
  });

  /* someone new to a revised SWMS never saw version 1, so it isn't "again" */
  it("knows who is new to a revised SWMS", async () => {
    mockDb.tables.staff_profiles.push({ org_id: ORG, id: "sam", first_name: "Sam", last_name: "Ikpeba", job_title: null, status: "Active" });
    mockDb.tables.swms_people.push(person("p-sam", "v2", { staff: "sam" }));
    expect(await pendingSignons(ORG, "sam")).toEqual([expect.objectContaining({ versionId: "v2", again: false })]);
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
      { swmsId: "s-1", versionId: "v2", version: 2, issuedAt: "2026-09-12T07:42:00.000Z", responsible: "Troy Porter", signed: 1, total: 3, waitingOn: ["Dane Whitmore", "Kai Lindqvist"], viewerCanSign: false },
    ]);
  });

  it("is empty for a job with none", async () => {
    expect(await listJobSwms(ORG, "job-9")).toEqual([]);
  });

  it("offers a sign-on only to someone with something to sign", async () => {
    const can = async (who: string) => (await listJobSwms(ORG, "job-1", who))[0].viewerCanSign;
    expect(await can("dane")).toBe(true); // their own
    expect(await can("troy")).toBe(true); // signed, but a helper on it is waiting
    expect(await can("isaac")).toBe(false); // not on it
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

  it("reads the job's category, so the wizard doesn't ask what the job already says", async () => {
    expect((await loadSwmsDocument(ORG, "v2"))?.job?.categoryName).toBe("Install");
  });

  it("reads the site's state from the address when ServiceM8 has none", async () => {
    expect((await loadSwmsDocument(ORG, "w1"))?.job).toMatchObject({ state: "QLD", jurisdiction: "QLD", postcode: "4151" });
  });

  it("names a state the template doesn't cover instead of guessing one it does", async () => {
    mockDb.tables.sm8_jobs.push({ org_id: ORG, uuid: "job-3", generated_job_id: "2603", job_address: "8 Lygon Street, Brunswick", geo_state: "VIC", geo_postcode: "3056", active: 1 });
    expect(await loadSwmsJob(ORG, "job-3")).toMatchObject({ state: "VIC", jurisdiction: null, postcode: "3056" });
  });

  /* the register said the person in charge was briefed by themselves */
  it("says nobody briefed the person in charge", async () => {
    const people = (await loadSwmsDocument(ORG, "v2"))?.people;
    expect(people?.find((p) => p.name === "Troy Porter")?.signon?.briefedBy).toBeNull();
    const dane = (await loadSwmsDocument(ORG, "w1"))?.people.find((p) => p.name === "Dane Whitmore");
    expect(dane?.signon?.briefedBy).toBe("Troy Porter");
  });

  it("knows nothing about another workspace's version", async () => {
    expect(await loadSwmsDocument("org-2", "v2")).toBeNull();
  });
});

/* A CORRECTION CARRIES SIGN-ONS. Dane signed version 1; version 2 only
   corrected it, so nobody asks Dane again and the record says version 1. */
describe("a correction", () => {
  beforeEach(() => {
    mockDb.tables.swms_versions[1].material = false;
    mockDb.tables.swms_signons.push({
      org_id: ORG, id: "g-0", version_id: "v1", person_id: "p-old", signed_by_staff_id: "dane", briefed_by_staff_id: "troy", signature_svg: "<svg/>", issue_raised: null, signed_at: "2026-09-11T07:50:00.000Z",
    });
  });

  it("doesn't ask again of someone who signed the version it corrects", async () => {
    expect(await pendingSignons(ORG, "dane")).toEqual([]);
    expect(await hasStandingSignon(ORG, "s-1", "p-dane")).toBe(true);
  });

  it("counts them as signed on the job card, still waiting on anyone who wasn't", async () => {
    expect(await listJobSwms(ORG, "job-1", "dane")).toEqual([
      expect.objectContaining({ signed: 2, total: 3, waitingOn: ["Kai Lindqvist"], viewerCanSign: true }),
    ]);
  });

  it("shows the sign-on on the version it was given", async () => {
    const dane = (await loadSwmsDocument(ORG, "v2"))?.people.find((p) => p.name === "Dane Whitmore");
    expect(dane?.signon).toMatchObject({ at: "2026-09-11T07:50:00.000Z", version: 1 });
    expect((await loadSwmsDocument(ORG, "v2"))?.versions.map((v) => v.material)).toEqual([true, false]);
  });

  it("carries nothing when the change was to how the work is done", async () => {
    mockDb.tables.swms_versions[1].material = true;
    expect(await pendingSignons(ORG, "dane")).toHaveLength(1);
  });
});

/* THE NEAREST HOSPITAL WAS TYPED ON EVERY SWMS. It belongs to the area, so
   a new one starts with the hospital the last SWMS in the same postcode named
   — and never one from further away. */
describe("nearbyHospital", () => {
  const job = async (uuid: string) => (await loadSwmsJob(ORG, uuid))!;
  beforeEach(() => {
    mockDb.tables.swms_versions[0].answers = { hospital: "Sutherland Hospital, Caringbah" };
    mockDb.tables.swms_versions[1].answers = { hospital: "  " };
    mockDb.tables.swms_versions[2].answers = { hospital: "Princess Alexandra Hospital" };
    mockDb.tables.sm8_jobs.push({ org_id: ORG, uuid: "job-4", generated_job_id: "2604", job_address: "2 Kiora Road, Miranda NSW 2228", geo_state: "NSW", active: 1 });
  });

  it("starts with the hospital the last SWMS in the same postcode named", async () => {
    expect(await nearbyHospital(ORG, await job("job-4"))).toEqual({ name: "Sutherland Hospital, Caringbah", jobNumber: "2601" });
  });

  it("takes the newest one named", async () => {
    mockDb.tables.swms_versions[1].answers = { hospital: "St George Hospital" };
    expect((await nearbyHospital(ORG, await job("job-4")))?.name).toBe("St George Hospital");
  });

  it("offers nothing from another postcode, or for a site with none", async () => {
    mockDb.tables.sm8_jobs.push({ org_id: ORG, uuid: "job-5", generated_job_id: "2605", job_address: "9 Beach Road, Cronulla NSW 2230", geo_state: "NSW", active: 1 });
    expect(await nearbyHospital(ORG, await job("job-5"))).toBeNull();
    expect(await nearbyHospital(ORG, { ...(await job("job-4")), postcode: null })).toBeNull();
    expect(await nearbyHospital("org-2", await job("job-4"))).toBeNull();
  });
});

describe("the template", () => {
  it("says who approved it and when, and nothing until then", async () => {
    expect(await libraryApproval(ORG)).toBeNull();
    mockDb.tables.swms_library_approvals = [{ org_id: ORG, library_version: "hvac-2026.09", approved_by_staff_id: "isaac", approved_at: "2026-09-16T09:00:00.000Z" }];
    expect(await libraryApproval(ORG)).toEqual({ approvedBy: "Isaac Smith", approvedAt: "2026-09-16T09:00:00.000Z" });
  });

  it("names the owner, for anyone who needs to ask them", async () => {
    expect(await ownerName(ORG)).toBe("Isaac Smith");
    expect(await ownerName("org-2")).toBeNull();
  });
});
