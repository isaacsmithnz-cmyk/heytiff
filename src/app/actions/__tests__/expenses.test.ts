/* Expense-claim actions. Own-tier is ungated but hard-scoped to the caller;
   review needs `approvals` and never your own claim; reimbursing needs
   `financials`; and every status change goes through the transition table so
   "already decided" and "already paid" are refusals, not overwrites. */

const insert = jest.fn();
const update = jest.fn();

let claimRow: Record<string, unknown> | null = { status: "pending", staff_profile_id: "someone-else" };
let caps = new Set<string>(["approvals", "financials"]);
let myStaffId: string | null = "me";
/** candidate receipt documents the adoption select finds */
let documentRows: { id: string; expense_claim_id: string | null }[] = [];
/** the caller's declined/cancelled claims the freeing lookup finds */
let deadClaimRows: { id: string }[] = [];
/** the row `resolveJobLink` finds when it looks a job up — null = not in this
    org, which has to stop the submit rather than silently drop the job */
let jobRow: Record<string, unknown> | null = null;

const table = (name: string) => {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.eq = self;
  c.is = self;
  c.not = self;
  c.in = self;
  c.select = self;
  c.order = self;
  c.maybeSingle = async () => ({
    data:
      name === "projects" || name === "maintenance_agreements" || name === "maintenance_visits"
        ? jobRow
        : claimRow,
  });
  c.insert = (row: unknown) => {
    insert(name, row);
    return { select: () => ({ maybeSingle: async () => ({ data: { id: "new-claim" }, error: null }) }) };
  };
  c.update = (row: unknown) => {
    update(name, row);
    return c;
  };
  c.then = (res: (v: { error: null; data: unknown[] }) => unknown) =>
    Promise.resolve({
      error: null,
      data: name === "documents" ? documentRows : name === "expense_claims" ? deadClaimRows : [],
    }).then(res);
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
  documentRows = [{ id: "doc-1", expense_claim_id: null }];
  deadClaimRows = [];
  jobRow = null;
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

  /* The audit: a declined claim stranded its receipt forever — the photo was
     bound to the dead claim, so fixing a typo meant re-photographing the
     docket. The evidence follows the live attempt; a LIVE claim's receipt
     stays exactly where it is. */
  it("frees a receipt from the caller's own dead claim", async () => {
    documentRows = [{ id: "doc-1", expense_claim_id: "old-declined" }];
    deadClaimRows = [{ id: "old-declined" }];
    await submitClaim({ ...goodClaim, documentIds: ["doc-1"] });
    expect(update).toHaveBeenCalledWith("documents", { expense_claim_id: "new-claim" });
  });

  it("never steals a receipt from a live claim", async () => {
    documentRows = [{ id: "doc-1", expense_claim_id: "still-pending" }];
    deadClaimRows = []; // that claim is not declined/cancelled
    await submitClaim({ ...goodClaim, documentIds: ["doc-1"] });
    expect(update).not.toHaveBeenCalledWith("documents", expect.anything());
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

/* ── the company card ─────────────────────────────────────────────────────

   A card receipt is born `recorded`, and `recorded` has no edge to `approved`
   or `reimbursed` in the transition table. That is deliberately the ONLY thing
   standing between an approver and paying somebody back for the company's own
   money — neither `decide()` nor `markReimbursed()` knows `paidWith` exists,
   because two screens each remembering to check it is two chances to forget.
   These pin the refusal at the layer that actually enforces it. */

describe("a company-card receipt", () => {
  it("is inserted as recorded, not pending", async () => {
    await submitClaim({
      expenseDate: "2026-07-20",
      description: "Makita drill",
      category: "tools",
      amount: 289,
      paidWith: "company",
    });
    expect(insert).toHaveBeenCalledWith(
      "expense_claims",
      expect.objectContaining({ paid_with: "company", status: "recorded" }),
    );
  });

  it("cannot be approved, declined or reimbursed by anybody", async () => {
    claimRow = { status: "recorded", staff_profile_id: "someone-else" };
    caps = new Set(["approvals", "financials"]);

    expect(await approveClaim("c1")).toEqual({
      ok: false,
      error: "That claim has already been decided.",
    });
    expect(await declineClaim("c1", "not ours")).toEqual({
      ok: false,
      error: "That claim has already been decided.",
    });
    expect(await markReimbursed("c1")).toEqual({
      ok: false,
      error: "That claim isn't approved and awaiting payment.",
    });
    expect(update).not.toHaveBeenCalled();
  });

  /* …but the person who filed it can withdraw it. A docket entered against the
     wrong purchase would otherwise be permanent — nothing else in this app can
     remove one. */
  it("can be cancelled by the person who filed it", async () => {
    claimRow = { status: "recorded", staff_profile_id: "me" };
    expect(await cancelClaim("c1")).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(
      "expense_claims",
      expect.objectContaining({ status: "cancelled" }),
    );
  });
});

/* ── which job, resolved on the server ────────────────────────────────────

   The browser sends a kind and an id, and both are claims about somebody
   else's data until a row in THIS org proves otherwise. The LABEL is never
   taken from the request either: it is printed on a screen for as long as the
   receipt exists, so a caller who could set it could write anything into
   somebody's expense list. */

describe("attaching a receipt to a job", () => {
  const filed = () => ({
    expenseDate: "2026-07-20",
    description: "Copper fittings",
    category: "materials",
    amount: 84.5,
  });

  it("builds the label from the row it finds, not from the request", async () => {
    jobRow = { id: "p1", name: "Plant room", client_name: "Acme Industrial" };
    await submitClaim({ ...filed(), job: { kind: "project", id: "p1" } });
    expect(insert).toHaveBeenCalledWith(
      "expense_claims",
      expect.objectContaining({
        job_kind: "project",
        job_id: "p1",
        job_label: "Acme Industrial · Plant room",
      }),
    );
  });

  /* AND IT STOPS THE SUBMIT. Stripping the job out and filing the receipt
     anyway would look to the person exactly like it had worked. */
  it("refuses an id that isn't in this workspace", async () => {
    jobRow = null;
    expect(await submitClaim({ ...filed(), job: { kind: "project", id: "someone-elses" } })).toEqual(
      { ok: false, error: "That job isn't in this workspace." },
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses a kind it doesn't know", async () => {
    expect(await submitClaim({ ...filed(), job: { kind: "invoice", id: "x1" } })).toEqual({
      ok: false,
      error: "Pick the job again.",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("files against no job when none is picked", async () => {
    await submitClaim(filed());
    expect(insert).toHaveBeenCalledWith(
      "expense_claims",
      expect.objectContaining({ job_kind: "none", job_id: null, job_label: null }),
    );
  });
});
