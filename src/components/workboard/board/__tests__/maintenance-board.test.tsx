/* The redesigned maintenance board, held still.

   What these pin, by audit finding: the C5 tab order; week grouping with
   trouble-first inside each group (C4/B5); done work absent from Upcoming
   (B7); the horizoned to-confirm chip (B8); the sheet's gates with NO crew
   tick (A12); the packed chip finally rendering (B14); the deliberate
   weekend choice (B9); the close-out that ends K1; urgent rows derived,
   with flags and tasks resolvable in place; Completed showing actuals never
   estimates (L3) and earning "done on time" (B12); agreements rows naming
   their client (B22) and calling an overdue date overdue (B10). */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MaintenanceBoard } from "../maintenance-board";
import type { BoardVisit, MaintenanceBoardData } from "@/lib/workboard/board-query";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const act = {
  setVisitReadiness: jest.fn(async () => ({ ok: true })),
  setVisitPacked: jest.fn(async () => ({ ok: true })),
  assignVisitTech: jest.fn(async () => ({ ok: true })),
  unassignVisitTech: jest.fn(async () => ({ ok: true })),
  placeVisit: jest.fn(async () => ({ ok: true })),
  clearVisitPlacement: jest.fn(async () => ({ ok: true })),
  completeVisit: jest.fn(async () => ({ ok: true })),
  setVisitStatus: jest.fn(async () => ({ ok: true })),
  setVisitNotes: jest.fn(async () => ({ ok: true })),
  addPackingItem: jest.fn(async () => ({ ok: true })),
  removePackingItem: jest.fn(async () => ({ ok: true })),
  createTag: jest.fn(async () => ({ ok: true, id: "t-new" })),
  tagAgreement: jest.fn(async () => ({ ok: true })),
  untagAgreement: jest.fn(async () => ({ ok: true })),
  setVisitInvoiced: jest.fn(async () => ({ ok: true })),
  updateAgreementMeta: jest.fn(async () => ({ ok: true })),
  updateAgreementSchedule: jest.fn(async () => ({ ok: true })),
  setAgreementStatus: jest.fn(async () => ({ ok: true })),
  setAgreementCategory: jest.fn(async () => ({ ok: true })),
  createCategory: jest.fn(async () => ({ ok: true, id: "cat-new" })),
  addAgreementEquipment: jest.fn(async () => ({ ok: true })),
  removeAgreementEquipment: jest.fn(async () => ({ ok: true })),
  createAgreement: jest.fn(async () => ({ ok: true, id: "a-new" })),
};
jest.mock("@/app/actions/workboard-maintenance", () => ({
  setVisitReadiness: (...a: unknown[]) => act.setVisitReadiness(...(a as [])),
  setVisitPacked: (...a: unknown[]) => act.setVisitPacked(...(a as [])),
  assignVisitTech: (...a: unknown[]) => act.assignVisitTech(...(a as [])),
  unassignVisitTech: (...a: unknown[]) => act.unassignVisitTech(...(a as [])),
  placeVisit: (...a: unknown[]) => act.placeVisit(...(a as [])),
  clearVisitPlacement: (...a: unknown[]) => act.clearVisitPlacement(...(a as [])),
  completeVisit: (...a: unknown[]) => act.completeVisit(...(a as [])),
  setVisitStatus: (...a: unknown[]) => act.setVisitStatus(...(a as [])),
  setVisitNotes: (...a: unknown[]) => act.setVisitNotes(...(a as [])),
  addPackingItem: (...a: unknown[]) => act.addPackingItem(...(a as [])),
  removePackingItem: (...a: unknown[]) => act.removePackingItem(...(a as [])),
  createTag: (...a: unknown[]) => act.createTag(...(a as [])),
  tagAgreement: (...a: unknown[]) => act.tagAgreement(...(a as [])),
  untagAgreement: (...a: unknown[]) => act.untagAgreement(...(a as [])),
  setVisitInvoiced: (...a: unknown[]) => act.setVisitInvoiced(...(a as [])),
  updateAgreementMeta: (...a: unknown[]) => act.updateAgreementMeta(...(a as [])),
  updateAgreementSchedule: (...a: unknown[]) => act.updateAgreementSchedule(...(a as [])),
  setAgreementStatus: (...a: unknown[]) => act.setAgreementStatus(...(a as [])),
  setAgreementCategory: (...a: unknown[]) => act.setAgreementCategory(...(a as [])),
  createCategory: (...a: unknown[]) => act.createCategory(...(a as [])),
  addAgreementEquipment: (...a: unknown[]) => act.addAgreementEquipment(...(a as [])),
  removeAgreementEquipment: (...a: unknown[]) => act.removeAgreementEquipment(...(a as [])),
  createAgreement: (...a: unknown[]) => act.createAgreement(...(a as [])),
}));

const searchJobs = jest.fn(async () => [] as unknown[]);
jest.mock("@/app/actions/workboard", () => ({
  searchJobs: (...a: unknown[]) => searchJobs(...(a as [])),
}));
const analyseSm8JobForAgreement = jest.fn(async () => ({ ok: false, reason: "no-key" }));
jest.mock("@/app/actions/workboard-ai", () => ({
  analyseSm8JobForAgreement: (...a: unknown[]) => analyseSm8JobForAgreement(...(a as [])),
}));

const clearFlag = jest.fn(async () => ({ ok: true }));
const restoreFlag = jest.fn(async () => ({ ok: true }));
jest.mock("@/app/actions/workboard-notes", () => ({
  clearFlag: (...a: unknown[]) => clearFlag(...(a as [])),
  restoreFlag: (...a: unknown[]) => restoreFlag(...(a as [])),
}));
const completeTask = jest.fn(async () => ({ ok: true }));
const reopenTask = jest.fn(async () => ({ ok: true }));
jest.mock("@/app/actions/dashboard", () => ({
  completeTask: (...a: unknown[]) => completeTask(...(a as [])),
  reopenTask: (...a: unknown[]) => reopenTask(...(a as [])),
}));

const TODAY = "2026-07-30"; // Thursday

function visit(over: Partial<BoardVisit> & { id: string }): BoardVisit {
  return {
    agreementId: "a-1",
    label: "Rooftop package units",
    clientName: "Halston Freight",
    siteLabel: "DC 2",
    intervalMonths: 3,
    techsNeeded: 1,
    hoursEstimate: 3,
    accessNotes: null,
    category: null,
    tags: [],
    packing: [],
    dueDate: "2026-08-04",
    bookedDate: null,
    status: "upcoming",
    readiness: { equipment_ready: false, access_confirmed: false },
    techs: [],
    packedIds: [],
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
  };
}

function agreementFix(
  over: Partial<MaintenanceBoardData["agreements"][number]> = {}
): MaintenanceBoardData["agreements"][number] {
  return {
    id: "a-1",
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
    nextDue: "2026-08-04",
    thenDue: "2026-11-04",
    lastDone: "2026-05-04",
    overdueCount: 0,
    ...over,
  };
}

function data(over: Partial<MaintenanceBoardData> = {}): MaintenanceBoardData {
  return {
    visits: [],
    agreements: [],
    staff: [
      { id: "s-1", name: "Dane Poulos" },
      { id: "s-2", name: "Luke Mercer" },
    ],
    tagPool: [],
    categories: [],
    tasks: [],
    ...over,
  };
}

function mount(
  d: MaintenanceBoardData,
  opts: { manage?: boolean; sm8?: { attention: boolean; syncedAt: string | null; running: boolean } | null } = {},
  flags: React.ComponentProps<typeof MaintenanceBoard>["flags"] = []
) {
  return render(
    <MaintenanceBoard
      data={d}
      flags={flags}
      today={TODAY}
      manage={opts.manage ?? true}
      connected={false}
      sm8={opts.sm8 ?? null}
    />
  );
}

const toTab = (name: RegExp | string) => userEvent.click(screen.getByRole("tab", { name }));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("the tab row", () => {
  it("runs in the order of the day (C5), labels only", () => {
    mount(data({ visits: [visit({ id: "v-over", dueDate: "2026-07-20" })] }));
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs[0]).toContain("Urgent");
    expect(tabs[1]).toContain("Upcoming");
    expect(tabs[2]).toContain("Calendar");
    expect(tabs[3]).toContain("Completed");
    expect(tabs[4]).toContain("Service agreements");
    /* The count lives on the page's side switcher, where it's visible from
       BOTH sides — a tab can't tell you about the half you're not on, and
       two places to read the same number is one place too many. */
    const urgentTab = screen.getByRole("tab", { name: /Urgent/ });
    expect(within(urgentTab).queryByText("1")).not.toBeInTheDocument();
  });
});

describe("Upcoming (C4/B5/B7/B8)", () => {
  const ready = { equipment_ready: true, access_confirmed: true } as const;

  it("groups by week with Overdue out front, trouble-first inside a group", async () => {
    mount(
      data({
        visits: [
          visit({ id: "v-ready", dueDate: "2026-07-31", readiness: { ...ready }, techs: [{ id: "s-1", name: "Dane Poulos" }] }),
          visit({ id: "v-gap", dueDate: "2026-08-01", clientName: "Meridian Data" }),
          visit({ id: "v-late", dueDate: "2026-07-21", clientName: "Grange Microbrewery" }),
          visit({ id: "v-far", dueDate: "2026-08-12", clientName: "Point Cook Medical" }),
        ],
      })
    );
    await toTab(/Upcoming/);

    const heads = screen.getAllByText(/^(Overdue|This week|Next week|Week of)/).map((h) => h.textContent);
    expect(heads[0]).toContain("Overdue");
    expect(heads[1]).toContain("This week");
    expect(heads[2]).toContain("Week of 10 Aug");

    // inside This week: the unconfirmed Friday row outranks the ready Thursday row
    const rows = screen.getAllByRole("button", { name: /^Open / }).map((r) => r.getAttribute("aria-label"));
    const gapIdx = rows.findIndex((r) => r?.includes("Meridian"));
    const readyIdx = rows.findIndex((r) => r?.includes("Halston"));
    expect(gapIdx).toBeGreaterThan(-1);
    expect(gapIdx).toBeLessThan(readyIdx);
  });

  it("never lists done work — Completed owns history (B7)", async () => {
    mount(
      data({
        visits: [
          visit({ id: "v-done", status: "done", completedAt: "2026-07-28", clientName: "Closed Pty" }),
          visit({ id: "v-open" }),
        ],
      })
    );
    await toTab(/Upcoming/);
    expect(screen.queryByText("Closed Pty")).not.toBeInTheDocument();
  });

  it("counts to-confirm inside 14 days only (B8) and says Ready on a clear row", async () => {
    mount(
      data({
        visits: [
          visit({ id: "v-near", dueDate: "2026-08-02" }), // 2 gates missing + crew = 3 gaps
          visit({ id: "v-sep", dueDate: "2026-09-20" }), // far out — not counted
          visit({
            id: "v-ok",
            dueDate: "2026-08-03",
            readiness: { ...ready },
            techs: [{ id: "s-1", name: "Dane Poulos" }],
          }),
        ],
      })
    );
    await toTab(/Upcoming/);
    expect(screen.getByText("3 to confirm across 1 service")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });
});

describe("the visit sheet — the editing heart", () => {
  const open = async (v: BoardVisit, extra: Partial<MaintenanceBoardData> = {}, opts: { manage?: boolean } = {}) => {
    mount(data({ visits: [v], ...extra }), opts);
    await toTab(/Upcoming/);
    await userEvent.click(screen.getByRole("button", { name: `Open ${v.clientName} — ${v.label}` }));
    return within(screen.getByRole("dialog"));
  };

  it("opens with the facts, and the Crew gate has NO tick — assignment only (A12)", async () => {
    const sheet = await open(visit({ id: "v-1" }));
    expect(sheet.getByRole("heading", { name: /Rooftop package units — Quarterly/ })).toBeInTheDocument();
    expect(sheet.getByLabelText(/Equipment ready — not confirmed/)).toBeInTheDocument();
    expect(sheet.getByLabelText(/Access confirmed — not confirmed/)).toBeInTheDocument();
    expect(sheet.queryByLabelText(/Crew assigned — /)).not.toBeInTheDocument();
    // placement is the time confirmation — no fourth tick anywhere (D1)
    expect(sheet.queryByText(/^Time$/)).not.toBeInTheDocument();
  });

  it("ticking a gate calls the whitelist action", async () => {
    const sheet = await open(visit({ id: "v-1" }));
    await userEvent.click(sheet.getByLabelText(/Equipment ready — not confirmed/));
    expect(act.setVisitReadiness).toHaveBeenCalledWith("v-1", "equipment_ready", true);
  });

  it("packs the van item by item and the chip finally renders (B14)", async () => {
    const sheet = await open(
      visit({
        id: "v-1",
        packing: [
          { id: "i-1", label: "R32 bottle" },
          { id: "i-2", label: "Ladder" },
        ],
        packedIds: ["i-1"],
      })
    );
    await userEvent.click(sheet.getByRole("button", { name: "Equipment ready" }));
    expect(sheet.getByText("1 of 2 packed")).toBeInTheDocument();
    await userEvent.click(sheet.getByLabelText("Mark Ladder packed"));
    expect(act.setVisitPacked).toHaveBeenCalledWith("v-1", "i-2", true);
  });

  it("assigns a technician from the crew gate", async () => {
    const sheet = await open(visit({ id: "v-1" }));
    await userEvent.click(sheet.getByRole("button", { name: "Crew assigned" }));
    await userEvent.selectOptions(sheet.getByLabelText("Assign a technician"), "s-2");
    expect(act.assignVisitTech).toHaveBeenCalledWith("v-1", "s-2");
  });

  it("places on a weekday directly, but a weekend asks which you meant (B9)", async () => {
    const sheet = await open(visit({ id: "v-1" }));
    const day = sheet.getByLabelText("Pick a day");

    await userEvent.type(day, "2026-08-05"); // a Wednesday
    await userEvent.click(sheet.getByRole("button", { name: "Place it" }));
    expect(act.placeVisit).toHaveBeenCalledWith("v-1", "2026-08-05");

    await userEvent.clear(day);
    await userEvent.type(day, "2026-08-01"); // a Saturday
    expect(sheet.getByRole("button", { name: /Roll to Mon 3 Aug/ })).toBeInTheDocument();
    await userEvent.click(sheet.getByRole("button", { name: /Keep the Saturday/ }));
    expect(act.placeVisit).toHaveBeenLastCalledWith("v-1", "2026-08-01");
  });

  it("says the K4 pair out loud when the booked day is after the due date", async () => {
    const sheet = await open(visit({ id: "v-1", dueDate: "2026-08-08", bookedDate: "2026-08-10", status: "booked" }));
    expect(sheet.getByText("2 days after it was due")).toBeInTheDocument();
  });

  it("closes the loop: the close-out captures date, ACTUAL hours and the note (K1)", async () => {
    const sheet = await open(visit({ id: "v-1", hoursEstimate: 2 }));
    await userEvent.click(sheet.getByRole("button", { name: /Mark visit complete/ }));
    // hours prefill from the estimate; the tech corrects to what it took
    const hours = sheet.getByLabelText("Hours on site");
    await userEvent.clear(hours);
    await userEvent.type(hours, "3");
    await userEvent.type(
      sheet.getByPlaceholderText(/What happened on site/),
      "Belts swapped."
    );
    await userEvent.click(sheet.getByRole("button", { name: "Mark it complete" }));
    expect(act.completeVisit).toHaveBeenCalledWith("v-1", {
      ranOn: TODAY,
      actualHours: 3,
      note: "Belts swapped.",
    });
  });

  /* THE DAY IT RAN IS THE DAY IT WAS BOOKED. It defaulted to today, which is
     only right if you close a job out the same afternoon — Isaac's point was
     that if you booked it in for Monday, Monday is the answer and the form
     shouldn't be asking. */
  it("close-out states the BOOKED day as the day it ran, not today", async () => {
    const sheet = await open(
      visit({ id: "v-1", status: "booked", bookedDate: "2026-07-29", dueDate: "2026-07-29" })
    );
    await userEvent.click(sheet.getByRole("button", { name: /Mark visit complete/ }));
    /* The close-out STATES the day rather than asking for it, and says where
       the day came from — which is the whole point: no picker to fill in, and
       no doubt about what it's about to record. */
    expect(sheet.getByRole("button", { name: /the day it was booked/ })).toBeInTheDocument();
    expect(sheet.queryByLabelText("Day it ran")).not.toBeInTheDocument();
    await userEvent.click(sheet.getByRole("button", { name: "Mark it complete" }));
    expect(act.completeVisit).toHaveBeenCalledWith(
      "v-1",
      expect.objectContaining({ ranOn: "2026-07-29" })
    );
  });

  it("won't record a visit as having run in the future — a day booked ahead clamps to today", async () => {
    const sheet = await open(
      visit({ id: "v-1", status: "booked", bookedDate: "2026-08-20", dueDate: "2026-08-20" })
    );
    await userEvent.click(sheet.getByRole("button", { name: /Mark visit complete/ }));
    await userEvent.click(sheet.getByRole("button", { name: "Mark it complete" }));
    expect(act.completeVisit).toHaveBeenCalledWith("v-1", expect.objectContaining({ ranOn: TODAY }));
  });

  it("lets you say it ran on a different day", async () => {
    const sheet = await open(
      visit({ id: "v-1", status: "booked", bookedDate: "2026-07-29", dueDate: "2026-07-29" })
    );
    await userEvent.click(sheet.getByRole("button", { name: /Mark visit complete/ }));
    await userEvent.click(sheet.getByRole("button", { name: /pick another/ }));
    const day = sheet.getByLabelText("Day it ran");
    await userEvent.clear(day);
    await userEvent.type(day, "2026-07-30");
    await userEvent.click(sheet.getByRole("button", { name: "Mark it complete" }));
    expect(act.completeVisit).toHaveBeenCalledWith("v-1", expect.objectContaining({ ranOn: "2026-07-30" }));
  });

  /* "Not yet" was a second button competing with the one that matters.
     Backing out of a card is an × on the card. */
  it("backs out of the close-out with the card's ×, not a rival button", async () => {
    const sheet = await open(visit({ id: "v-1" }));
    await userEvent.click(sheet.getByRole("button", { name: /Mark visit complete/ }));
    expect(sheet.queryByRole("button", { name: "Not yet" })).not.toBeInTheDocument();
    await userEvent.click(sheet.getByRole("button", { name: /Not yet — leave it open/ }));
    expect(sheet.getByRole("button", { name: /Mark visit complete/ })).toBeInTheDocument();
    expect(act.completeVisit).not.toHaveBeenCalled();
  });

  it("tags wear their stored colour and new ones route through create-then-attach (B2)", async () => {
    const sheet = await open(
      visit({ id: "v-1", tags: [{ id: "t-1", name: "Our install", color: "violet" }] }),
      { tagPool: [{ id: "t-1", name: "Our install", color: "violet" }, { id: "t-2", name: "HACCP", color: "amber" }] }
    );
    expect(sheet.getByText("Our install").className).toContain("t-violet");

    await userEvent.click(sheet.getByRole("button", { name: /Add tag/ }));
    await userEvent.click(sheet.getByRole("button", { name: "HACCP" }));
    expect(act.tagAgreement).toHaveBeenCalledWith("a-1", "t-2");

    await userEvent.click(sheet.getByRole("button", { name: /Add tag/ }));
    await userEvent.type(sheet.getByPlaceholderText("Type or pick a tag"), "Strata{Enter}");
    expect(act.createTag).toHaveBeenCalledWith("Strata");
  });

  it("without manage: ticking and packing stay, structure is read-only", async () => {
    const sheet = await open(
      visit({ id: "v-1", packing: [{ id: "i-1", label: "Ladder" }] }),
      {},
      { manage: false }
    );
    expect(sheet.getByLabelText(/Equipment ready — not confirmed/)).toBeEnabled();
    expect(sheet.queryByRole("button", { name: /Mark visit complete/ })).not.toBeInTheDocument();
    expect(sheet.queryByLabelText("Pick a day")).not.toBeInTheDocument();
    expect(sheet.queryByRole("button", { name: /Add tag/ })).not.toBeInTheDocument();
  });
});

describe("Urgent — derived rows, resolvable in place", () => {
  it("an overdue visit surfaces (K2's cure at the surface) and opens its sheet", async () => {
    mount(data({ visits: [visit({ id: "v-late", dueDate: "2026-07-21" })] }));
    expect(screen.getByText("9 days over")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Open Halston Freight/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  /* The subtitle spends its space on the DATE, not on a sentence telling you
     to press the button sitting next to it. */
  it("says when the visit was due, not what to do about it", async () => {
    mount(data({ visits: [visit({ id: "v-late", dueDate: "2026-07-21" })] }));
    expect(screen.getByText(/was due Tue 21 July/)).toBeInTheDocument();
    expect(screen.queryByText(/book it in to get it moving/)).not.toBeInTheDocument();
  });

  it("a placed visit says the day it is booked for instead", async () => {
    mount(
      data({
        visits: [
          visit({ id: "v-late", dueDate: "2026-07-21", bookedDate: "2026-08-04", status: "booked" }),
        ],
      })
    );
    expect(screen.getByText(/booked Tue 4 Aug/)).toBeInTheDocument();
  });

  it("flags clear and tasks complete right on the row", async () => {
    render(
      <MaintenanceBoard
        data={data({ tasks: [{ id: "t-1", title: "Order filters", dueDate: "2026-07-29", assigneeName: "Dane Poulos" }] })}
        flags={[
          {
            id: "f-1",
            message: "No roof access booked",
            severity: "urgent",
            targetKind: "none",
            targetId: null,
            createdAt: "2026-07-30T00:00:00.000Z",
          },
        ]}
        today={TODAY}
        manage
        connected={false}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(clearFlag).toHaveBeenCalledWith("f-1");
    await userEvent.click(screen.getByRole("button", { name: "Mark done — Order filters" }));
    expect(completeTask).toHaveBeenCalledWith("t-1");
  });

  it("splits the queue into Overdue and Deal with it today, with tasks in their own lane", () => {
    render(
      <MaintenanceBoard
        data={data({
          visits: [visit({ id: "v-late", dueDate: "2026-07-21" })],
          tasks: [
            { id: "t-1", title: "Order filters", dueDate: "2026-07-29", assigneeName: "Dane Poulos" },
          ],
        })}
        flags={[]}
        today={TODAY}
        manage
        connected={false}
      />
    );
    expect(document.querySelector(".wb2-urgrp > .wb2-sect")?.textContent).toBe("Overdue");
    expect(screen.getByText("Your tasks")).toBeInTheDocument();
    // both sides populated → the two-column grid
    expect(document.querySelector(".wb2-urbody.twocol")).not.toBeNull();
    // the task sits in the lane, not in the work queue
    expect(document.querySelector(".wb2-urside .wb2-tk")).not.toBeNull();
  });

  it("collapses to one column when only the work side has anything", () => {
    mount(data({ visits: [visit({ id: "v-late", dueDate: "2026-07-21" })] }));
    expect(document.querySelector(".wb2-urgrp > .wb2-sect")?.textContent).toBe("Overdue");
    expect(screen.queryByText("Your tasks")).not.toBeInTheDocument();
    expect(document.querySelector(".wb2-urbody.twocol")).toBeNull();
  });

  it("says the good outcome when nothing fires", () => {
    mount(data());
    expect(screen.getByText("Nothing needs attention right now")).toBeInTheDocument();
  });
});

describe("Completed — actuals, never estimates (L3/B12)", () => {
  it("shows actual hours with the booked variance, and earns its timing chip", async () => {
    mount(
      data({
        visits: [
          visit({
            id: "v-d1",
            status: "done",
            dueDate: "2026-07-20",
            completedAt: "2026-07-22",
            actualHours: 3,
            hoursEstimate: 2,
            completionNote: "Belts swapped, filters done.",
          }),
        ],
      })
    );
    await toTab(/Completed/);
    expect(screen.getByText("3 h on site")).toBeInTheDocument();
    expect(screen.getByText("booked 2 h")).toBeInTheDocument();
    expect(screen.getByText("2 days late")).toBeInTheDocument();
    expect(screen.getByText("Belts swapped, filters done.")).toBeInTheDocument();
  });

  it("an estimate never wears the on-site label when actuals are missing", async () => {
    mount(
      data({
        visits: [
          visit({ id: "v-d2", status: "done", dueDate: "2026-07-20", completedAt: "2026-07-20", actualHours: null }),
        ],
      })
    );
    await toTab(/Completed/);
    expect(screen.getByText("hours not recorded")).toBeInTheDocument();
    expect(screen.queryByText(/h on site/)).not.toBeInTheDocument();
    expect(screen.getByText("Done on time")).toBeInTheDocument();
  });

  /* A close-out note nobody can attribute is a note nobody can follow up —
     but we only NAME someone when there's exactly one person to name. */
  describe("the note signs itself", () => {
    const done = (over: Record<string, unknown>) =>
      data({
        visits: [
          visit({
            id: "v-n",
            status: "done",
            dueDate: "2026-07-20",
            completedAt: "2026-07-20",
            completionNote: "Bearing replaced.",
            ...over,
          }),
        ],
      });

    it("names the single technician who was there", async () => {
      mount(done({ techs: [{ id: "s-1", name: "Dane Poulos" }] }));
      await toTab(/Completed/);
      expect(screen.getByText("Dane Poulos, on the job sheet")).toBeInTheDocument();
    });

    it("names nobody when two were on it — we don't know which of them wrote it", async () => {
      mount(
        done({
          techs: [
            { id: "s-1", name: "Dane Poulos" },
            { id: "s-2", name: "Luke Mercer" },
          ],
        })
      );
      await toTab(/Completed/);
      expect(screen.getByText("the technician, on the job sheet")).toBeInTheDocument();
    });

    it("credits ServiceM8 when the mirror closed it", async () => {
      mount(done({ completedSource: "servicem8", techs: [{ id: "s-1", name: "Dane Poulos" }] }));
      await toTab(/Completed/);
      expect(screen.getByText("from the ServiceM8 job")).toBeInTheDocument();
    });
  });
});

describe("Agreements — named clients, honest dates (B22/B10)", () => {
  it("every row names its client, and an overdue next-due says so", async () => {
    mount(
      data({
        agreements: [
          agreementFix({
            tags: [{ id: "t-1", name: "Our install", color: "violet" }],
            nextDue: "2026-07-20",
            overdueCount: 1,
          }),
        ],
      })
    );
    await toTab(/Service agreements/);
    expect(screen.getByText("Halston Freight")).toBeInTheDocument();
    expect(screen.getByText(/Overdue since Mon 20 Jul/)).toBeInTheDocument();
    expect(screen.getByText("Our install").className).toContain("t-violet");
    expect(screen.getByText("Uncategorised")).toBeInTheDocument();
  });

  /* The ledger's three dates: what a cadence actually looks like. */
  it("reads last done, next due and the one after it", async () => {
    mount(
      data({
        agreements: [
          agreementFix({ lastDone: "2026-05-04", nextDue: "2026-08-04", thenDue: "2026-11-04" }),
        ],
      })
    );
    await toTab(/Service agreements/);
    expect(screen.getByText("Mon 4 May")).toBeInTheDocument();
    expect(screen.getByText("3 months ago")).toBeInTheDocument();
    expect(screen.getByText("Tue 4 Aug")).toBeInTheDocument();
    expect(screen.getByText("Wed 4 Nov")).toBeInTheDocument();
  });

  it("says so plainly when an agreement has never been serviced", async () => {
    mount(data({ agreements: [agreementFix({ lastDone: null })] }));
    await toTab(/Service agreements/);
    expect(screen.getByText("Not yet serviced")).toBeInTheDocument();
  });

  it("summarises each group with its count, its soonest date and what's late", async () => {
    mount(
      data({
        agreements: [
          agreementFix({ id: "a-1", nextDue: "2026-07-20", overdueCount: 1 }),
          agreementFix({ id: "a-2", clientName: "Meridian", nextDue: "2026-09-01" }),
        ],
      })
    );
    await toTab(/Service agreements/);
    expect(
      screen.getByText("2 agreements · oldest overdue Mon 20 July · 1 overdue")
    ).toBeInTheDocument();
  });

  it("searches client, service, site and tag — and says when nothing matches", async () => {
    mount(
      data({
        agreements: [
          agreementFix({ id: "a-1", clientName: "Halston Freight" }),
          agreementFix({ id: "a-2", clientName: "Meridian Data", label: "Server room CRACs" }),
        ],
      })
    );
    await toTab(/Service agreements/);
    const box = screen.getByRole("searchbox", { name: "Search agreements" });

    await userEvent.type(box, "crac");
    expect(screen.getByText("Meridian Data")).toBeInTheDocument();
    expect(screen.queryByText("Halston Freight")).not.toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.type(box, "zzz");
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });
});

describe("Calendar — first cut", () => {
  it("shows four weeks from this Monday, the legend, and counts unplaced overdue work honestly", async () => {
    mount(
      data({
        visits: [
          visit({ id: "v-placed", bookedDate: "2026-08-05", status: "booked", dueDate: "2026-08-05" }),
          visit({ id: "v-loose", dueDate: "2026-07-21" }),
        ],
      })
    );
    await toTab(/Calendar/);
    // TODAY is Thu 30 Jul → the window opens on Mon 27 Jul and runs 28 days.
    // "July" not "Jul" is deliberate — en-AU writes June/July/Sept out (au-dates).
    expect(screen.getByText("27 July – 23 Aug")).toBeInTheDocument();
    expect(document.querySelectorAll(".wb2-mcc")).toHaveLength(28);
    expect(screen.getByText("Ready to run")).toBeInTheDocument();
    expect(screen.getByText(/1 overdue job isn't on a day yet/)).toBeInTheDocument();
  });

  it("summarises the window, and rolls a week at a time without losing today", async () => {
    mount(
      data({
        visits: [
          visit({ id: "v-placed", bookedDate: "2026-08-05", status: "booked", dueDate: "2026-08-05" }),
        ],
      })
    );
    await toTab(/Calendar/);
    expect(screen.getByText("1 service")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "A week later" }));
    expect(screen.getByText("3 Aug – 30 Aug")).toBeInTheDocument();
    // stepping away offers the way back
    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByText("27 July – 23 Aug")).toBeInTheDocument();
  });

  it("marks a past day whose work all closed with a tick instead of dots", async () => {
    mount(
      data({
        visits: [
          visit({
            id: "v-done",
            status: "done",
            bookedDate: "2026-07-28",
            dueDate: "2026-07-28",
            completedAt: "2026-07-28",
          }),
        ],
      })
    );
    await toTab(/Calendar/);
    expect(document.querySelector(".wb2-mcdone")).not.toBeNull();
    expect(document.querySelector(".wb2-mcdots")).toBeNull();
  });

  /* A dot CARRIES the client and the service it stands for, hidden until
     display mode gives the cell room to show them. The markup is the same
     either way on purpose — a second calendar built for the big screen would
     be free to disagree with this one. */
  it("gives every dot the name and service it stands for", async () => {
    mount(
      data({
        visits: [
          visit({
            id: "v-placed",
            clientName: "Northgate Retail Group",
            label: "Split fleet, 4 stores",
            status: "booked",
            bookedDate: "2026-08-10",
            dueDate: "2026-08-10",
          }),
        ],
      })
    );
    await toTab(/Calendar/);
    const dot = document.querySelector(".wb2-mcdots i");
    expect(dot).not.toBeNull();
    expect(dot?.querySelector("b")?.textContent).toBe("Northgate Retail Group");
    expect(dot?.querySelector("em")?.textContent).toBe("Split fleet, 4 stores");
    // still one dot per visit, still capped at four — the cell didn't grow a
    // second way of counting
    expect(document.querySelectorAll(".wb2-mcdots i")).toHaveLength(1);
  });
});

describe("Urgent quick actions — each row fixes ITS fact (A1/A4)", () => {
  it("confirming the lead gate raises a toast whose Undo unticks exactly that gate (B23)", async () => {
    mount(
      data({
        visits: [
          visit({
            id: "v-1",
            dueDate: "2026-08-02",
            readiness: { equipment_ready: false, access_confirmed: true },
            techs: [{ id: "s-1", name: "Dane Poulos" }],
          }),
        ],
      })
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm equipment" }));
    expect(act.setVisitReadiness).toHaveBeenCalledWith("v-1", "equipment_ready", true);

    const toast = screen.getByText("Equipment confirmed — Halston Freight").closest(".wb2-toast")!;
    await userEvent.click(within(toast as HTMLElement).getByRole("button", { name: "Undo" }));
    expect(act.setVisitReadiness).toHaveBeenLastCalledWith("v-1", "equipment_ready", false);
  });

  it("a crew gap assigns straight off the row, with its own undo", async () => {
    mount(
      data({
        visits: [
          visit({
            id: "v-1",
            dueDate: "2026-08-02",
            readiness: { equipment_ready: true, access_confirmed: true },
          }),
        ],
      })
    );
    await userEvent.selectOptions(
      screen.getByLabelText("Assign a technician — Halston Freight"),
      "s-2"
    );
    expect(act.assignVisitTech).toHaveBeenCalledWith("v-1", "s-2");
    const toast = screen.getByText("Luke Mercer assigned — Halston Freight").closest(".wb2-toast")!;
    await userEvent.click(within(toast as HTMLElement).getByRole("button", { name: "Undo" }));
    expect(act.unassignVisitTech).toHaveBeenCalledWith("v-1", "s-2");
  });

  it("an overdue PLACED visit offers Close it out and lands on the open form", async () => {
    mount(
      data({
        visits: [visit({ id: "v-1", dueDate: "2026-07-25", bookedDate: "2026-07-28", status: "booked" })],
      })
    );
    await userEvent.click(screen.getByRole("button", { name: "Close it out" }));
    const sheet = within(screen.getByRole("dialog"));
    expect(sheet.getByRole("button", { name: "Mark it complete" })).toBeInTheDocument();
  });

  /* "It says it was raised from a note, but you should be able to click in.
     It should bring you into that job card where the note was placed."
     (Isaac.) The flag's target rode on the input and stopped at the rule
     builder, so every flag row was a dead end. */
  it("a flag raised against a visit clicks THROUGH to that visit", async () => {
    mount(
      data({ visits: [visit({ id: "v-1" })] }),
      {},
      [
        {
          id: "f-1",
          message: "Gate code changed — nobody told the crew",
          severity: "warn",
          createdAt: "2026-08-01T02:00:00Z",
          targetKind: "visit",
          targetId: "v-1",
        },
      ]
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Open Gate code changed — nobody told the crew/ })
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText(/Rooftop package units/)).toBeInTheDocument();
  });

  it("a flag against nothing stays a plain row — it can't pretend to lead somewhere", async () => {
    mount(
      data({ visits: [] }),
      {},
      [
        {
          id: "f-2",
          message: "Order more coil cleaner",
          severity: "warn",
          createdAt: "2026-08-01T02:00:00Z",
          targetKind: "none",
          targetId: null,
        },
      ]
    );
    expect(screen.queryByRole("button", { name: /Open Order more coil cleaner/ })).not.toBeInTheDocument();
    expect(screen.getByText(/stays up until somebody clears it/)).toBeInTheDocument();
  });

  it("flag Clear and task Done carry their own inverses — two toasts, two undos, no crosstalk (B23)", async () => {
    render(
      <MaintenanceBoard
        data={data({ tasks: [{ id: "t-1", title: "Order filters", dueDate: "2026-07-29", assigneeName: null }] })}
        flags={[
          {
            id: "f-1",
            message: "No roof access booked",
            severity: "urgent",
            targetKind: "none",
            targetId: null,
            createdAt: "2026-07-30T00:00:00.000Z",
          },
        ]}
        today={TODAY}
        manage
        connected={false}
        sm8={null}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    await userEvent.click(screen.getByRole("button", { name: "Mark done — Order filters" }));

    // both toasts up at once — the single-slot stomp is dead
    const undos = screen.getAllByRole("button", { name: "Undo" });
    expect(undos).toHaveLength(2);

    await userEvent.click(
      within(screen.getByText("Flag cleared").closest(".wb2-toast") as HTMLElement).getByRole(
        "button",
        { name: "Undo" }
      )
    );
    expect(restoreFlag).toHaveBeenCalledWith("f-1");

    await userEvent.click(
      within(screen.getByText("Done — Order filters").closest(".wb2-toast") as HTMLElement).getByRole(
        "button",
        { name: "Undo" }
      )
    );
    expect(reopenTask).toHaveBeenCalledWith("t-1");
  });

  it("the vitals live on as filters (D8): pressing one narrows the queue to its kind", async () => {
    mount(
      data({
        visits: [
          visit({ id: "v-late", dueDate: "2026-07-21", clientName: "Grange Microbrewery" }),
          visit({ id: "v-gap", dueDate: "2026-08-02", clientName: "Meridian Data" }),
        ],
      })
    );
    expect(screen.getByText("Grange Microbrewery — Rooftop package units")).toBeInTheDocument();
    expect(screen.getByText("Meridian Data — Rooftop package units")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Overdue 1/ }));
    expect(screen.getByText("Grange Microbrewery — Rooftop package units")).toBeInTheDocument();
    expect(screen.queryByText("Meridian Data — Rooftop package units")).not.toBeInTheDocument();

    // pressing it again is the way back to everything
    await userEvent.click(screen.getByRole("button", { name: /Overdue 1/ }));
    expect(screen.getByText("Meridian Data — Rooftop package units")).toBeInTheDocument();
  });
});

describe("the day modal — the list behind a day's colour, live (A3/A5/K8)", () => {
  const openDay = async (visits: BoardVisit[], dayISO: string) => {
    mount(data({ visits }));
    await toTab(/Calendar/);
    // the target day may sit outside July's grid — page forward if needed
    if (!screen.queryByLabelText(`Open ${dayISO}`)) {
      await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    }
    await userEvent.click(screen.getByLabelText(`Open ${dayISO}`));
    return within(screen.getByRole("dialog"));
  };

  it("shows the day's services and ticks gates live, with undo (A3)", async () => {
    const modal = await openDay(
      [visit({ id: "v-1", bookedDate: "2026-08-05", status: "booked", dueDate: "2026-08-05" })],
      "2026-08-05"
    );
    expect(modal.getByText("Halston Freight")).toBeInTheDocument();
    expect(modal.getByText("3 to confirm")).toBeInTheDocument();

    await userEvent.click(modal.getByTitle(/Equipment ready — not confirmed/));
    expect(act.setVisitReadiness).toHaveBeenCalledWith("v-1", "equipment_ready", true);
    expect(screen.getByText("Equipment confirmed — Halston Freight")).toBeInTheDocument();
  });

  it("places an unplaced visit onto the day — undo takes it back OFF the day", async () => {
    const modal = await openDay([visit({ id: "v-loose", dueDate: "2026-07-21" })], "2026-08-05");
    await userEvent.click(modal.getByRole("button", { name: "Place a service on this day" }));
    await userEvent.click(modal.getByRole("button", { name: "Place here" }));
    expect(act.placeVisit).toHaveBeenCalledWith("v-loose", "2026-08-05");

    const toast = screen.getByText(/placed on Wed 5 Aug/).closest(".wb2-toast")!;
    await userEvent.click(within(toast as HTMLElement).getByRole("button", { name: "Undo" }));
    expect(act.clearVisitPlacement).toHaveBeenCalledWith("v-loose");
  });

  it("moving a booked visit here reschedules it (A5) — undo restores the day it came from", async () => {
    const modal = await openDay(
      [visit({ id: "v-booked", dueDate: "2026-08-04", bookedDate: "2026-08-04", status: "booked" })],
      "2026-08-06"
    );
    await userEvent.click(modal.getByRole("button", { name: "Place a service on this day" }));
    expect(modal.getByText(/moving one reschedules it/)).toBeInTheDocument();
    await userEvent.click(modal.getByRole("button", { name: "Move it here" }));
    expect(act.placeVisit).toHaveBeenCalledWith("v-booked", "2026-08-06");

    const toast = screen.getByText(/moved to Thu 6 Aug/).closest(".wb2-toast")!;
    await userEvent.click(within(toast as HTMLElement).getByRole("button", { name: "Undo" }));
    expect(act.placeVisit).toHaveBeenLastCalledWith("v-booked", "2026-08-04");
  });

  /* Every agreement carries 13 months of generated visits, so an unscoped
     candidate list offered next year's work for placing on next Tuesday. */
  it("only offers visits due within four weeks of the day, and says what it held back", async () => {
    const modal = await openDay(
      [
        visit({ id: "v-near", dueDate: "2026-08-10" }),
        visit({ id: "v-far", dueDate: "2027-01-20", clientName: "Next Year Pty" }),
      ],
      "2026-08-05"
    );
    await userEvent.click(modal.getByRole("button", { name: "Place a service on this day" }));
    expect(modal.getByText("Not placed yet")).toBeInTheDocument();
    expect(modal.queryByText("Next Year Pty")).not.toBeInTheDocument();
    expect(modal.getByText(/1 more visit isn't due within four weeks/)).toBeInTheDocument();
  });

  it("an empty day owns up and offers the candidates straight away", async () => {
    const modal = await openDay([visit({ id: "v-loose", dueDate: "2026-08-20" })], "2026-08-05");
    expect(modal.getByText("Nothing placed on this day")).toBeInTheDocument();
    expect(modal.getByText("Not placed yet")).toBeInTheDocument();
    expect(modal.getByRole("button", { name: "Place here" })).toBeInTheDocument();
  });
});

describe("the mirror-health chip (D8)", () => {
  it("absent standalone, quiet when fresh, loud on attention", () => {
    const { rerender } = mount(data(), { sm8: null });
    expect(screen.queryByText(/ServiceM8/)).not.toBeInTheDocument();

    rerender(
      <MaintenanceBoard
        data={data()}
        flags={[]}
        today={TODAY}
        manage
        connected
        sm8={{ attention: false, syncedAt: new Date(Date.now() - 3 * 60_000).toISOString(), running: false }}
      />
    );
    expect(screen.getByText("ServiceM8 synced 3 min ago")).toBeInTheDocument();

    rerender(
      <MaintenanceBoard
        data={data()}
        flags={[]}
        today={TODAY}
        manage
        connected={false}
        sm8={{ attention: true, syncedAt: null, running: false }}
      />
    );
    expect(screen.getByText("ServiceM8 needs attention")).toBeInTheDocument();
  });
});

describe("Completed folds — the money waiting leads (step 4)", () => {
  const doneVisit = (id: string, over: Partial<BoardVisit> = {}) =>
    visit({
      id,
      status: "done",
      dueDate: "2026-07-20",
      completedAt: "2026-07-20",
      actualHours: 2,
      ...over,
    });

  it("folds To invoice above Invoiced, and marking carries its own undo (G9)", async () => {
    mount(
      data({
        visits: [
          doneVisit("v-open-bill"),
          doneVisit("v-billed", { invoicedAt: "2026-07-25T00:00:00Z", clientName: "Billed Pty" }),
        ],
      })
    );
    await toTab(/Completed/);
    const heads = screen.getAllByText(/^(To invoice|Invoiced)/).map((h) => h.textContent);
    expect(heads[0]).toContain("To invoice");
    expect(screen.getByText("1 to invoice")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Mark invoiced" }));
    expect(act.setVisitInvoiced).toHaveBeenCalledWith("v-open-bill", true);
    const toast = screen.getByText("Invoiced — Halston Freight").closest(".wb2-toast")!;
    await userEvent.click(within(toast as HTMLElement).getByRole("button", { name: "Undo" }));
    expect(act.setVisitInvoiced).toHaveBeenLastCalledWith("v-open-bill", false);
  });

  it("un-invoicing exists for the fat-finger, without a toast maze", async () => {
    mount(data({ visits: [doneVisit("v-billed", { invoicedAt: "2026-07-25T00:00:00Z" })] }));
    await toTab(/Completed/);
    await userEvent.click(screen.getByRole("button", { name: "Un-invoice" }));
    expect(act.setVisitInvoiced).toHaveBeenCalledWith("v-billed", false);
  });
});

describe("the agreement sheet (A6/D4)", () => {
  const openAgreement = async (agr = agreementFix(), extra: Partial<MaintenanceBoardData> = {}) => {
    mount(data({ agreements: [agr], ...extra }));
    await toTab(/Service agreements/);
    await userEvent.click(
      screen.getByRole("button", { name: `Open ${agr.clientName} — ${agr.label}` })
    );
    return within(screen.getByRole("dialog"));
  };

  it("rows open the sheet; edited meta saves as one patch", async () => {
    const sheet = await openAgreement();
    const billing = sheet.getByLabelText("Billing contact");
    await userEvent.type(billing, "accounts@halston.com");
    await userEvent.click(sheet.getByRole("button", { name: "Save" }));
    expect(act.updateAgreementMeta).toHaveBeenCalledWith(
      "a-1",
      expect.objectContaining({ billingContact: "accounts@halston.com" })
    );
  });

  it("the cadence saves through its own action and says the redraw rule", async () => {
    const sheet = await openAgreement();
    await userEvent.selectOptions(sheet.getByLabelText("How often"), "6");
    expect(sheet.getByText(/redraws only the visits nobody has touched/)).toBeInTheDocument();
    await userEvent.click(sheet.getByRole("button", { name: "Save the cadence" }));
    expect(act.updateAgreementSchedule).toHaveBeenCalledWith(
      "a-1",
      expect.objectContaining({ intervalMonths: 6, anchorDate: "2026-08-04" })
    );
  });

  it("pause resumes and ending demands a second press", async () => {
    const sheet = await openAgreement();
    await userEvent.click(sheet.getByRole("button", { name: "Pause" }));
    expect(act.setAgreementStatus).toHaveBeenCalledWith("a-1", "paused");

    await userEvent.click(sheet.getByRole("button", { name: /End the agreement/ }));
    expect(act.setAgreementStatus).not.toHaveBeenCalledWith("a-1", "ended");
    await userEvent.click(sheet.getByRole("button", { name: /End it — I'm sure/ }));
    expect(act.setAgreementStatus).toHaveBeenCalledWith("a-1", "ended");
  });

  it("equipment register adds structured units, never strings (D5)", async () => {
    const sheet = await openAgreement(
      agreementFix({
        equipment: [{ id: "e-1", description: "Rooftop package #1", model: "PKV-500", serial: "S123", location: "Roof" }],
      })
    );
    expect(sheet.getByText(/Model PKV-500 · Serial S123 · Roof/)).toBeInTheDocument();

    await userEvent.type(sheet.getByPlaceholderText(/Unit \(e\.g\./), "Rooftop package #2");
    await userEvent.type(sheet.getByPlaceholderText("Serial"), "S124");
    await userEvent.click(sheet.getByRole("button", { name: "Add unit" }));
    expect(act.addAgreementEquipment).toHaveBeenCalledWith(
      "a-1",
      expect.objectContaining({ description: "Rooftop package #2", serial: "S124" })
    );
  });

  it("a paused agreement wears its chip on the ledger and offers Resume", async () => {
    const sheet = await openAgreement(agreementFix({ status: "paused", nextDue: null }));
    expect(sheet.getByText("Paused")).toBeInTheDocument();
    await userEvent.click(sheet.getByRole("button", { name: "Resume the agreement" }));
    expect(act.setAgreementStatus).toHaveBeenCalledWith("a-1", "active");
  });
});

describe("the create flow (D7/K3/K4)", () => {
  const openModal = async (extra: Partial<MaintenanceBoardData> = {}) => {
    mount(data(extra));
    await toTab(/Service agreements/);
    await userEvent.click(screen.getByRole("button", { name: /New agreement/ }));
    return within(screen.getByRole("dialog"));
  };

  it("creates from the manual form; the packing suggestions never block it", async () => {
    const modal = await openModal();
    await userEvent.type(modal.getByLabelText("Service label"), "Cool room");
    await userEvent.type(modal.getByLabelText("Client"), "Grange Microbrewery");
    await userEvent.type(modal.getByLabelText("First service due"), "2026-08-12");
    await userEvent.click(modal.getByRole("button", { name: /Create the agreement/ }));
    expect(act.createAgreement).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Cool room",
        clientName: "Grange Microbrewery",
        anchorDate: "2026-08-12",
        intervalMonths: 3,
      })
    );
  });

  it("a weekend first-due says so and offers the Monday, keeping stays allowed (K4/B9)", async () => {
    const modal = await openModal();
    await userEvent.type(modal.getByLabelText("First service due"), "2026-08-01");
    expect(modal.getByText(/is a Saturday — every visit will fall due on a weekend/)).toBeInTheDocument();
    await userEvent.click(modal.getByRole("button", { name: /Anchor on Mon 3 Aug instead/ }));
    expect((modal.getByLabelText("First service due") as HTMLInputElement).value).toBe("2026-08-03");
  });

  it("the duplicate guard fires on the client's name and needs a deliberate override", async () => {
    const modal = await openModal({ agreements: [agreementFix()] });
    await userEvent.type(modal.getByLabelText("Service label"), "Second system");
    await userEvent.type(modal.getByLabelText("Client"), "halston freight");
    await userEvent.type(modal.getByLabelText("First service due"), "2026-08-12");

    expect(modal.getByText(/already has an agreement here/)).toBeInTheDocument();
    expect(modal.getByRole("button", { name: /Create the agreement/ })).toBeDisabled();

    await userEvent.click(modal.getByLabelText(/genuinely a separate agreement/));
    await userEvent.click(modal.getByRole("button", { name: /Create the agreement/ }));
    expect(act.createAgreement).toHaveBeenCalled();
  });

  it("standalone hides the ServiceM8 leg entirely — the board never looks broken without it", async () => {
    const modal = await openModal();
    expect(modal.queryByRole("tab", { name: /From a ServiceM8 job/ })).not.toBeInTheDocument();
  });
});

/* "Book the category on one day" was removed — Isaac's read is that booking a
   whole category onto one day isn't how the work goes, which beats the audit's
   inference from an orphaned prototype handler. Its suite went with it. */

/* The separate wall composition (A10) was deleted 2026-08-02 — display mode
   mirrors the page instead of replacing it, so there is no second board to
   test. What the mode itself does lives in overview-screen's suite, because
   it is a fact about the PAGE (the frame it hides), not about this card. */
