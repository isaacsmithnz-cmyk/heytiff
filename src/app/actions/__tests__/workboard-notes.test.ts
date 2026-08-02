/* applyNote is the only function in Smart Notes that writes, so it's the one
   that has to be paranoid. A Server Function is reachable by direct POST —
   "the review card only offered valid options" is not a control. */

const inserts: { table: string; payload: unknown }[] = [];
const updates: { table: string; patch: Record<string, unknown> }[] = [];

let rows: Record<string, Record<string, unknown> | null> = {};
/* Reads that come back as a SET rather than a row — the bulk `.in(…)` lookups
   that replaced the per-item queries. `rows` still serves `.maybeSingle()`. */
let lists: Record<string, Record<string, unknown>[]> = {};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = self;
      chain.in = self;
      chain.order = self;
      chain.limit = self;
      chain.maybeSingle = async () => ({ data: rows[table] ?? null });
      // awaiting the builder itself (no .maybeSingle) yields the set
      chain.then = (res: (v: { data: unknown[] }) => unknown) =>
        Promise.resolve({ data: lists[table] ?? [] }).then(res);
      chain.insert = (payload: unknown) => {
        inserts.push({ table, payload });
        const after: Record<string, unknown> = {
          select: () => ({
            single: async () => ({ data: { id: `${table}-new` }, error: null }),
            then: (res: (v: { data: { id: string }[] }) => unknown) =>
              Promise.resolve({
                data: (Array.isArray(payload) ? payload : [payload]).map((_, i) => ({
                  id: `${table}-${i}`,
                })),
              }).then(res),
          }),
          then: (res: (v: { error: null }) => unknown) =>
            Promise.resolve({ error: null }).then(res),
        };
        return after;
      };
      chain.update = (patch: Record<string, unknown>) => {
        const sub: Record<string, unknown> = {};
        sub.eq = () => sub;
        sub.then = (res: (v: { error: null }) => unknown) => {
          updates.push({ table, patch });
          return Promise.resolve({ error: null }).then(res);
        };
        return sub;
      };
      return chain;
    },
  },
}));

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(async () => ({ user: { sub: "auth0|me" }, orgId: "org-1" })) },
}));

let caps = new Set<string>();
jest.mock("@/lib/permissions-server", () => ({ can: async (c: string) => caps.has(c) }));
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: async () => "staff-me" }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: async () => "Australia/Brisbane" }));
jest.mock("@/lib/workboard/note-brain", () => ({
  ...jest.requireActual("@/lib/workboard/note-brain"),
  readNote: jest.fn(),
}));

import { applyNote, clearFlag, dismissNote } from "../workboard-notes";

const NOTE = { id: "n-1", transcript: "…", status: "pending", target_kind: "project", target_id: "p-1", proposal: {} };

/* Every row written to a table, whether the action batched them into one
   insert or sent them one at a time — the assertions below are about WHAT was
   written, and shouldn't break when the write is made cheaper. */
const rowsFor = (table: string): Record<string, unknown>[] =>
  inserts
    .filter((i) => i.table === table)
    .flatMap((i) => (Array.isArray(i.payload) ? i.payload : [i.payload]) as Record<string, unknown>[]);

const confirmed = (over: Record<string, unknown> = {}) => ({
  tasks: [],
  bringItems: [],
  flags: [],
  progressBullets: [],
  commissioningEntries: [],
  issueEntries: [],
  ...over,
}) as Parameters<typeof applyNote>[1];

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  rows = { workboard_notes: NOTE };
  lists = {};
  caps = new Set(["workboard"]);
});

describe("the gate", () => {
  it("refuses without the workboard capability", async () => {
    caps = new Set();
    expect((await applyNote("n-1", confirmed())).ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("ticking is the WORKBOARD tier — managing isn't required to apply your own note", async () => {
    caps = new Set(["workboard"]);
    lists.staff_profiles = [{ id: "s-luke" }];
    const res = await applyNote(
      "n-1",
      confirmed({ tasks: [{ title: "Order grilles", detail: "", assigneeId: "s-luke", dueDate: null }] })
    );
    expect(res.ok).toBe(true);
  });

  it("a note that was already applied can't be applied twice", async () => {
    rows.workboard_notes = { ...NOTE, status: "applied" };
    const res = await applyNote("n-1", confirmed({ progressBullets: ["x"] }));
    expect(res.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });
});

describe("tasks", () => {
  it("creates through the existing tasks table so assignment comes free", async () => {
    lists.staff_profiles = [{ id: "s-luke" }];
    await applyNote(
      "n-1",
      confirmed({
        tasks: [
          { title: "Order the grilles", detail: "4 × 595", assigneeId: "s-luke", dueDate: "2026-08-04" },
        ],
      })
    );
    const task = rowsFor("tasks")[0];
    expect(task).toMatchObject({
      org_id: "org-1",
      title: "Order the grilles",
      assigned_to: "s-luke",
      created_by: "staff-me",
      due_date: "2026-08-04",
      status: "open",
    });
  });

  it("refuses an assignee who isn't in this org", async () => {
    lists.staff_profiles = []; // the scoped lookup finds nobody
    const res = await applyNote(
      "n-1",
      confirmed({ tasks: [{ title: "Order grilles", detail: "", assigneeId: "s-elsewhere", dueDate: null }] })
    );
    expect(res.ok).toBe(false);
    expect(inserts.some((i) => i.table === "tasks")).toBe(false);
  });

  /* This used to FILTER, and the summary counted what was left — which is how
     two of Isaac's tasks disappeared between the review card and the database
     while the pill said "Saved as a note." An unassigned task is a task nobody
     does, and refusing is the only honest answer. */
  it("REFUSES a task with nobody on it — it does not quietly drop it", async () => {
    const res = await applyNote(
      "n-1",
      confirmed({ tasks: [{ title: "Order grilles", detail: "", assigneeId: null, dueDate: null }] })
    );
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/needs a person/);
    expect(inserts.some((i) => i.table === "tasks")).toBe(false);
    // and the note is NOT marked applied over an empty object
    expect(updates.some((u) => u.table === "workboard_notes" && u.patch.status === "applied")).toBe(
      false
    );
  });

  it("ignores a junk due date instead of failing the whole apply", async () => {
    lists.staff_profiles = [{ id: "s-luke" }];
    await applyNote(
      "n-1",
      confirmed({ tasks: [{ title: "T", detail: "", assigneeId: "s-luke", dueDate: "next tuesday" }] })
    );
    expect(rowsFor("tasks")[0].due_date).toBeNull();
  });
});

describe("flags", () => {
  it("keeps only severities we render, degrading the rest to warn", async () => {
    await applyNote(
      "n-1",
      confirmed({
        flags: [
          { message: "No roof access", severity: "urgent" },
          { message: "Filter rough", severity: "catastrophic" },
        ],
      })
    );
    expect(rowsFor("workboard_flags").map((r) => r.severity)).toEqual(["urgent", "warn"]);
  });

  it("traces every flag back to the note that raised it", async () => {
    await applyNote("n-1", confirmed({ flags: [{ message: "x", severity: "warn" }] }));
    expect(rowsFor("workboard_flags")[0].note_id).toBe("n-1");
  });
});

describe("issues — the recurring-fault memory", () => {
  it("bumps an existing issue instead of logging a second row", async () => {
    // two rows is exactly how a pattern stops being visible
    lists.workboard_issues = [{ id: "i-1", summary: "Tripped again", occurrences: 2 }];
    await applyNote("n-1", confirmed({ issueEntries: [{ summary: "Tripped again", equipmentRef: "" }] }));
    expect(inserts.some((i) => i.table === "workboard_issues")).toBe(false);
    const bump = updates.find((u) => u.table === "workboard_issues")!;
    expect(bump.patch.occurrences).toBe(3);
    expect(bump.patch.last_seen).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("logs a first sighting as a new row", async () => {
    lists.workboard_issues = [];
    await applyNote("n-1", confirmed({ issueEntries: [{ summary: "New fault", equipmentRef: "Unit 3" }] }));
    expect(rowsFor("workboard_issues")[0]).toMatchObject({ summary: "New fault", equipment_ref: "Unit 3" });
  });
});

describe("entries and bring-items", () => {
  it("writes progress and commissioning as one table told apart by kind", async () => {
    await applyNote(
      "n-1",
      confirmed({ progressBullets: ["Rough-in done"], commissioningEntries: ["Superheat 6K"] })
    );
    const rowsIn = rowsFor("project_entries");
    expect(rowsIn.map((r) => r.kind)).toEqual(["progress", "commissioning"]);
    expect(rowsIn.every((r) => r.note_id === "n-1")).toBe(true);
  });

  it("a project's bring-items become checklist items in their own section", async () => {
    await applyNote("n-1", confirmed({ bringItems: ["2 × 595 filters"] }));
    expect(rowsFor("project_checklist_items")[0]).toMatchObject({
      section: "Bring next visit",
      label: "2 × 595 filters",
    });
  });

  /* A bring-list is text on somebody else's row. With a general note there is
     no row, and these used to vanish without a word. */
  it("REFUSES bring-items on a note with no job to hang them off", async () => {
    rows.workboard_notes = { ...NOTE, target_kind: "none", target_id: null };
    const res = await applyNote("n-1", confirmed({ bringItems: ["2 × 595 filters"] }));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/needs a job to sit on/);
    expect(updates.some((u) => u.table === "workboard_notes" && u.patch.status === "applied")).toBe(
      false
    );
  });

  it("takes the review card's re-target, so a general note can be pinned to a job on save", async () => {
    rows.workboard_notes = { ...NOTE, target_kind: "none", target_id: null };
    rows.maintenance_agreements = { id: "a-1", bring_list: null };
    const res = await applyNote("n-1", confirmed({ bringItems: ["2 × 595 filters"] }), {
      kind: "agreement",
      id: "a-1",
    });
    expect(res.ok).toBe(true);
    // the note itself remembers where it ended up
    expect(
      updates.some(
        (u) => u.table === "workboard_notes" && u.patch.target_kind === "agreement" && u.patch.target_id === "a-1"
      )
    ).toBe(true);
    expect(updates.find((u) => u.table === "maintenance_agreements")!.patch.bring_list).toBe(
      "2 × 595 filters"
    );
  });

  it("an agreement's bring-items append to its existing list rather than replacing it", async () => {
    rows.workboard_notes = { ...NOTE, target_kind: "agreement", target_id: "a-1" };
    rows.maintenance_agreements = { bring_list: "coil cleaner" };
    await applyNote("n-1", confirmed({ bringItems: ["2 × 595 filters"] }));
    const patch = updates.find((u) => u.table === "maintenance_agreements")!.patch;
    expect(patch.bring_list).toBe("coil cleaner · 2 × 595 filters");
  });
});

describe("the note's own record", () => {
  it("records what the confirmation actually created", async () => {
    lists.staff_profiles = [{ id: "s-luke" }];
    const res = await applyNote(
      "n-1",
      confirmed({
        tasks: [{ title: "T", detail: "", assigneeId: "s-luke", dueDate: null }],
        flags: [{ message: "F", severity: "warn" }],
      })
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.summary).toContain("1 task");

    const noteUpdate = updates.find((u) => u.table === "workboard_notes")!;
    expect(noteUpdate.patch.status).toBe("applied");
    expect(noteUpdate.patch.applied).toMatchObject({
      taskIds: ["tasks-0"],
      flagIds: ["workboard_flags-0"],
    });
  });

  it("dismissing keeps the words and writes nothing else", async () => {
    const res = await dismissNote("n-1");
    expect(res.ok).toBe(true);
    expect(inserts).toHaveLength(0);
    expect(updates[0].patch.status).toBe("dismissed");
  });
});

describe("clearFlag", () => {
  it("stops a flag pulsing and records who did it", async () => {
    rows.workboard_flags = { id: "f-1" };
    const res = await clearFlag("f-1");
    expect(res.ok).toBe(true);
    expect(updates[0].patch).toMatchObject({ active: false, cleared_by: "staff-me" });
  });

  it("a flag from another workspace clears nothing", async () => {
    rows.workboard_flags = null;
    expect((await clearFlag("f-elsewhere")).ok).toBe(false);
    expect(updates).toHaveLength(0);
  });
});
