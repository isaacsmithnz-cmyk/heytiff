/* The Tasks face's reads. What can go wrong here is who sees what — someone
   else's diary words, the board's jobs without the board — and asking the
   database once per task instead of once per kind. */

type Call = {
  table: string;
  columns?: string;
  eq: Record<string, unknown>;
  in?: [string, string[]];
  or?: string;
  gte?: [string, string];
  order?: [string, unknown];
  limit?: number;
};

let rows: Record<string, Record<string, unknown>[]> = {};
let failing: Record<string, { code: string; message: string }> = {};
const calls: Call[] = [];

const table = (name: string) => {
  const call: Call = { table: name, eq: {} };
  calls.push(call);
  const chain: Record<string, unknown> = {};
  chain.select = (cols: string) => {
    call.columns = cols;
    return chain;
  };
  chain.eq = (col: string, val: unknown) => {
    call.eq[col] = val;
    return chain;
  };
  chain.in = (col: string, vals: string[]) => {
    call.in = [col, vals];
    return chain;
  };
  chain.or = (f: string) => {
    call.or = f;
    return chain;
  };
  chain.gte = (col: string, v: string) => {
    call.gte = [col, v];
    return chain;
  };
  chain.order = (col: string, o: unknown) => {
    call.order = [col, o];
    return chain;
  };
  chain.limit = (n: number) => {
    call.limit = n;
    return chain;
  };
  chain.then = (res: (v: { data: unknown; error: unknown }) => unknown) => {
    if (failing[name]) return Promise.resolve({ data: null, error: failing[name] }).then(res);
    /* Answer the way the database would: only the ids asked for, only the
       rows every `eq` matches. */
    let data = rows[name] ?? [];
    if (call.in) {
      const [col, vals] = call.in;
      data = data.filter((r) => vals.includes(String(r[col])));
    }
    for (const [col, val] of Object.entries(call.eq)) data = data.filter((r) => !(col in r) || r[col] === val);
    if (call.limit !== undefined) data = data.slice(0, call.limit);
    return Promise.resolve({ data, error: null }).then(res);
  };
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));

import { DONE_LIMIT, doneTaskRecord, loadTasksFace, type TasksFaceContext } from "../task-record-query";
import type { Capability } from "@/lib/permissions";

const ORG = "org-1";
const ME = "11111111-1111-4111-8111-111111111111";
const LUKE = "22222222-2222-4222-8222-222222222222";
const LEO = "33333333-3333-4333-8333-333333333333";
const names = new Map([
  [ME, "Isaac Smith"],
  [LUKE, "Luke Ingold"],
  [LEO, "Leo Park"],
  ["44444444-4444-4444-8444-444444444444", "Nobody Here"],
]);
const NOW = new Date("2026-09-24T03:00:00Z");

/** A task id: uuid-shaped, as every id in a filter string must be. */
const tid = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;

const taskRow = (n: number, over: Record<string, unknown> = {}) => ({
  id: tid(n),
  org_id: ORG,
  title: `Task ${n}`,
  detail: null,
  assigned_to: ME,
  created_by: ME,
  due_date: null,
  status: "open",
  created_at: "2026-09-18T03:42:00Z",
  done_at: null,
  done_by: null,
  remind_at: null,
  remind_kind: null,
  acknowledged_at: null,
  ...over,
});

const ctx = (over: Partial<TasksFaceContext> = {}, ...caps: Capability[]): TasksFaceContext => ({
  orgId: ORG,
  viewerStaffId: ME,
  caps: new Set<Capability>(caps),
  names,
  ...over,
});

beforeEach(() => {
  rows = {};
  failing = {};
  calls.length = 0;
});

const of = (t: string) => calls.filter((c) => c.table === t);

describe("open", () => {
  it("reads only your own open tasks without `team`", async () => {
    rows.tasks = [taskRow(1)];
    const rec = await loadTasksFace(ctx(), NOW);
    const [open] = of("tasks").filter((c) => c.eq.status === "open");
    expect(open.eq).toEqual({ org_id: ORG, status: "open", assigned_to: ME });
    expect(rec.open.map((t) => t.id)).toEqual([tid(1)]);
  });

  it("adds the team's delegated work with `team`, and never a colleague's own to-do", async () => {
    rows.tasks = [
      taskRow(1),
      taskRow(2, { assigned_to: LUKE, created_by: ME, due_date: "2026-09-20" }),
      // Luke's private to-do: his business, not management's
      taskRow(3, { assigned_to: LUKE, created_by: LUKE }),
    ];
    const rec = await loadTasksFace(ctx({}, "team"), NOW);
    const [open] = of("tasks").filter((c) => c.eq.status === "open");
    expect(open.eq).toEqual({ org_id: ORG, status: "open" });
    // most urgent first: the dated one leads
    expect(rec.open.map((t) => t.id)).toEqual([tid(2), tid(1)]);
  });

  it("carries the three facts the face adds to a task", async () => {
    rows.tasks = [taskRow(1, { assigned_to: LUKE, acknowledged_at: "2026-09-19T00:00:00Z" })];
    const [t] = (await loadTasksFace(ctx({}, "team"), NOW)).open;
    expect(t).toMatchObject({ createdByName: "Isaac Smith", doneById: null, acknowledgedAt: "2026-09-19T00:00:00Z" });
    expect(of("tasks")[0].columns).toContain("acknowledged_at");
  });
});

describe("doneTaskRecord", () => {
  it("reads the viewer's done work of the last 90 days, newest first, at most 100", async () => {
    rows.tasks = [taskRow(1, { status: "done", done_at: "2026-09-20T00:00:00Z", done_by: LUKE })];
    const { done, capped } = await doneTaskRecord(ORG, ME, names, NOW);
    const [call] = of("tasks");
    expect(call.eq).toEqual({ org_id: ORG, status: "done" });
    expect(call.gte).toEqual(["done_at", "2026-06-26T03:00:00.000Z"]);
    expect(call.or).toBe(`assigned_to.eq.${ME},created_by.eq.${ME},done_by.eq.${ME}`);
    expect(call.order).toEqual(["done_at", { ascending: false }]);
    expect(call.limit).toBe(DONE_LIMIT);
    expect(done.map((t) => [t.id, t.doneById])).toEqual([[tid(1), LUKE]]);
    expect(capped).toBe(false);
  });

  it("says when Done stopped at its limit", async () => {
    rows.tasks = Array.from({ length: 101 }, (_, i) => taskRow(i + 1, { status: "done", done_at: "2026-09-20T00:00:00Z" }));
    const { done, capped } = await doneTaskRecord(ORG, ME, names, NOW);
    expect(done).toHaveLength(100);
    expect(capped).toBe(true);
  });

  it("puts nothing that is not a staff id into the filter", async () => {
    expect(await doneTaskRecord(ORG, "x,created_by.neq.null", names, NOW)).toEqual({ done: [], capped: false });
    expect(calls).toHaveLength(0);
  });
});

describe("about", () => {
  const note = (id: string, taskIds: string[], over: Record<string, unknown> = {}) => ({
    id,
    org_id: ORG,
    author_id: ME,
    source: "voice",
    transcript: `words of ${id}`,
    created_at: "2026-08-22T13:42:00Z",
    target_kind: "none",
    target_id: null,
    applied: { taskIds },
    status: "applied",
    ...over,
  });

  it("finds the diary entry that made a task, one condition per task, forty to a read", async () => {
    rows.tasks = Array.from({ length: 45 }, (_, i) => taskRow(i + 1));
    rows.workboard_notes = [note("n1", [tid(1)])];
    const rec = await loadTasksFace(ctx(), NOW);
    const reads = of("workboard_notes");
    expect(reads).toHaveLength(2);
    expect(reads[0].eq).toEqual({ org_id: ORG, status: "applied" });
    expect(reads[0].or!.split(",")).toHaveLength(40);
    expect(reads[1].or!.split(",")).toHaveLength(5);
    expect(reads[0].or!.split(",")[0]).toBe(`applied->taskIds.cs.["${tid(1)}"]`);
    expect(rec.about[tid(1)]).toMatchObject({ source: "diary", noteId: "n1", authorId: ME, spoken: true });
    expect(rec.about[tid(2)].source).toBe("typed");
  });

  it("puts no id that is not a uuid into the diary's filter", async () => {
    rows.tasks = [taskRow(1), taskRow(2, { id: 'x"],id.not.is.null,x' })];
    await loadTasksFace(ctx(), NOW);
    const [read] = of("workboard_notes");
    expect(read.or).toBe(`applied->taskIds.cs.["${tid(1)}"]`);
  });

  it("gives the diary's words to their author and to nobody else", async () => {
    rows.tasks = [taskRow(1, { assigned_to: LUKE })];
    rows.workboard_notes = [note("n1", [tid(1)])];
    const mine = await loadTasksFace(ctx({}, "team"), NOW);
    expect(mine.about[tid(1)].words).toBe("words of n1");
    const luke = await loadTasksFace(ctx({ viewerStaffId: LUKE }), NOW);
    expect(luke.about[tid(1)]).toMatchObject({ source: "diary", authorId: ME, words: null });
  });

  it("joins a ServiceM8 task to its note, its writer and its job", async () => {
    rows.tasks = [taskRow(1)];
    rows.job_note_actions = [
      { org_id: ORG, action: "task", task_id: tid(1), sm8_note_uuid: "note-1", sm8_job_uuid: "job-1", acted_by: null, acted_at: "2026-09-21T04:00:00Z" },
    ];
    rows.sm8_job_notes = [
      { org_id: ORG, uuid: "note-1", note: "@isaacsmith grilles for susie@peterson.com", edit_by_staff_uuid: "sm8-luke", create_date: "2026-09-21 13:42:10" },
    ];
    rows.sm8_staff = [{ org_id: ORG, uuid: "sm8-luke", first: "Luke", last: "Ingold" }];
    rows.sm8_jobs = [{ org_id: ORG, uuid: "job-1", generated_job_id: "2041", geo_city: "Wollstonecraft" }];
    const rec = await loadTasksFace(ctx({}, "workboard"), NOW);
    expect(rec.about[tid(1)]).toMatchObject({
      source: "sm8",
      sm8NoteUuid: "note-1",
      askerName: "Luke Ingold",
      actedBy: null,
      said: { day: "2026-09-21", time: "1:42 pm" },
      // as written: the face quotes it, taking out only the handles it knows
      words: "@isaacsmith grilles for susie@peterson.com",
      job: { label: "2041 Wollstonecraft", uuid: "job-1" },
    });
    expect(of("job_note_actions")[0].eq).toEqual({ org_id: ORG, action: "task" });
    expect(of("sm8_staff")[0].in).toEqual(["uuid", ["sm8-luke"]]);
  });

  it("takes the job from the note action, then the diary's job target, then the project", async () => {
    rows.tasks = [taskRow(1), taskRow(2), taskRow(3), taskRow(4)];
    rows.job_note_actions = [
      { org_id: ORG, action: "task", task_id: tid(1), sm8_note_uuid: "note-1", sm8_job_uuid: "job-1", acted_by: ME, acted_at: null },
    ];
    rows.workboard_notes = [
      // a note that made task 1 too: the action's job still wins
      note("n1", [tid(1), tid(2)], { target_kind: "job", target_id: "job-2" }),
      note("n3", [tid(3)], { target_kind: "visit", target_id: "v1" }),
    ];
    rows.sm8_jobs = [
      { org_id: ORG, uuid: "job-1", generated_job_id: "2041", geo_city: "Wollstonecraft" },
      { org_id: ORG, uuid: "job-2", generated_job_id: "3271", geo_city: "Mosman" },
    ];
    rows.maintenance_visits = [{ org_id: ORG, id: "v1", agreement_id: "a1", job_number: "1042", job_no: null }];
    rows.maintenance_agreements = [{ org_id: ORG, id: "a1", label: "Quarterly service", client_name: "Bayview Apartments" }];
    rows.projects = [{ org_id: ORG, id: "p1", name: "Fit-out", client_name: "Harbour St", defects_task_id: tid(4) }];

    const rec = await loadTasksFace(ctx({}, "workboard"), NOW);
    expect(rec.about[tid(1)].job).toEqual({ label: "2041 Wollstonecraft", uuid: "job-1" });
    expect(rec.about[tid(2)].job).toEqual({ label: "3271 Mosman", uuid: "job-2" });
    // a visit has words and no door
    expect(rec.about[tid(3)].job).toEqual({ label: "Job 1042, Bayview Apartments", uuid: null });
    expect(rec.about[tid(4)]).toMatchObject({
      source: "project",
      project: "Fit-out",
      job: { label: "Harbour St, Fit-out", uuid: null },
    });
    // one read per table, not one per task
    expect(of("sm8_jobs")).toHaveLength(1);
    expect(of("sm8_jobs")[0].in![1].sort()).toEqual(["job-1", "job-2"]);
  });

  it("reads nothing of the board's without `workboard`", async () => {
    rows.tasks = [taskRow(1)];
    rows.workboard_notes = [note("n1", [tid(1)], { target_kind: "visit", target_id: "v1" })];
    rows.job_note_actions = [
      { org_id: ORG, action: "task", task_id: tid(1), sm8_note_uuid: "note-1", sm8_job_uuid: "job-1", acted_by: null, acted_at: null },
    ];
    const rec = await loadTasksFace(ctx({}, "team"), NOW);
    for (const t of [
      "job_note_actions",
      "projects",
      "sm8_job_notes",
      "sm8_staff",
      "sm8_jobs",
      "sm8_companies",
      "maintenance_visits",
      "maintenance_agreements",
    ]) {
      expect(of(t)).toHaveLength(0);
    }
    // the diary is still yours to read, just without the board's names
    expect(rec.about[tid(1)]).toMatchObject({ source: "diary", words: "words of n1", job: null });
  });

  it("reads the events oldest first, and a missing table as none", async () => {
    rows.tasks = [taskRow(1)];
    rows.task_events = [
      { org_id: ORG, task_id: tid(1), kind: "due", by_staff: LUKE, at: "2026-09-21T00:00:00Z", due_from: "2026-09-25", due_to: "2026-10-02", from_staff: null, to_staff: null },
      { org_id: ORG, task_id: tid(1), kind: "created", by_staff: ME, at: "2026-09-18T00:00:00Z", due_from: null, due_to: null, from_staff: null, to_staff: ME },
      // a kind this code has never heard of is not guessed at
      { org_id: ORG, task_id: tid(1), kind: "renamed", by_staff: ME, at: "2026-09-22T00:00:00Z" },
    ];
    const rec = await loadTasksFace(ctx(), NOW);
    expect(rec.about[tid(1)].events.map((e) => e.kind)).toEqual(["created", "due"]);
    expect(rec.about[tid(1)].events[1]).toEqual({
      kind: "due",
      at: "2026-09-21T00:00:00Z",
      by: LUKE,
      dueFrom: "2026-09-25",
      dueTo: "2026-10-02",
      from: null,
      to: null,
    });
    expect(of("task_events")[0].order).toEqual(["at", { ascending: true }]);

    failing.task_events = { code: "PGRST205", message: "Could not find the table 'public.task_events'" };
    const before = await loadTasksFace(ctx(), NOW);
    expect(before.about[tid(1)]).toMatchObject({ source: "typed", events: [] });
  });

  it("names only the people the record mentions, and nobody it cannot name", async () => {
    rows.tasks = [
      taskRow(1, { assigned_to: LUKE }),
      // made by a card that is no longer in the staff list: no name, no entry
      taskRow(2, { assigned_to: LUKE, created_by: "55555555-5555-4555-8555-555555555555" }),
    ];
    rows.task_events = [
      { org_id: ORG, task_id: tid(1), kind: "given", by_staff: ME, at: "2026-09-21T00:00:00Z", due_from: null, due_to: null, from_staff: LEO, to_staff: LUKE },
    ];
    const rec = await loadTasksFace(ctx({}, "team"), NOW);
    expect(rec.people).toEqual({ [ME]: "Isaac Smith", [LUKE]: "Luke Ingold", [LEO]: "Leo Park" });
  });

  it("asks nothing further when there are no tasks", async () => {
    const rec = await loadTasksFace(ctx(), NOW);
    expect(rec).toEqual({ open: [], done: [], doneCapped: false, about: {}, people: {} });
    expect(calls.map((c) => c.table)).toEqual(["tasks", "tasks"]);
  });

  it("reads no task at all for an account with no staff card and no `team`", async () => {
    const rec = await loadTasksFace(ctx({ viewerStaffId: null }), NOW);
    expect(rec.open).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
