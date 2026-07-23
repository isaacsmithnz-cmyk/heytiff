/* Public-holiday actions. Admin+ only, and everything entered is source=manual. */

const upsert = jest.fn().mockResolvedValue({ error: null });
const del = jest.fn().mockResolvedValue({ error: null });

let role = "admin";

const table = () => {
  const c: Record<string, unknown> = {};
  c.eq = () => c;
  c.upsert = (row: unknown) => {
    upsert(row);
    return Promise.resolve({ error: null });
  };
  c.delete = () => {
    del();
    return c;
  };
  c.then = (res: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(res);
  return c;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: () => table() } }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn().mockResolvedValue({ orgId: "org-1" }) },
}));
jest.mock("@/lib/permissions-server", () => ({ getDbRole: jest.fn(async () => role) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { addHoliday, removeHoliday } from "../holidays";

beforeEach(() => {
  upsert.mockClear();
  del.mockClear();
  role = "admin";
});

describe("addHoliday", () => {
  it("refuses a staff member", async () => {
    role = "staff";
    expect((await addHoliday({ state: "NSW", date: "2026-12-25", name: "Christmas Day" })).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("lets an admin add one, always tagged manual", async () => {
    expect((await addHoliday({ state: "NSW", date: "2026-12-25", name: "Christmas Day" })).ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: "org-1", state: "NSW", holiday_date: "2026-12-25", source: "manual" }),
    );
  });

  it("validates state, date and name", async () => {
    expect((await addHoliday({ state: "XX", date: "2026-12-25", name: "x" })).ok).toBe(false);
    expect((await addHoliday({ state: "NSW", date: "25/12/2026", name: "x" })).ok).toBe(false);
    expect((await addHoliday({ state: "NSW", date: "2026-12-25", name: "  " })).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("removeHoliday", () => {
  it("refuses a non-admin", async () => {
    role = "staff";
    expect((await removeHoliday("h1")).ok).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });

  it("removes for an admin", async () => {
    expect((await removeHoliday("h1")).ok).toBe(true);
    expect(del).toHaveBeenCalled();
  });
});
