/* The redesigned projects board, held still.

   What these pin, by decision: the settled tab order (Urgent, Pipeline,
   Completed, Calendar); the derived urgent queue with its quick actions
   fixing the row's own fact; the stage-GROUPED pipeline with trouble first
   and the two-axis money chip; Completed's ready-to-close fold; and the trip
   sheet's bring list with the carry-to-next-trip close-out. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectsBoard } from "../projects-board";
import type {
  BoardProject,
  ProjectBoardVisit,
  ProjectsBoardData,
} from "@/lib/workboard/projects-board-query";
import { deriveProjectMoney } from "@/lib/workboard/project-money";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const act = {
  setVisitReadiness: jest.fn(async () => ({ ok: true })),
  assignVisitTech: jest.fn(async () => ({ ok: true })),
  unassignVisitTech: jest.fn(async () => ({ ok: true })),
  placeVisit: jest.fn(async () => ({ ok: true })),
  clearVisitPlacement: jest.fn(async () => ({ ok: true })),
  completeVisit: jest.fn(async () => ({ ok: true })),
  setVisitStatus: jest.fn(async () => ({ ok: true })),
  setVisitNotes: jest.fn(async () => ({ ok: true })),
  linkVisitJob: jest.fn(async () => ({ ok: true })),
  unlinkVisitJob: jest.fn(async () => ({ ok: true })),
};
jest.mock("@/app/actions/workboard-maintenance", () => ({
  setVisitReadiness: (...a: unknown[]) => act.setVisitReadiness(...(a as [])),
  assignVisitTech: (...a: unknown[]) => act.assignVisitTech(...(a as [])),
  unassignVisitTech: (...a: unknown[]) => act.unassignVisitTech(...(a as [])),
  placeVisit: (...a: unknown[]) => act.placeVisit(...(a as [])),
  clearVisitPlacement: (...a: unknown[]) => act.clearVisitPlacement(...(a as [])),
  completeVisit: (...a: unknown[]) => act.completeVisit(...(a as [])),
  setVisitStatus: (...a: unknown[]) => act.setVisitStatus(...(a as [])),
  setVisitNotes: (...a: unknown[]) => act.setVisitNotes(...(a as [])),
  linkVisitJob: (...a: unknown[]) => act.linkVisitJob(...(a as [])),
  unlinkVisitJob: (...a: unknown[]) => act.unlinkVisitJob(...(a as [])),
}));

const pact = {
  addVisitBringItem: jest.fn(async () => ({ ok: true })),
  removeVisitBringItem: jest.fn(async () => ({ ok: true })),
  setVisitBringPacked: jest.fn(async () => ({ ok: true })),
  carryVisitBringItems: jest.fn(async () => ({ ok: true })),
  deleteProjectVisit: jest.fn(async () => ({ ok: true })),
  setProjectVisitLabel: jest.fn(async () => ({ ok: true })),
};
jest.mock("@/app/actions/workboard-projects", () => ({
  addVisitBringItem: (...a: unknown[]) => pact.addVisitBringItem(...(a as [])),
  removeVisitBringItem: (...a: unknown[]) => pact.removeVisitBringItem(...(a as [])),
  setVisitBringPacked: (...a: unknown[]) => pact.setVisitBringPacked(...(a as [])),
  carryVisitBringItems: (...a: unknown[]) => pact.carryVisitBringItems(...(a as [])),
  deleteProjectVisit: (...a: unknown[]) => pact.deleteProjectVisit(...(a as [])),
  setProjectVisitLabel: (...a: unknown[]) => pact.setProjectVisitLabel(...(a as [])),
}));

const setProjectStatus = jest.fn(async () => ({ ok: true }));
jest.mock("@/app/actions/workboard", () => ({
  setProjectStatus: (...a: unknown[]) => setProjectStatus(...(a as [])),
}));

const clearFlag = jest.fn(async () => ({ ok: true }));
const restoreFlag = jest.fn(async () => ({ ok: true }));
jest.mock("@/app/actions/workboard-notes", () => ({
  clearFlag: (...a: unknown[]) => clearFlag(...(a as [])),
  restoreFlag: (...a: unknown[]) => restoreFlag(...(a as [])),
}));

const TODAY = "2026-07-30"; // Thursday

function projectFix(over: Partial<BoardProject> & { id: string }): BoardProject {
  return {
    name: "Bowden St ducted",
    clientName: "The Bowdens",
    siteLabel: "14 Bowden St",
    siteAddress: null,
    stage: "Rough-in",
    status: "active",
    blockedReason: null,
    blockedOn: null,
    blockedAt: null,
    budgetCents: null,
    budgetSource: null,
    hoursBudget: null,
    promisedFinish: null,
    defectsEnd: null,
    designId: null,
    notes: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-29T09:00:00Z",
    checklist: [],
    progress: { done: 6, total: 15, percent: 40 },
    equipmentCount: 0,
    scopeCounts: { inclusions: 0, exclusions: 0 },
    money: deriveProjectMoney({ budgetCents: null, variations: [], claims: [] }),
    hoursLogged: 0,
    milestones: [],
    jobs: [],
    ...over,
  };
}

function trip(over: Partial<ProjectBoardVisit> & { id: string }): ProjectBoardVisit {
  return {
    projectId: "p-1",
    projectName: "Bowden St ducted",
    clientName: "The Bowdens",
    siteLabel: "14 Bowden St",
    label: "Rough-in — day 1",
    dueDate: "2026-08-04",
    bookedDate: null,
    status: "upcoming",
    readiness: { equipment_ready: false, access_confirmed: false },
    techs: [],
    bringList: [],
    jobNo: 1001,
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
  };
}

function data(over: Partial<ProjectsBoardData> = {}): ProjectsBoardData {
  return {
    projects: [projectFix({ id: "p-1" })],
    visits: [],
    staff: [
      { id: "s-1", name: "Luke Nguyen" },
      { id: "s-2", name: "Mia Ortiz" },
    ],
    ...over,
  };
}

function mount(d: ProjectsBoardData, over: Partial<Parameters<typeof ProjectsBoard>[0]> = {}) {
  return render(
    <ProjectsBoard
      data={d}
      flags={[]}
      today={TODAY}
      manage
      connected={false}
      {...over}
    />
  );
}

// A badge extends the tab's accessible name ("Completed 1") — match the front.
const toTab = (name: string) =>
  userEvent.click(screen.getByRole("tab", { name: new RegExp(`^${name}`) }));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("the shell", () => {
  it("runs the settled four tabs in order — Urgent, Pipeline, Completed, Calendar", () => {
    mount(data());
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Urgent",
      "Pipeline",
      "Completed",
      "Calendar",
    ]);
  });

  it("leaves the count to the page's side switcher, not the tab", () => {
    mount(
      data({
        projects: [
          projectFix({ id: "p-1", status: "blocked", blockedReason: "permit", blockedOn: "council" }),
        ],
      })
    );
    const tab = screen.getByRole("tab", { name: /Urgent/ });
    expect(within(tab).queryByText("1")).not.toBeInTheDocument();
  });
});

describe("urgent", () => {
  it("a blocked project is a danger row whose remedy is the project page", () => {
    mount(
      data({
        projects: [
          projectFix({
            id: "p-1",
            status: "blocked",
            blockedReason: "switchboard upgrade",
            blockedOn: "Dave",
          }),
        ],
      })
    );
    expect(screen.getByText("Blocked on Dave — switchboard upgrade")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the project" })).toHaveAttribute(
      "href",
      "/dashboard/workboard/projects/p-1"
    );
  });

  it("an overdue unplaced trip asks to be booked; a placed one asks if it ran", () => {
    mount(
      data({
        visits: [
          trip({ id: "v-1", dueDate: "2026-07-21" }),
          trip({ id: "v-2", dueDate: "2026-07-25", bookedDate: "2026-07-25", label: "Fit-off" }),
        ],
      })
    );
    expect(screen.getByRole("button", { name: "Book it in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close it out" })).toBeInTheDocument();
  });

  it("the lead-gate quick action confirms the actual gate", async () => {
    mount(
      data({
        visits: [trip({ id: "v-1", dueDate: "2026-08-01", techCount: 0 } as never)],
      })
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm equipment" }));
    expect(act.setVisitReadiness).toHaveBeenCalledWith("v-1", "equipment_ready", true);
  });

  it("a crew gap offers the assign select and fires the assignment", async () => {
    mount(
      data({
        visits: [
          trip({
            id: "v-1",
            dueDate: "2026-08-01",
            readiness: { equipment_ready: true, access_confirmed: true },
          }),
        ],
      })
    );
    await userEvent.selectOptions(screen.getByRole("combobox"), "s-1");
    expect(act.assignVisitTech).toHaveBeenCalledWith("v-1", "s-1");
  });

  it("flags clear in place", async () => {
    mount(data(), {
      flags: [
        {
          id: "f-1",
          message: "Left the vac pump on site",
          severity: "warn",
          targetKind: "project",
          targetId: "p-1",
          createdAt: "2026-07-29T00:00:00Z",
        },
      ],
    });
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(clearFlag).toHaveBeenCalledWith("f-1");
  });

  it("the good outcome reads as one", () => {
    mount(data());
    expect(screen.getByText("Nothing needs attention right now")).toBeInTheDocument();
  });
});

describe("pipeline", () => {
  it("groups by stage in the trade's order and skips empty stages", async () => {
    mount(
      data({
        projects: [
          projectFix({ id: "p-1", stage: "Fit-off", name: "Fit-off job" }),
          projectFix({ id: "p-2", stage: "Quote", name: "Quote job" }),
        ],
      })
    );
    await toTab("Pipeline");
    const heads = document.querySelectorAll(".wb2-wkhd");
    expect([...heads].map((h) => h.textContent)).toEqual(["Quote1 project", "Fit-off1 project"]);
  });

  it("says the money the two-axis way — claimed of revised total", async () => {
    mount(
      data({
        projects: [
          projectFix({
            id: "p-1",
            money: deriveProjectMoney({
              budgetCents: 5_000_000,
              variations: [{ amountCents: 400_000, status: "approved" }],
              claims: [{ amountCents: 1_000_000, status: "awaiting" }],
            }),
          }),
        ],
      })
    );
    await toTab("Pipeline");
    expect(screen.getByText("$10,000 of $54,000")).toBeInTheDocument();
  });

  /* Without capability `workboard_money` the loader hands back no money at
     all. The row must then say NOTHING about money — in particular not "no
     budget set", which describes the project rather than the reader and is a
     different (false) statement. */
  it("says nothing at all about money when the reader has no money access", async () => {
    mount(
      data({
        projects: [projectFix({ id: "p-1", name: "Belmont", money: undefined })],
      })
    );
    await toTab("Pipeline");

    expect(screen.getByText("Belmont")).toBeInTheDocument();
    expect(screen.queryByText("no budget set")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$/);
    // The cell survives so the grid's columns stay aligned for everyone.
    expect(document.querySelector(".wb2-plmoney")).toBeInTheDocument();
  });

  it("still says 'no budget set' to someone who CAN see money", async () => {
    mount(
      data({
        projects: [
          projectFix({
            id: "p-1",
            money: deriveProjectMoney({ budgetCents: null, variations: [], claims: [] }),
          }),
        ],
      })
    );
    await toTab("Pipeline");
    expect(screen.getByText("no budget set")).toBeInTheDocument();
  });

  it("blocked floats first inside its group and wears its chip", async () => {
    mount(
      data({
        projects: [
          projectFix({ id: "p-1", name: "Healthy one" }),
          projectFix({
            id: "p-2",
            name: "Stuck one",
            status: "blocked",
            blockedReason: "permit",
            blockedOn: "council",
          }),
        ],
      })
    );
    await toTab("Pipeline");
    const rows = document.querySelectorAll(".wb2-plrow");
    expect(rows[0].textContent).toContain("Stuck one");
    expect(within(rows[0] as HTMLElement).getByText("Blocked on council")).toBeInTheDocument();
  });

  it("each row links to its project page", async () => {
    mount(data());
    await toTab("Pipeline");
    expect(screen.getByText("Bowden St ducted").closest("a")).toHaveAttribute(
      "href",
      "/dashboard/workboard/projects/p-1"
    );
  });
});

describe("completed", () => {
  it("folds ready-to-close first and closes in one press with an undo", async () => {
    mount(
      data({
        projects: [projectFix({ id: "p-1", stage: "Complete", name: "Finished-not-closed" })],
      })
    );
    await toTab("Completed");
    expect(screen.getByText(/At Complete but not closed/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mark it done" }));
    expect(setProjectStatus).toHaveBeenCalledWith("p-1", "done");
  });

  it("tells the money truth on a done project — settled or still owed", async () => {
    mount(
      data({
        projects: [
          projectFix({
            id: "p-1",
            status: "done",
            money: deriveProjectMoney({
              budgetCents: 5_000_000,
              variations: [],
              claims: [{ amountCents: 5_000_000, status: "awaiting" }],
            }),
          }),
          projectFix({
            id: "p-2",
            status: "done",
            name: "Paid job",
            money: deriveProjectMoney({
              budgetCents: 1_000_000,
              variations: [],
              claims: [{ amountCents: 1_000_000, status: "paid" }],
            }),
          }),
        ],
      })
    );
    await toTab("Completed");
    expect(screen.getByText("$50,000 awaiting payment")).toBeInTheDocument();
    expect(screen.getByText("Money settled")).toBeInTheDocument();
  });
});

describe("calendar (P3 — per-side plus the merged view)", () => {

  it("opening a day opens the projects day modal, and placing fires the shared action", async () => {
    mount(
      data({
        visits: [trip({ id: "v-1", dueDate: "2026-07-21" })], // overdue, unplaced
      })
    );
    await toTab("Calendar");
    await userEvent.click(screen.getByRole("button", { name: "Open 2026-08-05" }));
    expect(screen.getByText("No trips on this day")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Place here" }));
    expect(act.placeVisit).toHaveBeenCalledWith("v-1", "2026-08-05");
  });
});

describe("the trip sheet", () => {
  it("opens from an urgent row, ticks the bring list, and adds to it", async () => {
    mount(
      data({
        visits: [
          trip({
            id: "v-1",
            dueDate: "2026-07-21",
            bringList: [{ id: "i-1", label: "Vac pump", packed: false }],
          }),
        ],
      })
    );
    await userEvent.click(screen.getByRole("button", { name: "Book it in" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // the Equipment gate body holds the bring list
    await userEvent.click(screen.getByRole("button", { name: "Equipment ready" }));
    await userEvent.click(screen.getByRole("button", { name: "Mark Vac pump packed" }));
    expect(pact.setVisitBringPacked).toHaveBeenCalledWith("i-1", true);

    await userEvent.click(screen.getByRole("button", { name: /Add to the list/ }));
    await userEvent.type(screen.getByPlaceholderText("What needs to come"), "Core drill{Enter}");
    expect(pact.addVisitBringItem).toHaveBeenCalledWith("v-1", "Core drill");
  });

  it("close-out records the trip and carries unpacked leftovers to the next trip", async () => {
    mount(
      data({
        visits: [
          trip({
            id: "v-1",
            dueDate: "2026-07-25",
            bookedDate: "2026-07-25",
            bringList: [{ id: "i-1", label: "Vac pump", packed: false }],
          }),
          trip({ id: "v-2", dueDate: "2026-08-11", label: "Fit-off — day 1" }),
        ],
      })
    );
    await userEvent.click(screen.getByRole("button", { name: "Close it out" }));
    expect(
      screen.getByText(/Carry the 1 unpacked item to “Fit-off — day 1”/)
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mark the trip complete" }));
    expect(act.completeVisit).toHaveBeenCalled();
    expect(pact.carryVisitBringItems).toHaveBeenCalledWith("v-1", "v-2");
  });

  it("deleting an open trip takes two deliberate presses", async () => {
    mount(data({ visits: [trip({ id: "v-1", dueDate: "2026-07-21" })] }));
    await userEvent.click(screen.getByRole("button", { name: "Book it in" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete the trip" }));
    expect(pact.deleteProjectVisit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Really delete it" }));
    expect(pact.deleteProjectVisit).toHaveBeenCalledWith("v-1");
  });
});
