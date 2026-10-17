/* New › Task's one action (v2, rules 44 and 51): what needs doing, the job
   it is for or none, when, and who. Every rule is re-decided here, so every
   rule is pinned: a job goes on the task, a task with a job is kept without
   it while the column is missing, a time needs a day, and only someone who
   may give work hands it to someone else. */

const inserts: Record<string, unknown>[] = [];
let failWithJob = false;
let staffRow: Record<string, unknown> | null = { id: "s-lyle" };
let allowed = new Set<string>();

const table = (name: string) => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = async () => ({ data: name === "staff_profiles" ? staffRow : null });
  chain.insert = (given: Record<string, unknown> | Record<string, unknown>[]) => {
    const rows = Array.isArray(given) ? given : [given];
    const withJob = rows.some((r) => "sm8_job_uuid" in r);
    if (name === "tasks") inserts.push(...rows);
    const answer =
      name === "tasks" && failWithJob && withJob
        ? { data: null, error: { code: "PGRST204", message: "column sm8_job_uuid does not exist" } }
        : { data: rows.map((_, i) => ({ id: `t-${i + 1}` })), error: null };
    const done: Record<string, unknown> = {};
    done.select = () => done;
    done.then = (res: (v: unknown) => unknown) => Promise.resolve(name === "tasks" ? answer : { error: null }).then(res);
    return done;
  };
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn().mockResolvedValue({ user: { sub: "auth0|me" }, orgId: "org-1" }) },
}));
jest.mock("@/lib/permissions-server", () => ({ can: jest.fn(async (cap: string) => allowed.has(cap)) }));
jest.mock("@/lib/fleet/query", () => ({
  staffProfileIdFor: jest.fn(async () => "s-me"),
  listFleetStaff: jest.fn(async () => [
    { id: "s-me", name: "Isaac Smith" },
    { id: "s-lyle", name: "Lyle Irving" },
  ]),
}));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: jest.fn(async () => "Australia/Sydney") }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { makeTasks, taskPeople } from "../dashboard";

const last = () => inserts[inserts.length - 1]!;

beforeEach(() => {
  inserts.length = 0;
  failWithJob = false;
  staffRow = { id: "s-lyle" };
  allowed = new Set();
});

describe("makeTasks", () => {
  it("makes a general task for you, with no job and no day", async () => {
    expect(await makeTasks({ text: "  Order the grilles " })).toEqual({ ok: true, taskIds: ["t-1"] });
    expect(last()).toMatchObject({ title: "Order the grilles", assigned_to: "s-me", created_by: "s-me", due_date: null, remind_at: null, remind_kind: null });
    expect(last()).not.toHaveProperty("sm8_job_uuid");
  });

  it("puts the task on the job it was made for", async () => {
    expect(await makeTasks({ text: "Order the grilles", jobUuid: "job-3209" })).toEqual({ ok: true, taskIds: ["t-1"], jobKept: true });
    expect(last()).toMatchObject({ sm8_job_uuid: "job-3209" });
  });

  it("keeps a task without its job while the job column isn't there, and says so", async () => {
    failWithJob = true;
    expect(await makeTasks({ text: "Order the grilles", jobUuid: "job-3209" })).toEqual({ ok: true, taskIds: ["t-1"], jobKept: false });
    expect(inserts).toHaveLength(2);
    expect(last()).not.toHaveProperty("sm8_job_uuid");
  });

  it("files a day, and a time on it as the time to have it done by", async () => {
    await makeTasks({ text: "x", dueDate: "2026-10-21", dueTime: "12:30 PM" });
    expect(last()).toMatchObject({ due_date: "2026-10-21", remind_kind: "by" });
    expect(last().remind_at).toBe("2026-10-21T01:30:00.000Z");
  });

  it("drops a time with no day, and refuses a day it can't read", async () => {
    await makeTasks({ text: "x", dueTime: "9:00 AM" });
    expect(last()).toMatchObject({ due_date: null, remind_at: null });
    expect(await makeTasks({ text: "x", dueDate: "Tuesday" })).toEqual({ ok: false, error: "Check the day." });
  });

  it("makes one task a line, sharing the job, the day and the person", async () => {
    allowed = new Set(["team"]);
    const res = await makeTasks({ text: "Order the grilles\n\n  Book the crane \nCall Rifkin", jobUuid: "job-3209", dueDate: "2026-10-21", forStaffId: "s-lyle" });
    expect(res).toEqual({ ok: true, taskIds: ["t-1", "t-2", "t-3"], jobKept: true });
    expect(inserts.map((r) => r.title)).toEqual(["Order the grilles", "Book the crane", "Call Rifkin"]);
    for (const r of inserts) expect(r).toMatchObject({ sm8_job_uuid: "job-3209", due_date: "2026-10-21", assigned_to: "s-lyle" });
  });

  it("makes no more than twenty in one go", async () => {
    await makeTasks({ text: Array.from({ length: 30 }, (_, i) => `Task ${i}`).join("\n") });
    expect(inserts).toHaveLength(20);
  });

  it("says why it won't save without words", async () => {
    expect(await makeTasks({ text: "   " })).toEqual({ ok: false, error: "Say what needs doing." });
    expect(inserts).toHaveLength(0);
  });

  it("gives it to someone else only for a person who may give work, and only to the team", async () => {
    expect(await makeTasks({ text: "x", forStaffId: "s-lyle" })).toEqual({ ok: false, error: "You can't give tasks to other people." });
    allowed = new Set(["team"]);
    await makeTasks({ text: "x", forStaffId: "s-lyle" });
    expect(last()).toMatchObject({ assigned_to: "s-lyle", created_by: "s-me" });
    staffRow = null;
    expect(await makeTasks({ text: "x", forStaffId: "s-nobody" })).toEqual({ ok: false, error: "That person isn't on the team." });
  });
});

describe("taskPeople", () => {
  it("is you alone without the team grant, and the team with it", async () => {
    expect(await taskPeople()).toEqual({ me: "s-me", people: [] });
    allowed = new Set(["team"]);
    expect((await taskPeople()).people.map((p) => p.name)).toEqual(["Isaac Smith", "Lyle Irving"]);
  });
});
