/**
 * @jest-environment node
 */

/* How the visit ended, from the phone: only for a member who may write on
   the board, on a job their workspace's mirror holds, and only an answer
   that says what it needs. The token check is the real one; the reading and
   saying record what they were asked. */

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
jest.mock("@/lib/workboard/all-jobs-query", () => ({ resolveJobCard: async (_o: string, id: string) => ({ parentRemoteId: id, focusRemoteId: null }) }));
jest.mock("@/lib/mobile/used", () => ({
  jobHeld: async (_o: string, id: string) => id !== "not-here",
  dayFor: async (_o: string, day: unknown) => (day === undefined || day === null || day === "" ? "2026-11-11" : day === "2026-11-10" ? day : null),
}));
const READ = { said: null, booked: null, charge: "As quoted, $9,856" };
jest.mock("@/lib/mobile/visit-ending", () => ({
  readEnding: async (orgId: string, job: string, day: string) => (asked.push(`read ${orgId} ${job} ${day}`), READ),
  sayEnding: async (_ctx: unknown, job: string, day: string, line: string, ending: { answer: string }) => (
    asked.push(`say ${job} ${day} "${line}" ${ending.answer}`), { read: READ, written: "note-1", first: true, by: { staff: "card-isaac", name: "Isaac" } }
  ),
}));
const scheduled: (() => unknown)[] = [];
jest.mock("next/server", () => ({ ...jest.requireActual("next/server"), after: (fn: () => unknown) => void scheduled.push(fn) }));
jest.mock("@/lib/integrations/sm8-press", () => ({ sm8PressFromMobile: async () => null }));
jest.mock("@/lib/mobile/wrapped-others", () => ({
  tellOthersWrapped: async (orgId: string, job: string, day: string, staff: string, name: string) => (asked.push(`tell others ${orgId} ${job} ${day} ${staff} ${name}`), 1),
}));
jest.mock("@/lib/mobile/quote-job", () => ({
  openQuoteJob: async (_press: unknown, orgId: string, job: string, day: string, words: string) => (asked.push(`quote job ${orgId} ${job} ${day} ${words}`), { ok: true, jobUuid: "Q1" }),
}));
jest.mock("@/lib/integrations/sm8-note-send-on", () => ({
  sendNoteOnToSm8: async (_press: unknown, orgId: string, noteId: string, jobUuid: string) => void asked.push(`send on ${orgId} ${noteId} ${jobUuid}`),
}));

import { GET, POST } from "../jobs/[id]/ending/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const auth = (sub?: string): Record<string, string> => (sub ? { authorization: `Bearer ${mint(sub)}` } : {});
const get = (job: string, q = "", sub?: string) => GET(new Request(`https://go.hey-tiff.com/api/mobile/jobs/${job}/ending${q}`, { headers: auth(sub) }), { params: Promise.resolve({ id: job }) });
const post = (job: string, body: unknown, sub?: string) =>
  POST(new Request(`https://go.hey-tiff.com/api/mobile/jobs/${job}/ending`, { method: "POST", headers: { "content-type": "application/json", ...auth(sub) }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: job }),
  });

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  asked.length = 0;
  members = [{ user_id: "auth0|isaac", org_id: "org-das", role: "owner", permissions: {} }];
});
afterAll(() => {
  process.env = env;
});

const LINE = "Isaac, 8:45 to 2:45 · 4 photos";

test("refused without a token, without the board, or on a job that isn't here", async () => {
  expect((await get("job-3324")).status).toBe(401);
  /* a staff member the board is switched off for; an owner always has it */
  members.push({ user_id: "auth0|ross", org_id: "org-das", role: "staff", permissions: { workboard: false } });
  expect((await post("job-3324", { line: LINE, ending: { answer: "finished" } }, "auth0|ross")).status).toBe(403);
  expect((await get("not-here", "", "auth0|isaac")).status).toBe(404);
  expect(asked).toEqual([]);
});

test("read for the day asked, or today", async () => {
  expect(await (await get("job-3324", "?day=2026-11-10", "auth0|isaac")).json()).toEqual(READ);
  await get("job-3324", "", "auth0|isaac");
  expect(asked).toEqual(["read org-das job-3324 2026-11-10", "read org-das job-3324 2026-11-11"]);
  expect((await get("job-3324", "?day=1999-01-01", "auth0|isaac")).status).toBe(400);
});

test("an answer is said with its visit's line, and on to ServiceM8 only when asked", async () => {
  const res = await post("job-3324", { day: "2026-11-10", line: LINE, ending: { answer: "finished" }, sendOn: true }, "auth0|isaac");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(READ);
  for (const fn of scheduled.splice(0)) await fn();
  expect(asked).toEqual([`say job-3324 2026-11-10 "${LINE}" finished`, "send on org-das note-1 job-3324", "tell others org-das job-3324 2026-11-10 card-isaac Isaac"]);
  asked.length = 0;
  await post("job-3324", { day: "2026-11-10", line: LINE, ending: { answer: "finished" } }, "auth0|isaac");
  for (const fn of scheduled.splice(0)) await fn();
  /* no ServiceM8 asked for: only the others are told */
  expect(asked).toEqual([`say job-3324 2026-11-10 "${LINE}" finished`, "tell others org-das job-3324 2026-11-10 card-isaac Isaac"]);
});

test("an answer missing what it needs, or with no visit's line, says nothing", async () => {
  expect((await post("job-3324", { line: LINE, ending: { answer: "coming_back" } }, "auth0|isaac")).status).toBe(400);
  expect((await post("job-3324", { line: "", ending: { answer: "finished" } }, "auth0|isaac")).status).toBe(400);
  expect(asked).toEqual([]);
});
