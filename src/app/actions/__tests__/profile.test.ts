/* The security-relevant half of the save action: which sections it will accept
   at all, and whether a rejected one ever reaches the database. */

const update = jest.fn().mockReturnValue({
  eq: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
});
const maybeSingle = jest
  .fn()
  .mockResolvedValue({ data: { id: "p1", first_name: "Jordan", last_name: "Mills" }, error: null });
const select = jest.fn().mockReturnValue({
  eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle }) }),
});
const from = jest.fn().mockReturnValue({ select, update });

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (...a: unknown[]) => from(...a) } }));
jest.mock("@/lib/auth0", () => ({
  auth0: {
    getSession: jest.fn().mockResolvedValue({
      user: { sub: "auth0|1", email: "a@b.co", name: "A B" },
      orgId: "org-1",
      orgRole: "staff",
    }),
  },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { saveMyProfileSection } from "../profile";

beforeEach(() => {
  update.mockClear();
  from.mockClear();
});

describe("saveMyProfileSection — section guard", () => {
  it.each(["payroll", "permissions", "notes"])(
    "refuses the admin-only section %s",
    async (section) => {
      const res = await saveMyProfileSection(section, { hourly_wage: "999" });
      expect(res).toEqual({ ok: false, error: "That section can't be edited here." });
      expect(update).not.toHaveBeenCalled();
    }
  );

  it("refuses an invented section without touching the database", async () => {
    const res = await saveMyProfileSection("__proto__", { first_name: "x" });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("accepts a legitimate section", async () => {
    const res = await saveMyProfileSection("personal", {
      first_name: "Jordan",
      last_name: "Mills",
    });
    expect(res).toEqual({ ok: true });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({
      first_name: "Jordan",
      last_name: "Mills",
      // derived, never submitted by the form
      full_name: "Jordan Mills",
    });
  });

  it("keeps the surname when only the first name is submitted", async () => {
    // the stored card supplies the half the patch doesn't carry, so a partial
    // save can't quietly truncate someone's name
    const res = await saveMyProfileSection("personal", { first_name: "Jordan" });
    expect(res).toEqual({ ok: true });
    expect(update.mock.calls[0][0]).toMatchObject({ full_name: "Jordan Mills" });
  });

  it("strips payroll columns from an otherwise valid section", async () => {
    await saveMyProfileSection("personal", {
      first_name: "Jordan",
      hourly_wage: "999",
      notes: "sneaky",
    });
    const patch = update.mock.calls[0][0];
    expect(patch).not.toHaveProperty("hourly_wage");
    expect(patch).not.toHaveProperty("notes");
  });

  it("rejects a bad date before writing, and names the field", async () => {
    const res = await saveMyProfileSection("personal", { birthday: "31/02/1990" });
    // `fields` carries buildPatch's own `invalid` list so the card can ring
    // the input rather than only printing a sentence above itself
    expect(res).toEqual({
      ok: false,
      error: "Check the date format — use dd/mm/yyyy.",
      fields: ["birthday"],
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("no-ops when nothing allowed survives", async () => {
    const res = await saveMyProfileSection("emergency", { first_name: "wrong section" });
    expect(res).toEqual({ ok: true });
    expect(update).not.toHaveBeenCalled();
  });

  it("always stamps updated_at", async () => {
    await saveMyProfileSection("personal", { first_name: "Jordan" });
    expect(update.mock.calls[0][0]).toHaveProperty("updated_at");
  });
});
