/* Public-holiday actions. Admin+ only; entries are source=manual, and
   removal is provenance-aware: manual rows delete, auto/synced rows become
   suppressed tombstones the sync must never resurrect. */

const upsert = jest.fn().mockResolvedValue({ error: null });
const del = jest.fn().mockResolvedValue({ error: null });
const update = jest.fn().mockResolvedValue({ error: null });

let role = "admin";
/** What the removeHoliday pre-read finds: a source string, or null for gone. */
let rowSource: string | null = "manual";

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
  c.update = (patch: unknown) => {
    update(patch);
    return c;
  };
  c.select = () => c;
  c.maybeSingle = () =>
    Promise.resolve({ data: rowSource === null ? null : { source: rowSource }, error: null });
  c.then = (res: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(res);
  return c;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: () => table() } }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn().mockResolvedValue({ orgId: "org-1" }) },
}));
jest.mock("@/lib/permissions-server", () => ({ getDbRole: jest.fn(async () => role) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { addHoliday, removeHoliday, restoreHoliday } from "../holidays";

beforeEach(() => {
  upsert.mockClear();
  del.mockClear();
  update.mockClear();
  role = "admin";
  rowSource = "manual";
});

describe("addHoliday", () => {
  it("refuses a staff member", async () => {
    role = "staff";
    expect((await addHoliday({ state: "NSW", date: "2026-12-25", name: "Christmas Day" })).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("lets an admin add one, always tagged manual and un-suppressed", async () => {
    expect((await addHoliday({ state: "NSW", date: "2026-12-25", name: "Christmas Day" })).ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: "org-1",
        state: "NSW",
        holiday_date: "2026-12-25",
        source: "manual",
        // on conflict this un-tombstones a previously removed day
        suppressed: false,
      }),
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
    expect(update).not.toHaveBeenCalled();
  });

  it("hard-deletes a manual row", async () => {
    rowSource = "manual";
    expect((await removeHoliday("h1")).ok).toBe(true);
    expect(del).toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("tombstones an auto row instead of deleting it", async () => {
    rowSource = "auto";
    expect((await removeHoliday("h1")).ok).toBe(true);
    expect(del).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ suppressed: true });
  });

  it("tombstones a synced row too — a sync would just re-create it", async () => {
    rowSource = "xero";
    expect((await removeHoliday("h1")).ok).toBe(true);
    expect(del).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ suppressed: true });
  });

  it("reports a row that no longer exists", async () => {
    rowSource = null;
    expect((await removeHoliday("h1")).ok).toBe(false);
    expect(del).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("restoreHoliday", () => {
  it("refuses a non-admin", async () => {
    role = "staff";
    expect((await restoreHoliday("h1")).ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("un-tombstones for an admin", async () => {
    expect((await restoreHoliday("h1")).ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ suppressed: false });
  });
});
