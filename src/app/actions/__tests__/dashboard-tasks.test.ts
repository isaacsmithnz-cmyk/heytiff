/* The task actions the new Home's Tasks face calls, and the history each one
   leaves. Every rule is re-decided on the server, so every rule is pinned
   here: who may add, who may give, what a hand-over clears so the new person
   hears about it, and that a history line that fails to write never costs
   the change it describes. */

type Write = { table: string; row: Record<string, unknown> };

const inserts: Write[] = [];
const updates: Write[] = [];
const reads: { table: string; eq: Record<string, unknown> }[] = [];

let taskRow: Record<string, unknown> | null = null;
let staffRow: Record<string, unknown> | null = null;
let insertError: { message: string } | null = null;
let eventError: { code?: string; message: string } | null = null;
let eventThrows = false;
let allowed = new Set<string>();
let staffId: string | null = "s-me";

const table = (name: string) => {
  const read = { table: name, eq: {} as Record<string, unknown> };
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (col: string, val: unknown) => {
    read.eq[col] = val;
    return chain;
  };
  chain.maybeSingle = async () => {
    reads.push(read);
    return { data: name === "tasks" ? taskRow : name === "staff_profiles" ? staffRow : null };
  };
  chain.insert = (row: Record<string, unknown>) => {
    if (name === "task_events" && eventThrows) throw new Error("socket hang up");
    inserts.push({ table: name, row });
    const done: Record<string, unknown> = {};
    done.select = () => done;
    done.single = async () =>
      insertError ? { data: null, error: insertError } : { data: { id: "t-new" }, error: null };
    done.then = (res: (v: { error: unknown }) => unknown) =>
      Promise.resolve({ error: name === "task_events" ? eventError : null }).then(res);
    return done;
  };
  chain.update = (patch: Record<string, unknown>) => {
    updates.push({ table: name, row: patch });
    const done: Record<string, unknown> = {};
    done.eq = () => done;
    done.then = (res: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(res);
    return done;
  };
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn().mockResolvedValue({ user: { sub: "auth0|me" }, orgId: "org-1" }) },
}));
jest.mock("@/lib/permissions-server", () => ({ can: jest.fn(async (cap: string) => allowed.has(cap)) }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => staffId) }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: jest.fn(async () => null) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { addTask, completeTask, createTask, giveTask, reopenTask, setTaskDue } from "../dashboard";

const events = () => inserts.filter((w) => w.table === "task_events").map((w) => w.row);
const taskUpdates = () => updates.filter((w) => w.table === "tasks").map((w) => w.row);

let warn: jest.SpyInstance;
beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  reads.length = 0;
  taskRow = { assigned_to: "s-me", created_by: "s-me", status: "open", remind_at: null, due_date: null };
  staffRow = { id: "s-luke" };
  insertError = null;
  eventError = null;
  eventThrows = false;
  allowed = new Set();
  staffId = "s-me";
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("addTask — anyone may add their own", () => {
  it("makes an open task for the caller, without `team`, and says who it was made for", async () => {
    expect(await addTask("  Order the grilles  ")).toEqual({ ok: true, taskId: "t-new" });
    expect(inserts[0]).toEqual({
      table: "tasks",
      row: {
        org_id: "org-1",
        title: "Order the grilles",
        detail: null,
        assigned_to: "s-me",
        created_by: "s-me",
        due_date: null,
        status: "open",
      },
    });
    expect(events()).toEqual([
      {
        org_id: "org-1",
        task_id: "t-new",
        kind: "created",
        by_staff: "s-me",
        due_from: null,
        due_to: null,
        from_staff: null,
        to_staff: "s-me",
      },
    ]);
  });

  it("caps the title at 200", async () => {
    await addTask("x".repeat(250));
    expect(String(inserts[0].row.title)).toHaveLength(200);
  });

  it("refuses an empty title, and an account with no staff card", async () => {
    expect(await addTask("   ")).toEqual({ ok: false, error: "Give the task a title." });
    staffId = null;
    expect(await addTask("Order the grilles")).toEqual({ ok: false, error: "Not signed in." });
    expect(inserts).toEqual([]);
  });

  it("says so when the task did not save, and writes no history for it", async () => {
    insertError = { message: "boom" };
    expect(await addTask("Order the grilles")).toEqual({ ok: false, error: "Couldn't save that task." });
    expect(events()).toEqual([]);
  });
});

describe("giveTask — only managers give a task away", () => {
  beforeEach(() => {
    allowed = new Set(["team"]);
  });

  it("needs `team`", async () => {
    allowed = new Set();
    expect(await giveTask("t1", "s-luke")).toEqual({ ok: false, error: "You can't give tasks to other people." });
    expect(updates).toEqual([]);
  });

  it("hands it over, and the new person's bell and reminder start afresh", async () => {
    expect(await giveTask("t1", "s-luke")).toEqual({ ok: true });
    expect(taskUpdates()).toEqual([
      { assigned_to: "s-luke", acknowledged_at: null, reminder_emailed_at: null, updated_at: expect.any(String) },
    ]);
    expect(events()).toEqual([
      expect.objectContaining({ kind: "given", by_staff: "s-me", from_staff: "s-me", to_staff: "s-luke", task_id: "t1" }),
    ]);
  });

  it("looks the person up inside this organisation, and refuses anyone outside it", async () => {
    staffRow = null;
    expect(await giveTask("t1", "s-elsewhere")).toEqual({ ok: false, error: "That person isn't in this organisation." });
    expect(reads.find((r) => r.table === "staff_profiles")?.eq).toEqual({ org_id: "org-1", id: "s-elsewhere" });
    expect(updates).toEqual([]);
    expect(events()).toEqual([]);
  });

  it("refuses a done task and a task that has gone", async () => {
    taskRow = { assigned_to: "s-me", status: "done" };
    expect(await giveTask("t1", "s-luke")).toEqual({ ok: false, error: "That task is done." });
    taskRow = null;
    expect(await giveTask("t1", "s-luke")).toEqual({ ok: false, error: "That task no longer exists." });
    expect(updates).toEqual([]);
  });

  it("writes nothing when it goes to the person who already has it", async () => {
    taskRow = { assigned_to: "s-luke", status: "open" };
    expect(await giveTask("t1", "s-luke")).toEqual({ ok: true });
    expect(updates).toEqual([]);
    expect(events()).toEqual([]);
    expect(reads.filter((r) => r.table === "staff_profiles")).toEqual([]);
  });
});

describe("setTaskDue — the history says the date moved", () => {
  it("logs where it moved from and to", async () => {
    taskRow = { assigned_to: "s-me", created_by: "s-me", status: "open", remind_at: null, due_date: "2026-09-25" };
    expect(await setTaskDue("t1", "2026-10-02")).toEqual({ ok: true });
    expect(events()).toEqual([
      expect.objectContaining({ kind: "due", due_from: "2026-09-25", due_to: "2026-10-02", by_staff: "s-me" }),
    ]);
  });

  it("logs a date set and a date taken off", async () => {
    await setTaskDue("t1", "2026-10-02");
    taskRow = { assigned_to: "s-me", created_by: "s-me", status: "open", remind_at: null, due_date: "2026-10-02" };
    await setTaskDue("t1", null);
    expect(events().map((e) => [e.due_from, e.due_to])).toEqual([
      [null, "2026-10-02"],
      ["2026-10-02", null],
    ]);
  });

  it("logs nothing when the date did not change, even as a timestamp", async () => {
    taskRow = { assigned_to: "s-me", created_by: "s-me", status: "open", remind_at: null, due_date: "2026-10-02T00:00:00+00:00" };
    expect(await setTaskDue("t1", "2026-10-02")).toEqual({ ok: true });
    expect(taskUpdates()).toHaveLength(1);
    expect(events()).toEqual([]);
  });
});

describe("completeTask and reopenTask log every done and reopen", () => {
  it("logs done, then reopened", async () => {
    expect(await completeTask("t1")).toEqual({ ok: true });
    taskRow = { assigned_to: "s-me", status: "done" };
    expect(await reopenTask("t1")).toEqual({ ok: true });
    expect(events().map((e) => [e.kind, e.by_staff, e.task_id])).toEqual([
      ["done", "s-me", "t1"],
      ["reopened", "s-me", "t1"],
    ]);
  });

  it("still finishes the task when its history line fails to write", async () => {
    eventError = { code: "23514", message: "violates check constraint" };
    expect(await completeTask("t1")).toEqual({ ok: true });
    expect(taskUpdates()).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);

    eventThrows = true;
    taskRow = { assigned_to: "s-me", status: "done" };
    expect(await reopenTask("t1")).toEqual({ ok: true });
  });

  it("says nothing in the log before the table exists", async () => {
    eventError = { code: "PGRST205", message: "Could not find the table 'public.task_events'" };
    expect(await completeTask("t1")).toEqual({ ok: true });
    expect(warn).not.toHaveBeenCalled();
  });

  it("writes no history for a completion that was refused", async () => {
    taskRow = { assigned_to: "s-luke", status: "open" };
    expect(await completeTask("t1")).toEqual({ ok: false, error: "That task isn't yours to complete." });
    expect(events()).toEqual([]);
  });
});

describe("createTask — the old Home's Assign form, unchanged but for its history", () => {
  it("still makes the task for the person picked, and records who that was", async () => {
    allowed = new Set(["team"]);
    expect(await createTask({ assignedTo: "s-luke", title: "Order the grilles", dueDate: "2026-10-02" })).toEqual({
      ok: true,
    });
    expect(inserts[0].row).toMatchObject({ assigned_to: "s-luke", created_by: "s-me", due_date: "2026-10-02" });
    expect(events()).toEqual([expect.objectContaining({ kind: "created", to_staff: "s-luke", by_staff: "s-me" })]);
  });

  it("still needs `team`", async () => {
    expect(await createTask({ assignedTo: "s-luke", title: "Order the grilles" })).toEqual({
      ok: false,
      error: "You can't assign tasks.",
    });
  });
});
