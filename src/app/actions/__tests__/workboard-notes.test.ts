/* The note writer (`applyConfirmed`, which `fileNote` runs) is the only
   thing in Smart Notes that turns a note into rows, so it's the one that has
   to be paranoid. A Server Function is reachable by direct POST — "the modal
   only offered valid options" is not a control.

   It is reached here the one way it is reached in the app: a note whose
   STORED proposal says what to file, filed by `fileNote`. (These were the
   review card's `applyNote` tests until the card went with the old capture
   UI, 2026-09-27; the writer they hold is the same one.) */

const inserts: { table: string; payload: unknown }[] = [];
const updates: { table: string; patch: Record<string, unknown>; onStatus?: string[] }[] = [];
/* `fileNote` merges the note's record in the database (tiff_modal_record.sql). */
const rpcs: { name: string; args: Record<string, unknown> }[] = [];

let rows: Record<string, Record<string, unknown> | null> = {};
/* Reads that come back as a SET rather than a row — the bulk `.in(…)` lookups
   that replaced the per-item queries. `rows` still serves `.maybeSingle()`. */
let lists: Record<string, Record<string, unknown>[]> = {};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      return { data: true, error: null };
    },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = self;
      chain.in = self;
      chain.is = self;
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
        const onStatus: string[][] = [];
        sub.eq = () => sub;
        /* a write on a note is conditional on the row still waiting
           (two-way phase 2) */
        sub.in = (col: string, vs: string[]) => {
          if (col === "status") onStatus.push(vs);
          return sub;
        };
        /* `fileNote` claims the note before it writes, and asks whether the
           claim landed: here it always does */
        sub.select = () => ({
          then: (res: (v: { data: { id: string }[]; error: null }) => unknown) => {
            updates.push({ table, patch, onStatus: onStatus[0] });
            return Promise.resolve({ data: [{ id: "claimed" }], error: null }).then(res);
          },
        });
        sub.then = (res: (v: { error: null }) => unknown) => {
          updates.push({ table, patch, onStatus: onStatus[0] });
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
/* The answers under "Which job is this for?" are the modal suite's; here the
   question is the point. */
jest.mock("@/lib/dashboard/job-candidates", () => ({ jobCandidates: async () => [] }));
jest.mock("@/lib/workboard/note-brain", () => ({
  ...jest.requireActual("@/lib/workboard/note-brain"),
  readNote: jest.fn(),
}));

import {
  clearFlag,
  continueNote,
  dismissNote,
  fileNote,
  routeNote,
  type ConfirmedNote,
  type NoteTarget,
} from "../workboard-notes";
import type { NoteProposal, Severity } from "@/lib/workboard/note-brain";
const { readNote } = jest.requireMock("@/lib/workboard/note-brain") as { readNote: jest.Mock };

const NOTE = {
  id: "n-1",
  transcript: "…",
  status: "pending",
  target_kind: "project",
  target_id: "p-1",
  proposal: {},
  author_id: "staff-me",
  turns: [],
};

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
}) as ConfirmedNote;

/* What the router would have stored for a confirmation: `fileNote` files
   `toConfirmed(toDraft(stored))`, so each lane goes back to the shape the
   router stores it in. */
const proposalOf = (c: ConfirmedNote): NoteProposal => ({
  tasks: c.tasks.map((t) => ({
    title: t.title,
    detail: t.detail,
    assigneeId: t.assigneeId,
    assigneeHint: "",
    dueHint: "",
    dueDate: t.dueDate ?? "",
    remindTime: t.remindTime ?? "",
    remindKind: t.remindKind === "by" ? "by" : "at",
  })),
  bringItems: c.bringItems,
  flags: c.flags.map((f) => ({ message: f.message, severity: f.severity as Severity })),
  progressBullets: c.progressBullets,
  commissioningEntries: c.commissioningEntries.map((body) => ({ body, equipmentHint: "" })),
  issueEntries: c.issueEntries.map((e) => ({ body: e.summary, equipmentHint: e.equipmentRef })),
  kbEntries: [],
  plainNote: "",
  say: "",
  clarify: null,
});

/** File the note with `c` as its stored proposal — the one way a note's rows
    are written. `retarget` is the job an answer to "Which job is this for?"
    carries. */
const file = (c: ConfirmedNote, retarget?: NoteTarget) => {
  rows.workboard_notes = { ...(rows.workboard_notes ?? NOTE), proposal: proposalOf(c) };
  return fileNote("n-1", retarget ? { retarget } : {});
};

/** The record the filing merged onto the note. */
const record = () => rpcs.find((r) => r.name === "workboard_note_file_record")?.args.p_applied as
  | Record<string, unknown>
  | undefined;

/** Whether the note was claimed for filing: moved to `applied`. */
const claimed =() => updates.some((u) => u.table === "workboard_notes" && u.patch.status === "applied");

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  rpcs.length = 0;
  rows = { workboard_notes: NOTE };
  lists = {};
  caps = new Set(["workboard"]);
});

describe("the gate", () => {
  it("refuses without the workboard capability", async () => {
    caps = new Set();
    expect((await file(confirmed())).ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("filing is the WORKBOARD tier — managing isn't required to file your own note", async () => {
    caps = new Set(["workboard"]);
    lists.staff_profiles = [{ id: "s-luke" }];
    const res = await file(
      confirmed({ tasks: [{ title: "Order grilles", detail: "", assigneeId: "s-luke", dueDate: null }] })
    );
    expect(res.ok).toBe(true);
  });

  it("a note that was already filed can't be filed twice", async () => {
    rows.workboard_notes = { ...NOTE, status: "applied" };
    const res = await file(confirmed({ progressBullets: ["x"] }));
    expect(res.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });
});

describe("tasks", () => {
  it("creates through the existing tasks table so assignment comes free", async () => {
    lists.staff_profiles = [{ id: "s-luke" }];
    await file(
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

  it("writes a deadline down and leaves an appointment to be inferred", async () => {
    /* ONLY "by" IS EVER STORED. A null already reads as "at" everywhere
       through `remindKindOf`, so writing the word would be a second way to
       say the identical thing — and a row that can one day disagree with
       itself. See docs/migrations/task_remind_kind.sql. */
    lists.staff_profiles = [{ id: "s-luke" }];
    await file(
      confirmed({
        tasks: [
          { title: "Crane truck back", detail: "", assigneeId: "s-luke", dueDate: "2026-08-04", remindTime: "16:00", remindKind: "by" },
          { title: "Service the Hilux", detail: "", assigneeId: "s-luke", dueDate: "2026-08-04", remindTime: "07:30", remindKind: "at" },
        ],
      })
    );
    const rows = rowsFor("tasks");
    expect(rows[0].remind_kind).toBe("by");
    expect(rows[0].remind_at).not.toBeNull();
    expect(rows[1].remind_kind).toBeNull();
  });

  it("never stores a kind on a task that named no hour", async () => {
    /* The database refuses the pair outright — a deadline with no moment is
       not a weaker fact, it is a meaningless one — so the filing must not
       offer it one. */
    lists.staff_profiles = [{ id: "s-luke" }];
    await file(
      confirmed({
        tasks: [
          { title: "Order the grilles", detail: "", assigneeId: "s-luke", dueDate: "2026-08-04", remindTime: null, remindKind: "by" },
        ],
      })
    );
    const task = rowsFor("tasks")[0];
    expect(task.remind_at).toBeNull();
    expect(task.remind_kind).toBeNull();
  });

  it("refuses an assignee who isn't in this org", async () => {
    lists.staff_profiles = []; // the scoped lookup finds nobody
    const res = await file(
      confirmed({ tasks: [{ title: "Order grilles", detail: "", assigneeId: "s-elsewhere", dueDate: null }] })
    );
    expect(res.ok).toBe(false);
    expect(inserts.some((i) => i.table === "tasks")).toBe(false);
  });

  /* This used to FILTER, and the summary counted what was left — which is how
     two of Isaac's tasks disappeared between the review card and the database
     while the pill said "Saved as a note." An unassigned task is a task nobody
     does, so the filing stops and asks who. */
  it("ASKS who, rather than filing a task with nobody on it or quietly dropping it", async () => {
    const res = await file(
      confirmed({ tasks: [{ title: "Order grilles", detail: "", assigneeId: null, dueDate: null }] })
    );
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("Who should do this: Order grilles?");
    expect(inserts.some((i) => i.table === "tasks")).toBe(false);
    // and the note is NOT marked applied over an empty object
    expect(claimed()).toBe(false);
  });

  it("ignores a junk due date instead of failing the whole filing", async () => {
    lists.staff_profiles = [{ id: "s-luke" }];
    await file(
      confirmed({ tasks: [{ title: "T", detail: "", assigneeId: "s-luke", dueDate: "next tuesday" }] })
    );
    expect(rowsFor("tasks")[0].due_date).toBeNull();
  });
});

describe("flags", () => {
  it("keeps only severities we render, degrading the rest to warn", async () => {
    await file(
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
    await file(confirmed({ flags: [{ message: "x", severity: "warn" }] }));
    expect(rowsFor("workboard_flags")[0].note_id).toBe("n-1");
  });
});

describe("issues — the recurring-fault memory", () => {
  it("bumps an existing issue instead of logging a second row", async () => {
    // two rows is exactly how a pattern stops being visible
    lists.workboard_issues = [{ id: "i-1", summary: "Tripped again", occurrences: 2 }];
    await file(confirmed({ issueEntries: [{ summary: "Tripped again", equipmentRef: "" }] }));
    expect(inserts.some((i) => i.table === "workboard_issues")).toBe(false);
    const bump = updates.find((u) => u.table === "workboard_issues")!;
    expect(bump.patch.occurrences).toBe(3);
    expect(bump.patch.last_seen).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("logs a first sighting as a new row", async () => {
    lists.workboard_issues = [];
    await file(confirmed({ issueEntries: [{ summary: "New fault", equipmentRef: "Unit 3" }] }));
    expect(rowsFor("workboard_issues")[0]).toMatchObject({ summary: "New fault", equipment_ref: "Unit 3" });
  });
});

describe("entries and bring-items", () => {
  it("writes progress and commissioning as one table told apart by kind", async () => {
    await file(
      confirmed({ progressBullets: ["Rough-in done"], commissioningEntries: ["Superheat 6K"] })
    );
    const rowsIn = rowsFor("project_entries");
    expect(rowsIn.map((r) => r.kind)).toEqual(["progress", "commissioning"]);
    expect(rowsIn.every((r) => r.note_id === "n-1")).toBe(true);
    // a project has a journal, so nothing goes on its free-text notes
    expect(updates.some((u) => u.table === "projects")).toBe(false);
  });

  /* THE SILENT DROP. `project_entries` has a project_id and nothing else, so
     this bucket used to be written `if (target.kind === "project")` and left
     at that — while the guard above accepts ANY job for progress and
     commissioning, and the review card's picker offers visits and agreements.
     A reading ticked against a visit was written nowhere, and the note came
     back "Saved — …" and went to status applied. Readings taken on a
     maintenance visit are the most ordinary commissioning there is. */
  it("a visit's progress and commissioning land on the visit's own notes", async () => {
    rows.workboard_notes = { ...NOTE, target_kind: "visit", target_id: "v-1" };
    rows.maintenance_visits = { notes: "gate 4417" };
    const res = await file(
      confirmed({ progressBullets: ["Belts swapped"], commissioningEntries: ["Superheat 6K"] })
    );
    expect(res.ok).toBe(true);
    // no project row is invented for a job that isn't one
    expect(inserts.some((i) => i.table === "project_entries")).toBe(false);
    /* A line is a bullet (lib/workboard/note-lines), what was already there
       stays, and the kind survives the trip into an untyped column — which is
       the one thing `project_entries` carries that `notes` can't. */
    expect(updates.find((u) => u.table === "maintenance_visits")!.patch.notes).toBe(
      "gate 4417\nBelts swapped\nCommissioning: Superheat 6K"
    );
  });

  it("counts them in the summary instead of reporting a save that dropped them", async () => {
    rows.workboard_notes = { ...NOTE, target_kind: "visit", target_id: "v-1" };
    rows.maintenance_visits = { notes: null };
    const res = await file(
      confirmed({ progressBullets: ["Belts swapped", "Filters out"] })
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.summary).toBe("Saved — 2 entries.");
    /* The words are the record: text on somebody else's row has no id of its
       own to point back at. Same as bring-items, same reason. */
    expect(record()).toMatchObject({ entryLines: ["Belts swapped", "Filters out"] });
  });

  it("an agreement's append the same way, never replacing what's there", async () => {
    rows.workboard_notes = { ...NOTE, target_kind: "agreement", target_id: "a-1" };
    rows.maintenance_agreements = { notes: "Ask for Marco at the dock." };
    const res = await file(confirmed({ commissioningEntries: ["Charge 4.2 kg"] }));
    expect(res.ok).toBe(true);
    expect(updates.find((u) => u.table === "maintenance_agreements")!.patch.notes).toBe(
      "Ask for Marco at the dock.\nCommissioning: Charge 4.2 kg"
    );
  });

  /* ANY job will do — but there has to BE one. With no target there is no
     notes column to append to either, so the filing stops and asks which job
     (`jobBound` names the same buckets the writer refuses). */
  it("ASKS which job for commissioning with no job at all", async () => {
    rows.workboard_notes = { ...NOTE, target_kind: "none", target_id: null };
    const res = await file(confirmed({ commissioningEntries: ["Superheat 6K"] }));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("Which job is this for?");
    expect(claimed()).toBe(false);
  });

  it("a project's bring-items become checklist items in their own section", async () => {
    await file(confirmed({ bringItems: ["2 × 595 filters"] }));
    expect(rowsFor("project_checklist_items")[0]).toMatchObject({
      section: "Bring next visit",
      label: "2 × 595 filters",
    });
  });

  /* A bring-list needs a job to sit on (Isaac, 2026-08-02) — and it's what
     stops a targetless FLAG being written: such a flag renders a row that
     names a problem and then opens nothing. */
  /* THE RULE IS PER BUCKET NOW, NOT PER NOTE (2026-08-05). It used to refuse
     every targetless note outright, which was right about the things that are
     text on somebody else's row and wrong about tasks — `tasks` has no job
     column at all, so "tell Luke to ring the wholesaler" was being refused
     for naming no job it never needed. */
  it("ASKS which job for a bring-list with no job to sit on", async () => {
    rows.workboard_notes = { ...NOTE, target_kind: "none", target_id: null };
    const res = await file(confirmed({ bringItems: ["2 × 595 filters"] }));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("Which job is this for?");
    expect(claimed()).toBe(false);
  });

  it("ACCEPTS a targetless note that is only tasks — a task stands on its own", async () => {
    rows.workboard_notes = { ...NOTE, target_kind: "none", target_id: null };
    lists.staff_profiles = [{ id: "s-luke" }]; // the scoped org lookup finds them
    const res = await file(
      confirmed({
        tasks: [
          { title: "Ring the wholesaler back", detail: "", assigneeId: "s-luke", dueDate: null },
        ],
      })
    );
    expect(res.ok).toBe(true);
    expect(rowsFor("tasks")).toHaveLength(1);
    /* And it really is jobless — no target column was invented for it. */
    expect(rowsFor("tasks")[0]).not.toHaveProperty("target_id");
  });

  it("ASKS which job for a targetless note even when it only raises a flag", async () => {
    rows.workboard_notes = { ...NOTE, target_kind: "none", target_id: null };
    const res = await file(
      confirmed({ flags: [{ message: "Rooftop unit tripped again", severity: "warn" }] })
    );
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("Which job is this for?");
    expect(rowsFor("workboard_flags")).toHaveLength(0);
  });

  it("takes the job an answer carries, so a general note is filed on it", async () => {
    rows.workboard_notes = { ...NOTE, target_kind: "none", target_id: null };
    rows.maintenance_agreements = { id: "a-1", bring_list: null };
    const res = await file(confirmed({ bringItems: ["2 × 595 filters"] }), {
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
    await file(confirmed({ bringItems: ["2 × 595 filters"] }));
    const patch = updates.find((u) => u.table === "maintenance_agreements")!.patch;
    expect(patch.bring_list).toBe("coil cleaner, 2 × 595 filters");
  });
});

describe("the note's own record", () => {
  it("records what the confirmation actually created", async () => {
    lists.staff_profiles = [{ id: "s-luke" }];
    const res = await file(
      confirmed({
        tasks: [{ title: "T", detail: "", assigneeId: "s-luke", dueDate: null }],
        flags: [{ message: "F", severity: "warn" }],
      })
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.summary).toContain("1 task");

    expect(claimed()).toBe(true);
    expect(record()).toMatchObject({ taskIds: ["tasks-0"], flagIds: ["workboard_flags-0"] });
  });

  it("dismissing keeps the words and writes nothing else", async () => {
    const res = await dismissNote("n-1");
    expect(res.ok).toBe(true);
    expect(inserts).toHaveLength(0);
    expect(updates[0].patch.status).toBe("dismissed");
    /* AND NOTHING TO READ BACK. The other endings record what they did,
       which is what puts them on the journal; this one is Escape, the × and
       walking away, and an abandonment that recorded an outcome would read
       there exactly like a note somebody filed on purpose. */
    expect(updates[0].patch).not.toHaveProperty("applied");
  });

  /* Abandoning a note — Esc, the ×, walking away — must never write anything
     but its own status. */
  it("abandoning is a status change and nothing else", async () => {
    rows.workboard_notes = { ...NOTE, transcript: "half a sentence" };
    await dismissNote("n-1");
    expect(updates.every((u) => u.table === "workboard_notes")).toBe(true);
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

describe("the router is grounded — the brain tool layer", () => {
  const PROPOSAL = {
    tasks: [],
    bringItems: [],
    flags: [],
    progressBullets: [],
    commissioningEntries: [],
    issueEntries: [],
    kbEntries: [],
    plainNote: "noted",
    say: "",
    clarify: null,
  };

  it("hands the brain what the job already knows, worded as recorded", async () => {
    readNote.mockClear();
    rows.maintenance_visits = { id: "v-1", notes: "gate 4417" };
    lists.workboard_issues = [
      {
        id: "i-1",
        summary: "Middle rooftop unit tripping",
        equipment_ref: null,
        occurrences: 3,
        first_seen: "2026-07-01",
        last_seen: "2026-08-02",
      },
    ];
    lists.workboard_flags = [{ message: "Roof access broken", severity: "warn" }];
    lists.workboard_notes = [{ transcript: "last visit swapped the belts" }];
    readNote.mockResolvedValue({ ok: true, proposal: PROPOSAL });

    const res = await routeNote({
      transcript: "the middle unit tripped again",
      target: { kind: "visit", id: "v-1" },
    });
    expect(res.ok).toBe(true);

    const ctx = readNote.mock.calls[0][1];
    /* The exact recorded wording travels — that is what lets the prompt tell
       the model to echo it, which is what makes the writer's dedupe bump the
       occurrence counter instead of splitting the issue in two. */
    expect(ctx.history.issues).toEqual([
      { summary: "Middle rooftop unit tripping", occurrences: 3, lastSeen: "2026-08-02" },
    ]);
    expect(ctx.history.flags).toEqual(["Roof access broken"]);
    expect(ctx.history.recentNotes).toEqual(["last visit swapped the belts"]);
  });

  it("a targetless note routes with an empty memory, not a crash", async () => {
    readNote.mockClear();
    readNote.mockResolvedValue({ ok: true, proposal: PROPOSAL });
    const res = await routeNote({ transcript: "ring the wholesaler", target: { kind: "none" } });
    expect(res.ok).toBe(true);
    const ctx = readNote.mock.calls[0][1];
    expect(ctx.history).toEqual({ issues: [], flags: [], recentNotes: [] });
    expect(ctx.equipment).toBeUndefined();
  });
});

/* ── THE DEBRIEF IS OUT OF THE ROUTER ───────────────────────────────────
   Isaac, 2026-09-24: "the diary, tasks and HeyTiff chat window should assist
   with that." No door sends the flag since the UI half went, and a Server
   Function is reachable by direct POST, so each of these sends what an old
   page or a hand-built request still could, and holds that nothing reads it:
   no `is_debrief` written, no debrief mode asked for, no stamp carried through
   a reply, and no grouped note filed from lines nothing shows any more. */

describe("the Debrief is out of the router", () => {
  const PROPOSAL = {
    tasks: [],
    bringItems: [],
    flags: [],
    progressBullets: [],
    commissioningEntries: [],
    issueEntries: [],
    kbEntries: [],
    plainNote: "long day, two callouts",
    say: "",
    clarify: null,
  };

  beforeEach(() => {
    readNote.mockReset();
    readNote.mockResolvedValue({ ok: true, proposal: PROPOSAL });
  });

  it("writes no is_debrief, asks for no debrief, and stores no stamp, whatever the request says", async () => {
    const res = await routeNote({
      transcript: "long day, two callouts",
      target: { kind: "none" },
      debrief: true,
    } as Parameters<typeof routeNote>[0]);
    expect(res.ok).toBe(true);

    const [row] = rowsFor("workboard_notes");
    expect(row).toMatchObject({ transcript: "long day, two callouts", author_id: "staff-me" });
    expect(row).not.toHaveProperty("is_debrief");
    expect(readNote.mock.calls[0][1]).not.toHaveProperty("debrief");
    const stored = updates.find((u) => u.table === "workboard_notes")!.patch;
    expect(stored.proposal).toEqual(PROPOSAL);
  });

  it("answers a question a debrief asked as the ordinary note it now is, and drops the stamp", async () => {
    /* Filed before the change: the stored proposal still carries the mode. */
    rows.workboard_notes = {
      ...NOTE,
      target_kind: "none",
      target_id: null,
      status: "clarifying",
      proposal: {
        ...PROPOSAL,
        clarify: { question: "Which Luke?", options: ["Luke Nguyen", "Luke Tran"] },
        debrief: true,
      },
    };
    const res = await continueNote("n-1", "Luke Nguyen");
    expect(res.ok).toBe(true);

    expect(readNote.mock.calls[0][1]).not.toHaveProperty("debrief");
    expect(readNote.mock.calls[0][2].plan).not.toHaveProperty("debrief");
    const stored = updates.find((u) => u.table === "workboard_notes")!.patch;
    expect(stored.proposal).toEqual(PROPOSAL);
  });

  it("files no grouped note from kept lines an old stored proposal still carries", async () => {
    rows.workboard_notes = { ...NOTE, proposal: { ...proposalOf(confirmed()), noteLines: ["chase the coil pricing"] } };
    expect((await fileNote("n-1")).ok).toBe(true);
    expect(rowsFor("staff_notes")).toEqual([]);
    expect(record()).not.toHaveProperty("noteLines");
  });
});

/* ── a SERVICEM8 JOB as a target (slice 5) ──────────────────────────────
   The odd one out, and every test here is about the same fact: the mirror is
   read-only, so nothing may be written onto `sm8_jobs`, and the job's written
   record is the DIARY — a `workboard_notes` row the card reads back. */

describe("a job target", () => {
  const JOB_NOTE = { ...NOTE, target_kind: "job", target_id: "job-uuid" };

  const patchesTo = (table: string) => updates.filter((u) => u.table === table);

  beforeEach(() => {
    rows = { workboard_notes: JOB_NOTE, sm8_jobs: { uuid: "job-uuid" } };
  });

  it("resolves against sm8_jobs by UUID, not by id", async () => {
    /* Every other target is keyed `id`; a hand-written `.eq("id", …)` here
       would have matched nothing and refused every note on a job. */
    const res = await file(confirmed(), { kind: "job", id: "job-uuid" });
    expect(res.ok).toBe(true);
  });

  it("NEVER writes on the mirror — the words land on the note row itself", async () => {
    const res = await file(confirmed());
    expect(res).toMatchObject({ ok: true, summary: "Saved — 1 note on the job." });
    expect(patchesTo("sm8_jobs")).toHaveLength(0);
    expect(inserts.some((i) => i.table === "sm8_jobs")).toBe(false);
    /* Filed applied with `jobNotes` — the group the diary reads and the
       journal already counts. */
    expect(claimed()).toBe(true);
    expect(record()).toMatchObject({ jobNotes: ["…"] });
  });

  it("puts the words in the diary whatever else the note did", async () => {
    lists.staff_profiles = [{ id: "s-luke" }];
    const res = await file(
      confirmed({
        tasks: [{ title: "Order the grilles", detail: "", assigneeId: "s-luke", dueDate: null }],
      })
    );
    expect(res.ok).toBe(true);
    /* "Get Luke to order the grilles" is a task AND a thing that was said on
       this job; a feed that showed only the half that grew a row would lie. */
    expect(record()).toMatchObject({ taskIds: expect.any(Array), jobNotes: ["…"] });
    expect(res).toMatchObject({ summary: expect.stringContaining("note on the job") });
  });

  it("lands bring-items on the job's own checklist as materials", async () => {
    const res = await file(confirmed({ bringItems: ["1060 × 175 linear grille"] }));
    expect(res.ok).toBe(true);
    const row = rowsFor("job_picklist_items")[0];
    expect(row).toMatchObject({
      org_id: "org-1",
      sm8_job_uuid: "job-uuid",
      kind: "material",
      name: "1060 × 175 linear grille",
      design_id: null,
    });
  });

  it("does not repeat progress bullets anywhere — the transcript is already the entry", async () => {
    const res = await file(
      confirmed({ progressBullets: ["Bulkheads in"], commissioningEntries: ["Charge 3.1kg"] })
    );
    expect(res.ok).toBe(true);
    /* The three note-owning tables are untouched, and so is the mirror. */
    expect(patchesTo("sm8_jobs")).toHaveLength(0);
    expect(patchesTo("maintenance_visits")).toHaveLength(0);
    expect(inserts.some((i) => i.table === "project_entries")).toBe(false);
    /* Counted all the same, so the journal sees the work. */
    expect(record()).toMatchObject({
      entryLines: ["Bulkheads in", "Commissioning: Charge 3.1kg"],
    });
  });

  it("hangs a flag off the job, like any other target", async () => {
    await file(confirmed({ flags: [{ message: "No roof access", severity: "warn" }] }));
    expect(rowsFor("workboard_flags")[0]).toMatchObject({
      target_kind: "job",
      target_id: "job-uuid",
    });
  });
});

/* ONLY A NOTE STILL WAITING CAN BE SET ASIDE (two-way phase 2). A reply, a
   Done or a pen entry is saved `applied`, and may be in ServiceM8: walking
   away, reached by direct POST, would hide it from the diary. */
describe("walking away, on a row that isn't waiting", () => {
  const APPLIED = {
    id: "n-9",
    transcript: "@lukeingold on my way",
    status: "applied",
    target_kind: "job",
    target_id: "job-uuid",
    proposal: { clarify: { question: "Which Luke?" } },
  };

  it("(F) refuses an applied row, and changes nothing", async () => {
    rows = { workboard_notes: APPLIED };
    expect(await dismissNote("n-9")).toEqual({ ok: false, error: "That note was already applied." });
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("(F) on a pending or clarifying note it works, its update conditional on the row still waiting", async () => {
    rows = { workboard_notes: { ...NOTE, status: "clarifying" } };
    expect((await dismissNote("n-1")).ok).toBe(true);
    expect(updates.at(-1)).toMatchObject({ table: "workboard_notes", onStatus: ["pending", "clarifying"] });
    rows = { workboard_notes: NOTE };
    expect((await dismissNote("n-1")).ok).toBe(true);
    expect(updates.at(-1)).toMatchObject({ table: "workboard_notes", onStatus: ["pending", "clarifying"] });
  });
});
