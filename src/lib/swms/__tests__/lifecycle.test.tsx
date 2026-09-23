/* THE LIFE OF ONE SWMS, WALKED END TO END.

   Six rounds of reading the SWMS found 83 things, and the worst of the late
   ones were COMBINATIONS no single screen's test tried: round 4's "Sorted on
   site" and raise-an-issue were dead on a CORRECTED SWMS, because every test
   of them used a fresh one. This suite is the combination test.

   It ACTS through the real server actions — issue, sign on, raise, sort,
   correct, revise — against the in-memory database, and at every step it
   OBSERVES what each person would actually see: the bell, the job card's
   Compliance row, the sign-on page, and the printed SWMS. Nothing is stubbed
   between the action and the screen, so a change anywhere in that chain that
   breaks a combination fails here, named by the step it broke. */

import { render } from "@testing-library/react";
import { fakeDb, type FakeDb } from "./fixtures/fake-db";
import { DEFAULT_ANSWERS, LIBRARY_VERSION } from "@/lib/swms/library";

jest.unmock("@/app/actions/swms");

let mockDb: FakeDb;
let mockMe: string | null = "troy";

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (t: string) => mockDb.client.from(t) },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/permissions-server", () => ({
  requireOrg: async () => ({ orgId: "org-1", userId: "auth0|me" }),
  getDbRole: async () => "staff",
  can: async () => true,
}));
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: async () => mockMe }));
jest.mock("@/lib/integrations/links", () => ({ sm8StaffLinkMap: async () => new Map() }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }), notFound: jest.fn(), redirect: jest.fn() }));
/* the printed SWMS's frame: whose session, whose letterhead */
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => ({ orgId: "org-1", user: { sub: "auth0|me" } }) } }));
jest.mock("@/lib/org/query", () => ({ orgBrand: async () => ({ name: "Diamond Air" }) }));
jest.mock("@/lib/org/brand", () => ({ hasBrand: () => false, brandContact: () => [] }));
jest.mock("@/components/org/letterhead", () => ({ Letterhead: () => null }));
jest.mock("@/app/swms/[versionId]/print-button", () => ({ PrintButton: () => null }));

import { clearSwmsIssue, issueSwms, raiseSwmsIssue, signOnSwms, swmsPrevious, type IssueSwmsInput } from "@/app/actions/swms";
import { listJobSwms, loadSwmsDocument, pendingSignons, raisedIssues } from "@/lib/swms/query";
import { swmsIssueChip, swmsSignonChip } from "@/lib/dashboard/chips";
import { JobDocumentsFace } from "@/components/workboard/board/job-documents-face";
import { SwmsSignOn } from "@/components/swms/sign-on";
import PaperPage from "@/app/swms/[versionId]/page";

const ORG = "org-1";
const JOB = "job-1";
const drawn = "M10 20 L30 40 L50 35 L80 60";

const staff = (id: string, first: string, last: string, title: string | null = null) => ({
  org_id: ORG, id, first_name: first, last_name: last, full_name: null, preferred_name: null, job_title: title, status: "Active",
});

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

beforeEach(() => {
  mockDb = fakeDb();
  mockMe = "troy";
  Object.assign(mockDb.tables, {
    sm8_jobs: [
      { org_id: ORG, uuid: JOB, generated_job_id: "2601", company_uuid: null, category_uuid: null, status: "Work Order", job_address: "14 Attunga Road, Miranda NSW 2228", geo_state: "NSW", job_description: "Supply and install a 5.0 kW split system", active: 1 },
    ],
    staff_profiles: [
      staff("troy", "Troy", "Porter", "Crew lead"),
      staff("dane", "Dane", "Whitmore", "Installer"),
      staff("sam", "Sam", "Ikpeba", "Apprentice"),
      staff("isaac", "Isaac", "Smith", "Owner"),
    ],
    staff_licences: [{ org_id: ORG, staff_profile_id: "dane", type_name: "ARC licence", expiry_date: "2099-01-01" }],
    sm8_job_activities: [],
    swms_library_approvals: [{ org_id: ORG, library_version: LIBRARY_VERSION }],
    organizations: [{ id: ORG, primary_owner_user_id: "auth0|isaac" }],
  });
});

/* ── acting: the real server actions, as whoever is holding the phone ───── */

const as = (who: string) => {
  mockMe = who;
};

const input = (over: Partial<IssueSwmsInput> = {}): IssueSwmsInput => ({
  jobUuid: JOB,
  answers: { ...DEFAULT_ANSWERS, isolation: "Main switchboard, garage wall", hospital: "Sutherland Hospital, Caringbah" },
  staffIds: ["troy", "dane", "sam"],
  outsiders: [{ name: "Kai Lindqvist", company: "Lindqvist Plumbing" }],
  responsibleStaffId: "troy",
  electrician: "staff:troy",
  firstAider: "staff:troy",
  siteChecked: true,
  ...over,
});

async function issue(over: Partial<IssueSwmsInput> = {}): Promise<{ swmsId: string; versionId: string }> {
  const res = await issueSwms(input(over));
  if (!res.ok) throw new Error(`issue failed: ${res.problems.join("; ")}`);
  return { swmsId: res.swmsId, versionId: res.versionId };
}

/** The person row for someone on a version — by staff id, or an outsider's name. */
const personOn = (versionId: string, who: string) =>
  mockDb.tables.swms_people.find((p) => p.version_id === versionId && (p.staff_profile_id ?? p.outside_name) === who)!.id as string;

async function signOn(versionId: string, who: string, opts: { issue?: string } = {}) {
  const res = await signOnSwms({ personId: personOn(versionId, who), pathData: drawn, issue: opts.issue ?? null });
  if (!res.ok) throw new Error(`sign-on for ${who} failed: ${res.error}`);
}

/* ── observing: what each person sees ─────────────────────────────────── */

const TODAY = "2026-09-17";

/** The bell's SWMS items for one person, as their labels. */
async function bell(who: string): Promise<string[]> {
  const [signons, issues] = await Promise.all([pendingSignons(ORG, who), raisedIssues(ORG, who)]);
  return [
    ...signons.map((p) => swmsSignonChip(p, { today: TODAY }).label),
    ...issues.flatMap((p) => swmsIssueChip(p)?.label ?? []),
  ];
}

/** The job card's Compliance row, read the way someone looking at it reads it. */
async function card(viewer: string | null) {
  const swms = await listJobSwms(ORG, JOB, viewer);
  const { container, unmount } = render(
    <JobDocumentsFace documents={[]} elsewhere={[]} designs={[]} loading={false} truncated={false} onOpen={() => {}} swms={swms} onReviseSwms={() => {}} />
  );
  const row = container.querySelector(".wb2-docrow");
  const out = {
    lines: row ? [...row.querySelectorAll(".wb2-doc-b em")].map((e) => e.textContent ?? "") : [],
    doors: row ? [...row.querySelectorAll("a.pbtn, button.pbtn")].map((e) => e.textContent ?? "") : [],
  };
  unmount();
  return out;
}

/** The sign-on page for one reader: its words, its rows, what it offers to press. */
async function page(viewer: string, versionId: string) {
  const doc = await loadSwmsDocument(ORG, versionId);
  if (!doc) throw new Error(`no document for ${versionId}`);
  const { container, unmount } = render(<SwmsSignOn doc={doc} me={viewer} />);
  const out = {
    text: container.textContent ?? "",
    rows: Object.fromEntries(
      [...container.querySelectorAll(".sws-people .sws-person")].map((r) => [r.querySelector("b")?.textContent ?? "", r.textContent ?? ""])
    ) as Record<string, string>,
    presses: [...container.querySelectorAll("button, a.pbtn, a.sw-more")].map((b) => b.textContent ?? ""),
  };
  unmount();
  return out;
}

/** The printed SWMS: the licences it claims, and the sign-on register. */
async function paper(versionId: string) {
  const { container, unmount } = render(await PaperPage({ params: Promise.resolve({ versionId }) }));
  const tables = [...container.querySelectorAll("table.swd-grid")];
  const byHeader = (h: string) => tables.find((t) => t.querySelector("thead")?.textContent?.includes(h));
  const rowsOf = (t: Element | undefined) =>
    t ? [...t.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent ?? "")) : [];
  const out = {
    text: container.textContent ?? "",
    licences: Object.fromEntries(rowsOf(byHeader("Licences and tickets on file")).map(([who, held]) => [who, held])),
    register: Object.fromEntries(rowsOf(byHeader("Briefed by")).map(([who, ...rest]) => [who, rest])),
  };
  unmount();
  return out;
}

/* ── the life of a SWMS ──────────────────────────────────────────────── */

it("keeps every screen telling the same true story from issue to a finished job", async () => {
  /* 1. THE CREW LEAD ISSUES IT on site: Troy in charge, Dane and Sam from the
        team, Kai from the plumber's. */
  const v1 = await issue();
  expect(await bell("dane")).toEqual(["Sign on to the SWMS"]);
  expect(await bell("troy")).toEqual(["Sign on to the SWMS"]);
  expect(await card(null)).toEqual({
    lines: [expect.stringMatching(/^Issued .*, Troy Porter in charge\. 0 of 4 signed on, waiting on Dane Whitmore, Sam Ikpeba, Troy Porter and Kai Lindqvist$/)],
    doors: ["Revise"],
  });
  expect((await card("dane")).doors).toEqual(["Sign on", "Revise"]);

  /* 2. AT THE TRUCK: Troy signs himself on, then Kai on his phone. */
  as("troy");
  await signOn(v1.versionId, "troy");
  await signOn(v1.versionId, "Kai Lindqvist");
  expect(await bell("troy")).toEqual([]);
  expect(await bell("dane")).toEqual(["Sign on to the SWMS"]);
  /* signed, but his crew hasn't: the door says what it does now */
  expect((await card("troy")).doors).toEqual(["Sign them on", "Revise"]);
  const troyReads = await page("troy", v1.versionId);
  expect(troyReads.text).toMatch(/You signed on /);
  expect(troyReads.rows["Kai Lindqvist"]).toMatch(/on Troy Porter's phone/);
  expect(troyReads.rows["Troy Porter"]).toMatch(/^Troy PorterCrew lead/);

  /* 3. DANE SIGNS ON AND RAISES SOMETHING — it reaches the person in charge. */
  as("dane");
  await signOn(v1.versionId, "dane", { issue: "No anchor on the rear ridge" });
  expect(await bell("dane")).toEqual([]);
  expect(await bell("troy")).toEqual(["Dane Whitmore raised an issue with the SWMS"]);
  expect((await card(null)).lines).toEqual([
    expect.stringMatching(/3 of 4 signed on, waiting on Sam Ikpeba$/),
    "Dane Whitmore raised: No anchor on the rear ridge",
  ]);
  const troyAnswers = await page("troy", v1.versionId);
  expect(troyAnswers.text).toMatch(/An issue was raisedYours to answerNo anchor on the rear ridge/);
  expect(troyAnswers.presses).toContain("Record it as sorted");

  /* 4. THE OFFICE CORRECTS A TYPO — a correction changes nothing about the
        work, so the sign-ons, the site walk AND the open issue all carry. */
  as("isaac");
  const v2 = await issue({
    swmsId: v1.swmsId,
    reason: "Hospital name was wrong",
    material: false,
    siteChecked: false,
    answers: { ...DEFAULT_ANSWERS, isolation: "Main switchboard, garage wall", hospital: "Sutherland Hospital" },
  });
  expect(await bell("dane")).toEqual([]);
  expect(await bell("troy")).toEqual(["Dane Whitmore raised an issue with the SWMS"]);
  expect(await bell("sam")).toEqual(["Sign on to the revised SWMS"]);
  expect((await card(null)).lines).toEqual([
    expect.stringMatching(/^Revised .*3 of 4 signed on, waiting on Sam Ikpeba$/),
    "Dane Whitmore raised: No anchor on the rear ridge",
  ]);
  expect((await page("dane", v2.versionId)).text).toMatch(/You signed on .*, before a correction\./);
  const correctedPaper = await paper(v2.versionId);
  expect(correctedPaper.text).toMatch(/Checked against the site by Troy Porter/);
  expect(correctedPaper.register["Dane WhitmoreInstaller"]).toEqual(["Troy Porter", expect.stringMatching(/, on version 1$/), "", "No anchor on the rear ridge"]);

  /* 5. TROY SORTS IT ON SITE — on the corrected version, where the sign-on
        that stands belongs to the version before. Round 4's version of this
        button answered "That sign-on isn't on this workspace." */
  as("troy");
  expect(await clearSwmsIssue(personOn(v2.versionId, "dane"))).toEqual({ ok: true });
  expect(await bell("troy")).toEqual([]);
  expect((await card(null)).lines).toEqual([expect.stringMatching(/waiting on Sam Ikpeba$/)]);
  expect((await page("dane", v2.versionId)).rows["Dane Whitmore"]).toMatch(/Raised: No anchor on the rear ridge — sorted by Troy Porter/);
  expect((await paper(v2.versionId)).register["Dane WhitmoreInstaller"][3]).toMatch(/^No anchor on the rear ridgeSorted on site by Troy Porter, /);

  /* 6. SAM IS SIGNED ON TROY'S PHONE, then finds something on the roof —
        his sign-on is his own to add to, whoever held the phone. */
  await signOn(v2.versionId, "sam");
  expect(await bell("sam")).toEqual([]);
  as("sam");
  expect(await raiseSwmsIssue({ personId: personOn(v2.versionId, "sam"), issue: "Ladder is too short for the rear wall" })).toEqual({ ok: true });
  expect(await bell("troy")).toEqual(["Sam Ikpeba raised an issue with the SWMS"]);
  /* everyone has signed now: the row still gives the issue a door */
  expect(await card("troy")).toEqual({
    lines: [expect.stringMatching(/4 of 4 signed on$/), "Sam Ikpeba raised: Ladder is too short for the rear wall"],
    doors: ["Open the issue", "Revise"],
  });

  /* 7. THE METHOD CHANGES — a crane instead of a hoist. Everyone signs again,
        the revision leads with why, and the new method answers the issue. */
  as("troy");
  expect((await swmsPrevious(v1.versionId))).toBeNull(); // a stale Revise can't build on a replaced version
  const v3 = await issue({
    swmsId: v1.swmsId,
    reason: "Crane lift instead of a hoist, and a longer ladder",
    answers: { ...DEFAULT_ANSWERS, isolation: "Main switchboard, garage wall", hospital: "Sutherland Hospital", lift: "crane" },
  });
  expect(await bell("dane")).toEqual(["Sign on to the revised SWMS"]);
  expect(await bell("troy")).toEqual(["Sign on to the revised SWMS"]);
  expect((await card(null)).lines).toEqual([expect.stringMatching(/^Revised .*0 of 4 signed on/)]);
  expect((await page("dane", v3.versionId)).text).toMatch(/What changedEveryone signs on againCrane lift instead of a hoist, and a longer ladder/);
  /* the replaced version points at this one, without a version number */
  expect((await page("dane", v1.versionId)).text).toMatch(/A newer SWMS replaced this one: Crane lift instead of a hoist, and a longer ladder\./);

  /* 8. DANE LEAVES THE BUSINESS, and ServiceM8 closes the job. The bell and
        the card stop asking; the record keeps what it said. */
  mockDb.tables.staff_profiles.find((p) => p.id === "dane")!.status = "Inactive";
  mockDb.tables.sm8_jobs[0].status = "Completed";
  expect(await bell("dane")).toEqual([]);
  expect(await bell("troy")).toEqual([]);
  expect(await card("troy")).toEqual({ lines: [expect.stringMatching(/0 of 4 signed on, waiting on /)], doors: ["Revise"] });
  /* a licence doesn't leave with the person: paper still says what he holds */
  expect((await paper(v3.versionId)).licences["Dane WhitmoreInstaller"]).toBe("ARC licence");

  /* 9. THE JOB DROPS OUT OF THE MIRROR. The printed SWMS still names what
        each person held — it used to print "None on file" for everyone. */
  mockDb.tables.sm8_jobs = [];
  const orphan = await paper(v3.versionId);
  expect(orphan.licences["Dane WhitmoreInstaller"]).toBe("ARC licence");
  expect(orphan.licences["Troy PorterCrew lead"]).toBe("None on file");
  expect(orphan.licences["Kai LindqvistLindqvist Plumbing"]).toBe("From outside the business, so none on file");
});

it("keeps one helper per name, however it was typed", async () => {
  const v1 = await issue({
    outsiders: [
      { name: "Kai Lindqvist", company: "Lindqvist Plumbing" },
      { name: " kai lindqvist ", company: null },
    ],
  });
  expect(mockDb.tables.swms_people.filter((p) => p.version_id === v1.versionId && !p.staff_profile_id)).toHaveLength(1);
  expect((await card(null)).lines[0]).toMatch(/0 of 4 signed on/);
});

it("refuses a correction that changes the method, and still wants the site walked", async () => {
  const v1 = await issue();
  as("isaac");
  expect(
    await issueSwms(
      input({
        swmsId: v1.swmsId,
        reason: "Crane instead",
        material: false,
        siteChecked: false,
        answers: { ...DEFAULT_ANSWERS, isolation: "Main switchboard, garage wall", hospital: "Sutherland Hospital", lift: "crane" },
      })
    )
  ).toEqual({ ok: false, problems: ["How the unit goes up changed, so it can't be issued as a correction.", "Confirm you've walked the site and this SWMS matches it."] });
  /* nothing half-written: the bell and the card still read version 1 */
  expect(await bell("dane")).toEqual(["Sign on to the SWMS"]);
  expect((await card(null)).lines[0]).toMatch(/^Issued /);
});
