/**
 * @jest-environment node
 */

/* The no-card row's actions, re-decided on the server: a Server Function is
   reachable by direct POST, so "the button wasn't rendered" guards nothing. */

type Row = Record<string, unknown>;

let seat: Row | null = null;
let card: Row | null = null;
let caps = new Set<string>(["team"]);
let actor = { role: "owner" as string | null, userId: "auth0|owner", primaryOwnerUserId: "auth0|owner" };
const deletes: { table: string; eq: [string, unknown][] }[] = [];
let rpcAnswer: { data: unknown; error: unknown } = { data: "deleted", error: null };
const rpcCalls: [string, unknown][] = [];
const ensureStaffCard = jest.fn(async () => {
  card = { id: "card-new" };
});

jest.mock("next/cache", () => ({ revalidatePath: () => {} }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: async () => ({ orgId: "org-1", user: { sub: actor.userId } }) },
  ensureStaffCard: (...a: unknown[]) => ensureStaffCard(...(a as [])),
}));
jest.mock("@/lib/permissions-server", () => ({
  can: async (c: string) => caps.has(c),
  getOwnership: async () => actor,
}));
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push([name, args]);
      return rpcAnswer;
    },
    from: (table: string) => {
      const eq: [string, unknown][] = [];
      let op = "read";
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (c: string, v: unknown) => {
        eq.push([c, v]);
        return chain;
      };
      chain.delete = () => {
        op = "delete";
        return chain;
      };
      chain.maybeSingle = async () => ({
        data:
          table === "memberships" ? seat
          : table === "staff_profiles" ? card
          : table === "profiles" ? { email: "isaacsmithnz@gmail.com", name: "isaacsmithnz@gmail.com", picture: null }
          : null,
        error: null,
      });
      chain.then = (res: (v: { error: null }) => unknown) => {
        if (op === "delete") deletes.push({ table, eq });
        return Promise.resolve({ error: null }).then(res);
      };
      return chain;
    },
  },
}));

import { createCardForMember, deleteStaffCard, removeMemberWithoutCard } from "../members";

const ORPHAN = "auth0|orphan";

beforeEach(() => {
  seat = { role: "staff" };
  card = null;
  caps = new Set(["team"]);
  actor = { role: "owner", userId: "auth0|owner", primaryOwnerUserId: "auth0|owner" };
  deletes.length = 0;
  rpcCalls.length = 0;
  rpcAnswer = { data: "deleted", error: null };
  ensureStaffCard.mockClear();
});

describe("Create card", () => {
  it("makes the card by the sign-in door, with what the profile knows", async () => {
    expect(await createCardForMember(ORPHAN)).toEqual({ ok: true });
    expect(ensureStaffCard).toHaveBeenCalledWith("org-1", ORPHAN, {
      user: { email: "isaacsmithnz@gmail.com", name: "isaacsmithnz@gmail.com", picture: undefined },
    });
  });

  it("refuses without the team capability", async () => {
    caps = new Set();
    expect(await createCardForMember(ORPHAN)).toMatchObject({ ok: false });
    expect(ensureStaffCard).not.toHaveBeenCalled();
  });

  it("refuses somebody who is not in this workspace", async () => {
    seat = null;
    expect(await createCardForMember(ORPHAN)).toMatchObject({ ok: false });
    expect(ensureStaffCard).not.toHaveBeenCalled();
  });

  // ensureStaffCard swallows its own failure; the button must not claim a card
  it("reports a card that did not appear", async () => {
    ensureStaffCard.mockImplementationOnce(async () => {});
    expect(await createCardForMember(ORPHAN)).toEqual({ ok: false, error: "Couldn't create the card." });
  });
});

describe("Remove", () => {
  it("takes back the seat of a member with no card", async () => {
    expect(await removeMemberWithoutCard(ORPHAN)).toEqual({ ok: true });
    expect(deletes).toEqual([
      { table: "memberships", eq: [["org_id", "org-1"], ["user_id", ORPHAN]] },
    ]);
  });

  it("is an owner's act — an admin with team access cannot", async () => {
    actor = { ...actor, role: "admin", userId: "auth0|admin" };
    expect(await removeMemberWithoutCard(ORPHAN)).toMatchObject({ ok: false });
    expect(deletes).toEqual([]);
  });

  it("never removes the caller", async () => {
    expect(await removeMemberWithoutCard("auth0|owner")).toMatchObject({ ok: false });
    expect(deletes).toEqual([]);
  });

  it("never removes an owner", async () => {
    seat = { role: "owner" };
    expect(await removeMemberWithoutCard(ORPHAN)).toMatchObject({ ok: false });
    expect(deletes).toEqual([]);
  });

  // a card means history; the way out for them is Deactivate
  it("refuses once they have a card", async () => {
    card = { id: "card-1" };
    expect(await removeMemberWithoutCard(ORPHAN)).toMatchObject({ ok: false });
    expect(deletes).toEqual([]);
  });
});

/* Delete: the database decides and does it (delete_staff_card, one
   transaction). What this action owns is who may ask, and saying the answer. */
describe("Delete a card with no records", () => {
  beforeEach(() => {
    card = { user_id: "auth0|test" };
  });

  it("asks the database to delete that card in this org", async () => {
    expect(await deleteStaffCard("card-test")).toEqual({ ok: true });
    expect(rpcCalls).toEqual([["delete_staff_card", { p_org: "org-1", p_staff: "card-test" }]]);
  });

  it("is an owner's act", async () => {
    actor = { ...actor, role: "admin", userId: "auth0|admin" };
    expect(await deleteStaffCard("card-test")).toMatchObject({ ok: false });
    expect(rpcCalls).toEqual([]);
  });

  it("never deletes your own card", async () => {
    card = { user_id: "auth0|owner" };
    expect(await deleteStaffCard("card-mine")).toEqual({ ok: false, error: "You can't delete your own card." });
    expect(rpcCalls).toEqual([]);
  });

  it.each([
    ["in_use", "They have records here now. Deactivate them instead."],
    ["owner", "Owners can't be deleted."],
    ["not_found", "That staff member is already gone."],
  ])("says what the database said: %s", async (answer, error) => {
    rpcAnswer = { data: answer, error: null };
    expect(await deleteStaffCard("card-test")).toEqual({ ok: false, error });
  });

  it("reports a failed call rather than a deletion", async () => {
    rpcAnswer = { data: null, error: { message: "boom" } };
    expect(await deleteStaffCard("card-test")).toEqual({ ok: false, error: "Couldn't delete them." });
  });
});
