/**
 * @jest-environment node
 */

/* Photos from the phone, behind the real token check: a slot on the job
   for a photo (never for paper, never on a job HeyTiff doesn't hold), then
   its landing, which sends it to ServiceM8 with a press minted from that
   check — and only the photo's own taker lands it. */

import { generateKeyPairSync, sign } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
jest.mock("@/lib/mobile/token", () => ({
  ...jest.requireActual("@/lib/mobile/token"),
  tenantKeys: () => async (kid: string) => (kid === "k1" ? publicKey : null),
}));

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => {
      const f: ((r: Row) => boolean)[] = [];
      const rows = () => (tables[t] ?? []).filter((r) => f.every((x) => x(r)));
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (f.push((r) => r[c] === v), q),
        in: (c: string, vs: unknown[]) => (f.push((r) => vs.includes(r[c])), q),
        order: () => q,
        limit: async () => ({ data: rows(), error: null }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => res({ data: rows(), error: null }),
      };
      return q;
    },
  },
}));
jest.mock("server-only", () => ({}));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => null } }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async (_o: string, userId: string) => (userId === "auth0|nocard" ? null : `card-${userId}`) }));

const asked: string[] = [];
jest.mock("@/lib/documents/upload-slots", () => ({
  openSlot: async (_o: string, staffId: string, kind: string, file: { mimeType: string }, onJob: string) => (
    asked.push(`open ${staffId} ${kind} ${file.mimeType} ${onJob}`), { ok: true, documentId: "p-7", ref: "r", token: "t", bucket: "documents", signedUrl: "https://storage/sign/p-7?token=t" }
  ),
  landSlot: async (_o: string, staffId: string, id: string) => (
    asked.push(`land ${staffId} ${id}`), staffId === "card-auth0|isaac" ? { ok: true } : { ok: false, error: "That isn't your upload." }
  ),
}));
jest.mock("@/app/actions/job-sm8", () => ({
  sendJobPhotoAs: async (press: unknown, input: { jobUuid: string; documentId: string }) => {
    const { isSm8Press } = jest.requireActual("@/lib/integrations/sm8-press");
    asked.push(`send ${isSm8Press(press) ? "press" : "FORGED"} ${input.jobUuid} ${input.documentId}`);
    return { ok: true };
  },
}));
let sent: Row[] = [];
jest.mock("@/lib/integrations/sm8-job-sends", () => ({ readJobSends: async () => sent }));
jest.mock("@/lib/integrations/sm8-writes", () => ({
  readSm8WriteState: async () => ({ readable: true, kinds: ["attachment"], deployment: true, mode: "live", modeStored: "live", pausedReason: null, pausedAt: null, linked: true, connected: true, tenantId: "v-1", granted: ["attachment"], refused: [], timezoneName: null, ownerKinds: ["attachment"], ownerKindsRead: true }),
}));

import { POST as BEGIN } from "../jobs/[id]/photos/route";
import { POST as LAND } from "../jobs/[id]/photos/[doc]/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";
import { documentSubject } from "@/lib/integrations/sm8-write-plan";

const DOMAIN = "tenant.example.auth0.com";
const JOB = "0b1e0b1e-0000-4000-8000-000000002935";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const req = (sub: string | null, body?: unknown) =>
  new Request(`https://go.hey-tiff.com/api/mobile/jobs/${JOB}/photos`, {
    method: "POST",
    headers: { ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const job = (id = JOB) => ({ params: Promise.resolve({ id }) });
const landing = (doc: string, id = JOB) => ({ params: Promise.resolve({ id, doc }) });
const shot = { fileName: "2935 27 Oct 10.42.jpg", mimeType: "image/jpeg", sizeBytes: 2_100_000 };

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  asked.length = 0;
  sent = [];
  tables = {
    memberships: [
      { user_id: "auth0|isaac", org_id: "org-1", role: "owner", permissions: {} },
      { user_id: "auth0|lyle", org_id: "org-1", role: "staff", permissions: {} },
      { user_id: "auth0|nocard", org_id: "org-1", role: "staff", permissions: {} },
      { user_id: "auth0|office", org_id: "org-1", role: "staff", permissions: { workboard: false } },
    ],
    sm8_jobs: [{ org_id: "org-1", uuid: JOB }],
    documents: [{ org_id: "org-1", id: "p-7", kind: "job_photo", sm8_job_uuid: JOB, file_name: shot.fileName, mime_type: shot.mimeType, size_bytes: shot.sizeBytes }],
  };
});
afterAll(() => {
  process.env = env;
});

test("a call without a token, or without the Workboard, opens nothing", async () => {
  expect((await BEGIN(req(null, shot), job())).status).toBe(401);
  expect((await BEGIN(req("auth0|office", shot), job())).status).toBe(403);
  expect(asked).toEqual([]);
});

test("a slot for a photo, filed on this job from the start, as a job photo", async () => {
  const res = await BEGIN(req("auth0|isaac", shot), job());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ documentId: "p-7", uploadUrl: "https://storage/sign/p-7?token=t" });
  expect(asked).toEqual([`open card-auth0|isaac job_photo image/jpeg ${JOB}`]);
});

test("never for paper, never on a job HeyTiff doesn't hold, never without a staff card", async () => {
  expect((await BEGIN(req("auth0|isaac", { ...shot, mimeType: "application/pdf" }), job())).status).toBe(400);
  expect((await BEGIN(req("auth0|isaac", shot), job("not-a-job"))).status).toBe(404);
  expect((await BEGIN(req("auth0|nocard", shot), job())).status).toBe(403);
  expect(asked).toEqual([]);
});

test("landed, it goes to ServiceM8 with the phone's own press, and says where it is", async () => {
  sent = [{ documentId: "p-7", status: "sent", error: null, attempts: 1, remoteUuid: "r-1", subject: documentSubject("p-7") }];
  const res = await LAND(req("auth0|isaac"), landing("p-7"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ documentId: "p-7", sent: { word: "In ServiceM8", tone: "ok" } });
  expect(asked).toEqual(["land card-auth0|isaac p-7", `send press ${JOB} p-7`]);
});

test("only its taker lands it, and only on its own job; nothing goes otherwise", async () => {
  expect((await LAND(req("auth0|lyle"), landing("p-7"))).status).toBe(409);
  expect((await LAND(req("auth0|isaac"), landing("p-8"))).status).toBe(404);
  tables.documents[0].kind = "job_document";
  expect((await LAND(req("auth0|isaac"), landing("p-7"))).status).toBe(404);
  expect(asked.filter((a) => a.startsWith("send"))).toEqual([]);
});
