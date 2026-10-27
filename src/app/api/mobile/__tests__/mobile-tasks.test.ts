/**
 * @jest-environment node
 */

/* Your To do from the phone: the web's own task rules (task-actions,
   recorded here), behind the real token check. A tick files the task's Done
   with a press minted from that check, only for someone with the Workboard;
   an Undo takes it back the same way; nothing else posts one. */

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
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async (orgId: string, userId: string) => (userId === "auth0|nocard" ? null : `card-${userId}`) }));
jest.mock("@/lib/shell/revalidate-home", () => ({ revalidateHome: () => {} }));

const asked: string[] = [];
jest.mock("@/lib/dashboard/task-actions", () => ({
  addOwnTask: async (a: { staffId: string }, title: string, due: string | null) => (asked.push(`add ${a.staffId} ${title} ${due}`), { ok: true, taskId: "t-new" }),
  tickTask: async (a: { staffId: string }, id: string) => (asked.push(`tick ${a.staffId} ${id}`), id === "11111111-1111-4111-8111-111111111111" ? { ok: false, error: "That task is already done." } : { ok: true }),
  untickTask: async (a: { staffId: string }, id: string) => (asked.push(`untick ${a.staffId} ${id}`), { ok: true }),
  moveTaskDue: async (a: { staffId: string }, id: string, due: string | null) => (asked.push(`due ${a.staffId} ${id} ${due}`), { ok: true }),
  removeTask: async (a: { staffId: string; team: () => Promise<boolean> }, id: string) => (asked.push(`delete ${a.staffId} ${id} team:${await a.team()}`), { ok: true }),
}));
jest.mock("@/app/actions/task-sm8", () => ({
  sendTaskDoneAs: async (press: unknown, input: { taskId: string }) => {
    const { isSm8Press } = jest.requireActual("@/lib/integrations/sm8-press");
    asked.push(`done-note ${isSm8Press(press) ? "press" : "FORGED"} ${(press as { staffId: string }).staffId} ${input.taskId}`);
    return { ok: true, state: null };
  },
  takeBackTaskDoneAs: async (press: unknown, input: { taskId: string }) => {
    asked.push(`take-back ${(press as { staffId: string }).staffId} ${input.taskId}`);
    return { ok: true, state: null, note: "Luke's Done stays in ServiceM8." };
  },
}));
jest.mock("@/lib/dashboard/tasks-query", () => ({
  loadStaffNames: async () => new Map([["card-auth0|luke", "Luke Ingold"]]),
  myTasks: async (orgId: string, staffId: string) => [
    { id: "a", title: "Call Mary", detail: null, assigneeId: staffId, assigneeName: "Isaac", dueDate: null, status: "open", createdBy: staffId, createdAt: "2026-09-26T00:00:00Z", doneAt: null, doneByName: null, remindAt: null, remindKind: "at" },
    { id: "b", title: "Order the grilles", detail: null, assigneeId: staffId, assigneeName: "Isaac", dueDate: "2026-10-07", status: "open", createdBy: "card-auth0|luke", createdAt: "2026-10-06T00:00:00Z", doneAt: null, doneByName: null, remindAt: null, remindKind: "at" },
  ],
}));

import { GET, POST as ADD } from "../tasks/route";
import { POST, DELETE } from "../tasks/[id]/route";
import { MOBILE_AUDIENCE } from "@/lib/mobile/token";

const DOMAIN = "tenant.example.auth0.com";
const TASK = "8f2b6c1e-3d4a-4b5c-9e7f-0a1b2c3d4e5f";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const h = b64({ alg: "RS256", kid: "k1" });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
};
const req = (path: string, sub: string | null, method = "GET", body?: unknown) =>
  new Request(`https://go.hey-tiff.com/api/mobile/${path}`, {
    method,
    headers: { ...(sub ? { authorization: `Bearer ${mint(sub)}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const env = process.env;
beforeEach(() => {
  process.env = { ...env, AUTH0_DOMAIN: DOMAIN };
  asked.length = 0;
  members = [
    { user_id: "auth0|isaac", org_id: "org-diamond", role: "owner", permissions: {} },
    { user_id: "auth0|lyle", org_id: "org-diamond", role: "staff", permissions: { workboard: false } },
    { user_id: "auth0|nocard", org_id: "org-diamond", role: "staff", permissions: {} },
  ];
});
afterAll(() => {
  process.env = env;
});

test("a call without a token reads and changes nothing", async () => {
  expect((await GET(req("tasks", null))).status).toBe(401);
  expect((await POST(req(`tasks/${TASK}`, null, "POST", { do: "done" }), params(TASK))).status).toBe(401);
  expect(asked).toEqual([]);
});

test("your open tasks, in Home's order, with who gave each one where it wasn't you", async () => {
  const res = await GET(req("tasks", "auth0|isaac"));
  const body = await res.json();
  expect(body.tasks.map((t: { id: string }) => t.id)).toEqual(["b", "a"]);
  expect(body.tasks[0]).toMatchObject({ from: "Luke Ingold", own: false, dueDate: "2026-10-07" });
  expect(body.tasks[1]).toMatchObject({ from: null, own: true });
  /* no staff card, no tasks */
  expect((await (await GET(req("tasks", "auth0|nocard"))).json()).tasks).toEqual([]);
});

test("a task for yourself, with the date you picked", async () => {
  expect((await ADD(req("tasks", "auth0|isaac", "POST", { title: "Order the line set", dueDate: "2026-10-28" }))).status).toBe(200);
  expect((await ADD(req("tasks", "auth0|nocard", "POST", { title: "x" }))).status).toBe(403);
  expect(asked).toEqual(["add card-auth0|isaac Order the line set 2026-10-28"]);
});

test("a tick files its Done with the phone's own press, only with the Workboard; a refused tick files none", async () => {
  expect((await POST(req(`tasks/${TASK}`, "auth0|isaac", "POST", { do: "done" }), params(TASK))).status).toBe(200);
  expect((await POST(req(`tasks/${TASK}`, "auth0|lyle", "POST", { do: "done" }), params(TASK))).status).toBe(200);
  const done = "11111111-1111-4111-8111-111111111111";
  expect((await POST(req(`tasks/${done}`, "auth0|isaac", "POST", { do: "done" }), params(done))).status).toBe(409);
  expect(asked).toEqual([
    `tick card-auth0|isaac ${TASK}`,
    `done-note press card-auth0|isaac ${TASK}`,
    `tick card-auth0|lyle ${TASK}`,
    `tick card-auth0|isaac ${done}`,
  ]);
});

test("Undo reopens it and takes its Done back, saying whose it is where it isn't yours", async () => {
  const res = await POST(req(`tasks/${TASK}`, "auth0|isaac", "POST", { do: "reopen" }), params(TASK));
  expect(await res.json()).toEqual({ open: true, note: "Luke's Done stays in ServiceM8." });
  expect(asked).toEqual([`untick card-auth0|isaac ${TASK}`, `take-back card-auth0|isaac ${TASK}`]);
});

test("a date moves or comes off; a delete carries whether you hold team; anything else is refused", async () => {
  await POST(req(`tasks/${TASK}`, "auth0|isaac", "POST", { do: "due", dueDate: "2026-10-30" }), params(TASK));
  await POST(req(`tasks/${TASK}`, "auth0|isaac", "POST", { do: "due", dueDate: null }), params(TASK));
  expect((await POST(req(`tasks/${TASK}`, "auth0|isaac", "POST", { do: "due" }), params(TASK))).status).toBe(400);
  expect((await POST(req(`tasks/${TASK}`, "auth0|isaac", "POST", { do: "rename" }), params(TASK))).status).toBe(400);
  await DELETE(req(`tasks/${TASK}`, "auth0|isaac", "DELETE"), params(TASK));
  await DELETE(req(`tasks/${TASK}`, "auth0|lyle", "DELETE"), params(TASK));
  expect((await POST(req("tasks/not-a-task", "auth0|isaac", "POST", { do: "done" }), params("not-a-task"))).status).toBe(404);
  expect(asked).toEqual([
    `due card-auth0|isaac ${TASK} 2026-10-30`,
    `due card-auth0|isaac ${TASK} null`,
    `delete card-auth0|isaac ${TASK} team:true`,
    `delete card-auth0|lyle ${TASK} team:false`,
  ]);
});
