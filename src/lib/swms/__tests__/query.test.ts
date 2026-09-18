/* The SWMS reads the bell, the job card and the document stand on. */

import { fakeDb, type FakeDb } from "./fixtures/fake-db";

let mockDb: FakeDb;
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (t: string) => mockDb.client.from(t) },
}));
jest.mock("@/lib/integrations/links", () => ({ sm8StaffLinkMap: async () => new Map() }));

import { hasStandingSignon, libraryApproval, licencesFor, listJobSwms, loadSwmsDocument, loadSwmsJob, nearbyHospital, ownerName, pendingSignons, raisedIssues } from "../query";

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

  /* asking someone to sign on BEFORE work that is already over is a nag
     nobody can act on — and a job that left the board couldn't even be named */
  it("stops asking once the job is finished, unsuccessful or gone", async () => {
    for (const status of ["Completed", "Unsuccessful"]) {
      mockDb.tables.sm8_jobs[0].status = status;
      expect(await pendingSignons(ORG, "dane")).toEqual([]);
    }
    mockDb.tables.sm8_jobs[0].status = "Work Order";
    expect(await pendingSignons(ORG, "dane")).toHaveLength(1);
    mockDb.tables.sm8_jobs[0].active = 0;
    expect(await pendingSignons(ORG, "dane")).toEqual([]);
  });
});

/* AN ISSUE RAISED AT SIGN-ON went into the printed register and nowhere else,
   so the one person who could act on it never saw it. */
describe("raisedIssues", () => {
  beforeEach(() => {
    mockDb.tables.swms_signons[0].issue_raised = "  No anchor on the rear ridge  ";
  });

  it("tells whoever is in charge what was raised on their latest version", async () => {
    expect(await raisedIssues(ORG, "troy")).toEqual([
      { versionId: "v2", jobNumber: "2601", site: "14 Attunga Road, Miranda NSW 2228", issues: [{ name: "Troy Porter", issue: "No anchor on the rear ridge" }] },
    ]);
  });

  it("tells nobody else, and says nothing when nothing was raised", async () => {
    expect(await raisedIssues(ORG, "dane")).toEqual([]);
    mockDb.tables.swms_signons[0].issue_raised = null;
    expect(await raisedIssues(ORG, "troy")).toEqual([]);
  });

  it("clears when the SWMS is revised, or the job leaves the board", async () => {
    mockDb.tables.swms_versions.push({ ...version("v3", "s-1", 3), issued_at: "2026-09-13T07:42:00.000Z" });
    mockDb.tables.swms_people.push(person("p3-troy", "v3", { staff: "troy" }));
    expect(await raisedIssues(ORG, "troy")).toEqual([]);

    mockDb.tables.swms_versions.pop();
    mockDb.tables.swms_people.pop();
    mockDb.tables.sm8_jobs[0].status = "Completed";
    expect(await raisedIssues(ORG, "troy")).toEqual([]);
  });

  it("carries the same issue onto the job card", async () => {
    expect((await listJobSwms(ORG, "job-1"))[0].issues).toEqual([{ name: "Troy Porter", issue: "No anchor on the rear ridge" }]);
  });

  /* A CORRECTION CHANGES NOTHING ABOUT THE WORK, so it cannot be what answers
     an open issue — it used to take one off the card and out of the bell. */
  it("keeps an issue a correction carried, and drops one a new method answered", async () => {
    mockDb.tables.swms_versions.push({ ...version("v3", "s-1", 3), material: false, issued_at: "2026-09-13T07:42:00.000Z" });
    mockDb.tables.swms_people.push(person("p3-troy", "v3", { staff: "troy" }));
    expect((await listJobSwms(ORG, "job-1"))[0].issues).toEqual([{ name: "Troy Porter", issue: "No anchor on the rear ridge" }]);
    expect(await raisedIssues(ORG, "troy")).toHaveLength(1);

    mockDb.tables.swms_versions[3].material = true;
    expect((await listJobSwms(ORG, "job-1"))[0].issues).toEqual([]);
    expect(await raisedIssues(ORG, "troy")).toEqual([]);
  });

  it("stops asking once the person in charge says it's sorted", async () => {
    mockDb.tables.swms_signons[0].issue_cleared_at = "2026-09-16T08:05:00.000Z";
    mockDb.tables.swms_signons[0].issue_cleared_by_staff_id = "troy";
    expect((await listJobSwms(ORG, "job-1"))[0].issues).toEqual([]);
    expect(await raisedIssues(ORG, "troy")).toEqual([]);
    /* and the document still says what was raised, and who sorted it */
    const troy = (await loadSwmsDocument(ORG, "v2"))?.people.find((p) => p.name === "Troy Porter");
    expect(troy?.signon).toMatchObject({ issue: "No anchor on the rear ridge", issueCleared: { by: "Troy Porter", at: "2026-09-16T08:05:00.000Z" } });
  });
});

describe("listJobSwms", () => {
  it("summarises the job's SWMS at its latest version, with who it's still waiting on", async () => {
    expect(await listJobSwms(ORG, "job-1")).toEqual([
      { swmsId: "s-1", versionId: "v2", version: 2, issuedAt: "2026-09-12T07:42:00.000Z", responsible: "Troy Porter", signed: 1, total: 3, waitingOn: ["Dane Whitmore", "Kai Lindqvist"], issues: [], viewerCanSign: false, viewerSigned: false },
    ]);
  });

  it("is empty for a job with none", async () => {
    expect(await listJobSwms(ORG, "job-9")).toEqual([]);
  });

  /* the card's Sign on is the only door to the page from here, and anyone the
     SWMS covers can sign anyone else on their phone */
  it("offers a sign-on to anyone on it while anyone is waiting, and to nobody else", async () => {
    const can = async (who: string) => (await listJobSwms(ORG, "job-1", who))[0].viewerCanSign;
    expect(await can("dane")).toBe(true); // their own
    expect(await can("troy")).toBe(true); // signed, but their crew hasn't
    expect(await can("isaac")).toBe(false); // not on it

    /* the helper has signed and only a team member is waiting: the door used
       to close on the person holding the phone they'd sign on */
    mockDb.tables.swms_signons.push({ org_id: ORG, id: "g-4", version_id: "v2", person_id: "p-kai", signed_by_staff_id: "troy", briefed_by_staff_id: "troy", signature_svg: "<svg/>", issue_raised: null, signed_at: "2026-09-16T08:00:00.000Z" });
    expect(await can("troy")).toBe(true);

    mockDb.tables.swms_signons.push({ org_id: ORG, id: "g-3", version_id: "v2", person_id: "p-dane", signed_by_staff_id: "dane", briefed_by_staff_id: "troy", signature_svg: "<svg/>", issue_raised: null, signed_at: "2026-09-16T07:59:00.000Z" });
    expect(await can("troy")).toBe(false); // everyone has signed
  });

  /* the same rule the bell follows: once the work is over, the register is
     history, not an ask */
  it("closes the door once the job is finished, and says who has signed", async () => {
    const row = async (who: string) => (await listJobSwms(ORG, "job-1", who))[0];
    expect(await row("troy")).toMatchObject({ viewerCanSign: true, viewerSigned: true });
    expect(await row("dane")).toMatchObject({ viewerCanSign: true, viewerSigned: false });

    mockDb.tables.sm8_jobs[0].status = "Completed";
    expect(await row("dane")).toMatchObject({ viewerCanSign: false, waitingOn: ["Dane Whitmore", "Kai Lindqvist"] });
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
  /* a sign-on given on someone else's phone says whose, whoever they are */
  it("names the phone a sign-on was given on", async () => {
    mockDb.tables.swms_signons[0].signed_by_staff_id = "dane";
    const troy = (await loadSwmsDocument(ORG, "v2"))?.people.find((p) => p.name === "Troy Porter");
    expect(troy?.signon?.onPhoneOf).toBe("Dane Whitmore");
  });

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

/* PAPER READ TICKETS OFF THE JOB'S ACTIVE ROSTER, so someone who had left
   printed as holding nothing — and every worker did, once the job had gone */
describe("licencesFor", () => {
  it("reads the named people's tickets, whether or not they're still active", async () => {
    mockDb.tables.staff_profiles.find((p) => p.id === "dane")!.status = "Inactive";
    mockDb.tables.staff_licences = [
      { org_id: ORG, staff_profile_id: "dane", type_name: "ARC licence", expiry_date: "2030-01-01" },
      { org_id: ORG, staff_profile_id: "dane", type_name: "White card", expiry_date: "2020-01-01" },
      { org_id: "org-2", staff_profile_id: "dane", type_name: "Someone else's", expiry_date: null },
    ];
    const got = await licencesFor(ORG, ["dane", null, "dane"], "2026-09-19");
    expect(got.get("dane")).toEqual([
      { name: "ARC licence", expires: "2030-01-01", current: true },
      { name: "White card", expires: "2020-01-01", current: false },
    ]);
    expect(await licencesFor(ORG, [], "2026-09-19")).toEqual(new Map());
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
