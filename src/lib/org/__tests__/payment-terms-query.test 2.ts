/* orgPaymentTermsDays — the read that finally puts a due date on a ServiceM8
   claim.

   What is worth pinning is all about ABSENCE. This number decides whether the
   money block calls somebody late, and it comes from one nullable column that
   most workspaces will never fill in. Every way the read can come back empty
   — no row, no value, an error — has to land on the same silence, because the
   alternative is a screen inventing a fortnight and dating an overdue chip
   against it. */

const maybeSingle = jest.fn();

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
  },
}));
jest.mock("@/lib/documents/query", () => ({ signOne: jest.fn() }));

import { orgPaymentTermsDays } from "../query";

beforeEach(() => maybeSingle.mockReset());

it("reads the organisation's own number", async () => {
  maybeSingle.mockResolvedValue({ data: { payment_terms_days: 14 } });
  expect(await orgPaymentTermsDays("org-1")).toBe(14);
});

it("keeps 0 — due on receipt is the strictest terms there are, not an absence", async () => {
  /* The derivation asks `termsDays !== null`, so a zero that leaked back as
     null would silently turn "pay me today" into "no terms at all". */
  maybeSingle.mockResolvedValue({ data: { payment_terms_days: 0 } });
  expect(await orgPaymentTermsDays("org-1")).toBe(0);
});

it("answers null every way the read can come back empty", async () => {
  for (const data of [null, {}, { payment_terms_days: null }]) {
    maybeSingle.mockResolvedValue({ data });
    expect(await orgPaymentTermsDays("org-1")).toBeNull();
  }
});

it("answers null on a failed read rather than guessing", async () => {
  maybeSingle.mockResolvedValue({ data: null, error: { message: "nope" } });
  expect(await orgPaymentTermsDays("org-1")).toBeNull();
});
