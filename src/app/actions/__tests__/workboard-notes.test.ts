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
      chain.neq = self;
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
/* A SPY OVER THE REAL READ, not a stand-in for it: the roster's own test
   below asserts what jobCandidates builds out of the tables, and only the
   count of calls is faked-up here. `jobHistory` runs for real in this suite
   too and reads `listIssues` out of the same module. */
jest.mock("@/lib/workboard/notes-query", () => {
  const actual = jest.requireActual("@/lib/workboard/notes-query");
  return { ...actual, jobCandidates: jest.fn(actual.jobCandidates) };
});

import {
  answerClarify,
  applyNote,
  clearFlag,
  dismissNote,
  keepNoteForMe,
  keepNoteOnJob,
  routeNote,
} from "../workboard-notes";
const { jobCandidates } = jest.requireMock("@/lib/workboard/notes-query") as {
  jobCandidates: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readNote } = jest.requireMock("@/lib/workboard/note-brain") as { readNote: jest.Mock };

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

  /* EVERY note names a job (Isaac, 2026-08-02) — the review card disables
     both save buttons until one is picked, and this is the server saying the
     same thing to a direct POST. It's what stops a targetless FLAG being
     written: such a flag renders a Needs-attention row that names a problem
     and then opens nothing. */
  /* THE RULE IS PER BUCKET NOW, NOT PER NOTE (2026-08-05). It used to refuse
     every targetless note outright, which was right about the things that are
     text on somebody else's row and wrong about tasks — `tasks` has no job
     column at all, so "tell Luke to ring the wholesaler" was being refused
     for naming no job it never needed. */
  it("REFUSES a bring-list with no job to sit on", async () => {
    rows.workboard_notes = { ...NOTE, target_kind: "none", target_id: null };
    const res = await applyNote("n-1", confirmed({ bringItems: ["2 × 595 filters"] }));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/hang off a job/);
    expect(updates.some((u) => u.table === "workboard_notes" && u.patch.status === "applied")).toBe(
      false
    );
  });

  it("ACCEPTS a targetless note that is only tasks — a task stands on its own", async () => {
    rows.workboard_notes = { ...NOTE, target_kind: "none", target_id: null };
    lists.staff_profiles = [{ id: "s-luke" }]; // the scoped org lookup finds them
    const res = await applyNote(
      "n-1",
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

  it("REFUSES a targetless note even when it only raises a flag", async () => {
    rows.workboard_notes = { ...NOTE, target_kind: "none", target_id: null };
    const res = await applyNote(
      "n-1",
      confirmed({ flags: [{ message: "Rooftop unit tripped again", severity: "warn" }] })
    );
    expect(res.ok).toBe(false);
    expect(rowsFor("workboard_flags")).toHaveLength(0);
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

/* "Just keep the note" has to keep it somewhere you'd FIND it. Filing the row
   at `dismissed` put the words in a drawer nobody opens — nothing in the app
   reads workboard_notes — which is what made Isaac ask where the note was
   even going. */
describe("keeping a note on the job", () => {
  it("appends the words to the job's own notes, never replacing what's there", async () => {
    rows.workboard_notes = { ...NOTE, transcript: "Gate code is 4821 after hours." };
    rows.projects = { notes: "Ask for Marco at the dock." };
    const res = await keepNoteOnJob("n-1");
    expect(res.ok).toBe(true);
    expect(updates.find((u) => u.table === "projects")!.patch.notes).toBe(
      "Ask for Marco at the dock.\n\nGate code is 4821 after hours."
    );
    // and the note itself is settled, not left pending forever
    expect(
      updates.some((u) => u.table === "workboard_notes" && u.patch.status === "dismissed")
    ).toBe(true);
  });

  it("takes the review card's job when the note was dictated against nothing", async () => {
    rows.workboard_notes = { ...NOTE, target_kind: "none", target_id: null, transcript: "Bring the long ladder." };
    rows.maintenance_agreements = { id: "a-1", notes: null };
    const res = await keepNoteOnJob("n-1", { kind: "agreement", id: "a-1" });
    expect(res.ok).toBe(true);
    expect(updates.find((u) => u.table === "maintenance_agreements")!.patch.notes).toBe(
      "Bring the long ladder."
    );
    expect(
      updates.some(
        (u) => u.table === "workboard_notes" && u.patch.target_kind === "agreement" && u.patch.target_id === "a-1"
      )
    ).toBe(true);
  });

  it("says so rather than pretending, when there's no job to keep it on", async () => {
    rows.workboard_notes = { ...NOTE, target_kind: "none", target_id: null };
    const res = await keepNoteOnJob("n-1");
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/which job/);
    expect(updates).toHaveLength(0);
  });

  /* Abandoning a note — Esc, the ×, walking away — must never write anything.
     That path is dismissNote, and it stays a status change and nothing else. */
  it("abandoning is still a status change and nothing else", async () => {
    rows.workboard_notes = { ...NOTE, transcript: "half a sentence" };
    await dismissNote("n-1");
    expect(updates.every((u) => u.table === "workboard_notes")).toBe(true);
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
    noteLines: [],
    plainNote: "noted",
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
       the model to echo it, which is what makes applyNote's dedupe bump the
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

  /* THE PICKER'S ROSTER RIDES THE ROUTE (Isaac, 2026-08-08). It used to be
     pushed into scope by board screens only, which left every other screen's
     review card saying "say which one" with no way to say it. Served here so
     the words can name a job wherever they were spoken. */
  it("returns the jobs a note could be pinned to — the board's own set", async () => {
    readNote.mockClear();
    readNote.mockResolvedValue({ ok: true, proposal: PROPOSAL });
    lists.maintenance_agreements = [
      { id: "a-1", label: "Quarterly service", client_name: "Kingsford Medical", site_label: null, status: "active" },
      { id: "a-2", label: "Annual clean", client_name: "Paused Pty", site_label: null, status: "paused" },
    ];
    lists.projects = [
      { id: "p-1", name: "Smith St change-over", client_name: "Smith St Dental", site_label: "Smith St" },
    ];
    lists.maintenance_visits = [
      { id: "v-1", agreement_id: "a-1", project_id: null, label: null, job_number: "1042", status: "upcoming" },
      /* a paused agreement's visit is not on the board's open list, so it is
         not offered here either — the agreement itself still is */
      { id: "v-2", agreement_id: "a-2", project_id: null, label: null, job_number: "1043", status: "upcoming" },
      { id: "t-1", agreement_id: null, project_id: "p-1", label: "Rough-in", job_number: null, status: "booked" },
    ];

    const res = await routeNote({ transcript: "ring the wholesaler", target: { kind: "none" } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs).toEqual([
      { kind: "visit", id: "v-1", clientName: "Kingsford Medical", label: "Quarterly service", siteLabel: null, jobNumber: "1042" },
      { kind: "visit", id: "t-1", clientName: "Smith St Dental", label: "Smith St change-over · Rough-in", siteLabel: "Smith St", jobNumber: null },
      { kind: "agreement", id: "a-1", clientName: "Kingsford Medical", label: "Quarterly service", siteLabel: null, jobNumber: null },
      { kind: "agreement", id: "a-2", clientName: "Paused Pty", label: "Annual clean", siteLabel: null, jobNumber: null },
      { kind: "project", id: "p-1", clientName: "Smith St Dental", label: "Smith St change-over", siteLabel: "Smith St", jobNumber: null },
    ]);
  });
});

/* "Keep it in my notes" with rows on the card is a DEMOTION, not a discard:
   a flag that names no job isn't a flag, it's your note. The card sends the
   ticked rows — reviewed, edited — and they're kept as one grouped note.
   Without rows the raw transcript is kept, exactly as before. */
describe("keeping it for yourself", () => {
  it("keeps the ticked rows as one grouped note, a line each", async () => {
    rows.workboard_notes = { ...NOTE, transcript: "the raw ramble" };
    const res = await keepNoteForMe("n-1", [
      "Unit still will not regulate.",
      "Checked the regulator",
    ]);
    expect(res.ok).toBe(true);
    expect(rowsFor("staff_notes")[0]).toMatchObject({
      staff_id: "staff-me",
      body: "• Unit still will not regulate.\n• Checked the regulator",
      source: "routed",
      source_note_id: "n-1",
    });
    // settled, not left pending forever
    expect(
      updates.some((u) => u.table === "workboard_notes" && u.patch.status === "dismissed")
    ).toBe(true);
  });

  it("keeps the raw words when no rows were ticked — a note that never grew rows", async () => {
    rows.workboard_notes = { ...NOTE, transcript: "gate code is 4417" };
    const res = await keepNoteForMe("n-1", []);
    expect(res.ok).toBe(true);
    expect(rowsFor("staff_notes")[0].body).toBe("gate code is 4417");
  });

  it("lines of nothing count as nothing — the transcript still wins", async () => {
    rows.workboard_notes = { ...NOTE, transcript: "the words" };
    await keepNoteForMe("n-1", ["   ", ""]);
    expect(rowsFor("staff_notes")[0].body).toBe("the words");
  });
});

describe("the picker roster", () => {
  const PROPOSAL = {
    tasks: [],
    bringItems: [],
    flags: [],
    progressBullets: [],
    commissioningEntries: [],
    issueEntries: [],
    kbEntries: [],
    noteLines: [],
    plainNote: "noted",
    clarify: null,
  };

  const KINGSFORD = {
    id: "v-9",
    kind: "visit",
    clientName: "Kingsford Medical",
    label: "Quarterly service",
    siteLabel: null,
    jobNumber: "1042",
  };

  beforeEach(() => {
    jobCandidates.mockClear();
    jobCandidates.mockResolvedValue([KINGSFORD]);
    readNote.mockClear();
    readNote.mockResolvedValue({ ok: true, proposal: PROPOSAL });
  });

  afterEach(() => {
    // hand the real read back, or the suite's other roster test is testing this stub
    jobCandidates.mockImplementation(
      (jest.requireActual("@/lib/workboard/notes-query") as { jobCandidates: typeof jobCandidates })
        .jobCandidates
    );
  });

  it("is fetched for a site note even when the note already has a target", async () => {
    rows.maintenance_visits = { id: "v-1" };

    const res = await routeNote({ transcript: "the unit tripped", target: { kind: "visit", id: "v-1" } });

    expect(res.ok && res.jobs).toEqual([KINGSFORD]);
    expect(jobCandidates).toHaveBeenCalledTimes(1);
  });

  /* THREE TABLES READ AND THROWN AWAY. The debrief card draws no picker, so
     the roster it would stock has nowhere to go — and this is the path whose
     reasoning effort was already cut because the wait was too long to watch. */
  it("is not fetched for a debrief, which has no picker to stock", async () => {
    const res = await routeNote({
      transcript: "everything on my mind",
      target: { kind: "none" },
      debrief: true,
    });

    expect(res.ok && res.jobs).toEqual([]);
    expect(jobCandidates).not.toHaveBeenCalled();
  });

  it("is not fetched again when a debrief's clarify is answered", async () => {
    rows.workboard_notes = {
      ...NOTE,
      target_kind: "none",
      target_id: null,
      proposal: { ...PROPOSAL, debrief: true, clarify: { question: "Which Luke?" } },
    };

    const res = await answerClarify("n-1", "Mercer");

    expect(res.ok).toBe(true);
    expect(jobCandidates).not.toHaveBeenCalled();
    /* The mode still has to survive the round-trip, or the answer re-routes
       the whole debrief as a site note. */
    expect(readNote.mock.calls[0][1].debrief).toBe(true);
    expect(updates.find((u) => u.table === "workboard_notes")?.patch.proposal).toMatchObject({
      debrief: true,
    });
  });
});
