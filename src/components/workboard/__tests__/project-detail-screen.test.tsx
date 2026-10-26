/* The project page, held still (v2: tabs like a job, Isaac, 27 October 2026).

   What these pin, by decision: Blocked as a first-class state with its
   reason-and-who story and one-press unblock (P4); stage moves that are
   manual but checklist-aware — the nudge when a section completes, moving
   past unticked items asking in a dialog and never blocking, corrections
   backward asking nothing (P5); the trips sharing the board's rows, gates
   and sheet; and the project's forms on the Dialog part. */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { pickDate } from "@/components/ui/__tests__/fixtures/pick-date";
import { ProjectDetailScreen } from "../project-detail-screen";
import type { ProjectDetail } from "@/lib/workboard/projects-query";
import type { ProjectBoardVisit } from "@/lib/workboard/projects-board-query";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => "/dashboard/jobs/projects/p-1",
}));

jest.mock("@/components/notes/note-token", () => ({
  NoteToken: ({ as }: { as?: string }) => <div data-testid="capture" data-as={as} />,
}));
jest.mock("../board/project-trip-sheet", () => ({
  ProjectTripSheet: ({ visit }: { visit: { label: string } }) => (
    <div role="dialog" data-testid="tripsheet">
      {visit.label}
    </div>
  ),
}));
jest.mock("@/app/actions/workboard-ai", () => ({
  readEquipmentPhoto: jest.fn(async () => ({ ok: false, reason: "no-key" })),
}));
/* New agreement, opened at handover, reads what the board would hand it */
const agreementFormContext = jest.fn(async () => ({ agreements: [], categories: [], connected: true, voiceless: false }));
const createAgreement = jest.fn(async () => ({ ok: true, id: "a-new" }));
jest.mock("@/app/actions/agreement-form", () => ({ agreementFormContext: () => agreementFormContext() }));
jest.mock("@/app/actions/workboard-maintenance", () => ({
  createAgreement: (...a: unknown[]) => createAgreement(...(a as [])),
  createCategory: jest.fn(),
  addPackingItem: jest.fn(),
}));
const deleteDocument = jest.fn(async () => ({ ok: true }));
jest.mock("@/app/actions/documents", () => ({
  deleteDocument: (...a: unknown[]) => deleteDocument(...(a as [])),
}));
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: jest.fn(async () => ({
    ok: true,
    file: { documentId: "d-new", fileName: "x.jpg", mimeType: "image/jpeg", sizeBytes: 1, previewUrl: null },
  })),
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
  setProjectBudget: jest.fn(async () => ({ ok: true })),
  setProjectHoursBudget: jest.fn(async () => ({ ok: true })),
  setProjectPromise: jest.fn(async () => ({ ok: true })),
  setProjectDefectsEnd: jest.fn(async () => ({ ok: true })),
  addScopeItem: jest.fn(async () => ({ ok: true })),
  removeScopeItem: jest.fn(async () => ({ ok: true })),
  addVariation: jest.fn(async () => ({ ok: true })),
  decideVariation: jest.fn(async () => ({ ok: true })),
  removeVariation: jest.fn(async () => ({ ok: true })),
  addClaim: jest.fn(async () => ({ ok: true })),
  setClaimPaid: jest.fn(async () => ({ ok: true })),
  removeClaim: jest.fn(async () => ({ ok: true })),
  addMilestone: jest.fn(async () => ({ ok: true })),
  removeMilestone: jest.fn(async () => ({ ok: true })),
  spawnAgreementFromProject: jest.fn(async () => ({ ok: true, id: "a-new" })),
  addProjectEntry: jest.fn(async () => ({ ok: true })),
  attachDocumentToProject: jest.fn(async () => ({ ok: true })),
};
jest.mock("@/app/actions/workboard-projects", () => ({
  setProjectBlocked: (...a: unknown[]) => pact.setProjectBlocked(...(a as [])),
  clearProjectBlocked: (...a: unknown[]) => pact.clearProjectBlocked(...(a as [])),
  createProjectVisit: (...a: unknown[]) => pact.createProjectVisit(...(a as [])),
  setProjectBudget: (...a: unknown[]) => pact.setProjectBudget(...(a as [])),
  setProjectHoursBudget: (...a: unknown[]) => pact.setProjectHoursBudget(...(a as [])),
  setProjectPromise: (...a: unknown[]) => pact.setProjectPromise(...(a as [])),
  setProjectDefectsEnd: (...a: unknown[]) => pact.setProjectDefectsEnd(...(a as [])),
  addScopeItem: (...a: unknown[]) => pact.addScopeItem(...(a as [])),
  removeScopeItem: (...a: unknown[]) => pact.removeScopeItem(...(a as [])),
  addVariation: (...a: unknown[]) => pact.addVariation(...(a as [])),
  decideVariation: (...a: unknown[]) => pact.decideVariation(...(a as [])),
  removeVariation: (...a: unknown[]) => pact.removeVariation(...(a as [])),
  addClaim: (...a: unknown[]) => pact.addClaim(...(a as [])),
  setClaimPaid: (...a: unknown[]) => pact.setClaimPaid(...(a as [])),
  removeClaim: (...a: unknown[]) => pact.removeClaim(...(a as [])),
  addMilestone: (...a: unknown[]) => pact.addMilestone(...(a as [])),
  removeMilestone: (...a: unknown[]) => pact.removeMilestone(...(a as [])),
  spawnAgreementFromProject: (...a: unknown[]) => pact.spawnAgreementFromProject(...(a as [])),
  addProjectEntry: (...a: unknown[]) => pact.addProjectEntry(...(a as [])),
  attachDocumentToProject: (...a: unknown[]) => pact.attachDocumentToProject(...(a as [])),
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
    moneyVisible: true,
    budgetCents: null,
    budgetSource: null,
    hoursBudget: null,
    promisedFinish: null,
    defectsEnd: null,
    designId: null,
    designName: null,
    agreementId: null,
    agreementLabel: null,
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
    documents: [],
    hoursLogged: 0,
    ...over,
  };
}

/** A linked job carrying whatever slice of the mirror the case is about. */
function linkedJob(over: Partial<ProjectDetail["jobs"][number]> = {}): ProjectDetail["jobs"][number] {
  return {
    id: "pj-1",
    jobNumber: "1042",
    role: "install",
    provider: "servicem8",
    remoteId: "sm8-job-1",
    mirror: null,
    ...over,
  };
}

const mirror = (
  over: Partial<NonNullable<ProjectDetail["jobs"][number]["mirror"]>> = {}
): NonNullable<ProjectDetail["jobs"][number]["mirror"]> => ({
  status: "Work Order",
  suburb: "Coorparoo",
  address: null,
  nextBooking: null,
  checklist: null,
  contacts: [],
  ...over,
});

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

function mount(p: ProjectDetail, trips: ProjectBoardVisit[] = [], manage = true) {
  return render(
    <ProjectDetailScreen
      project={p}
      trips={trips}
      staff={[{ id: "s-1", name: "Lyle Nguyen" }]}
      today={TODAY}
      manage={manage}
      sm8Connected={false}
      entries={[]}
      issues={[]}
    />
  );
}

/** Opens one of the page's six section tabs. */
const tab = (name: string) => userEvent.click(screen.getByRole("tab", { name }));

/** Picks an item from the head's Actions menu. */
async function action(name: string) {
  await userEvent.click(screen.getByRole("button", { name: /^Actions/ }));
  await userEvent.click(await screen.findByRole("menuitem", { name }));
}

beforeEach(() => jest.clearAllMocks());

describe("the page's shape", () => {
  it("has the job page's six section tabs, Money only with the money grant", async () => {
    const { unmount } = mount(detail());
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Overview", "Trips", "Scope", "Money", "Site", "Documents"]);
    unmount();
    mount(detail({ moneyVisible: false }));
    expect(screen.queryByRole("tab", { name: "Money" })).not.toBeInTheDocument();
  });

  it("keeps the open tab in the address", async () => {
    mount(detail());
    await tab("Scope");
    expect(window.location.search).toBe("?tab=scope");
    await tab("Overview");
    expect(window.location.search).toBe("");
  });

  it("says where it stands as a word, with the one press that state wants in blue", async () => {
    mount(detail({ status: "on_hold" }));
    expect(screen.getByText("On hold")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Resume project" }));
    expect(act.setProjectStatus).toHaveBeenCalledWith("p-1", "active");
  });

  it("an active project has no blue press; Block and Put on hold are in Actions", async () => {
    mount(detail());
    expect(screen.queryByRole("button", { name: /Resume|Unblock|Reopen/ })).not.toBeInTheDocument();
    await action("Put on hold");
    expect(act.setProjectStatus).toHaveBeenCalledWith("p-1", "on_hold");
  });
});

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
    expect(screen.getByText(/switchboard upgrade not done, since/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Unblock project" }));
    expect(pact.clearProjectBlocked).toHaveBeenCalledWith("p-1");
  });

  it("blocking demands the reason AND the who before it fires", async () => {
    mount(detail());
    await action("Block project");
    const dialog = within(screen.getByRole("dialog", { name: "Block the project" }));
    const blockIt = dialog.getByRole("button", { name: "Block project" });
    expect(blockIt).toBeDisabled();
    await userEvent.type(dialog.getByLabelText("Waiting on"), "council");
    expect(blockIt).toBeDisabled();
    await userEvent.type(dialog.getByLabelText("Why"), "permit pending");
    await userEvent.click(blockIt);
    expect(pact.setProjectBlocked).toHaveBeenCalledWith("p-1", {
      reason: "permit pending",
      on: "council",
    });
    expect(screen.queryByRole("dialog", { name: "Block the project" })).not.toBeInTheDocument();
  });
});

describe("stage moves (P5 — manual, checklist-aware)", () => {
  it("moving past unticked items asks in a dialog, and a second deliberate press moves it", async () => {
    mount(detail({ stage: "Pre-install", checklist: checklist([]) }));
    await userEvent.click(screen.getByRole("button", { name: "Rough-in" }));
    expect(act.setProjectStage).not.toHaveBeenCalled();
    const dialog = within(screen.getByRole("dialog", { name: "Move to Rough-in?" }));
    expect(dialog.getByText("4 items under Approval & prep aren't ticked yet.")).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Move to Rough-in" }));
    expect(act.setProjectStage).toHaveBeenCalledWith("p-1", "Rough-in");
  });

  it("keeping the stage moves nothing", async () => {
    mount(detail({ stage: "Pre-install", checklist: checklist([]) }));
    await userEvent.click(screen.getByRole("button", { name: "Commission" }));
    expect(screen.getByText("4 items under Approval & prep and 4 under On the tools aren't ticked yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep at Pre-install" }));
    expect(act.setProjectStage).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

  it("a completed section says so and offers the move in one press", async () => {
    mount(detail({ stage: "Pre-install", checklist: checklist(["Approval & prep"]) }));
    expect(screen.getByText("All ticked")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Move to Rough-in" }));
    expect(act.setProjectStage).toHaveBeenCalledWith("p-1", "Rough-in");
  });

  it("ticks are facts, not levers — no auto-advance ever fires", async () => {
    mount(detail({ stage: "Pre-install", checklist: checklist([]) }));
    expect(screen.queryByText(/of 15 ticked/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Quote accepted" }));
    expect(act.toggleChecklistItem).toHaveBeenCalledWith("Approval & prep-0", true);
    expect(act.setProjectStage).not.toHaveBeenCalled();
  });
});

describe("the status in Actions", () => {
  it("offers Mark project done only once the stage is Complete", async () => {
    mount(detail({ stage: "Fit-off" }));
    await userEvent.click(screen.getByRole("button", { name: /^Actions/ }));
    expect(screen.queryByRole("menuitem", { name: "Mark project done" })).not.toBeInTheDocument();
  });

  it("closes from Complete, and a closed project reopens", async () => {
    const { unmount } = mount(detail({ stage: "Complete" }));
    await action("Mark project done");
    expect(act.setProjectStatus).toHaveBeenCalledWith("p-1", "done");
    unmount();

    mount(detail({ status: "done" }));
    await userEvent.click(screen.getByRole("button", { name: "Reopen project" }));
    expect(act.setProjectStatus).toHaveBeenCalledWith("p-1", "active");
  });
});

describe("trips", () => {
  it("shows open trips with their gates and opens the shared sheet", async () => {
    mount(detail(), [trip({ id: "v-1" })]);
    await tab("Trips");
    const row = screen.getByRole("button", { name: "Open Rough-in — day 1" }).closest("li")!;
    expect(within(row).getByText("Not placed")).toBeInTheDocument();
    expect(within(row).getByText(/Equipment/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open Rough-in — day 1" }));
    expect(screen.getByTestId("tripsheet")).toHaveTextContent("Rough-in — day 1");
  });

  it("adds a trip with its purpose and target day", async () => {
    mount(detail());
    await tab("Trips");
    await userEvent.click(screen.getByRole("button", { name: "Add trip" }));
    const dialog = within(screen.getByRole("dialog", { name: "Add a trip" }));
    await userEvent.type(dialog.getByLabelText("What it's for"), "Commissioning");
    await pickDate("Around", "2026-08-12");
    await userEvent.click(dialog.getByRole("button", { name: "Add trip" }));
    expect(pact.createProjectVisit).toHaveBeenCalledWith("p-1", {
      label: "Commissioning",
      dueDate: "2026-08-12",
      bookedDate: null,
    });
  });

  it("tells the labour-burn truth beside the dates", async () => {
    mount(
      detail({ hoursBudget: 48, hoursLogged: 52 }),
      [trip({ id: "v-9", status: "done", completedAt: "2026-07-28", actualHours: 52 })]
    );
    await tab("Trips");
    expect(screen.getByText("52 of 48 h")).toBeInTheDocument();
    expect(screen.getByText("Over the budget")).toBeInTheDocument();
    expect(screen.getByText("52 h on site")).toBeInTheDocument();
  });

  it("sets a committed date through its form", async () => {
    mount(detail());
    await tab("Trips");
    const promised = screen.getByText("Promised finish").closest("li")!;
    await userEvent.click(within(promised).getByRole("button", { name: "Set date" }));
    const dialog = within(screen.getByRole("dialog", { name: "Promised finish" }));
    await pickDate("Day", "2026-09-01");
    await userEvent.click(dialog.getByRole("button", { name: "Save date" }));
    expect(pact.setProjectPromise).toHaveBeenCalledWith("p-1", "2026-09-01");
  });
});

describe("money (the two axes, never mixed)", () => {
  const withMoney = detail({
    budgetCents: 5_000_000,
    budgetSource: "manual",
    variations: [
      {
        id: "var-1",
        title: "Extra return-air grille",
        detail: null,
        amountCents: 400_000,
        status: "approved",
        decidedBy: "Sarah Bowden",
        decidedAt: "2026-07-20T00:00:00Z",
        createdAt: "2026-07-19T00:00:00Z",
      },
    ],
    claims: [
      {
        id: "cl-1",
        label: "Deposit",
        amountCents: 1_000_000,
        claimedOn: "2026-07-10",
        status: "paid",
        paidOn: "2026-07-14",
        source: "manual",
        remoteRef: null,
        variationId: null,
      },
    ],
  });

  it("says the claimed line off the REVISED total, with collection kept apart", async () => {
    mount(withMoney);
    await tab("Money");
    expect(screen.getByText("Claimed $10,000 of $54,000 — $44,000 to go")).toBeInTheDocument();
    expect(screen.getByText("$10,000 paid")).toBeInTheDocument();
  });

  it("flips a claim's collection status without touching the claimed line", async () => {
    mount(withMoney);
    await tab("Money");
    await userEvent.click(screen.getByRole("button", { name: "Mark unpaid" }));
    expect(pact.setClaimPaid).toHaveBeenCalledWith("cl-1", false);
  });

  it("adds a claim through its form", async () => {
    mount(withMoney);
    await tab("Money");
    await userEvent.click(screen.getByRole("button", { name: "Add claim" }));
    const dialog = within(screen.getByRole("dialog", { name: "Add a claim" }));
    await userEvent.type(dialog.getByLabelText("Label"), "Rough-in claim");
    await userEvent.type(dialog.getByLabelText("Amount ($)"), "15,000");
    await userEvent.click(dialog.getByRole("button", { name: "Add claim" }));
    expect(pact.addClaim).toHaveBeenCalledWith("p-1", {
      label: "Rough-in claim",
      amountCents: 1_500_000,
      variationId: null,
    });
  });

  it("an approved unclaimed variation offers its claim, prefilled", async () => {
    mount(withMoney);
    await tab("Money");
    await userEvent.click(screen.getByRole("button", { name: "Claim variation" }));
    expect(pact.addClaim).toHaveBeenCalledWith("p-1", {
      label: "Variation — Extra return-air grille",
      amountCents: 400_000,
      variationId: "var-1",
    });
  });

  it("the strip's Money cell says the total and opens Money", async () => {
    mount(withMoney);
    const cell = screen.getByRole("button", { name: "Money" });
    expect(screen.getByText("$54,000")).toBeInTheDocument();
    await userEvent.click(cell);
    expect(screen.getByRole("tab", { name: "Money" })).toHaveAttribute("aria-selected", "true");
  });

  /* A mirrored claim is ServiceM8's row: the sync rewrites its amount and its
     paid-ness on every board load, so offering a button here would promise an
     edit the next sync silently undoes. The server refuses it too. */
  describe("a claim that mirrors a ServiceM8 invoice", () => {
    const mirrored = detail({
      budgetCents: 5_000_000,
      claims: [
        {
          id: "cl-sm8",
          label: "Invoice — job #2198",
          amountCents: 396_000,
          claimedOn: "2026-07-30",
          status: "awaiting",
          paidOn: null,
          source: "servicem8",
          remoteRef: "j-1",
          variationId: null,
        },
      ],
    });

    it("counts toward the claimed line like any other", async () => {
      mount(mirrored);
      await tab("Money");
      expect(screen.getByText(/Claimed \$3,960 of \$50,000/)).toBeInTheDocument();
    });

    it("says where it came from", async () => {
      mount(mirrored);
      await tab("Money");
      expect(screen.getByText(/from ServiceM8/)).toBeInTheDocument();
    });

    it("offers no paid toggle and no remove, even to a manager", async () => {
      mount(mirrored);
      await tab("Money");
      expect(screen.queryByRole("button", { name: /Mark (un)?paid/ })).not.toBeInTheDocument();
      expect(screen.getByText("Awaiting payment")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Remove Invoice — job #2198/ })
      ).not.toBeInTheDocument();
    });
  });
});

/* Money is a separate grant (`workboard_money`). Without it the loader
   selected no budget, no variations and no claims — so the money must be
   ABSENT, not empty: an empty Money tab states that the job has no total,
   which is a claim about the project and not about who is looking. */
describe("a reader with no money access", () => {
  const noMoney = detail({ moneyVisible: false, budgetCents: null, variations: [], claims: [] });

  it("gets no Money tab, no Money cell and no invitation to set a total or claim", async () => {
    mount(noMoney);
    expect(screen.queryByText("Money")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Actions/ }));
    expect(screen.queryByRole("menuitem", { name: "Add claim" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Add variation" })).not.toBeInTheDocument();
  });

  it("lands on Overview when the address asks for Money", () => {
    render(
      <ProjectDetailScreen
        project={noMoney}
        trips={[]}
        staff={[]}
        today={TODAY}
        manage
        sm8Connected={false}
        entries={[]}
        issues={[]}
        tab="money"
      />
    );
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  /* Scope is site knowledge, not money: what's included and excluded is what
     the crew on site needs, and it carries no dollars. */
  it("keeps the scope, which carries no money", async () => {
    mount(noMoney);
    await tab("Scope");
    expect(screen.getByText("In the price")).toBeInTheDocument();
    expect(screen.getByText("Not in the price")).toBeInTheDocument();
  });
});

describe("variations record who made the call", () => {
  it("approving demands a name before it fires", async () => {
    mount(
      detail({
        variations: [
          {
            id: "var-9",
            title: "Zone the media room",
            detail: null,
            amountCents: 250_000,
            status: "pending",
            decidedBy: null,
            decidedAt: null,
            createdAt: "2026-07-28T00:00:00Z",
          },
        ],
      })
    );
    await tab("Money");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = within(screen.getByRole("dialog", { name: "Approve the variation" }));
    expect(dialog.getByText("Zone the media room, $2,500.")).toBeInTheDocument();
    const approve = dialog.getByRole("button", { name: "Approve variation" });
    expect(approve).toBeDisabled();
    await userEvent.type(dialog.getByLabelText("Who approved it"), "Sarah Bowden");
    await userEvent.click(approve);
    expect(pact.decideVariation).toHaveBeenCalledWith("var-9", "approved", "Sarah Bowden");
  });

  it("adds one through its form, waiting on a decision", async () => {
    mount(detail());
    await action("Add variation");
    const dialog = within(screen.getByRole("dialog", { name: "Add a variation" }));
    await userEvent.type(dialog.getByLabelText("What it is"), "Extra grille");
    await userEvent.type(dialog.getByLabelText("Amount ($)"), "-1,500");
    await userEvent.click(dialog.getByRole("button", { name: "Add variation" }));
    expect(pact.addVariation).toHaveBeenCalledWith("p-1", { title: "Extra grille", detail: undefined, amountCents: -150_000 });
  });
});

describe("the project's forms", () => {
  it("edits the name, client and site", async () => {
    mount(detail());
    await action("Edit details");
    const dialog = within(screen.getByRole("dialog", { name: "Edit project" }));
    await userEvent.clear(dialog.getByLabelText("Client"));
    await userEvent.type(dialog.getByLabelText("Client"), "Sarah Bowden");
    await userEvent.click(dialog.getByRole("button", { name: "Save project" }));
    expect(act.updateProjectMeta).toHaveBeenCalledWith("p-1", {
      name: "Bowden St ducted",
      clientName: "Sarah Bowden",
      siteLabel: "14 Bowden St",
      siteAddress: "",
    });
  });

  it("keeps a two-line site address on two lines", async () => {
    mount(detail({ siteAddress: "26 Boomerang Ave\nLilli Pilli NSW 2229" }));
    await action("Edit details");
    const dialog = within(screen.getByRole("dialog", { name: "Edit project" }));
    const address = dialog.getByLabelText("Site address");
    expect(address.tagName).toBe("TEXTAREA");
    expect(address).toHaveValue("26 Boomerang Ave\nLilli Pilli NSW 2229");
    await userEvent.type(address, "{Enter}Australia");
    await userEvent.click(dialog.getByRole("button", { name: "Save project" }));
    expect(act.updateProjectMeta).toHaveBeenCalledWith("p-1", expect.objectContaining({ siteAddress: "26 Boomerang Ave\nLilli Pilli NSW 2229\nAustralia" }));
  });

  it("attaches a typed job number in its role", async () => {
    mount(detail());
    await userEvent.click(screen.getByRole("button", { name: "Attach job" }));
    const dialog = within(screen.getByRole("dialog", { name: "Attach a job" }));
    await userEvent.click(dialog.getByRole("combobox", { name: "Role on this project" }));
    await userEvent.click(await screen.findByRole("option", { name: "Quote" }));
    await userEvent.type(dialog.getByLabelText("Job number"), "1042");
    await userEvent.click(dialog.getByRole("button", { name: "Attach job" }));
    expect(act.attachJob).toHaveBeenCalledWith("p-1", { jobNumber: "1042", role: "quote" });
  });

  it("adds equipment, and Cancel closes the form without a word to the server", async () => {
    mount(detail());
    await action("Add equipment");
    let dialog = within(screen.getByRole("dialog", { name: "Add equipment" }));
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await action("Add equipment");
    dialog = within(screen.getByRole("dialog", { name: "Add equipment" }));
    await userEvent.type(dialog.getByLabelText("Description"), "Ducted indoor unit");
    await userEvent.type(dialog.getByLabelText("Serial"), "4ZU01523");
    await userEvent.click(dialog.getByRole("button", { name: "Add equipment" }));
    await waitFor(() =>
      expect(act.addEquipment).toHaveBeenCalledWith("p-1", { description: "Ducted indoor unit", model: "", serial: "4ZU01523", locationNote: "" })
    );
  });
});

describe("the flywheel", () => {
  it("offers itself at Handover and opens New agreement filled in from the project", async () => {
    mount(detail({ stage: "Handover" }));
    await userEvent.click(screen.getByRole("button", { name: "Set up agreement" }));
    const form = within(await screen.findByRole("dialog", { name: "New agreement" }));
    // the project is the record: filled in, and clearable
    expect(form.getByText("Bowden St ducted", { selector: ".mk-job-name" })).toBeInTheDocument();
    expect(form.getByRole("button", { name: "Clear the project" })).toBeInTheDocument();
    expect(form.getByLabelText("Service label")).toHaveValue("Bowden St ducted");
    expect(form.getByLabelText("Client")).toHaveValue("The Bowdens");
    expect(form.getByLabelText("Site label")).toHaveValue("14 Bowden St");
    expect(form.getByRole("combobox", { name: "How often" })).toHaveTextContent("6-monthly");
    expect(form.getByLabelText("We installed this system")).toBeChecked();
    // a project's agreement is its own: no ServiceM8 leg
    expect(form.queryByRole("radiogroup", { name: "From" })).not.toBeInTheDocument();
  });

  it("creates through today's handover action, cadence, first service and the form's fields with it", async () => {
    mount(detail({ stage: "Handover" }));
    await userEvent.click(screen.getByRole("button", { name: "Set up agreement" }));
    const form = within(await screen.findByRole("dialog", { name: "New agreement" }));
    await waitFor(() => expect(agreementFormContext).toHaveBeenCalled());
    await pickDate("First service due", "2027-02-01", form);
    await userEvent.type(form.getByLabelText("Billing contact"), "sarah@bowden.au");
    await userEvent.click(form.getByRole("button", { name: "Create the agreement" }));
    expect(pact.spawnAgreementFromProject).toHaveBeenCalledWith(
      "p-1",
      expect.objectContaining({
        intervalMonths: 6,
        anchorDate: "2027-02-01",
        label: "Bowden St ducted",
        clientName: "The Bowdens",
        siteLabel: "14 Bowden St",
        weInstalled: true,
        billingContact: "sarah@bowden.au",
      }),
    );
    expect(createAgreement).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New agreement" })).not.toBeInTheDocument());
  });

  it("cleared of its project, it is an ordinary agreement", async () => {
    mount(detail({ stage: "Handover" }));
    await userEvent.click(screen.getByRole("button", { name: "Set up agreement" }));
    const form = within(await screen.findByRole("dialog", { name: "New agreement" }));
    await waitFor(() => expect(agreementFormContext).toHaveBeenCalled());
    await userEvent.click(form.getByRole("button", { name: "Clear the project" }));
    await pickDate("First service due", "2027-02-01", form);
    await userEvent.click(form.getByRole("button", { name: "Create the agreement" }));
    expect(createAgreement).toHaveBeenCalledWith(expect.objectContaining({ label: "Bowden St ducted", anchorDate: "2027-02-01" }));
    expect(pact.spawnAgreementFromProject).not.toHaveBeenCalled();
  });

  it("stays quiet mid-build, and once spawned it shows the link instead", () => {
    const { unmount } = mount(detail({ stage: "Rough-in" }));
    expect(screen.queryByText(/Set up agreement/)).not.toBeInTheDocument();
    unmount();

    mount(detail({ stage: "Handover", agreementId: "a-1", agreementLabel: "Bowden St ducted" }));
    expect(screen.queryByRole("button", { name: "Set up agreement" })).not.toBeInTheDocument();
    expect(screen.getByText(/On the maintenance board/)).toBeInTheDocument();
  });
});

describe("documents & photos", () => {
  it("lists the project's files with a signed Open link, and deletes in place", async () => {
    mount(
      detail({
        documents: [
          {
            id: "d-1",
            fileName: "before-cover-up.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 2_400_000,
            uploadedAt: "2026-07-28T02:00:00Z",
            url: "https://signed.example/x",
          },
        ],
      })
    );
    await tab("Documents");
    expect(screen.getByText("before-cover-up.jpg")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "https://signed.example/x"
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove before-cover-up.jpg" }));
    expect(deleteDocument).toHaveBeenCalledWith("d-1");
  });
});

describe("journals", () => {
  it("a typed commissioning reading lands in the same table the voice brain writes", async () => {
    mount(detail());
    await tab("Site");
    await userEvent.type(
      screen.getByPlaceholderText("Readings and settings"),
      "Suction 8.2 bar, superheat 6.1 K{Enter}"
    );
    expect(pact.addProjectEntry).toHaveBeenCalledWith(
      "p-1",
      "commissioning",
      "Suction 8.2 bar, superheat 6.1 K"
    );
  });

  it("the site journal sits on Overview", async () => {
    mount(detail());
    await userEvent.type(screen.getByPlaceholderText("What was done or found today"), "Rough-in done in the roof");
    await userEvent.click(screen.getByRole("button", { name: "Add entry" }));
    expect(pact.addProjectEntry).toHaveBeenCalledWith("p-1", "progress", "Rough-in done in the roof");
  });

  it("links the handover sheet from Commissioning", async () => {
    mount(detail());
    await tab("Site");
    expect(screen.getByRole("link", { name: "Open handover sheet" })).toHaveAttribute(
      "href",
      "/handover/p-1"
    );
  });
});

/* The SM8 garnish on a linked job — the one thing on this screen that
   renders straight out of the mirror, and the reason it stayed blank in prod
   until 2026-08-12 was that sm8_job_checklists had never synced a row (the
   sync's page budget starved the last object in the walk; #357). The markup
   was never covered, so "renders nothing" had two candidate causes and no
   test could tell them apart. These separate them for good. */
describe("the mirror's garnish on a linked job", () => {
  const jobRow = () => document.querySelector<HTMLElement>('[data-job="1042"]')!;

  it("shows done/total once the checklist mirror holds rows", () => {
    mount(detail({ jobs: [linkedJob({ mirror: mirror({ checklist: { done: 3, total: 8 } }) })] }));
    expect(within(jobRow()).getByText(/SM8 list 3\/8/)).toBeInTheDocument();
  });

  it("a fully ticked list still reads as a fraction, never a bare tick", () => {
    mount(detail({ jobs: [linkedJob({ mirror: mirror({ checklist: { done: 5, total: 5 } }) })] }));
    expect(within(jobRow()).getByText(/SM8 list 5\/5/)).toBeInTheDocument();
  });

  /* THE PROD SHAPE BEFORE #357, and the case that must never read as "0 done":
     the job is mirrored, but the checklist table is empty for it. An empty
     list and a list nobody has ticked are different facts, and only one of
     them is worth a garnish. */
  it("stays silent when the job has no checklist rows at all", () => {
    mount(detail({ jobs: [linkedJob({ mirror: mirror({ checklist: null }) })] }));
    expect(within(jobRow()).queryByText(/SM8 list/)).not.toBeInTheDocument();
    expect(within(jobRow()).getByText(/Work Order/)).toBeInTheDocument(); // the rest still renders
  });

  it("stays silent on a zero-length list rather than saying 0/0", () => {
    mount(detail({ jobs: [linkedJob({ mirror: mirror({ checklist: { done: 0, total: 0 } }) })] }));
    expect(within(jobRow()).queryByText(/SM8 list/)).not.toBeInTheDocument();
  });

  /* The OTHER reason prod shows nothing, still true today: project_jobs is
     empty, so no row exists to garnish. A job the mirror doesn't hold says
     so — it must never borrow the previous row's counts. */
  it("an unmirrored job says so instead of garnishing", () => {
    mount(detail({ jobs: [linkedJob({ mirror: null })] }));
    expect(within(jobRow()).getByText(/Not in the mirror yet/)).toBeInTheDocument();
    expect(within(jobRow()).queryByText(/SM8 list/)).not.toBeInTheDocument();
  });

  it("with no jobs attached the section says so and no garnish is reachable", () => {
    mount(detail({ jobs: [] }));
    expect(screen.getByText("No jobs attached yet.")).toBeInTheDocument();
    expect(screen.queryByText(/SM8 list/)).not.toBeInTheDocument();
  });

  it("the client's number comes from the linked job's contact", () => {
    mount(
      detail({
        jobs: [linkedJob({ mirror: mirror({ contacts: [{ name: "Sarah Bowden", type: "JOB", phone: "0410667516", email: null }] }) })],
      })
    );
    expect(screen.getByText("Job contact on 1042")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "0410 667 516" })).toHaveAttribute("href", "tel:0410667516");
  });
});
