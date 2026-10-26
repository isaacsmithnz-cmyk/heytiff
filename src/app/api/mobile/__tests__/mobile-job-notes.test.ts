/**
 * @jest-environment node
 */

/* Writing a note on a job from the phone: only for a member who may write
   on the board, only inside their own workspace (a claim writes on its job),
   and the words, the job and the pen's id handed to the one write the job
   sheet's pen uses. The token check is the real one; the write records what
   it was asked. */

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

const asked: string[] = [];
jest.mock("@/lib/workboard/all-jobs-query", () => ({
  resolveJobCard: async (orgId: string, id: string) => {
    asked.push(`resolve ${orgId} ${id}`);
    return { parentRemoteId: id === "claim-7" ? "job-3342" : id, focusRemoteId: null };
  },
}));
jest.mock("@/lib/workboard/job-note-write", () => ({
  writeJobNote: async (input: { orgId: string; userId: string; jobUuid: string; body: string; composeId?: string }) => {
    asked.push(`write ${input.orgId} ${input.userId} ${input.jobUuid} "${input.body}" ${input.composeId ?? "-"}`);
    if (input.jobUuid === "not-here") throw new Error("That job isn't on this workspace's board");
    return { id: input.composeId ?? "n1", text: input.body.trim(), at: "2026-10-26 09:12:00", author: "Lyle Irving" };
  },
}));

import { POST } from "../jobs/[id]/notes/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const PEN = "8f2b6c1e-3d4a-4b5c-9e7f-0a1b2c3d4e5f";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const post = (job: string, body: unknown, sub?: string, org?: string) =>
  POST(
    new Request(`https://go.hey-tiff.com/api/mobile/jobs/${job}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}), ...(org ? { "x-heytiff-org": org } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: job }) },
  );

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  asked.length = 0;
  members = [
    { user_id: "auth0|lyle", org_id: "org-diamond", role: "staff", permissions: {} },
    { user_id: "auth0|otto", org_id: "org-other", role: "owner", permissions: {} },
  ];
});
afterAll(() => {
  process.env = env;
});

describe("refused before anything is written", () => {
  test("without a token", async () => {
    expect((await post("job-3342", { body: "Pipe run is 14 m" })).status).toBe(401);
    expect(asked).toEqual([]);
  });

  test("on another business's job, named by its workspace", async () => {
    expect((await post("otto-job", { body: "hello" }, "auth0|lyle", "org-other")).status).toBe(403);
    expect(asked).toEqual([]);
  });

  test("without the board", async () => {
    members[0]!.permissions = { workboard: false };
    expect((await post("job-3342", { body: "Pipe run is 14 m" }, "auth0|lyle")).status).toBe(403);
    expect(asked).toEqual([]);
  });

  test("with nothing to say, or a body that isn't JSON words", async () => {
    expect((await post("job-3342", { body: "   " }, "auth0|lyle")).status).toBe(400);
    expect((await post("job-3342", "not json", "auth0|lyle")).status).toBe(400);
    expect((await post("job-3342", { body: 42 }, "auth0|lyle")).status).toBe(400);
    expect((await post("job-3342", { body: "hi", id: 7 }, "auth0|lyle")).status).toBe(400);
    expect(asked).toEqual([]);
  });
});

test("a note is written by the member, in their workspace, on the job a claim belongs to, under the pen's id", async () => {
  const res = await post("claim-7", { body: "Pipe run is 14 m", id: PEN }, "auth0|lyle");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: PEN, text: "Pipe run is 14 m", at: "2026-10-26 09:12:00", author: "Lyle Irving" });
  expect(asked).toEqual(["resolve org-diamond claim-7", `write org-diamond auth0|lyle job-3342 "Pipe run is 14 m" ${PEN}`]);
});

test("a job the workspace's mirror doesn't hold is refused with the write's own sentence", async () => {
  const res = await post("not-here", { body: "hello" }, "auth0|lyle");
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("That job isn't on this workspace's board");
});
