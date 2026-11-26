/**
 * @jest-environment node
 */

/* The phone's first door (bug 101). An invitation is matched on an address
   Auth0 has VERIFIED, joined only under that same address, and setting up a
   business never makes a second one. The tables are a stand-in. */

import { generateKeyPairSync, sign } from "node:crypto";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const rpc = jest.fn();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      let isNull: string | null = null;
      const rows = () =>
        (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v) && (isNull ? r[isNull] == null : true));
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push([c, v]), q),
        is: (c: string) => ((isNull = c), q),
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => res({ data: rows(), error: null }),
      };
      return q;
    },
  },
}));
const accept = jest.fn(async () => "staff");
jest.mock("@/lib/invite-accept", () => ({ acceptInvitation: (...a: unknown[]) => accept(...(a as [])) }));
const ensureStaffCard = jest.fn(async () => undefined);
jest.mock("@/lib/auth0", () => ({ ensureStaffCard: (...a: unknown[]) => ensureStaffCard(...(a as [])) }));
jest.mock("@/lib/integrations/auth0-management", () => ({ sendVerificationEmail: async () => ({ ok: true, value: true }) }));
const push = jest.fn(async () => 1);
jest.mock("../push", () => ({ pushToStaff: (...a: unknown[]) => push(...(a as [])) }));

import { requireMobileIdentity, type MobileIdentity } from "../identity";
import { askForNewInvite, joinInvite, readStart, startBusiness } from "../start";
import { MOBILE_AUDIENCE } from "../token";

const DOMAIN = "tenant.example.auth0.com";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const NOW = 1_800_000_000;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: NOW + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const keyFor = async (kid: string) => (kid === "k1" ? publicKey : null);
const userinfo = (body: Record<string, unknown>) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;

const sam: MobileIdentity = { userId: "auth0|sam", email: "sam@example.com", shownEmail: "sam@example.com", name: null };
const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  jest.clearAllMocks();
  tables.memberships = [];
  tables.organizations = [{ id: "org-demo", trading_name: "Demo Air Conditioning" }];
  tables.staff_profiles = [{ id: "card-jordan", org_id: "org-demo", user_id: "auth0|jordan", full_name: "Jordan Lee" }];
  tables.invitations = [
    { id: "inv-1", org_id: "org-demo", email: "sam@example.com", role: "staff", name: "Sam Carter", accepted_at: null, expires_at: future, created_at: "2026-11-24T00:00:00Z", invited_by: "auth0|jordan" },
  ];
});
afterAll(() => {
  process.env = env;
});

describe("who the phone is", () => {
  const call = (fetcher: typeof fetch) =>
    requireMobileIdentity(new Request("https://x/api/mobile/start", { headers: { authorization: `Bearer ${mint("auth0|sam")}` } }), { keyFor, now: NOW, fetcher });

  test("a verified address is the one invitations are matched on", async () => {
    expect(await call(userinfo({ sub: "auth0|sam", email: "Sam@Example.com", email_verified: true }))).toEqual({
      userId: "auth0|sam",
      email: "sam@example.com",
      shownEmail: "sam@example.com",
      name: null,
    });
  });

  test("an address Auth0 hasn't verified matches nothing", async () => {
    const who = await call(userinfo({ sub: "auth0|sam", email: "sam@example.com", email_verified: false }));
    expect(who).toMatchObject({ email: null, shownEmail: "sam@example.com" });
  });

  test("a /userinfo for someone else is refused", async () => {
    const r = await call(userinfo({ sub: "auth0|other", email: "sam@example.com", email_verified: true }));
    expect(r instanceof Response && r.status).toBe(503);
  });
});

describe("what's waiting", () => {
  test("an invitation, named: the business, who asked, and the role's words", async () => {
    expect(await readStart(sam)).toEqual({
      kind: "invite",
      id: "inv-1",
      company: "Demo Air Conditioning",
      role: "Staff",
      roleBlurb: "Field worker, their own records only",
      inviter: "Jordan Lee",
      invitedOn: "2026-11-24T00:00:00Z",
    });
  });

  test("one that ran out says so", async () => {
    tables.invitations[0].expires_at = past;
    expect(await readStart(sam)).toMatchObject({ kind: "expired", id: "inv-1", inviter: "Jordan Lee" });
  });

  test("an unverified address is asked to confirm, not told nothing is waiting", async () => {
    expect(await readStart({ ...sam, email: null })).toEqual({ kind: "confirm" });
  });

  test("someone already in a workspace is a member", async () => {
    tables.memberships = [{ user_id: "auth0|sam", org_id: "org-demo" }];
    expect(await readStart(sam)).toEqual({ kind: "member" });
  });
});

describe("the presses", () => {
  test("Join accepts this person's own invitation", async () => {
    expect(await joinInvite(sam, "inv-1")).toEqual({ ok: true });
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({ id: "inv-1" }), "auth0|sam", expect.anything());
  });

  test("an invitation to another address can't be joined by its id", async () => {
    const r = await joinInvite({ ...sam, userId: "auth0|eve", email: "eve@example.com" }, "inv-1");
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(accept).not.toHaveBeenCalled();
  });

  test("a run-out invitation isn't joined", async () => {
    tables.invitations[0].expires_at = past;
    expect(await joinInvite(sam, "inv-1")).toMatchObject({ ok: false, status: 410 });
  });

  test("setting up a business makes one, and its owner's card", async () => {
    rpc.mockResolvedValue({ data: "org-new", error: null });
    expect(await startBusiness(sam)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("create_org_for_owner", { p_user_id: "auth0|sam", p_name: "sam@example.com" });
    expect(ensureStaffCard).toHaveBeenCalledWith("org-new", "auth0|sam", expect.anything());
  });

  test("never a second business for someone already in one", async () => {
    tables.memberships = [{ user_id: "auth0|sam", org_id: "org-demo" }];
    expect(await startBusiness(sam)).toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  test("asking for a new one tells the inviter on their phone, pointing at Team", async () => {
    tables.invitations[0].expires_at = past;
    expect(await askForNewInvite(sam, "inv-1")).toEqual({ ok: true });
    expect(push).toHaveBeenCalledWith("org-demo", ["card-jordan"], expect.objectContaining({ title: "Sam Carter asked for a new invitation", path: "/team" }));
  });
});
