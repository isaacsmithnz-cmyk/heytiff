/* ensureStaffCard seeds the new card's holiday state from the organisation.
   Without the seed a fresh hire has state NULL, and every holiday consumer
   that reads the raw column would resolve them zero public holidays — the
   audit's "Christmas Day materialises as a worked day" finding. */

const inserted: Record<string, unknown>[] = [];
let staffRow: { id: string } | null = null;
let orgRow: { state: string | null } | null = { state: "QLD" };

function builder(name: string) {
  const b: Record<string, unknown> = {};
  const self = () => b;
  b.select = self;
  b.eq = self;
  b.maybeSingle = async () =>
    name === "staff_profiles" ? { data: staffRow } : { data: orgRow };
  b.insert = async (row: Record<string, unknown>) => {
    inserted.push(row);
    return { error: null };
  };
  return b;
}

jest.mock("@auth0/nextjs-auth0/server", () => ({
  Auth0Client: class {
    constructor(_cfg: unknown) {}
  },
}));
jest.mock("../supabase-server", () => ({
  supabaseAdmin: { from: (n: string) => builder(n) },
}));

import { ensureStaffCard } from "../auth0";

const session = { user: { name: "Jordan Mills", email: "jm@example.com", picture: null } };

beforeEach(() => {
  inserted.length = 0;
  staffRow = null;
  orgRow = { state: "QLD" };
});

describe("ensureStaffCard", () => {
  it("seeds the holiday state from the organisation", async () => {
    await ensureStaffCard("org-1", "auth0|new", session);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].state).toBe("QLD");
  });

  it("seeds null when the organisation has no state yet", async () => {
    orgRow = { state: null };
    await ensureStaffCard("org-1", "auth0|new", session);
    expect(inserted[0].state).toBeNull();
  });

  it("does nothing when the card already exists", async () => {
    staffRow = { id: "existing" };
    await ensureStaffCard("org-1", "auth0|new", session);
    expect(inserted).toHaveLength(0);
  });
});
