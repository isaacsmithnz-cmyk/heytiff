/* orgSetupPending — the one-column read Home's gate pivots on. The soft-fail
   DIRECTION is the whole test: this runs for every owner on every visit to
   Home, and the column arrives by migration, so an error must mean "stay out
   of the way", never "redirect everyone to setup". */

const maybeSingle = jest.fn();

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
  },
}));
jest.mock("@/lib/documents/query", () => ({
  signOne: jest.fn(),
}));

import { orgSetupPending } from "../query";

beforeEach(() => {
  maybeSingle.mockReset();
});

it("is pending while the stamp is null — a fresh org's state", async () => {
  maybeSingle.mockResolvedValue({ data: { setup_completed_at: null }, error: null });
  expect(await orgSetupPending("org-1")).toBe(true);
});

it("is settled once stamped, finished or skipped alike", async () => {
  maybeSingle.mockResolvedValue({
    data: { setup_completed_at: "2026-08-22T00:00:00Z" },
    error: null,
  });
  expect(await orgSetupPending("org-1")).toBe(false);
});

/* Code deployed ahead of docs/migrations/org_setup_completed.sql errors on
   the missing column. That must read as "nothing pending" or every live
   owner gets bounced into a wizard for a company that is already set up. */
it("reads an errored select as nothing pending", async () => {
  maybeSingle.mockResolvedValue({
    data: null,
    error: { message: 'column organizations.setup_completed_at does not exist' },
  });
  expect(await orgSetupPending("org-1")).toBe(false);
});

it("reads a missing row as nothing pending", async () => {
  maybeSingle.mockResolvedValue({ data: null, error: null });
  expect(await orgSetupPending("org-gone")).toBe(false);
});
