/**
 * @jest-environment node
 */

/* Your leave from the phone, behind the real token check: asking and Undo
   on the web's own rules (lib/timepay/leave-actions, recorded here), as the
   person the token names, never an id handed in; approved leave comes off
   the ServiceM8 board with a press minted from that check; a certificate is
   your own `medical_certificate`, slotted and landed. */

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
jest.mock("next/cache", () => ({ revalidatePath: () => {} }));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => null } }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async (_o: string, userId: string) => (userId === "auth0|nocard" ? null : `card-${userId}`) }));
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: async (_o: string, userId: string) => (userId === "auth0|nocard" ? null : `card-${userId}`) }));
jest.mock("@/lib/timepay/leave-page", () => ({ loadLeaveFor: async () => ({}) }));

const asked: string[] = [];
let approved = false;
jest.mock("@/lib/timepay/leave-actions", () => ({
  requestOwnLeave: async (a: { staffId: string }, input: { kind: string; startDate: string; endDate: string; hours: number; certificateDocumentId?: string }) => {
    asked.push(`ask ${a.staffId} ${input.kind} ${input.startDate} ${input.endDate} ${input.hours} ${input.certificateDocumentId ?? "-"}`);
    return input.hours > 200 ? { ok: false, error: "That's 104h more annual leave than you have available." } : { ok: true, id: "lr-1" };
  },
  cancelOwnLeave: async (a: { staffId: string }, id: string) => (asked.push(`cancel ${a.staffId} ${id}`), { ok: true, wasApproved: approved }),
}));
jest.mock("@/app/actions/sm8-leave-queue", () => ({
  queueLeaveOffBoard: async (press: unknown, input: { id: string }) => {
    const { isSm8Press } = jest.requireActual("@/lib/integrations/sm8-press");
    asked.push(`off-board ${isSm8Press(press) ? "press" : "FORGED"} ${input.id}`);
    return { ok: true };
  },
}));
jest.mock("@/lib/documents/upload-slots", () => ({
  openSlot: async (_o: string, staffId: string, kind: string) => (asked.push(`slot ${staffId} ${kind}`), { ok: true, documentId: "d-1", ref: "r", token: "t", bucket: "documents", signedUrl: "https://storage/sign/d-1" }),
  landSlot: async (_o: string, staffId: string, id: string) => (asked.push(`land ${staffId} ${id}`), { ok: true }),
}));

import { POST as ASK } from "../leave/route";
import { POST as ONE } from "../leave/[id]/route";
import { POST as CERT } from "../leave/certificate/route";
import { POST as LAND } from "../leave/certificate/[doc]/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const req = (sub: string | null, body?: unknown) =>
  new Request("https://go.hey-tiff.com/api/mobile/leave", {
    method: "POST",
    headers: { ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ask = { kind: "annual", startDate: "2026-12-21", endDate: "2027-01-08", hours: 96, note: "Christmas", staffProfileId: "someone-else" };

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN, SM8_WRITES: "attachment,note,booking,leave" };
  asked.length = 0;
  approved = false;
  members = [
    { user_id: "auth0|isaac", org_id: "org-1", role: "staff", permissions: {} },
    { user_id: "auth0|nocard", org_id: "org-1", role: "staff", permissions: {} },
  ];
});
afterAll(() => {
  process.env = env;
});

test("a call without a token asks, cancels and uploads nothing", async () => {
  expect((await ASK(req(null, ask))).status).toBe(401);
  expect((await ONE(req(null, { do: "cancel" }), { params: Promise.resolve({ id: "lr-1" }) })).status).toBe(401);
  expect((await CERT(req(null, {}))).status).toBe(401);
  expect(asked).toEqual([]);
});

test("asks as the token's own person, whatever the request names, and says what the rules refused", async () => {
  const res = await ASK(req("auth0|isaac", ask));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: "lr-1" });
  const refused = await ASK(req("auth0|isaac", { ...ask, hours: 300 }));
  expect(refused.status).toBe(400);
  expect(await refused.json()).toEqual({ error: "That's 104h more annual leave than you have available." });
  expect((await ASK(req("auth0|nocard", ask))).status).toBe(404);
  expect(asked).toEqual(["ask card-auth0|isaac annual 2026-12-21 2027-01-08 96 -", "ask card-auth0|isaac annual 2026-12-21 2027-01-08 300 -"]);
});

test("Undo cancels your own; approved leave comes off the ServiceM8 board with the phone's own press", async () => {
  const one = (id: string, body: unknown) => ONE(req("auth0|isaac", body), { params: Promise.resolve({ id }) });
  expect((await one("lr-1", { do: "cancel" })).status).toBe(200);
  approved = true;
  expect((await one("lr-2", { do: "cancel" })).status).toBe(200);
  expect((await one("lr-2", { do: "approve" })).status).toBe(400);
  expect(asked).toEqual(["cancel card-auth0|isaac lr-1", "cancel card-auth0|isaac lr-2", "off-board press lr-2"]);
});

test("a certificate is your own medical certificate: a slot, then its landing, then the request adopts it", async () => {
  const slot = await CERT(req("auth0|isaac", { fileName: "certificate.jpg", mimeType: "image/jpeg", sizeBytes: 900_000 }));
  expect(await slot.json()).toEqual({ documentId: "d-1", uploadUrl: "https://storage/sign/d-1" });
  expect((await LAND(req("auth0|isaac"), { params: Promise.resolve({ doc: "d-1" }) })).status).toBe(200);
  await ASK(req("auth0|isaac", { kind: "personal", startDate: "2026-10-26", endDate: "2026-10-28", hours: 24, certificateDocumentId: "d-1" }));
  expect(asked).toEqual(["slot card-auth0|isaac medical_certificate", "land card-auth0|isaac d-1", "ask card-auth0|isaac personal 2026-10-26 2026-10-28 24 d-1"]);
});
