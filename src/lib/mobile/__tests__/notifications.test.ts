/**
 * @jest-environment node
 */

/* What the phone tells you: each loader's rows as one notification apiece,
   newest first, each opening its own screen; your reminders to come for the
   phone's clock; ServiceM8 asks only where you're linked and can see the
   board; nothing at all without a staff card. */

jest.mock("server-only", () => ({}));
let card: { id: string } | null = { id: "s-isaac" };
let upcoming: Record<string, unknown>[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "gt", "lte", "order", "limit"]) q[k] = () => q;
      q.maybeSingle = async () => ({ data: table === "staff_profiles" ? card : null, error: null });
      q.then = (res: (v: unknown) => unknown) => res({ data: table === "tasks" ? upcoming : [], error: null });
      return q;
    },
  },
}));
const asked: string[] = [];
jest.mock("@/lib/dashboard/assignments-query", () => ({
  newAssignments: async () => [{ taskId: "t1", title: "Grab a 15 m coil", detail: null, fromName: "Michael Diamond", dueDate: null, createdAt: "2026-10-26T01:00:00.000Z" }],
}));
jest.mock("@/lib/dashboard/reminders-query", () => ({
  dueReminders: async () => [{ taskId: "t2", title: "Ring the builder", detail: "About roof access", remindAt: "2026-10-26T02:00:00.000Z" }],
}));
jest.mock("@/lib/dashboard/todo-query", () => ({ unreadNotices: async () => [{ id: "nt1", title: "Toolbox talk Friday", from: "Isaac Smith", day: "2026-10-25" }] }));
jest.mock("@/lib/dashboard/mentions-query", () => ({
  listMyMentions: async (_o: string, mine: string) => {
    asked.push(`mentions ${mine}`);
    return [
      {
        key: "j-2935:u-mick",
        jobUuid: "j-2935",
        jobLabel: "2935 Railway Avenue",
        asker: { name: "Michael Diamond" },
        lastTheirs: "2026-10-26 08:58:43",
        answered: false,
        messages: [{ from: "them", text: "Can you get this equipment in next week" }],
      },
      { key: "j-1:u-mick", jobUuid: "j-1", jobLabel: null, asker: { name: "Michael Diamond" }, lastTheirs: "2026-10-26 07:00:00", answered: true, messages: [] },
    ];
  },
}));
jest.mock("@/lib/timepay/leave-query", () => ({
  ownDeclinedLeave: async () => [{ id: "lv1", kind: "annual", startDate: "2026-11-02", endDate: "2026-11-06", decidedOn: "2026-10-24T03:00:00.000Z" }],
}));
let links = new Map([["u-isaac-sm8", "s-isaac"]]);
jest.mock("@/lib/integrations/links", () => ({ sm8StaffLinkMap: async () => links }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: async () => "Australia/Sydney" }));

import { notificationsFor, wallToIso } from "../notifications";
import type { MobileCtx } from "../auth";

const ctx = (caps: string[] = ["workboard"]) => ({ userId: "auth0|isaac", orgId: "org-1", role: "owner", caps: new Set(caps), orgIds: ["org-1"] }) as unknown as MobileCtx;
const NOW = new Date("2026-10-26T03:00:00.000Z");

beforeEach(() => {
  card = { id: "s-isaac" };
  upcoming = [];
  asked.length = 0;
  links = new Map([["u-isaac-sm8", "s-isaac"]]);
});

it("turns each loader's rows into a notification apiece, newest first, each opening its screen", async () => {
  const { items } = await notificationsFor(ctx(), NOW);
  expect(items.map((n) => [n.kind, n.title, n.body, n.path])).toEqual([
    ["reminder", "Ring the builder", "About roof access", null],
    ["task", "Michael Diamond gave you a task", "Grab a 15 m coil", null],
    ["mention", "Michael Diamond on 2935 Railway Avenue", "Can you get this equipment in next week", "/job?id=j-2935"],
    ["notice", "Isaac Smith posted a notice", "Toolbox talk Friday", null],
    ["leave", "Your leave was declined", "Annual leave, Mon 2 – Fri 6 Nov", "/leave"],
  ]);
  // an answered ask isn't news
  expect(items.some((n) => n.id === "mention:j-1:u-mick")).toBe(false);
  expect(asked).toEqual(["mentions u-isaac-sm8"]);
});

it("reads ServiceM8's wall-clock stamps on the account's clock", () => {
  expect(wallToIso("2026-10-26 08:58:43", "Australia/Sydney")).toBe("2026-10-25T21:58:43.000Z");
  expect(wallToIso("2026-07-13", "Australia/Sydney")).toBe("2026-07-12T14:00:00.000Z");
});

it("asks ServiceM8 nothing for someone without the board, or not linked to their ServiceM8 person", async () => {
  await notificationsFor(ctx([]), NOW);
  links = new Map();
  await notificationsFor(ctx(), NOW);
  expect(asked).toEqual([]);
});

it("carries your reminders still to come, for the phone's own clock", async () => {
  upcoming = [{ id: "t9", title: "Order the grilles", detail: null, remind_at: "2026-10-27T21:00:00.000Z" }];
  const { upcoming: u } = await notificationsFor(ctx(), NOW);
  expect(u).toEqual([{ id: "t9", title: "Order the grilles", body: null, at: "2026-10-27T21:00:00.000Z", path: "/notifications" }]);
});

it("tells someone with no staff card nothing", async () => {
  card = null;
  expect(await notificationsFor(ctx(), NOW)).toEqual({ items: [], upcoming: [] });
});
