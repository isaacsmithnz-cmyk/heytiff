import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamDirectory } from "../directory";
import type { PendingInviteRow, StaffRow } from "@/lib/staff/types";

/* The whole row navigates now, so the component calls useRouter() — which
   throws outside an app-router context. Same mock the other component tests
   use, with `push` captured so the row-click behaviour can be asserted. */
const push = jest.fn();
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

/* The pending rows now call server actions — mocked, never called for real. */
const renewInvite = jest.fn(async () => ({ ok: true }) as { ok: boolean; error?: string });
const revokeInvite = jest.fn(async () => ({ ok: true }) as { ok: boolean; error?: string });
jest.mock("@/app/actions/invite", () => ({
  renewInvite: (...a: unknown[]) => renewInvite(...(a as [])),
  revokeInvite: (...a: unknown[]) => revokeInvite(...(a as [])),
}));

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  renewInvite.mockClear();
  revokeInvite.mockClear();
  renewInvite.mockResolvedValue({ ok: true });
  revokeInvite.mockResolvedValue({ ok: true });
});

/* Own fixtures rather than the demo mock — the directory now renders real
   rows, and the point of this stage is that deleting mock/demo.ts changes
   nothing here. Shapes match what listStaff() returns. */

const staffRow = (over: Partial<StaffRow> & Pick<StaffRow, "id" | "name">): StaffRow => ({
  userId: `auth0|${over.id}`,
  initials: over.name.slice(0, 2).toUpperCase(),
  email: `${over.id}@heytiff.co`,
  role: "Installer",
  employmentType: "Full-time",
  started: "Mar 2021",
  years: "3.2",
  licenceCount: 0,
  status: "Active",
  vehicle: "—",
  compliance: { label: "Compliant", state: "ok", expiresDays: 9999 },
  orgRole: "staff",
  isMaster: false,
  ...over,
});

const STAFF: StaffRow[] = [
  staffRow({
    id: "a1",
    name: "Jordan Mills",
    role: "Lead Installer",
    compliance: { label: "ARC licence expires in 2 weeks", state: "warn", expiresDays: 14 },
  }),
  staffRow({
    id: "b2",
    name: "Liam O’Brien",
    role: "Apprentice",
    compliance: { label: "White Card expired", state: "bad", expiresDays: -3 },
  }),
  staffRow({ id: "c3", name: "Sophie Tran", role: "Office Manager" }),
  staffRow({ id: "d4", name: "Marcus Webb", role: "Installer" }),
  staffRow({ id: "e5", name: "Hannah Cole", role: "Estimator" }),
  staffRow({ id: "f6", name: "Dylan Reyes", role: "Installer", status: "Inactive" }),
];

const PENDING: PendingInviteRow[] = [
  {
    id: "inv-live",
    name: "ben.fletcher",
    email: "ben.fletcher@gmail.com",
    role: "Staff",
    state: "live",
    note: "Expires in 5 days",
    token: "tok-live",
    expiresAt: "2026-08-01T00:00:00Z",
  },
  {
    id: "inv-dead",
    name: "k.santos",
    email: "k.santos@outlook.com",
    role: "Admin",
    state: "expired",
    note: "Expired 2 days ago",
    token: "tok-dead",
    expiresAt: "2026-07-20T00:00:00Z",
  },
];

function setup(opts: { canInvite?: boolean } = {}) {
  render(
    <TeamDirectory
      staff={STAFF}
      pending={PENDING}
      canInvite={opts.canInvite ?? false}
      appUrl="https://heytiff.test"
    />,
  );
}

describe("TeamDirectory", () => {
  it("renders every staff member in the default view", () => {
    setup();
    for (const s of STAFF) {
      expect(screen.getByText(s.name)).toBeInTheDocument();
    }
  });

  it("shows the three-state compliance chips", () => {
    setup();
    expect(screen.getByText("ARC licence expires in 2 weeks")).toBeInTheDocument();
    expect(screen.getByText("White Card expired")).toBeInTheDocument();
    expect(screen.getAllByText("Compliant")).toHaveLength(4);
  });

  it("marks inactive staff", () => {
    setup();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("filters to compliance issues on the Need attention tab", async () => {
    setup();
    await userEvent.click(screen.getByText("Need attention"));
    expect(screen.getByText("Jordan Mills")).toBeInTheDocument();
    expect(screen.getByText("Liam O’Brien")).toBeInTheDocument();
    expect(screen.queryByText("Sophie Tran")).not.toBeInTheDocument();
  });

  it("shows pending invites on the invites tab", async () => {
    setup();
    await userEvent.click(screen.getByText("Pending invites"));
    expect(screen.getByText("ben.fletcher")).toBeInTheDocument();
    expect(screen.getByText("Expired 2 days ago")).toBeInTheDocument();
  });

  it("searches by name or role", async () => {
    setup();
    await userEvent.type(screen.getByPlaceholderText("Search name or role..."), "installer");
    expect(screen.getByText("Jordan Mills")).toBeInTheDocument();
    expect(screen.getByText("Marcus Webb")).toBeInTheDocument();
    expect(screen.queryByText("Hannah Cole")).not.toBeInTheDocument();
  });

  it("links each row to its card by UUID", async () => {
    setup();
    const menuButtons = screen.getAllByLabelText("Actions");
    await userEvent.click(menuButtons[0]);
    const link = screen.getByText("View profile").closest("a");
    // the id is the staff_profiles UUID, not a slug
    expect(link).toHaveAttribute("href", expect.stringContaining("/dashboard/team/"));
  });

  it("navigates to the card when the row itself is clicked", async () => {
    setup();
    await userEvent.click(screen.getByText("Jordan Mills"));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("/dashboard/team/"));
  });

  it("opens the actions menu without navigating", async () => {
    setup();
    await userEvent.click(screen.getAllByLabelText("Actions")[0]);
    // the menu stops its clicks reaching the row, so no navigation happens
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText("View profile")).toBeInTheDocument();
  });
});

describe("TeamDirectory pending-invite actions", () => {
  const openPending = async () => userEvent.click(screen.getByText("Pending invites"));

  it("keeps the link and the actions away from a viewer without `invites`", async () => {
    setup();
    await openPending();
    expect(screen.queryByText("Copy")).not.toBeInTheDocument();
    expect(screen.queryByText(/tok-live/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Revoke/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Renew/ })).not.toBeInTheDocument();
  });

  it("shows an accept link per row for someone who may invite", async () => {
    setup({ canInvite: true });
    await openPending();
    expect(
      screen.getByText("https://heytiff.test/invite/accept?token=tok-live"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Copy")).toHaveLength(2);
  });

  it("offers Renew on the expired row only", async () => {
    setup({ canInvite: true });
    await openPending();
    const renew = screen.getAllByRole("button", { name: /Renew/ });
    expect(renew).toHaveLength(1);

    await userEvent.click(renew[0]);
    expect(renewInvite).toHaveBeenCalledWith("inv-dead");
    expect(refresh).toHaveBeenCalled();
  });

  it("makes Revoke a two-step: arm, then confirm", async () => {
    setup({ canInvite: true });
    await openPending();
    const revoke = screen.getAllByRole("button", { name: /Revoke/ })[0];

    await userEvent.click(revoke);
    expect(revokeInvite).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Confirm revoke/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Confirm revoke/ }));
    expect(revokeInvite).toHaveBeenCalledWith("inv-live");
    expect(refresh).toHaveBeenCalled();
  });

  it("surfaces an action's refusal instead of pretending it worked", async () => {
    revokeInvite.mockResolvedValue({ ok: false, error: "That invite has already been accepted." });
    setup({ canInvite: true });
    await openPending();
    await userEvent.click(screen.getAllByRole("button", { name: /Revoke/ })[0]);
    await userEvent.click(screen.getByRole("button", { name: /Confirm revoke/ }));

    expect(
      await screen.findByText("That invite has already been accepted."),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
