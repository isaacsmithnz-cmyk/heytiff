/* Expense-claim actions. Own-tier is ungated but hard-scoped to the caller;
   review needs `approvals` and never your own claim; reimbursing needs
   `financials`; and every status change goes through the transition table so
   "already decided" and "already paid" are refusals, not overwrites. */

const insert = jest.fn();
const update = jest.fn();

let claimRow: Record<string, unknown> | null = { status: "pending", staff_profile_id: "someone-else" };
let caps = new Set<string>(["approvals", "financials"]);
let myStaffId: string | null = "me";

const table = (name: string) => {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.eq = self;
  c.is = self;
  c.not = self;
  c.in = self;
  c.select = self;
  c.order = self;
  c.maybeSingle = async () => ({ data: claimRow });
  c.insert = (row: unknown) => {
    insert(name, row);
    return { select: () => ({ maybeSingle: async () => ({ data: { id: "new-claim" }, error: null }) }) };
  };
  c.update = (row: unknown) => {
    update(name, row);
    return c;
  };
  c.then = (res: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(res);
  return c;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn().mockResolvedValue({ user: { sub: "auth0|me" }, orgId: "org-1" }) },
}));
jest.mock("@/lib/permissions-server", () => ({ can: jest.fn(async (c: string) => caps.has(c)) }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => myStaffId) }));
jest.mock("@/lib/au-dates", () => ({
  ...jest.requireActual("@/lib/au-dates"),
  todayInAu: () => "2026-07-26",
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import {
  approveClaim,
  cancelClaim,
  declineClaim,
  markReimbursed,
  submitClaim,
} from "../expenses";

const goodClaim = {
  expenseDate: "2026-07-20",
  description: "Copper fittings",
  category: "materials",
  amount: 84.5,
};

beforeEach(() => {
  insert.mockClear();
  update.mockClear();
  claimRow = { status: "pending", staff_profile_id: "someone-else" };
  caps = new Set(["approvals", "financials"]);
  myStaffId = "me";
});

describe("submitClaim", () => {
  it("writes the claim against the caller's own staff row", async () => {
    expect(await submitClaim(goodClaim)).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith(
      "expense_claims",
      expect.objectContaining({ org_id: "org-1", staff_profile_id: "me", amount: 84.5 })
    );
  });

  /* The form applies these too, but the form is a courtesy. */
  it("re-checks the rules the form already checked", async () => {
    expect(await submitClaim({ ...goodClaim, amount: 0 })).toMatchObject({ ok: false });
    expect(await submitClaim({ ...goodClaim, expenseDate: "2030-01-01" })).toMatchObject({ ok: false });
    expect(await submitClaim({ ...goodClaim, category: "beer" })).toMatchObject({ ok: false });
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses when the account has no staff card", async () => {
    myStaffId = null;
    expect(await submitClaim(goodClaim)).toMatchObject({ ok: false });
    expect(insert).not.toHaveBeenCalled();
  });

  it("adopts the receipts it was given", async () => {
    await submitClaim({ ...goodClaim, documentIds: ["doc-1"] });
    expect(update).toHaveBeenCalledWith("documents", { expense_claim_id: "new-claim" });
  });

  it("doesn't touch documents when there's no receipt", async () => {
    await submitClaim(goodClaim);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("cancelClaim", () => {
  it("withdraws an undecided claim", async () => {
    claimRow = { status: "pending", staff_profile_id: "me" };
    expect(await cancelClaim("c1")).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith("expense_claims", expect.objectContaining({ status: "cancelled" }));
  });

  it("won't withdraw one that's already been decided", async () => {
    claimRow = { status: "approved", staff_profile_id: "me" };
    expect(await cancelClaim("c1")).toMatchObject({ ok: false });
    expect(update).not.toHaveBeenCalled();
  });

  /* The read is scoped to the caller's own rows too, so a stranger's id
     resolves to nothing rather than to a refusal that confirms it exists. */
  it("can't reach a claim that isn't yours", async () => {
    claimRow = null;
    expect(await cancelClaim("someone-elses")).toEqual({ ok: false, error: "That claim isn't yours." });
  });
});

describe("approve / decline", () => {
  it("approves somebody else's pending claim", async () => {
    expect(await approveClaim("c1")).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(
      "expense_claims",
      expect.objectContaining({ status: "approved", reviewed_by: "me" })
    );
  });

  it("needs the approvals capability", async () => {
    caps = new Set(["financials"]);
    expect(await approveClaim("c1")).toEqual({ ok: false, error: "You can't approve expenses." });
    expect(update).not.toHaveBeenCalled();
  });

  /* The rule that holds across timesheets, leave and now expenses. */
  it("refuses to let anyone review their own claim", async () => {
    claimRow = { status: "pending", staff_profile_id: "me" };
    expect(await approveClaim("c1")).toEqual({
      ok: false,
      error: "You can't review your own expense claim.",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("won't re-decide a decided claim", async () => {
    claimRow = { status: "approved", staff_profile_id: "someone-else" };
    expect(await approveClaim("c1")).toMatchObject({ ok: false });
    expect(await declineClaim("c1", "wrong receipt")).toMatchObject({ ok: false });
  });

  /* Somebody is out of pocket and being told no. "Declined" alone is not an
     answer they can act on. */
  it("insists on a reason for declining", async () => {
    expect(await declineClaim("c1", "   ")).toMatchObject({
      ok: false,
      error: expect.stringContaining("reason"),
    });
    expect(update).not.toHaveBeenCalled();

    expect(await declineClaim("c1", "Personal purchase")).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(
      "expense_claims",
      expect.objectContaining({ status: "declined", review_note: "Personal purchase" })
    );
  });
});

describe("markReimbursed", () => {
  it("records payment on an approved claim", async () => {
    claimRow = { status: "approved", staff_profile_id: "someone-else" };
    expect(await markReimbursed("c1")).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(
      "expense_claims",
      expect.objectContaining({ status: "reimbursed", reimbursed_by: "me" })
    );
  });

  /* Approving says the spend was legitimate; this says money moved. A manager
     with `approvals` but not `financials` must not be able to do the second. */
  it("needs financials, not just approvals", async () => {
    claimRow = { status: "approved", staff_profile_id: "someone-else" };
    caps = new Set(["approvals"]);
    expect(await markReimbursed("c1")).toEqual({
      ok: false,
      error: "You can't record reimbursements.",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("won't pay a claim nobody approved", async () => {
    claimRow = { status: "pending", staff_profile_id: "someone-else" };
    expect(await markReimbursed("c1")).toMatchObject({ ok: false });
    expect(update).not.toHaveBeenCalled();
  });

  /* Paying twice is real money leaving the business twice. */
  it("won't pay the same claim again", async () => {
    claimRow = { status: "reimbursed", staff_profile_id: "someone-else" };
    expect(await markReimbursed("c1")).toMatchObject({ ok: false });
    expect(update).not.toHaveBeenCalled();
  });
});
