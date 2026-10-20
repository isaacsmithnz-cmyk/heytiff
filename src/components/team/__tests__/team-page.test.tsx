import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamPage, type TeamPageData } from "../team-page";
import { WindowsContext } from "@/components/records/records-context";
import type { MemberWithoutCardRow, PendingInviteRow, StaffRow } from "@/lib/staff/types";
import type { TimepaySection } from "@/lib/timepay/section";
import type { TeamView } from "@/lib/team/views";

/* TEAM (v2): the people list, and the five views that frame today's
   screens. Carried over from the old directory's suite, check for check:
   who is listed and where, the licences word, the invites and their
   actions, unclaimed cards and Invite to join, members with no card,
   Reactivate, the search, the sort and the doors into a person. */

const push = jest.fn();
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

/* The server actions are mocked, never called for real: importing a
   "use server" module drags next/cache into jsdom. */
const renewInvite = jest.fn(async (_id: string) => ({ ok: true }) as { ok: boolean; error?: string; delivery?: unknown });
const revokeInvite = jest.fn(async (_id: string) => ({ ok: true }) as { ok: boolean; error?: string });
const createInvite = jest.fn(async (_i: unknown) => ({ ok: true }) as { ok: boolean; error?: string });
jest.mock("@/app/actions/invite", () => ({
  renewInvite: (id: string) => renewInvite(id),
  revokeInvite: (id: string) => revokeInvite(id),
  createInvite: (i: unknown) => createInvite(i),
  lookupInvitee: async () => ({ kind: "new" }),
}));
const saveStaffSection = jest.fn(async (..._a: unknown[]) => ({ ok: true }) as { ok: boolean; error?: string });
jest.mock("@/app/actions/staff", () => ({ saveStaffSection: (...a: unknown[]) => saveStaffSection(...a) }));
const createCardForMember = jest.fn(async (_u: string) => ({ ok: true }) as { ok: boolean; error?: string });
const removeMemberWithoutCard = jest.fn(async (_u: string) => ({ ok: true }) as { ok: boolean; error?: string });
jest.mock("@/app/actions/members", () => ({
  createCardForMember: (u: string) => createCardForMember(u),
  removeMemberWithoutCard: (u: string) => removeMemberWithoutCard(u),
}));

/* The five framed views are today's screens, each with its own suite; here
   only that the right one opens, with the props that keep you on Team. */
const timePayProps = jest.fn();
jest.mock("@/components/timepay/timepay", () => ({
  TimePay: (p: Record<string, unknown>) => {
    timePayProps(p);
    return <p>Timesheets face</p>;
  },
}));
jest.mock("@/components/timepay/team-leave", () => ({ TeamLeave: () => <p>Leave face</p> }));
jest.mock("@/components/timepay/team-expenses", () => ({ TeamExpenses: () => <p>Expenses face</p> }));
jest.mock("@/components/fleet/register", () => ({ FleetRegister: () => <p>Fleet register</p> }));
jest.mock("@/components/fleet/fleet-state", () => ({ useFleetActions: () => ({}) }));
const noticeProps = jest.fn();
jest.mock("@/components/dashboard/notices-board", () => ({
  NoticesBoard: (p: Record<string, unknown>) => {
    noticeProps(p);
    return <p>Noticeboard</p>;
  },
}));

const toast = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  renewInvite.mockResolvedValue({ ok: true });
  revokeInvite.mockResolvedValue({ ok: true });
  saveStaffSection.mockResolvedValue({ ok: true });
  createCardForMember.mockResolvedValue({ ok: true });
  removeMemberWithoutCard.mockResolvedValue({ ok: true });
  window.history.replaceState(null, "", "/dashboard/team");
});

const staffRow = (over: Partial<StaffRow> & Pick<StaffRow, "id" | "name">): StaffRow => ({
  userId: `auth0|${over.id}`,
  initials: over.name.slice(0, 2).toUpperCase(),
  email: `${over.id}@heytiff.co`,
  phone: "0414 222 871",
  role: "Installer",
  employmentType: "Full-time",
  started: "Mar 2021",
  years: "3.2",
  licenceCount: 0,
  status: "Active",
  compliance: { label: "Compliant", state: "ok", expiresDays: 9999 },
  orgRole: "staff",
  isMaster: false,
  importedFrom: null,
  ...over,
});

const STAFF: StaffRow[] = [
  staffRow({ id: "a1", name: "Jordan Mills", role: "Lead Installer", compliance: { label: "ARC licence expires in 2 weeks", state: "warn", expiresDays: 14 } }),
  staffRow({ id: "b2", name: "Liam O’Brien", role: "Apprentice", compliance: { label: "White Card expired", state: "bad", expiresDays: -3 } }),
  staffRow({ id: "c3", name: "Sophie Tran", role: "Office Manager", orgRole: "admin" }),
  staffRow({ id: "d4", name: "Marcus Webb", role: "Installer", phone: null }),
  staffRow({ id: "e5", name: "Hannah Cole", role: "Estimator", compliance: { label: "—", state: "ok", expiresDays: 99999 } }),
  staffRow({ id: "f6", name: "Dylan Reyes", role: "Installer", status: "Inactive" }),
];

const PENDING: PendingInviteRow[] = [
  { id: "inv-live", name: "ben.fletcher", email: "ben.fletcher@gmail.com", role: "Staff", state: "live", note: "Expires in 5 days", token: "tok-live", expiresAt: "2026-08-01T00:00:00Z" },
  { id: "inv-dead", name: "k.santos", email: "k.santos@outlook.com", role: "Admin", state: "expired", note: "Expired 2 days ago", token: "tok-dead", expiresAt: "2026-07-20T00:00:00Z" },
];

/* without `invites`, the page never asked for the links */
const unlinked = PENDING.map((p) => ({ ...p, id: null, token: null }));

type Opts = {
  staff?: StaffRow[];
  pending?: PendingInviteRow[];
  orphans?: MemberWithoutCardRow[];
  canInvite?: boolean;
  canRemoveMembers?: boolean;
  vehicles?: Record<string, string> | null;
  timepay?: boolean;
  fleet?: boolean;
  view?: TeamView;
};

function dataFor(o: Opts = {}): TeamPageData {
  const canInvite = o.canInvite ?? false;
  const timepay = o.timepay
    ? ({
        sheets: { staff: [], week: [], today: 0, through: 0, periods: [], periodIndex: 0, settings: {}, configured: true, sheets: { a1: { status: "submitted" }, b2: { status: "approved" } } },
        leave: { pending: [{ id: "l1" }], calendar: [], balances: [] },
        claims: [],
        canApprove: true,
        financials: false,
        canHolidays: false,
        canManage: true,
        xeroConnected: false,
        wageDrift: null,
        expenses: { owed: 0, pending: 3 },
      } as unknown as TimepaySection)
    : null;
  const views: TeamView[] = ["people", ...(o.timepay ? (["timesheets", "leave", "expenses"] as const) : []), ...(o.fleet ? (["vehicles"] as const) : []), "notices"];
  return {
    people: {
      staff: o.staff ?? STAFF,
      orphans: o.orphans ?? [],
      pending: o.pending ?? (canInvite ? PENDING : unlinked),
      canInvite,
      inviteRoles: canInvite ? ["staff"] : [],
      appUrl: "https://heytiff.test",
      canRemoveMembers: o.canRemoveMembers ?? false,
      vehicles: o.vehicles === undefined ? null : o.vehicles,
    },
    timepay,
    fleet: o.fleet ? ({ register: { vehicles: [{ status: "active" }, { status: "sold" }], staff: [] }, today: "2026-10-19", warnDays: 30 } as never) : null,
    notices: { notices: [], canManage: true, canRead: true, today: "2026-10-19", staff: [], viewerStaffId: null },
    views,
  };
}

function setup(o: Opts = {}) {
  const user = userEvent.setup();
  const utils = render(
    <WindowsContext.Provider value={{ toast } as never}>
      <TeamPage data={dataFor(o)} view={o.view ?? "people"} />
    </WindowsContext.Provider>,
  );
  return { user, ...utils };
}

const rowOf = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

describe("Team, the page", () => {
  it("titles the page Team, no number beside it, and offers Add a person to an inviter only", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1, name: "Team" })).toBeInTheDocument();
    expect(screen.queryByText("5 people")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a person" })).toBeNull();
  });

  it("shows Add a person, the main button, to someone who may invite", () => {
    setup({ canInvite: true });
    expect(screen.getByRole("button", { name: "Add a person" })).toHaveClass("pt-btn--main");
  });

  it("offers only the views today's gates allow", () => {
    setup();
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["People", "Notices"]);
  });

  it("puts an approval view's word in amber while something waits, and no numbers anywhere", () => {
    setup({ timepay: true, fleet: true });
    for (const v of ["Timesheets", "Leave", "Expenses"]) expect(screen.getByRole("tab", { name: new RegExp(`^${v}\\W+something to look at$`) })).toHaveClass("pt-vtab--look");
    expect(screen.getByRole("tab", { name: "Vehicles" })).not.toHaveClass("pt-vtab--look");
    for (const t of screen.getAllByRole("tab")) expect(t.textContent).not.toMatch(/\d/);
  });

  it("opens each framed view on today's screen, and writes the view into the address", async () => {
    const { user } = setup({ timepay: true, fleet: true });
    await user.click(screen.getByRole("tab", { name: /Timesheets/ }));
    expect(screen.getByText("Timesheets face")).toBeInTheDocument();
    expect(window.location.search).toBe("?view=timesheets");
    await user.click(screen.getByRole("tab", { name: /Leave/ }));
    expect(screen.getByText("Leave face")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Expenses/ }));
    expect(screen.getByText("Expenses face")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Vehicles/ }));
    expect(screen.getByText("Fleet register")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Notices/ }));
    expect(screen.getByText("Noticeboard")).toBeInTheDocument();
    expect(noticeProps).toHaveBeenLastCalledWith(expect.objectContaining({ embedded: true }));
    await user.click(screen.getByRole("tab", { name: /People/ }));
    expect(window.location.search).toBe("");
  });

  it("keeps a period and the Expenses tile on Team", () => {
    setup({ timepay: true, view: "timesheets" });
    const p = timePayProps.mock.calls.at(-1)![0] as { periodHref: (s: string) => string; expensesHref: string };
    expect(p.periodHref("2026-10-13")).toBe("/dashboard/team?view=timesheets&period=2026-10-13");
    expect(p.expensesHref).toBe("/dashboard/team?view=expenses");
  });

  it("takes a view a link on the page names", () => {
    const { rerender } = setup({ timepay: true });
    rerender(
      <WindowsContext.Provider value={{ toast } as never}>
        <TeamPage data={dataFor({ timepay: true })} view="expenses" />
      </WindowsContext.Provider>,
    );
    expect(screen.getByText("Expenses face")).toBeInTheDocument();
  });
});

describe("Team, People", () => {
  it("lists everyone working, and nobody who has left", () => {
    setup();
    for (const s of STAFF.filter((r) => r.status === "Active")) expect(screen.getByText(s.name)).toBeInTheDocument();
    expect(screen.queryByText("Dylan Reyes")).toBeNull();
  });

  it("says each person's licences and papers as one word in its colour", () => {
    setup();
    expect(within(rowOf("Jordan Mills")).getByText("ARC licence expires in 2 weeks").closest(".pt-state")).toHaveClass("pt-state--look");
    expect(within(rowOf("Liam O’Brien")).getByText("White Card expired").closest(".pt-state")).toHaveClass("pt-state--wrong");
    expect(within(rowOf("Sophie Tran")).getByText("All current").closest(".pt-state")).toHaveClass("pt-state--good");
    expect(within(rowOf("Hannah Cole")).getByText("Nothing on file")).toBeInTheDocument();
  });

  it("shows the mobile and the access, and says when there's no mobile", () => {
    setup();
    expect(within(rowOf("Jordan Mills")).getByText("0414 222 871")).toBeInTheDocument();
    expect(within(rowOf("Sophie Tran")).getByText("Admin")).toBeInTheDocument();
    expect(within(rowOf("Marcus Webb")).getByText("No mobile")).toBeInTheDocument();
  });

  it("draws the Vehicle column only for a reader who may see the register", () => {
    setup();
    expect(screen.queryByText("Vehicle")).toBeNull();
    cleanup();
    setup({ vehicles: { a1: "Hilux XQG 41B" } });
    expect(screen.getByText("Vehicle")).toBeInTheDocument();
    expect(within(rowOf("Jordan Mills")).getByText("Hilux XQG 41B")).toBeInTheDocument();
    expect(within(rowOf("Sophie Tran")).getByText("No vehicle")).toBeInTheDocument();
  });

  it("makes the name a real link to the person's page by id, one per row", () => {
    setup();
    const row = rowOf("Jordan Mills");
    expect(screen.getByText("Jordan Mills").closest("a")).toHaveAttribute("href", "/dashboard/team/a1");
    expect(row).not.toHaveAttribute("role", "link");
    expect(row.querySelectorAll('a[href^="/dashboard/team/"]')).toHaveLength(1);
  });

  it("searches by name or role, and says so when nothing matches", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("textbox", { name: "Search people by name or role" }), "installer");
    expect(screen.getByText("Jordan Mills")).toBeInTheDocument();
    expect(screen.getByText("Marcus Webb")).toBeInTheDocument();
    expect(screen.queryByText("Hannah Cole")).toBeNull();
    await user.clear(screen.getByRole("textbox", { name: "Search people by name or role" }));
    await user.type(screen.getByRole("textbox", { name: "Search people by name or role" }), "zzz");
    expect(screen.getByText('No one here matches "zzz"')).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear the search" }));
    expect(screen.getByText("Jordan Mills")).toBeInTheDocument();
  });

  it("sorts by licences running out, the old Compliance gaps first", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("combobox", { name: "Sort" }));
    await user.click(screen.getByRole("option", { name: "Licences running out" }));
    const names = screen.getAllByRole("link").map((a) => a.textContent);
    expect(names.slice(0, 2)).toEqual(["Liam O’Brien", "Jordan Mills"]);
  });

  /* Isaac, 2026-09-28: deactivated people move out of the way, not out of
     the app. In v2 they are behind "Show people who have left". */
  it("shows who has left behind its choice, each with Reactivate in one press", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("checkbox", { name: /Show people who have left/ }));
    expect(screen.getByRole("heading", { name: "Left, 1" })).toBeInTheDocument();
    await user.click(within(rowOf("Dylan Reyes")).getByRole("button", { name: "Reactivate" }));
    expect(saveStaffSection).toHaveBeenCalledWith("f6", "personal", { status: "Active" });
    expect(refresh).toHaveBeenCalled();
  });

  it("offers no Show people who have left while nobody has", () => {
    setup({ staff: STAFF.filter((s) => s.status === "Active") });
    expect(screen.queryByRole("checkbox", { name: /who have left/ })).toBeNull();
  });

  it("says so when Reactivate is refused", async () => {
    saveStaffSection.mockResolvedValue({ ok: false, error: "You don't have access to change that." });
    const { user } = setup();
    await user.click(screen.getByRole("checkbox", { name: /Show people who have left/ }));
    await user.click(within(rowOf("Dylan Reyes")).getByRole("button", { name: "Reactivate" }));
    expect(await screen.findByText("You don't have access to change that.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("Team, an invitation", () => {
  it("is a row whose word is Invited, with its note", () => {
    setup();
    expect(within(rowOf("ben.fletcher")).getByText("Invited")).toBeInTheDocument();
    expect(within(rowOf("ben.fletcher")).getByText("Expires in 5 days")).toBeInTheDocument();
    expect(within(rowOf("k.santos")).getByText("Invite lapsed")).toBeInTheDocument();
  });

  it("keeps the link and the actions away from a viewer without `invites`", () => {
    setup();
    expect(screen.queryByRole("button", { name: /Actions on the invite/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/tok-live/);
  });

  it("resends a live invite, renews a lapsed one, and says where the letter went", async () => {
    renewInvite.mockResolvedValue({ ok: true, delivery: { sent: true, to: "ben.fletcher@gmail.com" } });
    const { user } = setup({ canInvite: true });
    await user.click(screen.getByRole("button", { name: "Actions on the invite to ben.fletcher" }));
    await user.click(screen.getByRole("menuitem", { name: "Resend the invite" }));
    expect(renewInvite).toHaveBeenCalledWith("inv-live");
    expect(refresh).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Invite sent to ben.fletcher@gmail.com");

    await user.click(screen.getByRole("button", { name: "Actions on the invite to k.santos" }));
    await user.click(screen.getByRole("menuitem", { name: "Renew and resend" }));
    expect(renewInvite).toHaveBeenCalledWith("inv-dead");
  });

  it("says a letter that didn't go is a note, and names the link", async () => {
    renewInvite.mockResolvedValue({ ok: true, delivery: { sent: false, reason: "failed", to: "ben.fletcher@gmail.com" } });
    const { user } = setup({ canInvite: true });
    await user.click(screen.getByRole("button", { name: "Actions on the invite to ben.fletcher" }));
    await user.click(screen.getByRole("menuitem", { name: "Resend the invite" }));
    expect(await screen.findByText(/didn't send\. Copy the link/)).toBeInTheDocument();
  });

  it("copies the accept link", async () => {
    const { user } = setup({ canInvite: true });
    const writeText = jest.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await user.click(screen.getByRole("button", { name: "Actions on the invite to ben.fletcher" }));
    await user.click(screen.getByRole("menuitem", { name: "Copy the invite link" }));
    expect(writeText).toHaveBeenCalledWith("https://heytiff.test/invite/accept?token=tok-live");
    expect(toast).toHaveBeenCalledWith("Invite link copied");
  });

  it("asks before it revokes, and revokes the invite it was on", async () => {
    const { user } = setup({ canInvite: true });
    await user.click(screen.getByRole("button", { name: "Actions on the invite to ben.fletcher" }));
    await user.click(screen.getByRole("menuitem", { name: "Revoke the invite" }));
    expect(revokeInvite).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Revoke invite" }));
    expect(revokeInvite).toHaveBeenCalledWith("inv-live");
    expect(refresh).toHaveBeenCalled();
  });

  it("surfaces a refusal instead of pretending it worked", async () => {
    revokeInvite.mockResolvedValue({ ok: false, error: "That invite has already been accepted." });
    const { user } = setup({ canInvite: true });
    await user.click(screen.getByRole("button", { name: "Actions on the invite to ben.fletcher" }));
    await user.click(screen.getByRole("menuitem", { name: "Revoke the invite" }));
    await user.click(screen.getByRole("button", { name: "Revoke invite" }));
    expect(await screen.findByText("That invite has already been accepted.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

/* Unclaimed cards: imported (or pre-seeded), no login yet. Say they haven't
   arrived, where they came from, and make the invite THE claim. */
describe("Team, a card nobody has claimed", () => {
  const UNCLAIMED = [
    ...STAFF,
    staffRow({ id: "g7", name: "Imported Dan", role: "Technician", userId: null, email: "dan@acme.com", importedFrom: "ServiceM8" }),
    staffRow({ id: "h8", name: "Seeded Sam", role: "Labourer", userId: null, email: "" }),
  ];

  it("says where the card came from, in words", () => {
    setup({ staff: UNCLAIMED, canInvite: true });
    expect(rowOf("Imported Dan").className).toContain("tm2-row--unclaimed");
    expect(within(rowOf("Imported Dan")).getByText("From ServiceM8")).toBeInTheDocument();
    expect(within(rowOf("Seeded Sam")).getByText("Hasn't joined yet")).toBeInTheDocument();
    expect(rowOf("Sophie Tran").className).not.toContain("unclaimed");
  });

  it("offers Invite to join on unclaimed rows only, and only to an inviter", () => {
    setup({ staff: UNCLAIMED, canInvite: true });
    expect(within(rowOf("Imported Dan")).getByRole("button", { name: "Invite to join" })).toBeInTheDocument();
    expect(within(rowOf("Jordan Mills")).queryByRole("button", { name: "Invite to join" })).toBeNull();
    cleanup();
    setup({ staff: UNCLAIMED, canInvite: false });
    expect(screen.queryByRole("button", { name: "Invite to join" })).toBeNull();
  });

  it("the invite carries the card: Add a person filled in, staffProfileId on the submit", async () => {
    const { user } = setup({ staff: UNCLAIMED, canInvite: true });
    await user.click(within(rowOf("Imported Dan")).getByRole("button", { name: "Invite to join" }));
    const form = within(screen.getByRole("dialog", { name: "Add a person" }));
    expect(form.getByText(/attaches to Imported Dan's card/)).toBeInTheDocument();
    expect((form.getByLabelText("Email address") as HTMLInputElement).value).toBe("dan@acme.com");
    await user.click(form.getByRole("button", { name: "Send invite" }));
    expect(createInvite).toHaveBeenCalledWith({ email: "dan@acme.com", role: "staff", staffProfileId: "g7" });
  });
});

/* A MEMBER WITH NO STAFF CARD (#611): they sign in, hold a role, and are
   in no list, because the table reads cards. */
describe("Team, a member with no staff card", () => {
  const orphan: MemberWithoutCardRow = { userId: "auth0|orphan", name: "Sam Rivers", email: "sam@rivers.com", role: "Staff" };

  it("shows them, with the fact that stops them working", () => {
    setup({ staff: [], pending: [], orphans: [orphan] });
    expect(screen.getByText("Sam Rivers")).toBeInTheDocument();
    expect(screen.getByText("sam@rivers.com")).toBeInTheDocument();
    expect(screen.getByText("No staff card")).toBeInTheDocument();
  });

  it("makes their card from the row, and says so when it couldn't", async () => {
    const { user } = setup({ staff: [], pending: [], orphans: [orphan] });
    await user.click(screen.getByRole("button", { name: "Create card" }));
    expect(createCardForMember).toHaveBeenCalledWith("auth0|orphan");
    expect(refresh).toHaveBeenCalled();
    createCardForMember.mockResolvedValue({ ok: false, error: "Couldn't create the card." });
    await user.click(screen.getByRole("button", { name: "Create card" }));
    expect(await screen.findByText("Couldn't create the card.")).toBeInTheDocument();
  });

  it("offers Remove only to an owner, and asks before it takes the seat back", async () => {
    setup({ staff: [], pending: [], orphans: [orphan] });
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    cleanup();
    const { user } = setup({ staff: [], pending: [], orphans: [orphan], canRemoveMembers: true });
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(removeMemberWithoutCard).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove them" }));
    expect(removeMemberWithoutCard).toHaveBeenCalledWith("auth0|orphan");
  });

  it("sits above the table, where the search can't hide them", async () => {
    const { user, container } = setup({ orphans: [orphan] });
    await user.type(screen.getByRole("textbox", { name: "Search people by name or role" }), "zzz");
    expect(screen.getByText("Sam Rivers")).toBeInTheDocument();
    expect(container.querySelector(".tm2-orphans")!.compareDocumentPosition(container.querySelector(".pt-empty")!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("falls back to the address, then the sub, when nothing holds a real name", () => {
    setup({ staff: [], pending: [], orphans: [{ ...orphan, name: null }] });
    expect(screen.getByText("sam")).toBeInTheDocument();
    cleanup();
    setup({ staff: [], pending: [], orphans: [{ ...orphan, name: null, email: "" }] });
    expect(screen.getByText("auth0|orphan")).toBeInTheDocument();
    expect(screen.getByText("Unnamed account")).toBeInTheDocument();
  });

  it("says the team is empty, not that a filter matched nothing", () => {
    setup({ staff: [], pending: [] });
    expect(screen.getByText("Nobody on the team yet")).toBeInTheDocument();
    expect(screen.queryByText(/matches/)).toBeNull();
  });
});
