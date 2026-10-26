/**
 * @jest-environment node
 */

/* The phone's Library: behind the `tiff` grant, inside the member's own
   workspace, and a file signed only when it sits under that workspace's own
   prefix. The token check is the real one; the library's readers record what
   they were asked for. */

import { generateKeyPairSync, sign } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
jest.mock("@/lib/mobile/token", () => ({
  ...jest.requireActual("@/lib/mobile/token"),
  tenantKeys: () => async (kid: string) => (kid === "k1" ? publicKey : null),
}));

type Row = { user_id: string; org_id: string; role: string | null; permissions: unknown };
let members: Row[] = [];
let docRef: string | null = "org/org-diamond/kb/doc-1.pdf";
const asked: string[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const f: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => ((f[c] = v), q),
        order: () => q,
        maybeSingle: async () => {
          asked.push(`doc ${f.org_id} ${f.id}`);
          return { data: f.id === "doc-1" ? { storage_ref: docRef } : null, error: null };
        },
        then: (res: (v: unknown) => unknown) =>
          res(table === "memberships" ? { data: members.filter((m) => m.user_id === f.user_id), error: null } : { data: [], error: null }),
      };
      return q;
    },
  },
}));
jest.mock("@/lib/tiff/query", () => ({
  kbDocsForOrg: async (orgId: string) => {
    asked.push(`docs ${orgId}`);
    return [
      { id: "doc-1", category: "faults", title: "Daikin FTXM-R service manual", source: "Daikin", edition: "2024", status: "ready", pageCount: 220, storageRef: "org/org-diamond/kb/doc-1.pdf", uploadedAt: "2026-10-01" },
      { id: "note-1", category: "field", title: "Long runs on the FTXM-R", source: null, edition: null, status: "ready", pageCount: null, storageRef: null, uploadedAt: "2026-10-20" },
    ];
  },
  searchKbDocument: async (orgId: string, id: string, q: string, limit: number) => {
    asked.push(`search ${orgId} ${id} "${q}" ${limit}`);
    return [{ chunkId: "c1", content: "E6: compressor lock or start failure. Check the compressor leads.", pageFrom: 112, pageTo: 112, heading: "Error codes" }];
  },
  signKbRef: async (ref: string) => `https://signed/${ref}`,
}));

import { GET as library } from "../library/route";
import { GET as search } from "../library/[id]/search/route";
import { GET as file } from "../library/[id]/file/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const req = (path: string, sub?: string, org?: string) =>
  new Request(`https://go.hey-tiff.com/api/mobile/${path}`, {
    headers: { ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}), ...(org ? { "x-heytiff-org": org } : {}) },
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  asked.length = 0;
  docRef = "org/org-diamond/kb/doc-1.pdf";
  members = [
    { user_id: "auth0|lyle", org_id: "org-diamond", role: "staff", permissions: {} },
    { user_id: "auth0|otto", org_id: "org-other", role: "owner", permissions: {} },
  ];
});
afterAll(() => {
  process.env = env;
});

describe("refused before anything is read", () => {
  test("without a token", async () => {
    expect((await library(req("library"))).status).toBe(401);
    expect((await search(req("library/doc-1/search?q=E6"), params("doc-1"))).status).toBe(401);
    expect((await file(req("library/doc-1/file"), params("doc-1"))).status).toBe(401);
    expect(asked).toEqual([]);
  });

  test("for another business's workspace", async () => {
    expect((await library(req("library", "auth0|lyle", "org-other"))).status).toBe(403);
    expect((await file(req("library/doc-1/file", "auth0|lyle", "org-other"), params("doc-1"))).status).toBe(403);
    expect(asked).toEqual([]);
  });

  test("without the Library grant", async () => {
    members[0]!.permissions = { tiff: false };
    expect((await library(req("library", "auth0|lyle"))).status).toBe(403);
    expect((await search(req("library/doc-1/search?q=E6", "auth0|lyle"), params("doc-1"))).status).toBe(403);
    expect(asked).toEqual([]);
  });
});

test("the shelves list the workspace's documents, with no storage reference", async () => {
  const body = await (await library(req("library", "auth0|lyle"))).json();
  expect(asked).toEqual(["docs org-diamond"]);
  expect(body.map((d: { id: string; hasFile: boolean }) => [d.id, d.hasFile])).toEqual([
    ["doc-1", true],
    ["note-1", false],
  ]);
  expect(JSON.stringify(body)).not.toContain("org/org-diamond");
});

test("a search reads inside the workspace's document and marks the matches", async () => {
  const body = await (await search(req("library/doc-1/search?q=E6", "auth0|lyle"), params("doc-1"))).json();
  expect(asked).toEqual(['search org-diamond doc-1 "E6" 51']);
  expect(body.capped).toBe(false);
  expect(body.hits[0]).toMatchObject({ pageFrom: 112, heading: "Error codes" });
  expect(body.hits[0].segments.some((s: { text: string; hit: boolean }) => s.hit && s.text === "E6")).toBe(true);
});

test("a search too short to mean anything reads nothing", async () => {
  expect(await (await search(req("library/doc-1/search?q=E", "auth0|lyle"), params("doc-1"))).json()).toEqual({ hits: [], capped: false });
  expect(asked).toEqual([]);
});

test("a file is signed only when it's the workspace's own", async () => {
  expect(await (await file(req("library/doc-1/file", "auth0|lyle"), params("doc-1"))).json()).toEqual({ url: "https://signed/org/org-diamond/kb/doc-1.pdf" });
  docRef = "org/org-other/kb/doc-1.pdf";
  expect((await file(req("library/doc-1/file", "auth0|lyle"), params("doc-1"))).status).toBe(403);
  docRef = null;
  expect((await file(req("library/doc-1/file", "auth0|lyle"), params("doc-1"))).status).toBe(404);
  expect((await file(req("library/gone/file", "auth0|lyle"), params("gone"))).status).toBe(404);
});
