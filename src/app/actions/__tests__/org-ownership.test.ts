/* transferOwnership — the one master-only write in the app.

   THE GATE IS THE POINT. Every other write on the Organisation screen is
   owner-intrinsic and a co-owner shares it; this one is the definition of the
   difference, and a Server Function is reachable by direct POST — so a
   co-owner's call has to be refused here, not merely un-rendered.

   The transactional half lives in the RPC (docs/migrations/
   transfer_org_ownership.sql). What this file pins about it is the CONTRACT:
   the three arguments it is given, and that each named exception comes back as
   a sentence rather than as raw Postgres. */

const rpc = jest.fn();
let master = true;

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { rpc: (...a: unknown[]) => rpc(...a) },
}));
jest.mock("@/lib/auth0", () => ({
  auth0: {
    getSession: jest.fn().mockResolvedValue({
      user: { sub: "auth0|master" },
      orgId: "org-1",
    }),
  },
}));
jest.mock("@/lib/permissions-server", () => ({
  isMaster: jest.fn(() => Promise.resolve(master)),
}));
const revalidatePath = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import { transferOwnership } from "../org-ownership";

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ error: null });
  revalidatePath.mockClear();
  master = true;
});

describe("the gate", () => {
  it("hands over for the master owner, naming org, actor and target", async () => {
    const res = await transferOwnership("auth0|second");

    expect(res).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("transfer_org_ownership", {
      p_org_id: "org-1",
      p_actor_user_id: "auth0|master",
      p_new_owner_user_id: "auth0|second",
    });
  });

  /* A CO-OWNER IS A FULL OWNER EVERYWHERE ELSE on this screen — they edit the
     ABN, the address and the licences. Not this. */
  it("refuses a co-owner, and never reaches the database", async () => {
    master = false;
    const res = await transferOwnership("auth0|second");

    expect(res).toEqual({
      ok: false,
      error: "Only the account owner can hand the account over.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses handing it to yourself before asking the database", async () => {
    const res = await transferOwnership("auth0|master");

    expect(res).toEqual({ ok: false, error: "You already hold the account." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an empty target", async () => {
    const res = await transferOwnership("   ");
    expect(res).toEqual({ ok: false, error: "Choose who the account goes to." });
    expect(rpc).not.toHaveBeenCalled();
  });
});

/* The RPC raises named exceptions and Postgres puts the name in the message.
   Each one has to arrive as something a person can act on — "not_a_member" is
   not an error message, it is a symptom. */
describe("what the database refuses", () => {
  const said = async (raised: string) => {
    rpc.mockResolvedValue({ error: { message: `... raise exception ${raised} ...` } });
    const res = await transferOwnership("auth0|second");
    return res.ok ? null : res.error;
  };

  it("translates a target who has never signed in", async () => {
    expect(await said("not_a_member")).toBe(
      "They haven't signed in yet, so the account can't be put in their name."
    );
  });

  /* The actor check inside the transaction is a CONCURRENCY guard: two people
     cannot both be master, so two transfers cannot fork the org. Reaching it
     means the master changed under this request. */
  it("translates losing the master seat mid-request", async () => {
    expect(await said("not_master")).toBe("Only the account owner can hand the account over.");
  });

  it("translates a target who already holds it", async () => {
    expect(await said("already_master")).toBe("They already hold the account.");
  });

  /* An unrecognised failure must NOT be dressed up as one of the four — a
     constraint nobody predicted should read as "that didn't go through", not as
     a confident wrong diagnosis. */
  it("does not guess at an error it doesn't know", async () => {
    expect(await said("deadlock detected")).toBe("That didn't go through.");
  });

  it("leaves both screens alone when nothing moved", async () => {
    await said("not_a_member");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

/* The new owner's powers come from memberships, read per request — so they do
   not need to sign out. What IS stale is any page already rendered naming the
   old owner: Organisation itself, and Team, which draws the master's padlock. */
it("revalidates both screens that name the owner", async () => {
  await transferOwnership("auth0|second");
  expect(revalidatePath).toHaveBeenCalledWith("/dashboard/admin/organization");
  expect(revalidatePath).toHaveBeenCalledWith("/dashboard/team");
});
