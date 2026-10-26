/**
 * @jest-environment node
 */

/* Sending one of your notes to ServiceM8 from the phone: only where this
   deployment sends notes, only for a member who may write on the board,
   inside their own workspace, and only once the workspace offers notes. The
   press is minted from the context the real token check made, and the note,
   its job and that press are handed to the one send the job sheet's button
   uses. The send records what it was asked. */

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
jest.mock("@/lib/integrations/sm8-note-entry", () => ({
  notOffered: () => "Notes to ServiceM8 are switched off for this workspace.",
  sendEntryToSm8: async (press: unknown, state: { orgId: string }, input: { jobUuid: string; noteId: string }) => {
    const { isSm8Press } = jest.requireActual("@/lib/integrations/sm8-press");
    const p = press as { orgId: string; userId: string; staffId: string };
    asked.push(`send ${isSm8Press(press) ? "press" : "FORGED"} ${p.orgId} ${p.userId} ${p.staffId} ${state.orgId} ${input.jobUuid} ${input.noteId}`);
    if (input.noteId === "not-mine") return { ok: false, error: "Only the note's author can send it.", state: null };
    return { ok: true, state: { key: "queued", text: "Going to ServiceM8", tone: null, acts: [] } };
  },
}));

import { POST } from "../jobs/[id]/notes/[noteId]/sm8/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const NOTE = "8f2b6c1e-3d4a-4b5c-9e7f-0a1b2c3d4e5f";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const post = (job: string, noteId: string, sub?: string, org?: string) =>
  POST(
    new Request(`https://go.hey-tiff.com/api/mobile/jobs/${job}/notes/${noteId}/sm8`, {
      method: "POST",
      headers: { ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}), ...(org ? { "x-heytiff-org": org } : {}) },
    }),
    { params: Promise.resolve({ id: job, noteId }) },
  );

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  asked.length = 0;
  notesOn = true;
  offered = true;
  members = [
    { user_id: "auth0|lyle", org_id: "org-diamond", role: "staff", permissions: {} },
    { user_id: "auth0|otto", org_id: "org-other", role: "owner", permissions: {} },
  ];
});
afterAll(() => {
  process.env = env;
});

describe("refused before anything is sent", () => {
  test("without a token — even with a web session in the same process", async () => {
    expect((await post("job-3342", NOTE)).status).toBe(401);
    expect(asked).toEqual([]);
  });

  test("on another business's workspace", async () => {
    expect((await post("otto-job", NOTE, "auth0|lyle", "org-other")).status).toBe(403);
    expect(asked).toEqual([]);
  });

  test("without the board", async () => {
    members[0]!.permissions = { workboard: false };
    expect((await post("job-3342", NOTE, "auth0|lyle")).status).toBe(403);
    expect(asked).toEqual([]);
  });

  test("where this deployment doesn't send notes", async () => {
    notesOn = false;
    expect((await post("job-3342", NOTE, "auth0|lyle")).status).toBe(409);
    expect(asked).toEqual([]);
  });

  test("where the workspace doesn't offer notes, saying why", async () => {
    offered = false;
    const res = await post("job-3342", NOTE, "auth0|lyle");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Notes to ServiceM8 are switched off for this workspace.");
    expect(asked).toEqual(["state org-diamond"]);
  });
});

test("a note goes as the member, from their workspace, on the job a claim belongs to, with a real press", async () => {
  const res = await post("claim-7", NOTE, "auth0|lyle");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ state: { key: "queued", text: "Going to ServiceM8", tone: null, acts: [] } });
  expect(asked).toEqual([
    "state org-diamond",
    "resolve org-diamond claim-7",
    `send press org-diamond auth0|lyle card-org-diamond-auth0|lyle org-diamond job-3342 ${NOTE}`,
  ]);
});

test("the send's refusal is the phone's answer, in its own words", async () => {
  const res = await post("job-3342", "not-mine", "auth0|lyle");
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "Only the note's author can send it.", state: null });
});
