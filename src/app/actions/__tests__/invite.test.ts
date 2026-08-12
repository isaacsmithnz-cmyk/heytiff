/* Invite actions — the two-tier gate (may they invite AT ALL, and at THIS
   role), org scoping on every write, and the accepted-invite protections. */

import { CAPABILITIES, type Capability } from "@/lib/permissions";

type Call = { table: string; op: string; payload?: Record<string, unknown>; filters: Record<string, unknown> };

const calls: Call[] = [];
/** what a select on `invitations` finds — null = no such row for this org */
let inviteRow: { id: string; accepted_at: string | null } | null = { id: "inv-1", accepted_at: null };
/** what createInvite's duplicate check finds — [] = no open invite for the address yet */
let openInvites: Record<string, unknown>[] = [];
/** what a card-claiming invite's staff_profiles lookup finds — null = not ours / gone */
let staffCardRow: { id: string; user_id: string | null } | null = null;
/** open invites already holding the card — the one-per-card twin of openInvites */
let cardOpenInvites: Record<string, unknown>[] = [];

let role: string | null = "owner";
let caps: Set<Capability> = new Set(CAPABILITIES);
let session: unknown = { orgId: "org-1", user: { sub: "auth0|boss" } };

const table = (name: string) => {
  const call: Call = { table: name, op: "select", filters: {} };
  const c: Record<string, unknown> = {};
  const chain = () => c;
  c.eq = (k: string, v: unknown) => {
    call.filters[k] = v;
    return chain();
  };
  c.is = (k: string, v: unknown) => {
    call.filters[k] = v;
    return chain();
  };
  c.select = () => chain();
  c.limit = () => chain();
  c.insert = (row: Record<string, unknown>) => {
    call.op = "insert";
    call.payload = row;
    calls.push(call);
    return Promise.resolve({ error: null });
  };
  c.update = (row: Record<string, unknown>) => {
    call.op = "update";
    call.payload = row;
    calls.push(call);
    return chain();
  };
  c.delete = () => {
    call.op = "delete";
    calls.push(call);
    return chain();
  };
  c.maybeSingle = () =>
    name === "staff_profiles"
      ? Promise.resolve({ data: staffCardRow, error: null })
      : Promise.resolve({ data: inviteRow, error: inviteRow ? null : { message: "no rows" } });
  /* Awaiting the chain resolves it: a still-`select` chain is a LIST read
     (a duplicate check), recorded so its filters can be asserted; anything
     else (delete/update, already recorded) resolves like a write. The two
     invitations duplicate checks are told apart by what they filtered on. */
  c.then = (res: (v: { data?: unknown; error: null }) => unknown) => {
    if (call.op === "select") {
      calls.push(call);
      const rows =
        name !== "invitations" ? []
        : call.filters.staff_profile_id !== undefined ? cardOpenInvites
        : openInvites;
      return Promise.resolve({ data: rows, error: null }).then(res);
    }
    return Promise.resolve({ error: null }).then(res);
  };
  return c;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: jest.fn(async () => session) } }));
jest.mock("@/lib/permissions-server", () => ({
  getDbRole: jest.fn(async () => role),
  getCapabilities: jest.fn(async () => caps),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { createInvite, renewInvite, revokeInvite } from "../invite";

const DAY = 86_400_000;
/* The action keeps its window private — a "use server" module may only export
   async functions — so it is restated here, matching the DB default on
   invitations.expires_at (now() + '7 days'). */
const INVITE_WINDOW_DAYS = 7;
const writes = (op: string) => calls.filter((c) => c.op === op);
const payloadOf = (c: Call): Record<string, string> => (c.payload ?? {}) as Record<string, string>;

beforeEach(() => {
  calls.length = 0;
  inviteRow = { id: "inv-1", accepted_at: null };
  openInvites = [];
  staffCardRow = null;
  cardOpenInvites = [];
  role = "owner";
  caps = new Set(CAPABILITIES);
  session = { orgId: "org-1", user: { sub: "auth0|boss" } };
});

describe("createInvite — who may invite, and at what role", () => {
  it("refuses a staff member with no `invites` capability", async () => {
    role = "staff";
    caps = new Set(["toolbox"] as Capability[]);
    const res = await createInvite({ email: "new@heytiff.co", role: "staff" });
    expect(res.ok).toBe(false);
    expect(writes("insert")).toHaveLength(0);
  });

  it("lets an `invites` holder create a staff invite", async () => {
    role = "admin";
    caps = new Set(["invites"] as Capability[]);
    expect((await createInvite({ email: "new@heytiff.co", role: "staff" })).ok).toBe(true);
    expect(payloadOf(writes("insert")[0])).toMatchObject({ role: "staff", org_id: "org-1" });
  });

  it("refuses an `invites` holder asking for admin — that's a role assignment", async () => {
    role = "admin";
    caps = new Set(["invites"] as Capability[]);
    const res = await createInvite({ email: "new@heytiff.co", role: "admin" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/role/i);
    expect(writes("insert")).toHaveLength(0);
  });

  it("lets the owner create an admin invite", async () => {
    expect((await createInvite({ email: "boss2@heytiff.co", role: "admin" })).ok).toBe(true);
    expect(payloadOf(writes("insert")[0])).toMatchObject({ role: "admin" });
  });

  it("refuses owner as a role — the DB check says admin|staff", async () => {
    const res = await createInvite({ email: "new@heytiff.co", role: "owner" });
    expect(res.ok).toBe(false);
    expect(writes("insert")).toHaveLength(0);
  });

  it("validates the email and normalises it", async () => {
    expect((await createInvite({ email: "not-an-email", role: "staff" })).ok).toBe(false);
    expect(writes("insert")).toHaveLength(0);

    expect((await createInvite({ email: "  New@Heytiff.co ", role: "staff" })).ok).toBe(true);
    expect(payloadOf(writes("insert")[0])).toMatchObject({ email: "new@heytiff.co" });
  });

  it("refuses a second open invite for the same address", async () => {
    openInvites = [{ id: "inv-existing" }];
    const res = await createInvite({ email: "New@Heytiff.co", role: "staff" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/pending invite/i);
    expect(writes("insert")).toHaveLength(0);
  });

  it("scopes the duplicate check to the org and the normalised address", async () => {
    // lowercased on the read as well as the write, or Re-inviting `New@…`
    // would sail straight past the open invite for `new@…`
    await createInvite({ email: "  New@Heytiff.co ", role: "staff" });
    const check = calls.find((c) => c.table === "invitations" && c.op === "select");
    expect(check?.filters).toMatchObject({
      org_id: "org-1",
      email: "new@heytiff.co",
      accepted_at: null,
    });
    expect(writes("insert")).toHaveLength(1);
  });

  it("stamps the org, the inviter and a window of its own", async () => {
    await createInvite({ email: "new@heytiff.co", role: "staff" });
    const payload = payloadOf(writes("insert")[0]);
    expect(payload.org_id).toBe("org-1");
    expect(payload.invited_by).toBe("auth0|boss");
    const ahead = new Date(payload.expires_at).getTime() - Date.now();
    expect(ahead).toBeGreaterThan((INVITE_WINDOW_DAYS - 0.1) * DAY);
    expect(ahead).toBeLessThanOrEqual(INVITE_WINDOW_DAYS * DAY);
  });

  it("refuses when there's no session at all", async () => {
    session = null;
    expect((await createInvite({ email: "new@heytiff.co", role: "staff" })).ok).toBe(false);
    expect(writes("insert")).toHaveLength(0);
  });
});

/* Card-claiming invites — the bridge from an imported/pre-seeded card to a
   real login. The card must be this org's and still unclaimed, and a card can
   hold at most one open invite, mirroring the per-address rule. */
describe("createInvite — claiming a staff card", () => {
  it("stamps the card on the invite row", async () => {
    staffCardRow = { id: "card-1", user_id: null };
    const res = await createInvite({
      email: "new@heytiff.co",
      role: "staff",
      staffProfileId: "card-1",
    });
    expect(res.ok).toBe(true);
    expect(payloadOf(writes("insert")[0]).staff_profile_id).toBe("card-1");
  });

  it("a plain invite's payload carries no card key at all", async () => {
    await createInvite({ email: "new@heytiff.co", role: "staff" });
    expect("staff_profile_id" in payloadOf(writes("insert")[0])).toBe(false);
  });

  it("refuses a card that is gone — or another org's, which reads the same", async () => {
    staffCardRow = null;
    const res = await createInvite({
      email: "new@heytiff.co",
      role: "staff",
      staffProfileId: "card-elsewhere",
    });
    expect(res.ok).toBe(false);
    expect(writes("insert")).toHaveLength(0);
  });

  it("refuses a claimed card — they already have an account", async () => {
    staffCardRow = { id: "card-1", user_id: "auth0|already-here" };
    const res = await createInvite({
      email: "new@heytiff.co",
      role: "staff",
      staffProfileId: "card-1",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/already have an account/i);
    expect(writes("insert")).toHaveLength(0);
  });

  it("refuses a second open invite for the same card", async () => {
    staffCardRow = { id: "card-1", user_id: null };
    cardOpenInvites = [{ id: "inv-9" }];
    const res = await createInvite({
      email: "another.address@heytiff.co",
      role: "staff",
      staffProfileId: "card-1",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/pending invite/i);
    expect(writes("insert")).toHaveLength(0);
  });
});

describe("revokeInvite", () => {
  it("refuses someone without the capability", async () => {
    role = "staff";
    caps = new Set(["toolbox"] as Capability[]);
    expect((await revokeInvite("inv-1")).ok).toBe(false);
    expect(writes("delete")).toHaveLength(0);
  });

  it("refuses an invitation that has already been accepted", async () => {
    inviteRow = { id: "inv-1", accepted_at: "2026-07-01T00:00:00Z" };
    const res = await revokeInvite("inv-1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/accepted/i);
    expect(writes("delete")).toHaveLength(0);
  });

  it("refuses an id that isn't this org's", async () => {
    inviteRow = null; // the org-scoped read finds nothing
    expect((await revokeInvite("someone-elses")).ok).toBe(false);
    expect(writes("delete")).toHaveLength(0);
  });

  it("deletes the row, scoped to the org and still unaccepted", async () => {
    expect((await revokeInvite("inv-1")).ok).toBe(true);
    const del = writes("delete")[0];
    expect(del.table).toBe("invitations");
    expect(del.filters).toMatchObject({ org_id: "org-1", id: "inv-1", accepted_at: null });
  });
});

describe("renewInvite", () => {
  it("refuses someone without the capability", async () => {
    role = "staff";
    caps = new Set(["toolbox"] as Capability[]);
    expect((await renewInvite("inv-1")).ok).toBe(false);
    expect(writes("update")).toHaveLength(0);
  });

  it("refuses an accepted invitation", async () => {
    inviteRow = { id: "inv-1", accepted_at: "2026-07-01T00:00:00Z" };
    expect((await renewInvite("inv-1")).ok).toBe(false);
    expect(writes("update")).toHaveLength(0);
  });

  it("pushes expiry out by the same window a new invite gets, org-scoped", async () => {
    expect((await renewInvite("inv-1")).ok).toBe(true);
    const up = writes("update")[0];
    expect(up.filters).toMatchObject({ org_id: "org-1", id: "inv-1", accepted_at: null });
    const ahead = new Date(payloadOf(up).expires_at).getTime() - Date.now();
    expect(ahead).toBeGreaterThan((INVITE_WINDOW_DAYS - 0.1) * DAY);
    expect(ahead).toBeLessThanOrEqual(INVITE_WINDOW_DAYS * DAY);
  });
});
