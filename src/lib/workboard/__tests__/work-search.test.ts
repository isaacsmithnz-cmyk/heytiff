/* The one search box's rules, held still.

   What these pin: that every side of the board is reachable from one query;
   that a job promoted onto a board is found ONCE, as the promotion; that
   every typed word has to land, so a second word narrows rather than widens;
   that live work sorts ahead of finished work; and that a cap is a number the
   caller can report rather than a silent truncation. */

import {
  GROUP_CAP,
  matchesWords,
  searchWorkboard,
  type WorkSearchInput,
} from "@/lib/workboard/work-search";
import type { BoardVisit, BoardAgreement } from "@/lib/workboard/board-query";
import type { BoardProject, ProjectBoardVisit } from "@/lib/workboard/projects-board-query";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";

const TODAY = "2026-08-12";

const job = (over: Partial<AllJobsMirrorJob> & { remoteId: string }): AllJobsMirrorJob => ({
  jobNumber: "2200",
  status: "Work Order",
  clientName: "Ardex Logistics",
  description: "Cool room door heater tape failed",
  suburb: "Mascot",
  categoryName: "Service Call",
  categoryColour: null,
  date: "2026-08-08 09:00:00",
  quoteDate: null,
  completionDate: null,
  nextBooking: null,
  money: null,
  paidCents: 0,
  ...over,
});

const visit = (over: Partial<BoardVisit> & { id: string }): BoardVisit =>
  ({
    agreementId: "a-1",
    label: "Quarterly service",
    clientName: "Kingsford Medical Centre",
    siteLabel: "Kingsford",
    intervalMonths: 3,
    techsNeeded: 1,
    hoursEstimate: 3,
    accessNotes: null,
    category: null,
    tags: [],
    packing: [],
    dueDate: "2026-08-20",
    bookedDate: null,
    status: "upcoming",
    readiness: { equipment_ready: false, access_confirmed: false },
    techs: [],
    packedIds: [],
    jobNo: 1004,
    jobNumber: null,
    provider: null,
    remoteId: null,
    bookedStart: null,
    mirrorStatus: null,
    warn: false,
    notes: null,
    completedAt: null,
    completedSource: null,
    actualHours: null,
    completionNote: null,
    invoicedAt: null,
    ...over,
  }) as BoardVisit;

const agreement = (over: Partial<BoardAgreement> & { id: string }): BoardAgreement =>
  ({
    label: "Rooftop package units",
    clientName: "Halston Freight",
    siteLabel: "DC 2",
    siteAddress: null,
    intervalMonths: 3,
    anchorDate: "2026-08-04",
    contractEnd: null,
    status: "active",
    weInstalled: false,
    accessNotes: null,
    bringList: null,
    siteRequirements: null,
    notes: null,
    billingContact: null,
    techsNeeded: 1,
    hoursEstimate: 3,
    category: null,
    tags: [],
    packing: [],
    equipment: [],
    nextDue: "2026-09-04",
    thenDue: "2026-12-04",
    lastDone: "2026-06-04",
    overdueCount: 0,
    ...over,
  }) as BoardAgreement;

const project = (over: Partial<BoardProject> & { id: string }): BoardProject =>
  ({
    name: "Belmont change-over",
    clientName: "Belmont Holdings",
    siteLabel: "Belmont",
    siteAddress: null,
    stage: "Pre-install",
    status: "active",
    blockedReason: null,
    blockedOn: null,
    blockedAt: null,
    budgetCents: null,
    budgetSource: null,
    hoursBudget: null,
    promisedFinish: "2026-10-01",
    defectsEnd: null,
    designId: null,
    notes: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    checklist: [],
    progress: { done: 0, total: 0, percent: 0 },
    equipmentCount: 0,
    scopeCounts: { inclusions: 0, exclusions: 0 },
    hoursLogged: 0,
    milestones: [],
    jobs: [],
    ...over,
  }) as BoardProject;

const trip = (over: Partial<ProjectBoardVisit> & { id: string }): ProjectBoardVisit =>
  ({
    projectId: "p-1",
    projectName: "Belmont change-over",
    clientName: "Belmont Holdings",
    siteLabel: "Belmont",
    label: "Rough-in day 1",
    dueDate: "2026-08-25",
    bookedDate: null,
    status: "upcoming",
    readiness: { equipment_ready: false, access_confirmed: false },
    techs: [],
    bringList: [],
    jobNo: 1009,
    jobNumber: null,
    provider: null,
    remoteId: null,
    bookedStart: null,
    mirrorStatus: null,
    mirrorNextStart: null,
    warn: false,
    notes: null,
    completedAt: null,
    completedSource: null,
    actualHours: null,
    completionNote: null,
    invoicedAt: null,
    ...over,
  }) as ProjectBoardVisit;

const input = (over: Partial<WorkSearchInput> = {}): WorkSearchInput => ({
  today: TODAY,
  jobs: [],
  visits: [],
  agreements: [],
  projects: [],
  trips: [],
  projectLinks: [],
  ...over,
});

const groupOf = (r: ReturnType<typeof searchWorkboard>, key: string) =>
  r.groups.find((g) => g.key === key);

describe("one box, every side", () => {
  const everything = () =>
    input({
      jobs: [job({ remoteId: "j-1", clientName: "Kingsford Bakery" })],
      visits: [visit({ id: "v-1" })],
      agreements: [agreement({ id: "a-1", siteLabel: "Kingsford" })],
      projects: [project({ id: "p-1", name: "Kingsford fitout" })],
      trips: [trip({ id: "t-1", projectName: "Kingsford fitout" })],
    });

  it("answers from all three sides at once", () => {
    const r = searchWorkboard(everything(), "kingsford");
    expect(r.total).toBe(5);
    expect(groupOf(r, "jobs")?.hits).toHaveLength(1);
    expect(groupOf(r, "maintenance")?.hits).toHaveLength(2);
    expect(groupOf(r, "projects")?.hits).toHaveLength(2);
  });

  /* The destination is half the answer: most of what a search finds lives on
     a side you aren't standing on, and the page needs the kind to know which
     sheet to open — a visit and an agreement are different sheets. */
  it("says where each answer lives", () => {
    const r = searchWorkboard(everything(), "kingsford");
    expect(groupOf(r, "maintenance")?.hits.map((h) => h.go)).toEqual(
      expect.arrayContaining([
        { side: "maintenance", kind: "visit", id: "v-1" },
        { side: "maintenance", kind: "agreement", id: "a-1" },
      ])
    );
    expect(groupOf(r, "jobs")?.hits[0].go).toEqual({
      side: "jobs",
      kind: "job",
      remoteId: "j-1",
    });
  });

  it("finds a maintenance visit by ServiceM8's number as well as by ours", () => {
    const i = input({ visits: [visit({ id: "v-1", jobNo: 1004, jobNumber: "2214" })] });
    expect(searchWorkboard(i, "1004").total).toBe(1);
    expect(searchWorkboard(i, "2214").total).toBe(1);
  });

  it("finds an agreement by its tags, the way the ledger's own box did", () => {
    const i = input({
      agreements: [
        agreement({
          id: "a-1",
          tags: [{ id: "t-1", name: "Roof access", color: "blue" }] as BoardAgreement["tags"],
        }),
      ],
    });
    expect(searchWorkboard(i, "roof access").total).toBe(1);
  });

  it("is quiet below two characters — a keystroke isn't a question", () => {
    expect(searchWorkboard(everything(), "k").total).toBe(0);
    expect(searchWorkboard(everything(), "  ").groups).toEqual([]);
  });
});

describe("one thing, one hit", () => {
  /* A row found twice looks like two jobs. The promotion is the better of the
     two answers — it has the readiness, the crew and the sheet — so the raw
     ServiceM8 row steps aside for it. */
  it("drops a ServiceM8 job that a maintenance visit already claims", () => {
    const r = searchWorkboard(
      input({
        jobs: [job({ remoteId: "j-1", clientName: "Ardex Logistics" })],
        visits: [visit({ id: "v-1", clientName: "Ardex Logistics", remoteId: "j-1" })],
      }),
      "ardex"
    );
    expect(r.total).toBe(1);
    expect(groupOf(r, "jobs")).toBeUndefined();
    expect(groupOf(r, "maintenance")?.hits[0].go).toEqual({
      side: "maintenance",
      kind: "visit",
      id: "v-1",
    });
  });

  it("drops one a project has linked", () => {
    const r = searchWorkboard(
      input({
        jobs: [job({ remoteId: "j-1", clientName: "Belmont Holdings" })],
        projects: [project({ id: "p-1" })],
        projectLinks: [{ projectId: "p-1", remoteId: "j-1" }],
      }),
      "belmont"
    );
    expect(groupOf(r, "jobs")).toBeUndefined();
    expect(groupOf(r, "projects")?.hits).toHaveLength(1);
  });

  it("keeps the mirror's older half apart from what's already on screen", () => {
    const r = searchWorkboard(
      input({
        jobs: [job({ remoteId: "j-1" })],
        elsewhere: [job({ remoteId: "j-1" }), job({ remoteId: "j-old" })],
      }),
      "ardex"
    );
    expect(groupOf(r, "jobs")?.hits.map((h) => h.key)).toEqual(["job:j-1"]);
    expect(groupOf(r, "elsewhere")?.hits.map((h) => h.key)).toEqual(["job:j-old"]);
  });

  /* The server's query is broader than the words typed — it matches a company
     by name and then takes that company's jobs — so a row nobody's words
     picked out would arrive looking like a miss. */
  it("holds server hits to the same words the local half was held to", () => {
    const r = searchWorkboard(
      input({
        elsewhere: [
          job({ remoteId: "j-a", description: "Cool room door heater tape failed" }),
          job({ remoteId: "j-b", description: "Rooftop package unit swap" }),
        ],
      }),
      "ardex cool"
    );
    expect(groupOf(r, "elsewhere")?.hits.map((h) => h.key)).toEqual(["job:j-a"]);
  });
});

describe("the word rule", () => {
  /* Every word must land — otherwise "ardex cool" returns every job at Ardex
     and the second word was decoration. */
  it("narrows on a second word rather than widening", () => {
    const fields = ["2214", "Ardex Logistics", "Cool room door heater tape failed", "Mascot"];
    expect(matchesWords(fields, "ardex cool")).toBe(true);
    expect(matchesWords(fields, "ardex rooftop")).toBe(false);
  });

  it("takes typed words literally — a generic word is still a word", () => {
    expect(matchesWords(["Strathfield Dental"], "dental")).toBe(true);
  });

  /* The list filter this rule grew from matched EVERYTHING on an empty query,
     which was right for a filter and wrong for a box that also decides
     whether searching is happening: "not asked yet" must not read as "all of
     it matched". */
  it("matches nothing on an empty query", () => {
    expect(matchesWords(["Strathfield Dental"], "   ")).toBe(false);
  });
});

describe("order and cap", () => {
  it("puts live work first and soonest first, finished work after and newest first", () => {
    const r = searchWorkboard(
      input({
        visits: [
          visit({ id: "v-far", dueDate: "2026-12-01" }),
          visit({ id: "v-soon", dueDate: "2026-08-14" }),
          visit({ id: "v-old", status: "done", completedAt: "2026-05-02", dueDate: "2026-05-01" }),
          visit({ id: "v-recent", status: "done", completedAt: "2026-08-01", dueDate: "2026-07-30" }),
        ],
      }),
      "kingsford"
    );
    expect(groupOf(r, "maintenance")?.hits.map((h) => h.key)).toEqual([
      "visit:v-soon",
      "visit:v-far",
      "visit:v-recent",
      "visit:v-old",
    ]);
  });

  /* A cap nobody is told about reads as "that's all there is", so the count
     the group was cut from rides alongside the rows that survived it. */
  it("caps a group but reports what it held back", () => {
    const many = Array.from({ length: GROUP_CAP + 6 }, (_, i) =>
      visit({ id: `v-${i}`, dueDate: `2026-09-${String((i % 28) + 1).padStart(2, "0")}` })
    );
    const g = groupOf(searchWorkboard(input({ visits: many }), "kingsford"), "maintenance");
    expect(g?.hits).toHaveLength(GROUP_CAP);
    expect(g?.found).toBe(GROUP_CAP + 6);
  });

  it("counts every match in the headline, cap or no cap", () => {
    const many = Array.from({ length: GROUP_CAP + 6 }, (_, i) => visit({ id: `v-${i}` }));
    expect(searchWorkboard(input({ visits: many }), "kingsford").total).toBe(GROUP_CAP + 6);
  });
});
