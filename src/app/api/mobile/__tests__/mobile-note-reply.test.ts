/**
 * @jest-environment node
 */

/* A reply from the phone (Isaac, 16 November 2026, bug 2 on 3516: "Unable to
   reply to comments on this job"): the notes route with `replyTo` hands the
   words, the job a claim belongs to, the note it answers and a real press to
   the one reply the job sheet's Reply uses, behind the same gates as a note
   sent on: only where this deployment sends notes, and only once the
   workspace offers them. It never writes a plain note instead. */

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
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => ({ orgId: "org-other", user: { sub: "auth0|otto" } }) } }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async (orgId: string, userId: string) => `card-${orgId}-${userId}` }));

let notesOn = true;
jest.mock("@/lib/integrations/sm8-kinds", () => ({ sm8NotesAllowed: () => notesOn }));
let offered = true;
const asked: string[] = [];
jest.mock("@/lib/integrations/sm8-writes", () => ({
  readSm8WriteState: async (orgId: string) => (asked.push(`state ${orgId}`), { orgId, offered }),
}));
jest.mock("@/lib/integrations/sm8-write-plan", () => ({
  offersSend: (s: { offered: boolean }, kind: string) => kind === "note" && s.offered,
}));
jest.mock("@/lib/workboard/all-jobs-query", () => ({
  resolveJobCard: async (orgId: string, id: string) => {
    asked.push(`resolve ${orgId} ${id}`);
    return { parentRemoteId: id === "claim-7" ? "job-3342" : id, focusRemoteId: null };
  },
}));
jest.mock("@/lib/workboard/job-note-write", () => ({
  writeJobNote: async () => {
    asked.push("WROTE A PLAIN NOTE");
    return { id: "n1", text: "", at: "", author: null };
  },
}));
jest.mock("@/lib/mobile/wrapup-replace", () => ({ replaceWrapupNote: async () => "none" }));
jest.mock("@/lib/integrations/sm8-note-send-on", () => ({ sendNoteOnToSm8: async () => undefined }));
jest.mock("@/lib/integrations/sm8-note-entry", () => ({
  notOffered: () => "Notes to ServiceM8 are switched off for this workspace.",
  replyToNote: async (
    press: unknown,
    state: { orgId: string },
    input: { jobUuid: string; sourceNoteUuid: string; words: string; spoken?: boolean; composeId: string }
  ) => {
    const { isSm8Press } = jest.requireActual("@/lib/integrations/sm8-press");
    const p = press as { orgId: string; userId: string; staffId: string };
    asked.push(
      `reply ${isSm8Press(press) ? "press" : "FORGED"} ${p.orgId} ${p.staffId} ${state.orgId} ${input.jobUuid} ${input.sourceNoteUuid} "${input.words}" ${input.spoken ? "said" : "typed"} ${input.composeId}`
    );
    if (input.sourceNoteUuid === "not-you") return { ok: false, error: "That note doesn't mention you." };
    return { ok: true, note: { id: input.composeId, text: input.words, at: "2026-11-16 15:02:00", author: "Lyle Irving", replyTo: input.sourceNoteUuid } };
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
const post = (job: string, body: Record<string, unknown>, sub?: string) =>
  POST(
    new Request(`https://go.hey-tiff.com/api/mobile/jobs/${job}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: job }) }
  );

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  asked.length = 0;
  notesOn = true;
  offered = true;
  members = [{ user_id: "auth0|lyle", org_id: "org-diamond", role: "staff", permissions: {} }];
});
afterAll(() => {
  process.env = env;
});

test("a reply goes as the member, on the job a claim belongs to, to the note it answers, with a real press", async () => {
  const res = await post("claim-7", { body: "On it Monday", id: PEN, replyTo: "sm8-note-1", spoken: true }, "auth0|lyle");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ id: PEN, text: "On it Monday", replyTo: "sm8-note-1" });
  expect(asked).toEqual([
    "resolve org-diamond claim-7",
    "state org-diamond",
    `reply press org-diamond card-org-diamond-auth0|lyle org-diamond job-3342 sm8-note-1 "On it Monday" said ${PEN}`,
  ]);
});

test("the reply's refusal is the phone's answer, and nothing else is written", async () => {
  const res = await post("job-3342", { body: "Yes", id: PEN, replyTo: "not-you" }, "auth0|lyle");
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("That note doesn't mention you.");
  expect(asked).not.toContain("WROTE A PLAIN NOTE");
});

test("refused where this deployment doesn't send notes, or the workspace doesn't offer them", async () => {
  notesOn = false;
  expect((await post("job-3342", { body: "Yes", id: PEN, replyTo: "sm8-note-1" }, "auth0|lyle")).status).toBe(400);
  notesOn = true;
  offered = false;
  const res = await post("job-3342", { body: "Yes", id: PEN, replyTo: "sm8-note-1" }, "auth0|lyle");
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("Notes to ServiceM8 are switched off for this workspace.");
  expect(asked.some((a) => a.startsWith("reply"))).toBe(false);
  expect(asked).not.toContain("WROTE A PLAIN NOTE");
});

test("without a token, nothing", async () => {
  expect((await post("job-3342", { body: "Yes", replyTo: "sm8-note-1" })).status).toBe(401);
  expect(asked).toEqual([]);
});
