/* Writing on a ServiceM8 job, and answering one of its notes.

   These are Server Functions, so every one of them is reachable by direct
   POST — "the strip only offered real options" is not a control, and the
   tests below are about what happens when it isn't true. */

const inserts: { table: string; payload: unknown }[] = [];
const upserts: { table: string; payload: unknown }[] = [];
const deletes: string[] = [];

let rows: Record<string, Record<string, unknown> | null> = {};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = (...args: unknown[]) => {
        if (table === "workboard_notes" && args[0] === "target_kind") deletes.push(String(args[1]));
        return chain;
      };
      chain.in = self;
      chain.order = self;
      chain.limit = self;
      chain.maybeSingle = async () => ({ data: rows[table] ?? null });
      chain.then = (res: (v: { data: unknown[] }) => unknown) =>
        Promise.resolve({ data: [] }).then(res);
      chain.insert = (payload: unknown) => {
        inserts.push({ table, payload });
        return {
          select: () => ({
            single: async () => ({
              data: { id: `${table}-new`, applied_at: "2026-08-28T09:00:00.000Z", created_at: "x" },
              error: null,
            }),
          }),
          then: (res: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(res),
        };
      };
      chain.upsert = (payload: unknown) => {
        upserts.push({ table, payload });
        return Promise.resolve({ error: null });
      };
      chain.delete = () => chain;
      return chain;
    },
  },
}));

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
let caps = new Set<string>(["workboard"]);
jest.mock("@/lib/permissions-server", () => ({
  requireOrg: async (c?: string) => {
    if (c && !caps.has(c)) throw new Error("Insufficient permissions");
    return { orgId: "org-1", userId: "auth0|me" };
  },
}));
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: async () => "staff-me" }));

import { addJobNote, dismissJobNote, taskFromJobNote } from "../job-notes";

beforeEach(() => {
  inserts.length = 0;
  upserts.length = 0;
  deletes.length = 0;
  caps = new Set(["workboard"]);
  rows = {
    sm8_jobs: { uuid: "job-uuid" },
    sm8_job_notes: { uuid: "n-1" },
    staff_profiles: { id: "staff-1", first_name: "Isaac", last_name: "Smith" },
  };
});

describe("addJobNote", () => {
  it("files the note applied, on the job, with the words in jobNotes", async () => {
    await addJobNote("job-uuid", "Drain kit still to go on");
    const row = inserts.find((i) => i.table === "workboard_notes")?.payload as Record<
      string,
      unknown
    >;
    expect(row).toMatchObject({
      org_id: "org-1",
      target_kind: "job",
      target_id: "job-uuid",
      transcript: "Drain kit still to go on",
      status: "applied",
      applied: { jobNotes: ["Drain kit still to go on"] },
    });
  });

  it("hands back the SAVED row, name and all", async () => {
    /* The browser knows its own auth id and not the display name behind it —
       slice 3 shipped that defect on the checklist's stamps, and an
       optimistic diary entry would repeat it. */
    const saved = await addJobNote("job-uuid", "Drain kit still to go on");
    expect(saved).toMatchObject({
      id: "workboard_notes-new",
      text: "Drain kit still to go on",
      author: "Isaac Smith",
    });
  });

  it("refuses a job that isn't in this workspace's mirror", async () => {
    rows.sm8_jobs = null;
    await expect(addJobNote("someone-elses-job", "hello")).rejects.toThrow(/isn't on this/);
    expect(inserts).toHaveLength(0);
  });

  it("refuses without the workboard capability", async () => {
    caps = new Set();
    await expect(addJobNote("job-uuid", "hello")).rejects.toThrow();
    expect(inserts).toHaveLength(0);
  });

  it("refuses an empty note rather than filing a blank diary entry", async () => {
    await expect(addJobNote("job-uuid", "   ")).rejects.toThrow(/Nothing to write/);
    expect(inserts).toHaveLength(0);
  });
});

describe("taskFromJobNote", () => {
  const input = {
    jobUuid: "job-uuid",
    noteUuid: "n-1",
    title: "Still need another day on site",
    assigneeId: "staff-1",
  };

  it("saves the task and records that this note has been answered", async () => {
    const res = await taskFromJobNote(input);
    expect(res).toEqual({ ok: true, taskId: "tasks-new" });
    expect(inserts.find((i) => i.table === "tasks")?.payload).toMatchObject({
      org_id: "org-1",
      title: "Still need another day on site",
      assigned_to: "staff-1",
      status: "open",
      due_date: null,
    });
    /* The join `tasks` deliberately doesn't carry, recorded where it belongs:
       against the one mirrored note it is about. */
    expect(upserts.find((u) => u.table === "job_note_actions")?.payload).toMatchObject({
      sm8_note_uuid: "n-1",
      sm8_job_uuid: "job-uuid",
      action: "task",
      task_id: "tasks-new",
    });
  });

  it("REFUSES a task with nobody on it — it never quietly drops one", async () => {
    const res = await taskFromJobNote({ ...input, assigneeId: "" });
    expect(res).toEqual({
      ok: false,
      error: "A task needs a person on it. Say who, or dismiss it.",
    });
    expect(inserts).toHaveLength(0);
  });

  it("refuses somebody who isn't on this workspace", async () => {
    rows.staff_profiles = null;
    const res = await taskFromJobNote(input);
    expect(res.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("refuses a note that isn't in the mirror", async () => {
    rows.sm8_job_notes = null;
    const res = await taskFromJobNote(input);
    expect(res.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("keeps a due date only when it is a real ISO day", async () => {
    await taskFromJobNote({ ...input, dueDate: "next friday" });
    expect(inserts.find((i) => i.table === "tasks")?.payload).toMatchObject({ due_date: null });
    inserts.length = 0;
    await taskFromJobNote({ ...input, dueDate: "2026-09-04" });
    expect(inserts.find((i) => i.table === "tasks")?.payload).toMatchObject({
      due_date: "2026-09-04",
    });
  });
});

describe("dismissJobNote", () => {
  it("records the decision so the strip never suggests it again", async () => {
    await dismissJobNote("job-uuid", "n-1");
    expect(upserts.find((u) => u.table === "job_note_actions")?.payload).toMatchObject({
      sm8_note_uuid: "n-1",
      action: "dismissed",
      task_id: null,
    });
  });
});
