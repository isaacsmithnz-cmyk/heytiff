import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyExpensesFace } from "../my-expenses-face";
import type { Claim } from "@/lib/expenses/claim";

/* THE CLAIMANT'S SCREEN: the lists of what was filed, what you are owed,
   cancelling, and the door to Claim an expense. The form itself, with every
   rule this screen's own form had, is tested where it lives now
   (components/making/__tests__/expense-form.test.tsx). */

const cancel = jest.fn(async (_id: string) => ({ ok: true }));
const refresh = jest.fn();
const formProps = jest.fn();

jest.mock("@/app/actions/expenses", () => ({
  cancelClaim: (id: string) => cancel(id),
}));
/* the form is its own suite's business: here, that the door opens it, on what */
jest.mock("@/components/making/expense-form", () => ({
  ExpenseForm: (p: { payer: string; onSaved: (paid: string) => void; onClose: () => void }) => {
    formProps(p);
    return (
      <div role="dialog" aria-label="Claim an expense">
        <button type="button" onClick={() => p.onSaved("company")}>
          Saved on the card
        </button>
      </div>
    );
  },
}));
const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const TODAY = "2026-08-05";

/** A claim, with only what a given test cares about spelled out. */
const claim = (over: Partial<Claim> = {}): Claim =>
  ({
    id: "c1",
    staffProfileId: "me",
    expenseDate: "2026-08-01",
    description: "Copper fittings",
    category: "materials",
    amount: 184.5,
    gstAmount: 16.77,
    supplier: "Reece",
    paidWith: "own",
    job: null,
    status: "pending",
    reviewNote: null,
    createdAt: "2026-08-01T00:00:00Z",
    receipts: [],
    ...over,
  }) as Claim;
const draw = () => render(<MyExpensesFace claims={[]} today={TODAY} />);

beforeEach(() => {
  cancel.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
  formProps.mockReset();
});

/* THE DOOR (rule 52): your name › Expense claims › Claim an expense. */
describe("the door", () => {
  it("opens Claim an expense over the screen, as your own money, with the open work", async () => {
    const user = userEvent.setup();
    const jobs = [{ kind: "visit" as const, id: "v1", clientName: "Northgate", label: "Service", jobNumber: "1042" }];
    render(<MyExpensesFace claims={[]} today={TODAY} jobs={jobs} />);
    const door = screen.getByRole("button", { name: "Claim an expense" });
    expect(door).toHaveClass("pt-btn--main");
    await user.click(door);
    expect(screen.getByRole("dialog", { name: "Claim an expense" })).toBeInTheDocument();
    expect(formProps).toHaveBeenLastCalledWith(expect.objectContaining({ payer: "own", today: TODAY, jobs }));
  });

  it("starts a card receipt on the company card, from the Company card face", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("tab", { name: /Company card/ }));
    await user.click(screen.getByRole("button", { name: "File a card receipt" }));
    expect(formProps).toHaveBeenLastCalledWith(expect.objectContaining({ payer: "company" }));
  });

  it("lands on the face what you filed lives on", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("button", { name: "Claim an expense" }));
    await user.click(screen.getByRole("button", { name: "Saved on the card" }));
    expect(screen.getByRole("tab", { name: /Company card/ })).toHaveAttribute("aria-selected", "true");
    expect(refresh).toHaveBeenCalled();
  });

  it("is not on Closed, which is history", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("tab", { name: /Closed/ }));
    expect(screen.queryByRole("button", { name: "Claim an expense" })).toBeNull();
  });
});

describe("provenance", () => {
  /* A claim raised by "Log fuel · my own money" is one the person never
     filled in. Without a line saying where it came from it reads as a
     mystery charge on their own claims list. */
  const fuelClaim = {
    id: "c-fuel",
    staffProfileId: "me",
    expenseDate: "2026-08-01",
    description: "Fuel — BP Kingsford",
    category: "fuel" as const,
    amount: 158.4,
    gstAmount: 14.4,
    supplier: "BP Kingsford",
    paidWith: "own" as const,
    job: null,
    status: "pending" as const,
    reviewNote: null,
    createdAt: "2026-08-01T00:00:00Z",
    fuelLog: { vehicleLogId: "log-1", vehicle: "Hilux" },
  };

  it("says a claim came from a fuel log, and names the vehicle", () => {
    render(<MyExpensesFace claims={[fuelClaim]} today={TODAY} />);
    expect(screen.getByText(/Raised from your fuel log, Hilux/)).toBeInTheDocument();
  });

  it("still says it when the vehicle has no name to show", () => {
    render(<MyExpensesFace claims={[{ ...fuelClaim, fuelLog: { vehicleLogId: "log-1", vehicle: null } }]} today={TODAY} />);
    expect(screen.getByText(/Raised from your fuel log/)).toBeInTheDocument();
  });

  it("says nothing on a claim somebody typed themselves", () => {
    render(<MyExpensesFace claims={[{ ...fuelClaim, fuelLog: null }]} today={TODAY} />);
    expect(screen.queryByText(/Raised from your fuel log/)).toBeNull();
  });
});

/* ---------------- the 2026-08 audit ---------------- */

describe("what the claimant is told", () => {
  /* THE FIGURE THE APPROVER ALWAYS HAD. `owedTotal` counts pending plus
     approved-but-unpaid, and it was on the review queue and the Time & Pay
     stat tile — every screen except the one belonging to the person who is
     out of pocket, who got a list and was left to add it up. */
  it("totals what it owes you, using the same helper the approver's screen uses", () => {
    const { container } = render(
      <MyExpensesFace
        today={TODAY}
        claims={[
          claim({ id: "a", amount: 184.5, status: "pending" }),
          claim({ id: "b", amount: 62, status: "approved" }),
          // already paid — not owed, so not counted
          claim({ id: "c", amount: 500, status: "reimbursed" }),
        ]}
      />,
    );
    const owed = container.querySelector(".xc-owed")!;
    expect(within(owed as HTMLElement).getByText("$246.50")).toBeInTheDocument();
  });

  it("says nothing when nothing is owed", () => {
    const { container } = render(
      <MyExpensesFace today={TODAY} claims={[claim({ status: "reimbursed" })]} />,
    );
    expect(container.querySelector(".xc-owed")).toBeNull();
  });

  /* The approver's row has always said "No receipt" and called it a judgement
     call. The claimant's row said nothing — so a person was told a docket is
     "what gets approved without a conversation" while filling the form, and
     never told again whether theirs had one. */
  it("says when a claim has no receipt, the way the review screen does", () => {
    render(<MyExpensesFace today={TODAY} claims={[claim({ receipts: [] })]} />);
    expect(screen.getByText("No receipt")).toBeInTheDocument();
  });

  it("drops the nag once the claim is settled", () => {
    // a reimbursed claim's missing docket is history, not a thing to chase
    render(<MyExpensesFace today={TODAY} claims={[claim({ status: "reimbursed", receipts: [] })]} />);
    expect(screen.queryByText("No receipt")).toBeNull();
  });

  it("links the receipt when there is one, instead", () => {
    render(
      <MyExpensesFace
        today={TODAY}
        claims={[claim({ receipts: [{ url: "https://x/r.jpg", image: true }] })]}
      />,
    );
    expect(screen.getByRole("link", { name: "Receipt" })).toBeInTheDocument();
    expect(screen.queryByText("No receipt")).toBeNull();
  });
});

describe("cancelling a claim", () => {
  /* ARMS BEFORE IT FIRES — the protocol My leave uses on its own Cancel, for
     the same reason. This discards a claim for money you are owed (an APPROVED
     one, at that) and strands the receipt with it. One press did it. */
  it("asks first, then goes through on the second press", async () => {
    const user = userEvent.setup();
    render(<MyExpensesFace today={TODAY} claims={[claim({ id: "c9", status: "pending" })]} />);

    await user.click(screen.getByRole("button", { name: /^Cancel / }));
    expect(cancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^Confirm cancelling/ }));
    expect(cancel).toHaveBeenCalledWith("c9");
  });
});

/* THE CARD'S TWO FACES. Answered claims — reimbursed, declined, cancelled —
   used to pad the one list forever; they live behind the Closed tab now, and
   the Claims tab counts only what is still moving. */
describe("the Claims / Closed split", () => {
  it("keeps open claims on Claims and answered ones behind Closed", async () => {
    const user = userEvent.setup();
    render(
      <MyExpensesFace
        today={TODAY}
        claims={[
          claim({ id: "open-1", description: "Brazing rods", status: "pending" }),
          claim({ id: "done-1", description: "Old drill", status: "reimbursed" }),
        ]}
      />,
    );

    expect(screen.getByText("Brazing rods")).toBeInTheDocument();
    expect(screen.queryByText("Old drill")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Closed/ }));
    expect(screen.getByText("Old drill")).toBeInTheDocument();
    expect(screen.queryByText("Brazing rods")).not.toBeInTheDocument();
    // the door is the working face's, not history's
    expect(screen.queryByRole("button", { name: "Claim an expense" })).not.toBeInTheDocument();
  });
});

/* THE PANEL SWAPS IN PLACE — no remount, no fade. `key={tab}` + `.psec2`
   rebuilt the claim list and faded it in on every switch; Team's directory
   just changes its children (Isaac, 2026-08-22). */
describe("the panel does not animate on a switch", () => {
  it("keeps the same panel node, with no fade class", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MyExpensesFace
        today={TODAY}
        claims={[claim({ id: "o1", status: "pending" }), claim({ id: "d1", status: "reimbursed" })]}
      />,
    );
    const panel = () => container.querySelector('[role="tabpanel"]');

    const before = panel();
    expect(before).not.toHaveClass("psec2");

    await user.click(screen.getByRole("tab", { name: /Closed/ }));
    expect(panel()).toBe(before);
    expect(panel()).not.toHaveClass("psec2");
  });
});

/* ── the company card ─────────────────────────────────────────────────────

   The screen was reimbursement-only: a staff member who bought a drill on the
   company card had nowhere to put the docket, and Xero would see a card
   transaction off the bank feed with no receipt, no description and no
   category against it (Isaac, 2026-08-23). What these pin is the half of that
   fix the screen owns — that the two kinds never mix, and that the button
   never says the wrong thing about what pressing it does. */

describe("company-card receipts", () => {
  const card = (over: Partial<Claim> = {}) =>
    claim({ id: "cc1", paidWith: "company", status: "recorded", description: "Makita drill", ...over });

  it("keeps card receipts off Claims and Closed entirely", async () => {
    const user = userEvent.setup();
    render(
      <MyExpensesFace
        today={TODAY}
        claims={[card(), claim({ id: "o1", status: "pending", description: "Copper fittings" })]}
      />,
    );
    // Claims is money you are owed — a filed docket is not that
    expect(screen.queryByText("Makita drill")).not.toBeInTheDocument();
    expect(screen.getByText("Copper fittings")).toBeInTheDocument();

    /* And NOT in Closed either. Closed is reimbursed / declined / cancelled —
       the pile you read when something went wrong — and nothing went wrong
       with a receipt somebody filed. */
    await user.click(screen.getByRole("tab", { name: /Closed/ }));
    expect(screen.queryByText("Makita drill")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Company card/ }));
    expect(screen.getByText("Makita drill")).toBeInTheDocument();
    expect(screen.queryByText("Copper fittings")).not.toBeInTheDocument();
  });

  /* THE OPEN COUNT IS PEOPLE WAITING ON MONEY. A card receipt is nobody
     waiting on anything, so it must not inflate the badge that says how many
     claims are still live. */
  it("does not count a card receipt as an open claim", () => {
    render(<MyExpensesFace today={TODAY} claims={[card(), card({ id: "cc2" })]} />);
    expect(screen.queryByRole("tab", { name: /Claims — / })).not.toBeInTheDocument();
  });
});

/* OWED IS A CLAIMS FACT. Over a list of company dockets it is a figure about
   somewhere else entirely — and the one thing that face has to say is that
   nobody owes anybody anything. */
it("keeps the owed figure off the company-card face", async () => {
  const user = userEvent.setup();
  render(
    <MyExpensesFace
      today={TODAY}
      claims={[
        claim({ id: "o1", status: "pending", amount: 184.5 }),
        claim({ id: "cc1", paidWith: "company", status: "recorded", amount: 289 }),
      ]}
    />,
  );
  expect(screen.getByText("Owed to you")).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: /Company card/ }));
  expect(screen.queryByText("Owed to you")).not.toBeInTheDocument();
});

/* ── which job ────────────────────────────────────────────────────────────

   A receipt for a job is a cost on that job, and the app knew it for the two
   seconds somebody was holding the docket. Optional, and it stays optional —
   a new drill is the van's, not Tuesday's. */

describe("a receipt on a job", () => {
  it("shows the job on a filed row, on both kinds", async () => {
    const user = userEvent.setup();
    render(
      <MyExpensesFace
        today={TODAY}
        claims={[
          claim({ id: "o1", status: "pending", job: { kind: "visit", id: "v1", label: "#1042, Northgate" } }),
          claim({
            id: "cc1",
            paidWith: "company",
            status: "recorded",
            description: "Makita drill",
            job: { kind: "project", id: "p1", label: "Acme, Plant room" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("#1042, Northgate")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Company card/ }));
    expect(screen.getByText("Acme, Plant room")).toBeInTheDocument();
  });
});
