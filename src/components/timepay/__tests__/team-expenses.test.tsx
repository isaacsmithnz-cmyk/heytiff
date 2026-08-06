import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamExpenses } from "../team-expenses";
import type { TeamClaim } from "@/lib/expenses/query";

const approve = jest.fn();
const decline = jest.fn();
const reimburse = jest.fn();
const refresh = jest.fn();

jest.mock("@/app/actions/expenses", () => ({
  approveClaim: (...a: unknown[]) => approve(...a),
  declineClaim: (...a: unknown[]) => decline(...a),
  markReimbursed: (...a: unknown[]) => reimburse(...a),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));

const claim = (o: Partial<TeamClaim> & { id: string; status: TeamClaim["status"] }): TeamClaim => ({
  staffProfileId: "s1",
  staffName: "Dan Smith",
  expenseDate: "2026-07-20",
  description: "Copper fittings",
  category: "materials",
  amount: 84.5,
  gstAmount: 7.68,
  supplier: "Reece",
  reviewNote: null,
  createdAt: "2026-07-20T00:00:00Z",
  receipts: [{ url: "https://example.test/receipt.jpg", image: true }],
  ...o,
});

beforeEach(() => {
  approve.mockReset().mockResolvedValue({ ok: true });
  decline.mockReset().mockResolvedValue({ ok: true });
  reimburse.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

describe("TeamExpenses — a claim raised by a fuel log", () => {
  /* THE APPROVER'S RISK. Without this line, a fuel log AND a claim for the
     same tank look like a duplicate to reject — when they are the intended
     pair: the log records the fuel, the claim pays the person back. The tax
     report already counts it once, via the log. */
  const fromFuel = claim({
    id: "c-fuel",
    status: "pending",
    category: "fuel",
    description: "Fuel — BP Kingsford",
    fuelLog: { vehicleLogId: "log-1", vehicle: "Hilux" },
  });

  it("says the fuel is already logged, and against what", () => {
    render(<TeamExpenses claims={[fromFuel]} canApprove canPay />);
    expect(screen.getByText(/Already logged against Hilux — this is the reimbursement/)).toBeInTheDocument();
  });

  it("falls back to 'the vehicle' when there is no name", () => {
    render(<TeamExpenses claims={[claim({ ...fromFuel, fuelLog: { vehicleLogId: "log-1", vehicle: null } })]} canApprove canPay />);
    expect(screen.getByText(/Already logged against the vehicle/)).toBeInTheDocument();
  });

  it("says nothing on an ordinary claim", () => {
    render(<TeamExpenses claims={[claim({ id: "c-1", status: "pending" })]} canApprove canPay />);
    expect(screen.queryByText(/Already logged against/)).toBeNull();
  });
});

describe("TeamExpenses — deciding", () => {
  const pending = [claim({ id: "c1", status: "pending" })];

  it("approves a pending claim", async () => {
    const user = userEvent.setup();
    render(<TeamExpenses claims={pending} canApprove canPay />);

    await user.click(screen.getByText("Approve"));

    await waitFor(() => expect(approve).toHaveBeenCalledWith("c1"));
    expect(refresh).toHaveBeenCalled();
  });

  /* Somebody is out of pocket and being told no. "Declined" alone is not an
     answer they can act on, so the button can't fire without a reason. */
  it("won't let a decline go through without a reason", async () => {
    const user = userEvent.setup();
    render(<TeamExpenses claims={pending} canApprove canPay />);

    await user.click(screen.getByText("Decline"));
    // the confirm button is the second "Decline" — disabled until there's text
    const confirm = screen.getAllByText("Decline").find((b) => (b as HTMLButtonElement).disabled);
    expect(confirm).toBeDefined();

    await user.type(screen.getByPlaceholderText("Why is it being declined?"), "Personal purchase");
    await user.click(screen.getAllByText("Decline").find((b) => !(b as HTMLButtonElement).disabled)!);

    await waitFor(() => expect(decline).toHaveBeenCalledWith("c1", "Personal purchase"));
  });

  it("surfaces a refusal rather than claiming success", async () => {
    approve.mockResolvedValue({ ok: false, error: "You can't review your own expense claim." });
    const user = userEvent.setup();
    render(<TeamExpenses claims={pending} canApprove canPay />);

    await user.click(screen.getByText("Approve"));

    expect(await screen.findByText("You can't review your own expense claim.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("TeamExpenses — the two gates are different questions", () => {
  it("offers no decide buttons without `approvals`", () => {
    render(<TeamExpenses claims={[claim({ id: "c1", status: "pending" })]} canApprove={false} canPay />);
    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
    expect(screen.getByText(/approving them needs the approvals permission/)).toBeInTheDocument();
  });

  /* Approving says the spend was legitimate; paying says money moved. A
     manager with `approvals` alone must not be offered a control the server
     will refuse. */
  it("offers no Mark paid without `financials`, even to an approver", () => {
    render(<TeamExpenses claims={[claim({ id: "c1", status: "approved" })]} canApprove canPay={false} />);
    expect(screen.queryByText("Mark paid")).not.toBeInTheDocument();
  });

  it("offers Mark paid only on an approved claim", () => {
    const { unmount } = render(
      <TeamExpenses claims={[claim({ id: "c1", status: "approved" })]} canApprove canPay />
    );
    expect(screen.getByText("Mark paid")).toBeInTheDocument();
    unmount();

    render(<TeamExpenses claims={[claim({ id: "c2", status: "pending" })]} canApprove canPay />);
    expect(screen.queryByText("Mark paid")).not.toBeInTheDocument();
  });

  it("records the payment", async () => {
    const user = userEvent.setup();
    render(<TeamExpenses claims={[claim({ id: "c1", status: "approved" })]} canApprove canPay />);

    await user.click(screen.getByText("Mark paid"));

    await waitFor(() => expect(reimburse).toHaveBeenCalledWith("c1"));
  });
});

describe("TeamExpenses — what it says", () => {
  it("shows the amount, which is the decision being asked for", () => {
    render(<TeamExpenses claims={[claim({ id: "c1", status: "pending" })]} canApprove canPay />);
    // scoped to the row: the summary strip legitimately shows the same figure
    // when there is only one outstanding claim
    expect(document.querySelector(".xc-amt")?.textContent).toContain("$84.50");
    expect(screen.getByText(/incl. \$7.68 GST/)).toBeInTheDocument();
    expect(screen.getByText("Dan Smith", { exact: false })).toBeInTheDocument();
  });

  /* A claim with no receipt is a judgement call, and the approver should know
     that's what they're making — silence would read as "receipt fine". */
  it("says out loud when a claim has no receipt", () => {
    render(
      <TeamExpenses claims={[claim({ id: "c1", status: "pending", receipts: [] })]} canApprove canPay />
    );
    expect(screen.getByText("No receipt")).toBeInTheDocument();
  });

  it("totals only what's still owed", () => {
    render(
      <TeamExpenses
        claims={[
          claim({ id: "c1", status: "pending", amount: 100 }),
          claim({ id: "c2", status: "approved", amount: 50 }),
          claim({ id: "c3", status: "reimbursed", amount: 999 }),
          claim({ id: "c4", status: "declined", amount: 777 }),
        ]}
        canApprove
        canPay
      />
    );
    // pending + approved; already paid and refused are not owed
    expect(screen.getByText("$150.00")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument(); // waiting on a decision
  });

  it("puts undecided claims at the top of the queue", () => {
    render(
      <TeamExpenses
        claims={[
          claim({ id: "old", status: "reimbursed", description: "Settled thing" }),
          claim({ id: "new", status: "pending", description: "Needs a decision" }),
        ]}
        canApprove
        canPay
      />
    );
    const rows = document.querySelectorAll(".xc-row b");
    expect(rows[0].textContent).toBe("Needs a decision");
  });

  it("says so plainly when there is nothing to review", () => {
    render(<TeamExpenses claims={[]} canApprove canPay />);
    expect(screen.getByText("No expense claims yet")).toBeInTheDocument();
  });
});
