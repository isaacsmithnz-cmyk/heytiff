/* The rebuilt project page, held still.

   What these pin, by decision: Blocked as a first-class state with its
   reason-and-who story and one-press unblock (P4); stage moves that are
   manual but checklist-aware — the nudge when a section completes, the
   warn-never-block two-press past unticked items, corrections backward
   asking nothing (P5); and the trips card sharing the board's rows, gates
   and sheet. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { pickDate } from "@/components/ui/__tests__/fixtures/pick-date";
import { ProjectDetailScreen } from "../project-detail-screen";
import type { ProjectDetail } from "@/lib/workboard/projects-query";
import type { ProjectBoardVisit } from "@/lib/workboard/projects-board-query";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
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
      staff={[{ id: "s-1", name: "Luke Nguyen" }]}
      today={TODAY}
      manage={manage}
      sm8Connected={false}
      entries={[]}
      issues={[]}
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
    await pickDate("Roughly when", "2026-08-12");
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

  it("says the claimed line off the REVISED total, with collection kept apart", () => {
    mount(withMoney);
    expect(screen.getByText("Claimed $10,000 of $54,000 — $44,000 to go")).toBeInTheDocument();
    expect(screen.getByText("$10,000 paid")).toBeInTheDocument();
  });

  it("flips a claim's collection status without touching the claimed line", async () => {
    mount(withMoney);
    await userEvent.click(screen.getByRole("button", { name: "Paid" }));
    expect(pact.setClaimPaid).toHaveBeenCalledWith("cl-1", false);
  });

  it("adds a claim through the modal", async () => {
    mount(withMoney);
    await userEvent.click(screen.getByRole("button", { name: /Add a claim/ }));
    await userEvent.type(screen.getByPlaceholderText(/Deposit · Rough-in claim/), "Rough-in claim");
    await userEvent.type(screen.getByPlaceholderText("10,000"), "15,000");
    await userEvent.click(screen.getByRole("button", { name: "Add the claim" }));
    expect(pact.addClaim).toHaveBeenCalledWith("p-1", {
      label: "Rough-in claim",
      amountCents: 1_500_000,
      variationId: null,
    });
  });

  it("an approved unclaimed variation offers Claim it, prefilled", async () => {
    mount(withMoney);
    await userEvent.click(screen.getByRole("button", { name: "Claim it" }));
    expect(pact.addClaim).toHaveBeenCalledWith("p-1", {
      label: "Variation — Extra return-air grille",
      amountCents: 400_000,
      variationId: "var-1",
    });
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

    it("counts toward the claimed line like any other", () => {
      mount(mirrored);
      expect(screen.getByText(/Claimed \$3,960 of \$50,000/)).toBeInTheDocument();
    });

    it("says where it came from", () => {
      mount(mirrored);
      expect(screen.getByText(/from ServiceM8/)).toBeInTheDocument();
    });

    it("offers no paid toggle and no remove, even to a manager", () => {
      mount(mirrored);
      expect(screen.queryByRole("button", { name: "Awaiting payment" })).not.toBeInTheDocument();
      expect(screen.getByText("Awaiting payment")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Remove Invoice — job #2198/ })
      ).not.toBeInTheDocument();
    });

    it("explains that the hand-typed ledger is still there for the rest", () => {
      mount(mirrored);
      expect(screen.getByText(/a deposit, retention/)).toBeInTheDocument();
    });
  });
});

/* Money is a separate grant (`workboard_money`). Without it the loader
   selected no budget, no variations and no claims — so the cards must be
   ABSENT, not empty: an empty money card states that the job has no total,
   which is a claim about the project and not about who is looking. */
describe("a reader with no money access", () => {
  const noMoney = detail({ moneyVisible: false, budgetCents: null, variations: [], claims: [] });

  it("gets no money card and no invitation to set a total", () => {
    mount(noMoney);
    expect(screen.queryByText("Money")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Set the total/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add a claim/ })).not.toBeInTheDocument();
  });

  it("gets no variations card either — a variation is a dollar figure", () => {
    mount(noMoney);
    expect(screen.queryByText("Variations")).not.toBeInTheDocument();
  });

  /* Scope is site knowledge, not money: what's included and excluded is what
     the crew on site needs, and it carries no dollars. */
  it("keeps the scope card, which carries no money", () => {
    mount(noMoney);
    expect(screen.getByText("Scope of work")).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("button", { name: "Approve…" }));
    const approve = screen.getByRole("button", { name: "Approve it" });
    expect(approve).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(/Sarah Bowden/), "Sarah Bowden");
    await userEvent.click(approve);
    expect(pact.decideVariation).toHaveBeenCalledWith("var-9", "approved", "Sarah Bowden");
  });
});

describe("the flywheel", () => {
  it("offers itself at Handover and spawns the agreement with cadence + first service", async () => {
    mount(detail({ stage: "Handover" }));
    await userEvent.click(screen.getByRole("button", { name: "Set up the agreement" }));
    await pickDate("First service due", "2027-02-01");
    await userEvent.click(screen.getByRole("button", { name: "Create the agreement" }));
    expect(pact.spawnAgreementFromProject).toHaveBeenCalledWith("p-1", {
      intervalMonths: 6,
      anchorDate: "2027-02-01",
    });
  });

  it("stays quiet mid-build, and once spawned it shows the link instead", () => {
    const { unmount } = mount(detail({ stage: "Rough-in" }));
    expect(screen.queryByText(/Set up the agreement/)).not.toBeInTheDocument();
    unmount();

    mount(detail({ stage: "Handover", agreementId: "a-1", agreementLabel: "Bowden St ducted" }));
    expect(screen.queryByRole("button", { name: "Set up the agreement" })).not.toBeInTheDocument();
    expect(screen.getByText(/on the maintenance board/)).toBeInTheDocument();
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
    await userEvent.type(
      screen.getByPlaceholderText(/Suction 8\.2 bar/),
      "Suction 8.2 bar, superheat 6.1 K{Enter}"
    );
    expect(pact.addProjectEntry).toHaveBeenCalledWith(
      "p-1",
      "commissioning",
      "Suction 8.2 bar, superheat 6.1 K"
    );
  });

  it("links the handover sheet from the commissioning card", () => {
    mount(detail());
    expect(screen.getByRole("link", { name: /Handover sheet/ })).toHaveAttribute(
      "href",
      "/handover/p-1"
    );
  });
});

/* The SM8 garnish on a linked job chip — the one thing on this screen that
   renders straight out of the mirror, and the reason it stayed blank in prod
   until 2026-08-12 was that sm8_job_checklists had never synced a row (the
   sync's page budget starved the last object in the walk; #357). The markup
   was never covered, so "renders nothing" had two candidate causes and no
   test could tell them apart. These separate them for good. */
describe("the mirror's garnish on a linked job", () => {
  const jobRow = () => screen.getByText("#1042").closest<HTMLElement>(".wb-row")!;

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
    expect(within(jobRow()).getByText("Work Order")).toBeInTheDocument(); // the rest still renders
  });

  it("stays silent on a zero-length list rather than saying 0/0", () => {
    mount(detail({ jobs: [linkedJob({ mirror: mirror({ checklist: { done: 0, total: 0 } }) })] }));
    expect(within(jobRow()).queryByText(/SM8 list/)).not.toBeInTheDocument();
  });

  /* The OTHER reason prod shows nothing, still true today: project_jobs is
     empty, so no chip exists to garnish. A job the mirror doesn't hold says
     so — it must never borrow the previous row's counts. */
  it("an unmirrored job says so instead of garnishing", () => {
    mount(detail({ jobs: [linkedJob({ mirror: null })] }));
    expect(within(jobRow()).getByText(/Not in the mirror yet/)).toBeInTheDocument();
    expect(within(jobRow()).queryByText(/SM8 list/)).not.toBeInTheDocument();
  });

  it("with no jobs attached the card says so and no garnish is reachable", () => {
    mount(detail({ jobs: [] }));
    expect(screen.getByText("No jobs attached yet.")).toBeInTheDocument();
    expect(screen.queryByText(/SM8 list/)).not.toBeInTheDocument();
  });
});
