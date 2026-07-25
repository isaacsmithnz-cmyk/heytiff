/* Invite actions — the two-tier gate (may they invite AT ALL, and at THIS
   role), org scoping on every write, and the accepted-invite protections. */

import { CAPABILITIES, type Capability } from "@/lib/permissions";

type Call = { table: string; op: string; payload?: Record<string, unknown>; filters: Record<string, unknown> };

const calls: Call[] = [];
/** what a select on `invitations` finds — null = no such row for this org */
let inviteRow: { id: string; accepted_at: string | null } | null = { id: "inv-1", accepted_at: null };

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
    Promise.resolve({ data: inviteRow, error: inviteRow ? null : { message: "no rows" } });
  // awaiting the chain itself (delete/update) resolves like a write
  c.then = (res: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(res);
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
