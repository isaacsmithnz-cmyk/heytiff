/* The staff photo actions — which verify the DOCUMENT rather than trusting the
   id they were handed.

   A Server Function is reachable by direct POST, so "the picker only offered
   your own upload" is not a control. Everything below is a way of pointing a
   staff card at a file it should not be able to reach, and every one of them
   has to come back refused. */

const update = jest.fn();

let docRow: Record<string, unknown> | null = null;
let updateError: { message: string } | null = null;
let target: Record<string, unknown> | null = null;

const from = jest.fn((table: string) => {
  const chain: Record<string, unknown> = {};
  chain.eq = () => chain;
  chain.select = () => chain;
  chain.maybeSingle = async () => ({
    data: table === "documents" ? docRow : target,
    error: null,
  });
  chain.update = (patch: Record<string, unknown>) => {
    update(patch, table);
    return { eq: () => ({ eq: () => Promise.resolve({ error: updateError }) }) };
  };
  return chain;
});

let caps = new Set<string>(["team"]);

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (...a: unknown[]) => from(...(a as [string])) },
}));
jest.mock("@/lib/auth0", () => ({
  auth0: {
    getSession: jest.fn().mockResolvedValue({ user: { sub: "auth0|admin" }, orgId: "org-1" }),
  },
}));
jest.mock("@/lib/permissions-server", () => ({
  getCapabilities: jest.fn(() => Promise.resolve(caps)),
  getOwnership: jest.fn(() =>
    Promise.resolve({ role: "owner", userId: "auth0|admin", primaryOwnerUserId: "auth0|admin" })
  ),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
// staff.ts pulls the drift sweep, which pulls xero-node's ESM — nothing these
// actions touch, so it is stubbed rather than transformed
jest.mock("@/lib/integrations/drift-sweep", () => ({ clearDrift: jest.fn() }));

import { clearStaffPhoto, setStaffPhoto } from "../staff";

const REF = "org/org-1/staff_photo/doc-1.jpg";
const good = { kind: "staff_photo", storage_ref: REF, uploaded_at: "2026-08-04T00:00:00Z" };

beforeEach(() => {
  update.mockClear();
  from.mockClear();
  caps = new Set(["team"]);
  updateError = null;
  docRow = { ...good };
  target = { id: "staff-1", user_id: "auth0|dane", role: "staff", permissions: null };
});

describe("setStaffPhoto", () => {
  it("points the card at a confirmed staff_photo from this org", async () => {
    expect(await setStaffPhoto("staff-1", "doc-1")).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ photo_url: REF }),
      "staff_profiles"
    );
  });

  it("refuses a document that isn't a photo", async () => {
    docRow = { ...good, kind: "receipt" };
    expect(await setStaffPhoto("staff-1", "doc-1")).toMatchObject({ ok: false });
    expect(update).not.toHaveBeenCalled();
  });

  /* An unconfirmed row is a slot that was handed out and never filled. Pointing
     at it would put a broken image on the card and keep it there. */
  it("refuses an upload that never finished", async () => {
    docRow = { ...good, uploaded_at: null };
    expect(await setStaffPhoto("staff-1", "doc-1")).toMatchObject({ ok: false });
    expect(update).not.toHaveBeenCalled();
  });

  /* The path itself carries the org. Without this check a confirmed
     `staff_photo` belonging to another business could be pointed at by id. */
  it("refuses a ref that belongs to another org", async () => {
    docRow = { ...good, storage_ref: "org/org-2/staff_photo/doc-1.jpg" };
    expect(await setStaffPhoto("staff-1", "doc-1")).toMatchObject({ ok: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a document id that resolves to nothing", async () => {
    docRow = null;
    expect(await setStaffPhoto("staff-1", "doc-1")).toMatchObject({ ok: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("needs the team capability, whatever the UI rendered", async () => {
    caps = new Set();
    expect(await setStaffPhoto("staff-1", "doc-1")).toMatchObject({ ok: false });
    expect(update).not.toHaveBeenCalled();
  });

  /* targetIn() resolves the person INSIDE the caller's org, so an id from
     another business is indistinguishable from one that doesn't exist. */
  it("refuses a staff id outside the caller's org", async () => {
    target = null;
    expect(await setStaffPhoto("staff-1", "doc-1")).toMatchObject({ ok: false });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("clearStaffPhoto", () => {
  it("nulls the column", async () => {
    expect(await clearStaffPhoto("staff-1")).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ photo_url: null }),
      "staff_profiles"
    );
  });

  it("still needs the team capability", async () => {
    caps = new Set();
    expect(await clearStaffPhoto("staff-1")).toMatchObject({ ok: false });
    expect(update).not.toHaveBeenCalled();
  });
});
