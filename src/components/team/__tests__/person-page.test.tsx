import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonPage, type PersonPageData } from "../person-page";
import { WindowsContext } from "@/components/records/records-context";
import type { AssignedVehicle, PermissionsCtx } from "@/components/profile/types";
import type { StaffLicence } from "@/lib/staff/types";
import { TODAY, header as baseHeader, jordan, okActions } from "@/components/profile/__tests__/fixtures/staff";

/* TEAM, A PERSON (v2): one page, an Edit per group, every section of
   today's staff card and its gates. What the old card and the directory's
   row menu did is checked here where it now lives: Deactivate asks then
   writes the status, Reactivate is one press, Delete only on a card the
   page named, Invite to join only on an unclaimed card. */

const push = jest.fn();
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const saveStaffSection = jest.fn(async (..._a: unknown[]) => ({ ok: true }) as { ok: boolean; error?: string });
jest.mock("@/app/actions/staff", () => ({ saveStaffSection: (...a: unknown[]) => saveStaffSection(...a) }));
const deleteStaffCard = jest.fn(async (_id: string) => ({ ok: true }) as { ok: boolean; error?: string });
jest.mock("@/app/actions/members", () => ({ deleteStaffCard: (id: string) => deleteStaffCard(id) }));
const saveMyHours = jest.fn(async (..._a: unknown[]) => ({ ok: true }) as { ok: boolean; error?: string });
jest.mock("@/app/actions/timepay", () => ({ saveMyHours: (...a: unknown[]) => saveMyHours(...a) }));
const setScheduleCapacity = jest.fn(async (_r: unknown) => ({ ok: true }) as { ok: boolean; error?: string });
jest.mock("@/app/actions/workboard", () => ({ setScheduleCapacity: (r: unknown) => setScheduleCapacity(r) }));
const setLeaveBalance = jest.fn(async (_i: unknown) => ({ ok: true }) as { ok: boolean; error?: string });
jest.mock("@/app/actions/leave", () => ({ setLeaveBalance: (i: unknown) => setLeaveBalance(i) }));
jest.mock("@/app/actions/invite", () => ({ createInvite: async () => ({ ok: true }), lookupInvitee: async () => ({ kind: "new" }) }));
jest.mock("@/app/actions/staff-licence-ai", () => ({ readStaffLicence: jest.fn() }));
jest.mock("@/app/actions/work-rights-ai", () => ({ readWorkRightsDocument: jest.fn() }));
jest.mock("@/lib/documents/upload-client", () => ({ uploadFile: jest.fn() }));
jest.mock("@/components/making/regular-days-off-form", () => ({
  RegularDaysOffForm: (p: { name: string }) => <div role="dialog" aria-label={`Regular days off for ${p.name}`} />,
}));
jest.mock("@/components/profile/signature-card", () => ({ SignatureCard: () => <section aria-label="Signature" /> }));

const toast = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  saveStaffSection.mockResolvedValue({ ok: true });
  deleteStaffCard.mockResolvedValue({ ok: true });
  saveMyHours.mockResolvedValue({ ok: true });
  setScheduleCapacity.mockResolvedValue({ ok: true });
  setLeaveBalance.mockResolvedValue({ ok: true });
});

const VEHICLE: AssignedVehicle = {
  vehicle: {
    id: "v1",
    name: "",
    make: "Toyota",
    model: "Hilux",
    year: 2022,
    plate: "XQG 41B",
    plateState: "NSW",
    status: "active",
    odometer: 84_210,
    regoDays: 120,
    insuranceDays: 200,
    ctpDays: 200,
    serviceIntervalKm: 10_000,
    lastServiceOdo: 80_000,
    serviceIntervalMonths: null,
    serviceDays: null,
    motorised: true,
  },
  openIssues: 0,
  lastFuel: null,
};

const LICENCES: StaffLicence[] = [
  { id: "l1", typeName: "ARC refrigerant handling licence", licenceNumber: "L148820", expiryDate: "2026-08-10", color: null },
  { id: "l2", typeName: "Electrical licence, restricted", licenceNumber: null, expiryDate: "2027-06-04", color: null },
  { id: "l3", typeName: "White card", licenceNumber: null, expiryDate: null, color: null },
];

const PERMS: PermissionsCtx = { role: "staff", caps: new Set(["workboard"]), settable: new Set(), canChangeRole: true, editable: true };

function dataFor(over: Partial<PersonPageData> = {}): PersonPageData {
  return {
    header: { ...baseHeader, userId: "auth0|1", importedFrom: null, isMaster: false, photoUrl: null },
    profile: jordan,
    licences: LICENCES,
    licenceTerms: {},
    licenceDocuments: {},
    workRightsChecks: [],
    workRightsDocuments: [],
    vehicle: VEHICLE,
    today: TODAY,
    warnDays: 30,
    org: "Coastal Air",
    orgState: "NSW",
    aliases: ["Jordy"],
    addressLookup: false,
    isSelf: false,
    payroll: null,
    rosteredWeek: null,
    permissions: PERMS,
    notes: { notes: "Asked for more commissioning work" },
    week: { start: "7:00 AM", end: "3:30 PM", days: [0, 1, 2, 3, 4], perDay: 8, breakMinutes: 30, breakPaid: false, weekHours: 40, ownHours: false, ownDays: false },
    crew: { staffUuid: "sm8-1", included: true, dailyMinutes: 480 },
    canManageCrew: true,
    linkedToSm8: true,
    showCrew: true,
    leave: {
      annual: { available: 112.4, balanceHours: 120.4, asAt: "2026-07-01", source: "manual" },
      personal: { available: 46, balanceHours: 46, asAt: "2026-07-01", source: "manual" },
      coming: [{ id: "r1", kind: "annual", startDate: "2026-10-28", endDate: "2026-10-28", hours: 8, status: "approved" }],
    },
    canSetBalances: true,
    regularDaysOff: [
      { id: "rd1", staffProfileId: "p1", reason: "TAFE", weekdays: [3], everyWeeks: 1, fromDate: "2026-02-01", toDate: null, partFrom: null, partTo: null, skipDates: [] },
    ],
    deletable: false,
    inviteRoles: [],
    ...over,
  };
}

function setup(over: Partial<PersonPageData> = {}) {
  const actions = { ...okActions(), onRecordWorkRightsCheck: jest.fn().mockResolvedValue({ ok: true }) };
  const user = userEvent.setup();
  render(
    <WindowsContext.Provider value={{ toast } as never}>
      <PersonPage data={dataFor(over)} actions={actions as never} />
    </WindowsContext.Provider>,
  );
  return { user, actions };
}

const group = (name: string) => screen.getAllByText(name, { selector: ".pdlh span, .pdlh span *" })[0].closest(".pdlcard") as HTMLElement;

describe("the head", () => {
  it("names them, says what they do and since when, and offers Actions", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Jordan Mills");
    expect(screen.getByText("Lead Installer, with you since Jun 2020")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions" })).toBeInTheDocument();
  });

  it("says when they have left, and when a card hasn't been claimed", () => {
    setup({ header: { ...dataFor().header, status: "Inactive" } });
    expect(screen.getByText("Left the team")).toBeInTheDocument();
  });
});

describe("the groups, one page, an Edit each", () => {
  it("draws every group today's card has, in three columns", () => {
    setup({ payroll: { hourly_wage: 42 } });
    for (const name of ["Details", "Emergency", "Licences and tickets", "Qualifications", "Normal week", "Regular days off", "Leave", "Work rights", "Vehicle", "Pay", "Access", "Notes about Jordy"])
      expect(group(name)).toBeInTheDocument();
    expect(document.querySelectorAll(".tm2-col")).toHaveLength(3);
  });

  it("edits Details in place, through the personal section's save", async () => {
    const { user, actions } = setup();
    await user.click(within(group("Details")).getByRole("button", { name: "Edit details" }));
    const mobile = screen.getByRole("textbox", { name: /Mobile/ });
    await user.clear(mobile);
    await user.type(mobile, "0414 222 871");
    await user.click(within(group("Details")).getByRole("button", { name: /Save/ }));
    expect(actions.onSave).toHaveBeenCalledWith("personal", expect.objectContaining({ phone: "0414 222 871" }));
    // the page stays: the group is back to reading, and the others never moved
    expect(within(group("Details")).getByRole("button", { name: "Edit details" })).toBeInTheDocument();
  });

  it("reads the emergency contact as rows, not the plastic card", () => {
    setup();
    expect(within(group("Emergency")).getByText("Sarah Mills")).toBeInTheDocument();
    expect(within(group("Emergency")).getByRole("button", { name: "Edit emergency contact" })).toBeInTheDocument();
  });

  it("lists licences in words, with Renew licence only on one running out", () => {
    setup();
    const lics = group("Licences and tickets");
    expect(within(lics).getByText("L148820, runs out 10 Aug 2026").closest(".pt-state")).toHaveClass("pt-state--look");
    expect(within(lics).getByText("Current to 4 Jun 2027").closest(".pt-state")).toHaveClass("pt-state--good");
    expect(within(lics).getByText("No expiry")).toBeInTheDocument();
    expect(within(lics).getAllByRole("button", { name: "Renew licence" })).toHaveLength(1);
    expect(within(lics).getByRole("button", { name: "Add a licence" })).toBeInTheDocument();
  });

  it("puts Record a check on Work rights, opening the checks", async () => {
    const { user } = setup();
    await user.click(within(group("Work rights")).getByRole("button", { name: "Record a check" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows the vehicle they drive, read-only, with the way to it", () => {
    setup();
    const v = group("Vehicle");
    expect(within(v).getByText("Hilux XQG 41B")).toBeInTheDocument();
    expect(within(v).getByText("84,210 km")).toBeInTheDocument();
    expect(within(v).getByText("At 90,000 km")).toBeInTheDocument();
    expect(within(v).getByRole("link", { name: "Open the vehicle" })).toHaveAttribute("href", "/dashboard/vehicles/v1");
  });

  it("keeps pay hidden until Show pay, and leaves it out without `financials`", async () => {
    const { user } = setup({ payroll: { hourly_wage: 42.5, pay_basis: "hourly" } });
    expect(screen.queryByText(/42\.5/)).toBeNull();
    await user.click(within(group("Pay")).getByRole("button", { name: "Show pay" }));
    expect(within(group("Pay")).getByRole("button", { name: "Edit pay" })).toBeInTheDocument();
  });

  it("has no Pay group for a reader without `financials`", () => {
    setup({ payroll: null });
    expect(screen.queryByText("Pay", { selector: ".pdlh span" })).toBeNull();
  });

  it("has no notes on your own page, and no Leave without Time & Pay", () => {
    setup({ isSelf: true, notes: null, leave: null });
    expect(screen.queryByText(/Notes about/)).toBeNull();
    expect(screen.queryByText("Leave", { selector: ".pdlh span" })).toBeNull();
    expect(screen.getByRole("region", { name: "Signature" })).toBeInTheDocument();
  });

  it("draws Signature on your own page only", () => {
    setup();
    expect(screen.queryByRole("region", { name: "Signature" })).toBeNull();
  });
});

describe("Normal week", () => {
  it("lays the days across with their hours, and the times under them", () => {
    setup();
    const week = group("Normal week");
    expect(within(week).getAllByText("8")).toHaveLength(5);
    expect(within(week).getByText(/7:00 am to 3:30 pm, 30 minute unpaid break, 40 hours/)).toBeInTheDocument();
  });

  it("is changed only by its owner, through their own hours", async () => {
    setup();
    expect(within(group("Normal week")).queryByRole("button", { name: "Edit hours" })).toBeNull();
    cleanup();
    const { user } = setup({ isSelf: true, notes: null });
    await user.click(within(group("Normal week")).getByRole("button", { name: "Edit hours" }));
    await user.click(screen.getByRole("button", { name: "Friday" }));
    await user.click(screen.getByRole("button", { name: "Save hours" }));
    expect(saveMyHours).toHaveBeenCalledWith("7:00 AM", "3:30 PM", [0, 1, 2, 3]);
    expect(refresh).toHaveBeenCalled();
  });

  it("switches Counts toward the schedule by itself, through the crew's own save", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("switch", { name: "Counts toward the schedule" }));
    expect(setScheduleCapacity).toHaveBeenCalledWith([{ staffUuid: "sm8-1", included: false, dailyMinutes: 480 }]);
  });

  it("puts the switch back and says why when the save is refused", async () => {
    setScheduleCapacity.mockResolvedValue({ ok: false, error: "You can't change the crew." });
    const { user } = setup();
    const sw = screen.getByRole("switch", { name: "Counts toward the schedule" });
    await user.click(sw);
    expect(await screen.findByText("You can't change the crew.")).toBeInTheDocument();
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("reads the crew row without `workboard_manage`, and says when they aren't linked", () => {
    setup({ canManageCrew: false });
    expect(screen.getByRole("switch", { name: "Counts toward the schedule" })).toBeDisabled();
    expect(screen.getByText("8 hours a day")).toBeInTheDocument();
    cleanup();
    setup({ crew: null, linkedToSm8: false });
    expect(screen.getByText(/Not linked to anyone in ServiceM8/)).toBeInTheDocument();
    cleanup();
    setup({ crew: null, showCrew: false });
    expect(screen.queryByRole("switch")).toBeNull();
  });
});

describe("Regular days off", () => {
  it("lists the rules in words, and Edit opens the form", async () => {
    const { user } = setup();
    const rdo = group("Regular days off");
    expect(within(rdo).getByText("TAFE")).toBeInTheDocument();
    expect(within(rdo).getByText("Every Wednesday")).toBeInTheDocument();
    await user.click(within(rdo).getByRole("button", { name: "Edit days off" }));
    expect(screen.getByRole("dialog", { name: "Regular days off for Jordan Mills" })).toBeInTheDocument();
  });
});

describe("Leave", () => {
  it("shows what's available, and what's coming up", () => {
    setup();
    const lv = group("Leave");
    expect(within(lv).getByText("112.4 hours")).toBeInTheDocument();
    expect(within(lv).getByText("46 hours")).toBeInTheDocument();
    expect(within(lv).getByText(/Wednesday 28 October, annual leave, approved/)).toBeInTheDocument();
  });

  it("sets a changed entitlement through the team's own action, and only with `team`", async () => {
    const { user } = setup();
    await user.click(within(group("Leave")).getByRole("button", { name: "Edit balances" }));
    const annual = screen.getByRole("spinbutton", { name: /Annual entitlement/ });
    await user.clear(annual);
    await user.type(annual, "152");
    await user.click(screen.getByRole("button", { name: "Save balances" }));
    expect(setLeaveBalance).toHaveBeenCalledTimes(1);
    expect(setLeaveBalance).toHaveBeenCalledWith({ staffProfileId: "p1", kind: "annual", balanceHours: 152 });
    cleanup();
    setup({ canSetBalances: false });
    expect(within(group("Leave")).queryByRole("button", { name: "Edit balances" })).toBeNull();
  });
});

describe("Actions", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Actions" }));

  it("asks before Deactivate, then writes the status through the personal section's save", async () => {
    const { user } = setup();
    await open(user);
    await user.click(screen.getByRole("menuitem", { name: "Deactivate" }));
    expect(saveStaffSection).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Deactivate them" }));
    expect(saveStaffSection).toHaveBeenCalledWith("p1", "personal", { status: "Inactive" });
    expect(refresh).toHaveBeenCalled();
  });

  it("says so when Deactivate is refused", async () => {
    saveStaffSection.mockResolvedValue({ ok: false, error: "You don't have access to change that." });
    const { user } = setup();
    await open(user);
    await user.click(screen.getByRole("menuitem", { name: "Deactivate" }));
    await user.click(screen.getByRole("button", { name: "Deactivate them" }));
    expect(await screen.findByText("You don't have access to change that.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("puts someone who has left back in one press", async () => {
    const { user } = setup({ header: { ...dataFor().header, status: "Inactive" } });
    await open(user);
    expect(screen.queryByRole("menuitem", { name: "Deactivate" })).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: "Reactivate" }));
    expect(saveStaffSection).toHaveBeenCalledWith("p1", "personal", { status: "Active" });
  });

  it("offers Delete only on a card the page named, asks, deletes, and goes back to Team", async () => {
    const { user } = setup();
    await open(user);
    expect(screen.queryByRole("menuitem", { name: "Delete the card" })).toBeNull();
    cleanup();
    const again = setup({ deletable: true });
    await open(again.user);
    await again.user.click(screen.getByRole("menuitem", { name: "Delete the card" }));
    expect(deleteStaffCard).not.toHaveBeenCalled();
    await again.user.click(screen.getByRole("button", { name: "Delete the card" }));
    expect(deleteStaffCard).toHaveBeenCalledWith("p1");
    expect(push).toHaveBeenCalledWith("/dashboard/team");
  });

  it("says why when Delete is refused", async () => {
    deleteStaffCard.mockResolvedValue({ ok: false, error: "They have records here now. Deactivate them instead." });
    const { user } = setup({ deletable: true });
    await open(user);
    await user.click(screen.getByRole("menuitem", { name: "Delete the card" }));
    await user.click(screen.getByRole("button", { name: "Delete the card" }));
    expect(await screen.findByText("They have records here now. Deactivate them instead.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("offers Invite to join on an unclaimed card to an inviter, the card riding the invite", async () => {
    const { user } = setup({ header: { ...dataFor().header, userId: null, importedFrom: "ServiceM8" }, inviteRoles: ["staff"] });
    expect(screen.getByText("From ServiceM8, hasn't joined yet")).toBeInTheDocument();
    await open(user);
    await user.click(screen.getByRole("menuitem", { name: "Invite to join" }));
    expect(within(screen.getByRole("dialog", { name: "Add a person" })).getByText(/attaches to Jordan Mills's card/)).toBeInTheDocument();
  });

  it("keeps Invite to join off a claimed card and away from a non-inviter", async () => {
    const { user } = setup({ inviteRoles: ["staff"] });
    await open(user);
    expect(screen.queryByRole("menuitem", { name: "Invite to join" })).toBeNull();
  });

  it("copies the link to the page", async () => {
    const writeText = jest.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { user } = setup();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await open(user);
    await user.click(screen.getByRole("menuitem", { name: "Copy the link" }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/dashboard/team/p1`);
  });
});
