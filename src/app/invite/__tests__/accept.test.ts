/**
 * @jest-environment node
 */

/* Accepting an invite — the path every real employee takes exactly once.

   The thing under test is that a staff card EXISTS by the time they land on
   /dashboard. `ensureStaffCard` runs in `beforeSessionSaved`, but this route
   finishes with `updateSession`, which writes the cookie directly and never
   runs that hook — and the sign-in before it returns early precisely BECAUSE an
   invite is pending. So nothing else creates the card until their next login,
   and until it exists `staffProfileIdFor` returns null, which silently refuses
   commenting, reacting, RSVPs, poll votes and every document upload, and leaves
   them out of the team list so they can't even be assigned a task.

   The real route and the real ensureStaffCard both run here; only the Auth0 SDK
   class and the Supabase client are stubbed. */

type Row = Record<string, unknown>;

const calls: { table: string; op: string; payload?: unknown }[] = [];

let inviteRow: Row | null = null;
let existingStaffCard: Row | null = null;
let sessionValue: Row | null = null;
let staffInsertFails = false;
/* Rows the LIST-style reads return (awaited builders, no .single()). The
   beforeSessionSaved hook looks for a membership and then a pending invite
   this way; the accept route uses .single() instead, so the two never collide. */
let listRows: Record<string, Row[]> = {};
/* What a guarded adopt UPDATE on staff_profiles returns — [] means the card
   was already claimed or gone, so the WHERE matched nothing. A non-empty
   result also becomes `existingStaffCard`, the mock's stand-in for the DB now
   holding user_id: ensureStaffCard's own lookup must FIND the adopted card,
   because not-inserting-after-adoption is the entire point under test. */
let adoptResult: Row[] = [];

/* Every .eq()/.is() with its arguments — the invitations row is stored
   lowercased and every adopt must carry its user_id-is-null guard, so WHAT a
   query filters on is part of what these tests have to see. (.is records as
   "is:col" so a guard can't be satisfied by a mere .eq.) */
const eqCalls: { table: string; col: string; val: unknown }[] = [];

const table = (name: string) => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  let op: "read" | "update" = "read";
  chain.eq = (col: string, val: unknown) => {
    eqCalls.push({ table: name, col, val });
    return chain;
  };
  chain.is = (col: string, val: unknown) => {
    eqCalls.push({ table: name, col: `is:${col}`, val });
    return chain;
  };
  chain.not = self;
  chain.gt = self;
  chain.limit = self;
  chain.order = self;
  chain.select = self;
  chain.single = async () => ({
    data: name === "invitations" ? inviteRow : null,
    error: name === "invitations" && !inviteRow ? { message: "not found" } : null,
  });
  chain.maybeSingle = async () => ({
    data: name === "staff_profiles" ? existingStaffCard : null,
    error: null,
  });
  chain.upsert = async (payload: unknown) => {
    calls.push({ table: name, op: "upsert", payload });
    return { error: null };
  };
  /* insert() is awaited directly in most places but chained as
     .insert().select().single() when a generated id is needed, so it has to be
     both a promise and a builder. */
  chain.insert = (payload: unknown) => {
    calls.push({ table: name, op: "insert", payload });
    if (name === "staff_profiles" && staffInsertFails) throw new Error("insert blew up");
    const result = { data: { id: `${name}-new-id` }, error: null };
    return {
      select: () => ({ single: async () => result, maybeSingle: async () => result }),
      then: (res: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(res),
    };
  };
  chain.update = (payload: unknown) => {
    op = "update";
    calls.push({ table: name, op: "update", payload });
    // simulate persistence: a successful adopt means the (org, user) lookup
    // that ensureStaffCard runs next will find this card
    if (name === "staff_profiles" && (payload as Row).user_id && adoptResult.length) {
      existingStaffCard = adoptResult[0];
    }
    return chain;
  };
  chain.then = (res: (v: { data: unknown; error: null }) => unknown) =>
    Promise.resolve({
      data: op === "update" ? (name === "staff_profiles" ? adoptResult : []) : (listRows[name] ?? []),
      error: null,
    }).then(res);
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (n: string) => table(n) },
}));

/* `var`, not `const`: jest hoists the mock factory (and the imports below it)
   above these declarations, and lib/auth0.ts constructs the client at import
   time — a `const` would still be in its temporal dead zone by then. */
// eslint-disable-next-line no-var
var updateSessionSpy = jest.fn(async () => {});
// eslint-disable-next-line no-var
var capturedOptions: Record<string, unknown>;

/* A stand-in for the SDK client. Constructing it is what lib/auth0.ts does at
   import time; capturing the options lets the last describe block below call
   the real beforeSessionSaved hook. */
jest.mock("@auth0/nextjs-auth0/server", () => ({
  Auth0Client: class {
    constructor(opts: Record<string, unknown>) {
      capturedOptions = opts;
    }
    // method bodies, so nothing is dereferenced until it is actually called
    async getSession() {
      return sessionValue;
    }
    async updateSession(...args: unknown[]) {
      return updateSessionSpy(...(args as []));
    }
  },
}));

import { GET } from "../accept/route";
import { NextRequest } from "next/server";

const ORG = "11111111-1111-1111-1111-111111111111";
const USER = "auth0|new-hire";
const EMAIL = "newhire@example.com";

const validInvite = (over: Row = {}): Row => ({
  id: "inv-1",
  org_id: ORG,
  email: EMAIL,
  role: "staff",
  token: "tok-1",
  accepted_at: null,
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  ...over,
});

const req = (token = "tok-1") =>
  new NextRequest(`https://app.test/invite/accept?token=${token}`);

const staffInserts = () => calls.filter((c) => c.table === "staff_profiles" && c.op === "insert");

beforeEach(() => {
  calls.length = 0;
  eqCalls.length = 0;
  updateSessionSpy.mockClear();
  inviteRow = validInvite();
  existingStaffCard = null;
  staffInsertFails = false;
  listRows = {};
  adoptResult = [];
  sessionValue = { user: { sub: USER, email: EMAIL, name: "Sam Rivers" } };
});

const staffAdopts = () =>
  calls.filter(
    (c) => c.table === "staff_profiles" && c.op === "update" && (c.payload as Row).user_id === USER,
  );

describe("accepting an invite seats a staff card", () => {
  it("creates one for a brand-new member", async () => {
    const res = await GET(req());

    expect(staffInserts()).toHaveLength(1);
    const row = staffInserts()[0].payload as Row;
    expect(row.org_id).toBe(ORG);
    expect(row.user_id).toBe(USER);
    // the Auth0 `name` claim is split best-effort so the card isn't blank
    expect(row.first_name).toBe("Sam");
    expect(row.last_name).toBe("Rivers");

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/dashboard");
  });

  it("seats the card in the SAME request, not on a later login", () => {
    // the whole point of the fix: the membership and the card are written
    // together, so nothing depends on the member signing in a second time
    return GET(req()).then(() => {
      const order = calls.map((c) => `${c.table}.${c.op}`);
      expect(order).toContain("memberships.upsert");
      expect(order).toContain("staff_profiles.insert");
      expect(order.indexOf("staff_profiles.insert")).toBeGreaterThan(
        order.indexOf("memberships.upsert"),
      );
    });
  });

  it("does not duplicate a card the member already has", async () => {
    existingStaffCard = { id: "existing-card" };
    await GET(req());
    expect(staffInserts()).toHaveLength(0);
  });

  it("falls back to the email local-part when Auth0 sends no name", async () => {
    sessionValue = { user: { sub: USER, email: EMAIL } };
    await GET(req());
    expect((staffInserts()[0].payload as Row).full_name).toBe("newhire");
  });

  it("still lands them on the dashboard if seating the card fails", async () => {
    // best-effort by design: a staff-card failure must not strand someone
    // holding a valid invite on an error page. It logs, which is the point —
    // silenced here so an expected error doesn't read as a broken test run.
    const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
    staffInsertFails = true;
    const res = await GET(req());
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
    expect(res.headers.get("location")).toBe("https://app.test/dashboard");
  });
});

/* The claim path: a card imported from ServiceM8/Xero (or pre-seeded by hand)
   waits with user_id null, and accepting the invite binds the login to THAT
   card. The one wrong outcome in every scenario below is the same one: a
   second card for a human who already has one. */
describe("claiming a pre-seeded card", () => {
  it("adopts the card the invite names instead of minting a duplicate", async () => {
    inviteRow = validInvite({ staff_profile_id: "card-7" });
    adoptResult = [{ id: "card-7" }];

    const res = await GET(req());

    expect(staffAdopts()).toHaveLength(1);
    expect(eqCalls).toContainEqual({ table: "staff_profiles", col: "id", val: "card-7" });
    // the write itself carries the only-unclaimed guard — not just the read
    expect(eqCalls).toContainEqual({ table: "staff_profiles", col: "is:user_id", val: null });
    expect(staffInserts()).toHaveLength(0);
    expect(res.headers.get("location")).toBe("https://app.test/dashboard");
  });

  it("falls back to a fresh card when the named card is claimed or gone", async () => {
    // deleted card → FK set the pointer null before we ever got here; claimed
    // card → the guarded update matches nothing. Same degrade either way.
    inviteRow = validInvite({ staff_profile_id: "card-7" });
    adoptResult = [];

    await GET(req());

    expect(staffInserts()).toHaveLength(1);
  });

  it("adopts the one unclaimed card holding the invite's address, whatever its casing", async () => {
    // no staff_profile_id on the invite — the address is the only clue, and
    // contact_email was typed by a human, so the comparison must normalise
    listRows = { staff_profiles: [{ id: "card-9", contact_email: "NewHire@Example.com" }] };
    adoptResult = [{ id: "card-9" }];

    await GET(req());

    expect(staffAdopts()).toHaveLength(1);
    expect(eqCalls).toContainEqual({ table: "staff_profiles", col: "id", val: "card-9" });
    expect(staffInserts()).toHaveLength(0);
  });

  it("refuses to guess between two unclaimed cards sharing the address", async () => {
    listRows = {
      staff_profiles: [
        { id: "card-9", contact_email: EMAIL },
        { id: "card-10", contact_email: EMAIL },
      ],
    };

    await GET(req());

    // both stay visible for an admin to untangle; the new arrival gets a
    // fresh card rather than somebody else's
    expect(staffAdopts()).toHaveLength(0);
    expect(staffInserts()).toHaveLength(1);
  });

  it("never adopts for someone who already has a card here", async () => {
    existingStaffCard = { id: "their-existing-card" };
    inviteRow = validInvite({ staff_profile_id: "card-7" });
    adoptResult = [{ id: "card-7" }];

    await GET(req());

    expect(staffAdopts()).toHaveLength(0);
    expect(staffInserts()).toHaveLength(0);
  });
});

describe("the guards still hold", () => {
  it("sends an unauthenticated visitor to log in, preserving the token", async () => {
    sessionValue = null;
    const res = await GET(req());
    expect(res.headers.get("location")).toContain("/auth/login?returnTo=");
    expect(res.headers.get("location")).toContain("invite%2Faccept%3Ftoken%3Dtok-1");
    expect(staffInserts()).toHaveLength(0);
  });

  it("refuses an invite addressed to somebody else — and seats nothing", async () => {
    sessionValue = { user: { sub: USER, email: "someone.else@example.com" } };
    const res = await GET(req());
    expect(res.headers.get("location")).toContain("/invite/error");
    expect(calls.filter((c) => c.table === "memberships")).toHaveLength(0);
    expect(staffInserts()).toHaveLength(0);
  });

  it("accepts when only the letter-case differs — Auth0 relays the IdP's casing", async () => {
    // the row is stored lowercased (createInvite normalises on write); Google
    // and Microsoft connections hand back whatever casing the account holds
    sessionValue = { user: { sub: USER, email: "NewHire@Example.com", name: "Sam Rivers" } };
    const res = await GET(req());
    expect(calls.filter((c) => c.table === "memberships" && c.op === "upsert")).toHaveLength(1);
    expect(staffInserts()).toHaveLength(1);
    expect(res.headers.get("location")).toBe("https://app.test/dashboard");
  });

  it("refuses an already-accepted invite", async () => {
    inviteRow = validInvite({ accepted_at: new Date().toISOString() });
    const res = await GET(req());
    expect(res.headers.get("location")).toContain("/invite/error");
    expect(staffInserts()).toHaveLength(0);
  });

  it("refuses an expired invite", async () => {
    inviteRow = validInvite({ expires_at: new Date(Date.now() - 1000).toISOString() });
    const res = await GET(req());
    expect(res.headers.get("location")).toContain("/invite/error");
    expect(staffInserts()).toHaveLength(0);
  });

  it("marks the invite used, so the link is single-shot", async () => {
    await GET(req());
    const used = calls.find((c) => c.table === "invitations" && c.op === "update");
    expect((used?.payload as Row)?.accepted_at).toEqual(expect.any(String));
  });
});

/* The reason the route has to do this at all: updateSession does NOT run the
   beforeSessionSaved hook, and the sign-in that precedes an accept leaves an
   invitee with nothing — no org, no membership, no staff card.

   THAT EMPTINESS IS THE POINT NOW. The hook used to found a company for
   anybody arriving without a membership, and only a pending-invitation lookup
   held it back for invitees; sign up before the invite existed and there was
   nothing to find. Signing in mints nothing at all today (lib/auth0.ts, and
   lib/__tests__/auth0-signup.test.ts pins it), so the accept route is the only
   thing that can seat this person's card — which is exactly what it does. */
describe("why the hook cannot be relied on here", () => {
  it("beforeSessionSaved seats no card for someone with no membership", async () => {
    const hook = capturedOptions.beforeSessionSaved as (
      s: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
    expect(typeof hook).toBe("function");

    // no membership: the session comes back with no orgId and no staff card,
    // whether or not an invitation is waiting for this address
    listRows = { memberships: [], invitations: [{ id: "inv-1" }] };
    calls.length = 0;
    const out = await hook({ user: { sub: USER, email: EMAIL } });

    expect(out.orgId).toBeUndefined();
    expect(staffInserts()).toHaveLength(0);
  });
});
