/**
 * @jest-environment node
 */

/* A job's people and addresses from the phone's Contact sheet (bug 26):
   only where the deployment saves customer changes, only for someone who
   runs the board, inside their own workspace, and only once the workspace
   offers customer details. The press is minted from the context the real
   token check made; the save is the web's (sm8-customer-edit), handed the
   phone's one change to shape against the job as it stands. NOTHING HERE
   REACHES SERVICEM8: the reads and the save are stand-ins. */

import { generateKeyPairSync, sign } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
jest.mock("@/lib/mobile/token", () => ({
  ...jest.requireActual("@/lib/mobile/token"),
  tenantKeys: () => async (kid: string) => (kid === "k1" ? publicKey : null),
}));

type Row = { user_id: string; org_id: string; role: string | null; permissions: unknown };
let members: Row[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const f: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => ((f[c] = v), q),
        order: () => q,
        then: (res: (v: unknown) => unknown) => res({ data: members.filter((m) => m.user_id === f.user_id), error: null }),
      };
      return q;
    },
  },
}));

jest.mock("server-only", () => ({}));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => null } }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async () => null }));

let offered = true;
const asked: string[] = [];
jest.mock("@/lib/integrations/sm8-writes", () => ({
  readSm8WriteState: async (orgId: string) => (asked.push(`state ${orgId}`), { orgId, offered, readable: true }),
}));
jest.mock("@/lib/integrations/sm8-write-plan", () => ({
  ...jest.requireActual("@/lib/integrations/sm8-write-plan"),
  offersSend: (s: { offered: boolean }, kind: string) => kind === "customer" && s.offered,
  sendRefusal: () => null,
}));
jest.mock("@/lib/workboard/all-jobs-query", () => ({
  resolveJobCard: async (orgId: string, id: string) => (asked.push(`resolve ${orgId} ${id}`), { parentRemoteId: J, focusRemoteId: null }),
}));

const J = "0b1e0b1e-0000-4000-8000-000000000001";
const RAY = "0b1e0b1e-0000-4000-8000-0000000000a2";
const PRESS_ID = "0b1e0b1e-0000-4000-8000-0000000000ff";
const FORM = {
  jobUuid: J,
  company: { uuid: "0b1e0b1e-0000-4000-8000-0000000000c1", name: "Lisa Watters", address: "6/40 Raglan St, Mosman" },
  billingAddress: "6/40 Raglan St\nMosman",
  siteAddress: "6/40 Raglan St, Mosman",
  contacts: [{ uuid: RAY, first: "Ray", last: "Watters", mobile: "0400 111 222", phone: "02 9960 0000", email: "", type: "BILLING" }],
};
const saved: { orgId: string; pressId: string; after: unknown; pressed: boolean }[] = [];
let answer: unknown = { ok: true, saved: 1, waiting: 0, failed: [] };
jest.mock("@/lib/integrations/sm8-customer-edit", () => ({
  readCustomerFormIn: async (orgId: string, jobUuid: string) => (asked.push(`read ${orgId} ${jobUuid}`), { ok: true, form: FORM, siteAddress: FORM.siteAddress, billingRead: true }),
  saveCustomerWith: async (press: { orgId: string }, pressId: string, save: { jobUuid: string; shape: (b: unknown) => { ok: boolean; after?: unknown } }) => {
    const { isSm8Press } = jest.requireActual("@/lib/integrations/sm8-press");
    const shaped = save.shape(FORM);
    saved.push({ orgId: press.orgId, pressId, after: shaped.ok ? shaped.after : shaped, pressed: isSm8Press(press) });
    return answer;
  },
}));

import { GET, POST } from "../jobs/[id]/customer/route";
import { POST as address } from "../address/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";
import { CUSTOMER_WORDS } from "@/lib/integrations/sm8-customer-words";

const DOMAIN = "tenant.example.auth0.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const req = (sub: string | null, body?: unknown) =>
  new Request(`https://go.hey-tiff.com/api/mobile/jobs/3488/customer`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const params = { params: Promise.resolve({ id: "3488" }) };

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN, SM8_WRITES: "attachment,customer" };
  asked.length = 0;
  saved.length = 0;
  offered = true;
  answer = { ok: true, saved: 1, waiting: 0, failed: [] };
  members = [
    { user_id: "auth0|lyle", org_id: "org-diamond", role: "staff", permissions: {} },
    { user_id: "auth0|isaac", org_id: "org-diamond", role: "owner", permissions: {} },
  ];
});
afterAll(() => {
  process.env = env;
});

describe("reading for the Contact sheet", () => {
  it("without a token is a 401, and nothing is read", async () => {
    expect((await GET(req(null), params)).status).toBe(401);
    expect(asked).toEqual([]);
  });

  it("someone who doesn't run the board sees the sheet as it was, and nothing is read", async () => {
    expect(await (await GET(req("auth0|lyle"), params)).json()).toEqual({ canEdit: false });
    expect(asked).toEqual([]);
  });

  it("a deployment that doesn't save customer changes offers nothing, and reads nothing", async () => {
    process.env.SM8_WRITES = "attachment,note";
    expect(await (await GET(req("auth0|isaac"), params)).json()).toEqual({ canEdit: false });
    expect(asked).toEqual([]);
  });

  it("with Customer details off, offers nothing", async () => {
    offered = false;
    expect(await (await GET(req("auth0|isaac"), params)).json()).toEqual({ canEdit: false });
    expect(asked).toEqual(["state org-diamond"]);
  });

  it("for someone who runs the board: the people with their ids, the site, the bills and the six roles", async () => {
    const body = await (await GET(req("auth0|isaac"), params)).json();
    expect(body).toMatchObject({
      canEdit: true,
      people: [{ id: RAY, first: "Ray", last: "Watters", mobile: "0400 111 222", type: "BILLING" }],
      site: "6/40 Raglan St, Mosman",
      billing: "6/40 Raglan St\nMosman",
      billingSame: true,
    });
    expect(body.roles.map((r: { word: string }) => r.word)).toEqual(["Job contact", "Billing contact", "Site contact", "Property manager", "Property owner", "Tenant"]);
    expect(asked).toEqual(["state org-diamond", "resolve org-diamond 3488", `read org-diamond ${J}`]);
  });
});

describe("saving one change", () => {
  const person = { kind: "person", id: RAY, first: "Ray", last: "Watters", mobile: "0400 999 888", email: "ray@example.com", type: "Tenant" };

  it("someone who doesn't run the board is refused before anything is read", async () => {
    const res = await POST(req("auth0|lyle", { pressId: PRESS_ID, edit: person }), params);
    expect([res.status, (await res.json()).error]).toEqual([403, CUSTOMER_WORDS.press.noManage]);
    expect(asked).toEqual([]);
    expect(saved).toEqual([]);
  });

  it("a deployment that doesn't save customer changes refuses before anything is read", async () => {
    process.env.SM8_WRITES = "attachment";
    expect((await POST(req("auth0|isaac", { pressId: PRESS_ID, edit: person }), params)).status).toBe(409);
    expect(asked).toEqual([]);
  });

  it("an edit it doesn't know, or no press id, saves nothing", async () => {
    expect((await POST(req("auth0|isaac", { pressId: PRESS_ID, edit: { kind: "company", name: "x" } }), params)).status).toBe(400);
    expect((await POST(req("auth0|isaac", { pressId: "nope", edit: person }), params)).status).toBe(400);
    expect(saved).toEqual([]);
  });

  it("with Customer details off, saves nothing", async () => {
    offered = false;
    expect((await POST(req("auth0|isaac", { pressId: PRESS_ID, edit: person }), params)).status).toBe(409);
    expect(saved).toEqual([]);
  });

  it("hands a real press and the change, shaped against the job as it stands, to the web's save; the landline stays", async () => {
    const res = await POST(req("auth0|isaac", { pressId: PRESS_ID, edit: person }), params);
    expect(await res.json()).toEqual({ saved: 1, waiting: 0 });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ orgId: "org-diamond", pressId: PRESS_ID, pressed: true });
    expect((saved[0]!.after as typeof FORM).contacts).toEqual([{ uuid: RAY, first: "Ray", last: "Watters", mobile: "0400 999 888", phone: "02 9960 0000", email: "ray@example.com", type: "Tenant" }]);
  });

  it("saving what's already there is done, not a refusal", async () => {
    answer = { ok: false, error: CUSTOMER_WORDS.press.nothing };
    const res = await POST(req("auth0|isaac", { pressId: PRESS_ID, edit: { kind: "site", address: "6/40 Raglan St, Mosman" } }), params);
    expect([res.status, await res.json()]).toEqual([200, { saved: 0, waiting: 0 }]);
  });

  it("a change ServiceM8 refused says why", async () => {
    answer = { ok: true, saved: 0, waiting: 0, failed: [CUSTOMER_WORDS.row.refused] };
    const res = await POST(req("auth0|isaac", { pressId: PRESS_ID, edit: person }), params);
    expect([res.status, (await res.json()).error]).toEqual([400, CUSTOMER_WORDS.row.refused]);
  });
});

describe("the phone's address lookup", () => {
  it("without a token is a 401 before the body is read or Google asked", async () => {
    const fetchMock = jest.fn();
    const real = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      const res = await address(new Request("https://go.hey-tiff.com/api/mobile/address", { method: "POST", body: JSON.stringify({ op: "suggest", input: "40 Raglan" }) }));
      expect(res.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      global.fetch = real;
    }
  });

  it("with no key, says lookup is off", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const res = await address(
      new Request("https://go.hey-tiff.com/api/mobile/address", { method: "POST", headers: { authorization: `Bearer ${mint("auth0|lyle")}` }, body: JSON.stringify({ op: "suggest", input: "40 Raglan" }) })
    );
    expect([res.status, await res.json()]).toEqual([503, { enabled: false }]);
  });
});
