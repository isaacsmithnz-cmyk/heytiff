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
    tasks: [],
    ...over,
  };
}

function mount(
  d: MaintenanceBoardData,
  opts: { manage?: boolean; sm8?: { attention: boolean; syncedAt: string | null; running: boolean } | null } = {}
) {
  return render(
    <MaintenanceBoard
      data={d}
      flags={[]}
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
  it("runs in the order of the day (C5) with severity-coloured badges (E6)", () => {
    mount(data({ visits: [visit({ id: "v-over", dueDate: "2026-07-20" })] }));
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs[0]).toContain("Urgent");
    expect(tabs[1]).toContain("Upcoming");
    expect(tabs[2]).toContain("Calendar");
    expect(tabs[3]).toContain("Completed");
    expect(tabs[4]).toContain("Service agreements");
    // one overdue visit → a danger-toned count on Urgent
    const urgentTab = screen.getByRole("tab", { name: /Urgent/ });
    expect(within(urgentTab).getByText("1").className).toContain("dan");
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
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(completeTask).toHaveBeenCalledWith("t-1");
  });

  it("says the good outcome when nothing fires", () => {
    mount(data());
    expect(screen.getByText("Nothing needs you right now")).toBeInTheDocument();
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
});

describe("Agreements — named clients, honest dates (B22/B10)", () => {
  it("every row names its client, and an overdue next-due says so", async () => {
    mount(
      data({
        agreements: [
          {
            id: "a-1",
            label: "Rooftop package units",
            clientName: "Halston Freight",
            siteLabel: "DC 2",
            intervalMonths: 3,
            category: null,
            tags: [{ id: "t-1", name: "Our install", color: "violet" }],
            nextDue: "2026-07-20",
            overdueCount: 1,
          },
        ],
      })
    );
    await toTab(/Service agreements/);
    expect(screen.getByText("Halston Freight")).toBeInTheDocument();
    expect(screen.getByText(/Overdue since Mon 20 Jul/)).toBeInTheDocument();
    expect(screen.getByText("Our install").className).toContain("t-violet");
    expect(screen.getByText("Uncategorised")).toBeInTheDocument();
  });
});

describe("Calendar — first cut", () => {
  it("shows the month, the legend, and counts unplaced overdue work honestly", async () => {
    mount(
      data({
        visits: [
          visit({ id: "v-placed", bookedDate: "2026-08-05", status: "booked", dueDate: "2026-08-05" }),
          visit({ id: "v-loose", dueDate: "2026-07-21" }),
        ],
      })
    );
    await toTab(/Calendar/);
    expect(screen.getByText("July 2026")).toBeInTheDocument();
    expect(screen.getByText("Ready to run")).toBeInTheDocument();
    expect(screen.getByText(/1 overdue service isn't on a day yet/)).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

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

    await userEvent.click(screen.getByRole("button", { name: /1 overdue/ }));
    expect(screen.getByText("Grange Microbrewery — Rooftop package units")).toBeInTheDocument();
    expect(screen.queryByText("Meridian Data — Rooftop package units")).not.toBeInTheDocument();

    // pressing it again is the way back to everything
    await userEvent.click(screen.getByRole("button", { name: /1 overdue/ }));
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
