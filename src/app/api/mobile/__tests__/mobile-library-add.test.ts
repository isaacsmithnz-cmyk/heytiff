/**
 * @jest-environment node
 */

/* Adding a manual from the phone: behind `tiff_manage`, the web's own offer
   for a file's name, and the web's own begin, confirm and read as the token's
   person. The token check is the real one; the web's code records who asked. */

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

const asked: unknown[] = [];
jest.mock("@/lib/tiff/tags-query", () => ({
  ensureKbSeedTags: async (org: string) => void asked.push(`seed ${org}`),
  kbTagsForOrg: async () => [
    { id: "t-me", label: "Mitsubishi Electric", slug: "mitsubishi-electric", color: "#000", kind: "brand" },
    { id: "t-ducted", label: "Ducted", slug: "ducted", color: "#000", kind: "system" },
  ],
}));
jest.mock("@/lib/tiff/large", () => ({ kbLargeAllowance: async (_o: string, owner: boolean) => (owner ? { left: 2, resetsOn: "2026-11-01" } : null) }));

const session = () => (jest.requireActual("@/lib/phone-session") as typeof import("@/lib/phone-session")).phoneSession();
jest.mock("@/app/actions/kb", () => ({
  beginKbUpload: async (input: { title: string }) => {
    asked.push({ begin: input, as: session() });
    return input.title ? { ok: true, documentId: "d1", ref: "org/o/kb/d1.pdf", token: "t", bucket: "kb" } : { ok: false, error: "Give that document a title." };
  },
  confirmKbUpload: async (id: string) => {
    asked.push({ confirm: id, as: session() });
    return id === "gone" ? { ok: false, error: "That upload no longer exists." } : { ok: true };
  },
}));
jest.mock("@/app/api/tiff/ingest/route", () => ({
  POST: async (r: Request) => {
    asked.push({ read: await r.json(), as: session() });
    return Response.json({ status: "processing", pagesDone: 20, pageCount: 147, continuing: true });
  },
}));

import { GET as offer, POST as begin } from "../library/add/route";
import { POST as landed } from "../library/[id]/landed/route";
import { POST as read } from "../library/[id]/read/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const req = (path: string, sub?: string, body?: unknown) =>
  new Request(`https://go.hey-tiff.com/api/mobile/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: sub ? { authorization: `Bearer ${mint(sub)}` } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const FILE = "library/add?file=Mitsubishi-Electric_Ducted_Install.pdf&mime=application/pdf&size=";

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  asked.length = 0;
  members = [
    { user_id: "owner", org_id: "o", role: "owner", permissions: null },
    { user_id: "staff", org_id: "o", role: "staff", permissions: null },
  ];
});
afterAll(() => {
  process.env = env;
});

describe("who may add", () => {
  it("refuses no token, and anyone without tiff_manage, before anything runs", async () => {
    expect((await offer(req(FILE))).status).toBe(401);
    expect((await offer(req(FILE, "staff"))).status).toBe(403);
    expect((await begin(req("library/add", "staff", { title: "x" }))).status).toBe(403);
    expect((await landed(req("library/d1/landed", "staff", {}), params("d1"))).status).toBe(403);
    expect((await read(req("library/d1/read", "staff", {}), params("d1"))).status).toBe(403);
    expect(asked).toEqual([]);
  });
});

describe("what the sheet is offered", () => {
  it("is the drawer's guess from the file's name, and the workspace's tags", async () => {
    const body = await (await offer(req(`${FILE}3000000`, "owner"))).json();
    expect(asked).toEqual(["seed o"]);
    expect(body).toEqual({
      refused: null,
      title: expect.any(String),
      category: "install",
      tagIds: ["t-me", "t-ducted"],
      tags: [
        { id: "t-me", label: "Mitsubishi Electric", kind: "brand" },
        { id: "t-ducted", label: "Ducted", kind: "system" },
      ],
    });
  });

  it("says why a file won't do, by the web's own rules", async () => {
    expect((await (await offer(req("library/add?file=a.jpg&mime=image/jpeg&size=10", "owner"))).json()).refused).toBe("The library takes PDFs only.");
    expect((await (await offer(req(`${FILE}${60 * 1024 * 1024}`, "owner"))).json()).refused).toBeNull();
    members[0]!.role = "admin";
    expect((await (await offer(req(`${FILE}${60 * 1024 * 1024}`, "owner"))).json()).refused).toMatch(/too big/);
  });
});

describe("the web's own steps, as the token's person", () => {
  const as = { user: { sub: "owner" }, orgId: "o" };

  it("begins with what the sheet says, and hands back only the slot", async () => {
    const res = await begin(req("library/add", "owner", { title: "Main Zone Controller", category: "install", tagIds: ["t-me"], fileName: "m.pdf", mime: "application/pdf", sizeBytes: 9 }));
    expect(await res.json()).toEqual({ documentId: "d1", bucket: "kb", ref: "org/o/kb/d1.pdf", token: "t" });
    expect(asked).toEqual([{ begin: { title: "Main Zone Controller", category: "install", tagIds: ["t-me"], fileName: "m.pdf", mime: "application/pdf", sizeBytes: 9 }, as }]);
  });

  it("says the web's refusal", async () => {
    const res = await begin(req("library/add", "owner", { title: "" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Give that document a title.");
  });

  it("confirms the bytes landed", async () => {
    expect((await landed(req("library/d1/landed", "owner", {}), params("d1"))).status).toBe(200);
    expect(asked).toEqual([{ confirm: "d1", as }]);
    const gone = await landed(req("library/gone/landed", "owner", {}), params("gone"));
    expect(gone.status).toBe(409);
  });

  it("reads through the web's ingest route", async () => {
    const res = await read(req("library/d1/read", "owner", {}), params("d1"));
    expect(await res.json()).toEqual({ status: "processing", pagesDone: 20, pageCount: 147, continuing: true });
    expect(asked).toEqual([{ read: { documentId: "d1" }, as }]);
  });
});
