/* The rebuilt project page, held still.

   What these pin, by decision: Blocked as a first-class state with its
   reason-and-who story and one-press unblock (P4); stage moves that are
   manual but checklist-aware — the nudge when a section completes, the
   warn-never-block two-press past unticked items, corrections backward
   asking nothing (P5); and the trips card sharing the board's rows, gates
   and sheet. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectDetailScreen } from "../project-detail-screen";
import type { ProjectDetail } from "@/lib/workboard/projects-query";
import type { ProjectBoardVisit } from "@/lib/workboard/projects-board-query";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

jest.mock("../note-capture", () => ({
  NoteCapture: () => <div data-testid="capture" />,
}));
jest.mock("../board/project-trip-sheet", () => ({
  ProjectTripSheet: ({ visit }: { visit: { label: string } }) => (
    <div role="dialog" data-testid="tripsheet">
      {visit.label}
    </div>
  ),
}));

const act = {
  setProjectStage: jest.fn(async () => ({ ok: true })),
  setProjectStatus: jest.fn(async () => ({ ok: true })),
  toggleChecklistItem: jest.fn(async () => ({ ok: true })),
  addChecklistItem: jest.fn(async () => ({ ok: true })),
  removeChecklistItem: jest.fn(async () => ({ ok: true })),
  addEquipment: jest.fn(async () => ({ ok: true })),
  removeEquipment: jest.fn(async () => ({ ok: true })),
  setEquipmentManualLeft: jest.fn(async () => ({ ok: true })),
  attachJob: jest.fn(async () => ({ ok: true })),
  detachJob: jest.fn(async () => ({ ok: true })),
  searchJobs: jest.fn(async () => []),
  listDesignOptions: jest.fn(async () => []),
  setProjectDesign: jest.fn(async () => ({ ok: true })),
  updateProjectMeta: jest.fn(async () => ({ ok: true })),
};
jest.mock("@/app/actions/workboard", () => ({
  setProjectStage: (...a: unknown[]) => act.setProjectStage(...(a as [])),
  setProjectStatus: (...a: unknown[]) => act.setProjectStatus(...(a as [])),
  toggleChecklistItem: (...a: unknown[]) => act.toggleChecklistItem(...(a as [])),
  addChecklistItem: (...a: unknown[]) => act.addChecklistItem(...(a as [])),
  removeChecklistItem: (...a: unknown[]) => act.removeChecklistItem(...(a as [])),
  addEquipment: (...a: unknown[]) => act.addEquipment(...(a as [])),
  removeEquipment: (...a: unknown[]) => act.removeEquipment(...(a as [])),
  setEquipmentManualLeft: (...a: unknown[]) => act.setEquipmentManualLeft(...(a as [])),
  attachJob: (...a: unknown[]) => act.attachJob(...(a as [])),
  detachJob: (...a: unknown[]) => act.detachJob(...(a as [])),
  searchJobs: (...a: unknown[]) => act.searchJobs(...(a as [])),
  listDesignOptions: (...a: unknown[]) => act.listDesignOptions(...(a as [])),
  setProjectDesign: (...a: unknown[]) => act.setProjectDesign(...(a as [])),
  updateProjectMeta: (...a: unknown[]) => act.updateProjectMeta(...(a as [])),
}));

const pact = {
  setProjectBlocked: jest.fn(async () => ({ ok: true })),
  clearProjectBlocked: jest.fn(async () => ({ ok: true })),
  createProjectVisit: jest.fn(async () => ({ ok: true })),
};
jest.mock("@/app/actions/workboard-projects", () => ({
  setProjectBlocked: (...a: unknown[]) => pact.setProjectBlocked(...(a as [])),
  clearProjectBlocked: (...a: unknown[]) => pact.clearProjectBlocked(...(a as [])),
  createProjectVisit: (...a: unknown[]) => pact.createProjectVisit(...(a as [])),
}));

const TODAY = "2026-07-30";

/** The seed, part-ticked per section. */
const checklist = (doneSections: string[]): ProjectDetail["checklist"] => {
  const rows: ProjectDetail["checklist"] = [];
  const add = (section: string, labels: string[]) =>
    labels.forEach((label, i) =>
      rows.push({
        id: `${section}-${i}`,
        section,
        label,
        done: doneSections.includes(section),
        doneAt: null,
        sort: rows.length,
      })
    );
  add("Approval & prep", ["Quote accepted", "Access sorted", "Equipment ordered", "Materials ordered"]);
  add("On the tools", ["Rough-in", "Penetrations", "Condensate", "Fit-off"]);
  add("Commissioning", ["Pressure test", "Sheet done", "Controls"]);
  add("Handover", ["Manuals", "Walkthrough", "Warranty", "Clean site"]);
  return rows;
};

function detail(over: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: "p-1",
    name: "Bowden St ducted",
    clientName: "The Bowdens",
    siteLabel: "14 Bowden St",
    siteAddress: null,
    stage: "Pre-install",
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
    designName: null,
    notes: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-29T00:00:00Z",
    checklist: checklist([]),
    equipment: [],
    jobs: [],
    scope: [],
    variations: [],
    claims: [],
    milestones: [],
    hoursLogged: 0,
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

function mount(p: ProjectDetail, trips: ProjectBoardVisit[] = [], manage = true) {
  return render(
    <ProjectDetailScreen
      project={p}
      trips={trips}
      staff={[{ id: "s-1", name: "Luke Nguyen" }]}
      today={TODAY}
      manage={manage}
      sm8Connected={false}
      entries={[]}
      issues={[]}
      voiceEnabled={false}
    />
  );
}

beforeEach(() => jest.clearAllMocks());

describe("blocked (P4)", () => {
  it("wears its whole story — who, why, since — and unblocks in one press", async () => {
    mount(
      detail({
        status: "blocked",
        blockedReason: "switchboard upgrade not done",
        blockedOn: "Dave the sparky",
        blockedAt: "2026-07-25T00:00:00Z",
      })
    );
    expect(screen.getByText(/Blocked on Dave the sparky/)).toBeInTheDocument();
    expect(screen.getByText(/switchboard upgrade not done/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Unblock" }));
    expect(pact.clearProjectBlocked).toHaveBeenCalledWith("p-1");
  });

  it("blocking demands the reason AND the who before it fires", async () => {
    mount(detail());
    await userEvent.click(screen.getByRole("button", { name: "Block…" }));
    const blockIt = screen.getByRole("button", { name: "Block it" });
    expect(blockIt).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(/Dave the sparky/), "council");
    expect(blockIt).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(/Switchboard upgrade/), "permit pending");
    await userEvent.click(blockIt);
    expect(pact.setProjectBlocked).toHaveBeenCalledWith("p-1", {
      reason: "permit pending",
      on: "council",
    });
  });
});

describe("stage moves (P5 — manual, checklist-aware)", () => {
  it("advancing past unticked items warns and takes a second deliberate press", async () => {
    mount(detail({ stage: "Pre-install", checklist: checklist([]) }));
    await userEvent.click(screen.getByRole("button", { name: "Rough-in" }));
    expect(act.setProjectStage).not.toHaveBeenCalled();
    expect(screen.getByText(/4 checklist items unticked behind Rough-in/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Advance anyway" }));
    expect(act.setProjectStage).toHaveBeenCalledWith("p-1", "Rough-in");
  });

  it("a clean advance asks nothing", async () => {
    mount(detail({ stage: "Pre-install", checklist: checklist(["Approval & prep"]) }));
    await userEvent.click(screen.getByRole("button", { name: "Rough-in" }));
    expect(act.setProjectStage).toHaveBeenCalledWith("p-1", "Rough-in");
  });

  it("backward is a correction — never a warning", async () => {
    mount(detail({ stage: "Fit-off", checklist: checklist([]) }));
    await userEvent.click(screen.getByRole("button", { name: "Quote" }));
    expect(act.setProjectStage).toHaveBeenCalledWith("p-1", "Quote");
  });

  it("a completed section nudges the move and one press takes it", async () => {
    mount(detail({ stage: "Pre-install", checklist: checklist(["Approval & prep"]) }));
    expect(screen.getByText(/Approval & prep is all ticked — move to Rough-in\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Move to Rough-in" }));
    expect(act.setProjectStage).toHaveBeenCalledWith("p-1", "Rough-in");
  });

  it("ticks are facts, not levers — no auto-advance ever fires", () => {
    mount(detail({ stage: "Pre-install", checklist: checklist(["Approval & prep"]) }));
    expect(act.setProjectStage).not.toHaveBeenCalled();
  });
});

describe("the status cluster", () => {
  it("offers Mark done only once the stage is Complete", () => {
    mount(detail({ stage: "Fit-off" }));
    expect(screen.queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
  });

  it("closes from Complete, and a held project resumes", async () => {
    const { unmount } = mount(detail({ stage: "Complete" }));
    await userEvent.click(screen.getByRole("button", { name: "Mark done" }));
    expect(act.setProjectStatus).toHaveBeenCalledWith("p-1", "done");
    unmount();

    mount(detail({ status: "on_hold" }));
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(act.setProjectStatus).toHaveBeenCalledWith("p-1", "active");
  });
});

describe("trips", () => {
  it("shows open trips with their gates and opens the shared sheet", async () => {
    mount(detail(), [trip({ id: "v-1" })]);
    const row = screen.getByRole("button", { name: "Open Rough-in — day 1" });
    expect(within(row).getByText("Not placed")).toBeInTheDocument();
    await userEvent.click(row);
    expect(screen.getByTestId("tripsheet")).toHaveTextContent("Rough-in — day 1");
  });

  it("adds a trip with its purpose and target day", async () => {
    mount(detail());
    await userEvent.click(screen.getByRole("button", { name: /Add a trip/ }));
    await userEvent.type(screen.getByPlaceholderText(/What's the trip for/), "Commissioning");
    const dates = screen.getAllByDisplayValue("");
    const around = dates.find((el) => (el as HTMLInputElement).type === "date")!;
    await userEvent.type(around, "2026-08-12");
    await userEvent.click(screen.getByRole("button", { name: "Add the trip" }));
    expect(pact.createProjectVisit).toHaveBeenCalledWith("p-1", {
      label: "Commissioning",
      dueDate: "2026-08-12",
      bookedDate: null,
    });
  });

  it("tells the labour-burn truth under the trips", () => {
    mount(
      detail({ hoursBudget: 48, hoursLogged: 52 }),
      [trip({ id: "v-9", status: "done", completedAt: "2026-07-28", actualHours: 52 })]
    );
    expect(screen.getByText(/52 of 48 h used — over the labour budget\./)).toBeInTheDocument();
  });
});
