/**
 * @jest-environment node
 */

/* Tiff doing things from the phone, behind the real token check and the real
   session wrapper (lib/auth0 over a stand-in SDK): the web's note router
   (recorded here) runs as the token's own person — `auth0.getSession()`
   inside it is them — decided in the web conversation's order: a question
   goes to her answer, anything else is routed, asked about, and filed, with
   Undo. */

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
/* the SDK: a browser session that is nobody's phone */
jest.mock("@auth0/nextjs-auth0/server", () => ({
  Auth0Client: class {
    async getSession() {
      return { user: { sub: "auth0|browser" }, orgId: "org-browser" };
    }
  },
}));

const asked: string[] = [];
/* whether each file asked for the note's library entries to go in with it (bug 97) */
const library: boolean[] = [];
type PlanRow = { key: string; lane: string; index: number; lead: string; join: string; text: string; needs: boolean };
const LUKE: PlanRow = { key: "tasks:0", lane: "tasks", index: 0, lead: "Luke", join: ", ", text: "order the grilles for 2935 · Fri", needs: false };
let planRows: PlanRow[] = [LUKE];
const as = async () => {
  const { auth0 } = jest.requireActual("@/lib/auth0") as typeof import("@/lib/auth0");
  const s = await auth0.getSession();
  return `${s?.user.sub}@${s?.orgId}`;
};
const proposal = (over: Record<string, unknown> = {}) => ({ say: "", clarify: null, nothing: false, ...over });
let fileAnswer: Record<string, unknown> = { ok: true, summary: "1 task", doors: [{ kind: "tasks", count: 1, label: "1 task filed", ids: ["t-1"] }], turns: [{ who: "tiff", text: "Luke has it." }] };
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: async (input: { transcript: string; target: { kind: string } }) => {
    asked.push(`route as ${await as()}: ${input.transcript} on ${input.target.kind}`);
    if (input.transcript.includes("nothing")) return { ok: true, noteId: "n-0", proposal: proposal({ nothing: true }), staff: [], turns: [] };
    if (input.transcript.includes("grille moved"))
      return { ok: true, noteId: "n-3", proposal: proposal({ say: "I'll file a variation. Who should go to move it?", clarify: { question: "Who should go to move the grille?", options: ["Anyone", "Isaac Smith", "Luke Ingram"], who: "go" } }), staff: [], turns: [] };
    if (input.transcript.includes("Book Leo")) return { ok: true, noteId: "n-2", proposal: proposal({ say: "Leo on 3304.", clarify: { question: "Which day?", options: ["Tomorrow", "Friday"] } }), staff: [], turns: [] };
    return { ok: true, noteId: "n-1", proposal: proposal(), staff: [], turns: [] };
  },
  fileNote: async (id: string, opts: { retarget?: { id: string }; library?: boolean }) => (
    asked.push(`file as ${await as()}: ${id}${opts.retarget ? ` on ${opts.retarget.id}` : ""}`), (library.push(!!opts.library), fileAnswer)
  ),
  continueNote: async (id: string, words: string) => (asked.push(`reply as ${await as()}: ${id} ${words}`), { ok: true, noteId: id, proposal: proposal(), staff: [], turns: [] }),
  answerVisit: async (id: string, answer: string) => (asked.push(`visit ${id} ${answer}`), { ok: true, visit: { index: 0, how: "booking", title: "Install", line: "Leo, Thursday 29 October, 7:00 am to 3:00 pm", aside: "", undo: true }, turns: [{ who: "tiff", text: "Leo's on 3304 tomorrow." }] }),
  undoNote: async (id: string) => (asked.push(`undo as ${await as()}: ${id}`), { ok: true, summary: "", turns: [{ who: "tiff", text: "Taken back." }] }),
  dismissNote: async (id: string) => (asked.push(`away ${id}`), { ok: true, summary: "" }),
  keepWords: async () => ({ ok: true, noteId: "n-k" }),
}));
jest.mock("@/lib/workboard/note-draft", () => ({ filesNothing: (p: { nothing?: boolean }) => !!p.nothing }));
jest.mock("@/components/tiff/modal/plan-view", () => ({
  ...jest.requireActual("@/components/tiff/modal/plan-view"),
  planView: () => planRows,
}));

import { POST } from "../tiff/note/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";
import { WHICH_JOB } from "@/lib/workboard/note-turns";
import { datesInWords } from "@/lib/mobile/tiff-notes";

const DOMAIN = "tenant.example.auth0.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const say = async (sub: string | null, body: unknown) => {
  const res = await POST(
    new Request("https://go.hey-tiff.com/api/mobile/tiff/note", {
      method: "POST",
      headers: { ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}), "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, body: (await res.json()) as { turns?: Record<string, unknown>[]; error?: string } };
};
const words = (w: string) => ({ do: "say", words: w, source: "text", before: [] });

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  asked.length = 0;
  library.length = 0;
  planRows = [LUKE];
  fileAnswer = { ok: true, summary: "1 task", doors: [{ kind: "tasks", count: 1, label: "1 task filed", ids: ["t-1"] }], turns: [{ who: "tiff", text: "Luke has it." }] };
  members = [
    { user_id: "auth0|isaac", org_id: "org-1", role: "owner", permissions: {} },
    { user_id: "auth0|office", org_id: "org-1", role: "staff", permissions: { workboard: false } },
  ];
});
afterAll(() => {
  process.env = env;
});

test("no token, or no Workboard, files nothing", async () => {
  expect((await say(null, words("Make Luke a task"))).status).toBe(401);
  expect((await say("auth0|office", words("Make Luke a task"))).status).toBe(403);
  expect(asked).toEqual([]);
});

test("a question goes to her answer, untouched by the router", async () => {
  expect((await say("auth0|isaac", words("What's on for Leo tomorrow?"))).body.turns).toEqual([{ kind: "ask" }]);
  expect(asked).toEqual([]);
});

test("something to do is routed and filed AS the token's own person, never the browser's", async () => {
  const r = await say("auth0|isaac", words("Make Luke a task to order the grilles for 2935 by Friday"));
  expect(r.body.turns).toEqual([
    { kind: "filed", noteId: "n-1", say: "Luke has it.", rows: [{ key: "tasks:0", lead: "Luke", join: ", ", text: "order the grilles for 2935 · Fri", needs: false }], doors: ["1 task filed"], visits: [] },
  ]);
  expect(asked).toEqual(["route as auth0|isaac@org-1: Make Luke a task to order the grilles for 2935 by Friday on none", "file as auth0|isaac@org-1: n-1"]);
});

test("what she can't work out she asks, and the answer is the note's", async () => {
  const r = await say("auth0|isaac", words("Book Leo on 3304"));
  expect(r.body.turns).toEqual([expect.objectContaining({ kind: "asks", noteId: "n-2", say: "Leo on 3304. Which day?", options: [{ label: "Tomorrow" }, { label: "Friday" }], answer: "reply" })]);
  await say("auth0|isaac", { do: "reply", noteId: "n-2", words: "Tomorrow" });
  expect(asked.slice(-2)).toEqual(["reply as auth0|isaac@org-1: n-2 Tomorrow", "file as auth0|isaac@org-1: n-2"]);
});

test("which job is a pick, filed on the job picked; a visit's time is its own answer", async () => {
  fileAnswer = { ok: false, error: "", ask: { question: WHICH_JOB, options: [{ label: "2935 Trial Ave", target: { kind: "job", id: "j-2935" } }] }, turns: [{ who: "tiff", text: WHICH_JOB }] };
  const r = await say("auth0|isaac", words("Order the grilles"));
  expect(r.body.turns).toEqual([expect.objectContaining({ kind: "asks", answer: "job", options: [{ label: "2935 Trial Ave", target: { kind: "job", id: "j-2935" } }] })]);
  await say("auth0|isaac", { do: "job", noteId: "n-1", target: { kind: "job", id: "j-2935" } });
  expect(asked.slice(-1)).toEqual(["file as auth0|isaac@org-1: n-1 on j-2935"]);
  const v = await say("auth0|isaac", { do: "visit", noteId: "n-2", answer: "7:00 am" });
  expect(v.body.turns).toEqual([{ kind: "filed", noteId: "n-2", say: "Leo's on 3304 tomorrow.", rows: [], doors: [], visits: ["Leo, Thursday 29 October, 7:00 am to 3:00 pm"] }]);
});

test("a question comes once: with nothing filed yet it carries the plan and no Undo; after a filing it isn't the filing's words", async () => {
  fileAnswer = { ok: true, summary: "", doors: [], ask: { question: "Make the job in ServiceM8?", options: [{ label: "Make the job" }, { label: "Not now" }] }, turns: [{ who: "tiff", text: "Make the job in ServiceM8?" }] };
  const r = await say("auth0|isaac", words("Peter Quartermain wants a return visit"));
  expect(r.body.turns).toEqual([expect.objectContaining({ kind: "asks", say: "Make the job in ServiceM8?", rows: [expect.objectContaining({ lead: "Luke" })] })]);
  fileAnswer = { ...fileAnswer, doors: [{ kind: "tasks", count: 1, label: "1 task filed", ids: ["t-1"] }] };
  const f = await say("auth0|isaac", words("Peter Quartermain wants a return visit"));
  expect(f.body.turns?.map((x) => [x.kind, x.say])).toEqual([
    ["filed", "Done."],
    ["asks", "Make the job in ServiceM8?"],
  ]);
});

/* bug 88 (Isaac, 24 November 2026): "It should be a dropdown. With... The label, anyone, and then specific staff underneath" */
test("who goes is asked once and drawn as one dropdown under its label", async () => {
  const r = await say("auth0|isaac", words("the client wants the grille moved"));
  expect(r.body.turns).toEqual([
    expect.objectContaining({
      kind: "asks",
      say: "I'll file a variation. Who should go to move it?",
      options: [{ label: "Anyone" }, { label: "Isaac Smith" }, { label: "Luke Ingram" }],
      answer: "reply",
      who: "Who goes",
    }),
  ]);
});

test("No job is an answer to which job: it files past the question, on none", async () => {
  // filed with a target of none, which `fileNote` reads as the note's own
  await say("auth0|isaac", { do: "job", noteId: "n-1", target: { kind: "none" } });
  expect(asked.slice(-1)).toEqual(["file as auth0|isaac@org-1: n-1 on undefined"]);
});

test("her dates are said in words", () => {
  expect(datesInWords("the end of next Friday (2026-11-27), Peter Quartermain")).toBe("the end of next Friday (Fri 27 Nov), Peter Quartermain");
});

test("nothing to file is set aside and answered instead; Undo takes a note back as its author", async () => {
  expect((await say("auth0|isaac", words("nothing much on at 2935 today"))).body.turns).toEqual([{ kind: "ask" }]);
  expect(asked).toContain("away n-0");
  expect((await say("auth0|isaac", { do: "undo", noteId: "n-1" })).body.turns).toEqual([{ kind: "said", say: "Taken back.", failed: false }]);
  expect(asked.slice(-1)).toEqual(["undo as auth0|isaac@org-1: n-1"]);
  expect((await say("auth0|isaac", { do: "rename" })).status).toBe(400);
});

/* bug 97 (Isaac, 25 November 2026: "where it says for everyone... Put in brackets saying, 'Added to library'") */
test("a library entry goes in with the note from the phone, and says added only once it's in", async () => {
  const kb = (index: number, text: string): PlanRow => ({ key: `kbEntries:${index}`, lane: "kbEntries", index, lead: "For everyone", join: ", ", text, needs: false });
  planRows = [LUKE, kb(0, "Clearing an E6"), kb(1, "Filter sizes")];
  fileAnswer = { ...fileAnswer, library: [{ index: 0, added: true }, { index: 1, added: false }] };
  const r = await say("auth0|isaac", words("Make Luke a task, and everyone should know how to clear an E6"));
  expect(library).toEqual([true]);
  expect((r.body.turns?.[0]?.rows as { lead: string; text: string }[]).map((x) => [x.lead, x.text])).toEqual([
    ["Luke", "order the grilles for 2935 · Fri"],
    ["For everyone (added to the Library)", "Clearing an E6"],
    ["For everyone (not added to the Library)", "Filter sizes"],
  ]);
});

test("an entry the web didn't say went in keeps its plain lead", async () => {
  planRows = [{ key: "kbEntries:0", lane: "kbEntries", index: 0, lead: "For everyone", join: ", ", text: "Clearing an E6", needs: false }];
  const r = await say("auth0|isaac", words("Everyone should know how to clear an E6"));
  expect((r.body.turns?.[0]?.rows as { lead: string }[]).map((x) => x.lead)).toEqual(["For everyone"]);
});
