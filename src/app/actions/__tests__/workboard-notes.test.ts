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

import {
  applyNote,
  clearFlag,
  dismissNote,
  keepNoteForMe,
  keepNoteOnJob,
  routeNote,
} from "../workboard-notes";
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
    const res = await applyNote(
      "n-1",
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
    const res = await applyNote(
      "n-1",
      confirmed({ progressBullets: ["Belts swapped", "Filters out"] })
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.summary).toBe("Saved — 2 entries.");
    /* The words are the record: text on somebody else's row has no id of its
       own to point back at. Same as bring-items, same reason. */
    expect(updates.find((u) => u.table === "workboard_notes")!.patch.applied).toMatchObject({
      entryLines: ["Belts swapped", "Filters out"],
    });
  });

  it("an agreement's append the same way, never replacing what's there", async () => {
    rows.workboard_notes = { ...NOTE, target_kind: "agreement", target_id: "a-1" };
    rows.maintenance_agreements = { notes: "Ask for Marco at the dock." };
    const res = await applyNote("n-1", confirmed({ commissioningEntries: ["Charge 4.2 kg"] }));
    expect(res.ok).toBe(true);
    expect(updates.find((u) => u.table === "maintenance_agreements")!.patch.notes).toBe(
      "Ask for Marco at the dock.\nCommissioning: Charge 4.2 kg"
    );
  });

  /* ANY job will do — but there has to BE one. With no target there is no
     notes column to append to either, so this stays a refusal, and the
     sentence names commissioning because the person may have ticked nothing
     else. The review card's `blockers` says the identical thing. */
  it("REFUSES commissioning with no job at all, and says commissioning", async () => {
    rows.workboard_notes = { ...NOTE, target_kind: "none", target_id: null };
    const res = await applyNote("n-1", confirmed({ commissioningEntries: ["Superheat 6K"] }));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/commissioning/);
    expect(updates.some((u) => u.table === "workboard_notes" && u.patch.status === "applied")).toBe(
      false
    );
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
    /* AND NOTHING TO READ BACK. The other three endings record what they did,
       which is what puts them on the journal; this one is Escape, the × and
       walking away, and an abandonment that recorded an outcome would read
       there exactly like a note somebody filed on purpose. */
    expect(updates[0].patch).not.toHaveProperty("applied");
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
    /* And the note itself is settled — as what it actually was. It used to
       settle at `dismissed`, the status Escape writes, so the journal (which
       lists `applied` rows) had nothing to show for a capture that had just
       succeeded: you said it, chose "Keep it on the job", and the record said
       you never said it. */
    const note = updates.find((u) => u.table === "workboard_notes")!;
    expect(note.patch.status).toBe("applied");
    expect(note.patch.applied).toEqual({ jobNotes: ["Gate code is 4821 after hours."] });
    expect(note.patch.applied_at).toEqual(expect.any(String));
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

/* THE LAST RUNG, and the ending that was hardest to see. It writes a real row
   to a real screen and used to file its own capture at `dismissed` — so the
   journal, which lists what was applied, showed nothing at all for it. */
describe("keeping a note for yourself", () => {
  it("writes the words to your own notes and records the line it kept", async () => {
    rows.workboard_notes = { ...NOTE, transcript: "Ring the wholesaler back about pricing." };

    const res = await keepNoteForMe("n-1");
    expect(res.ok).toBe(true);
    expect(rowsFor("staff_notes")).toEqual([
      {
        org_id: "org-1",
        staff_id: "staff-me",
        body: "Ring the wholesaler back about pricing.",
        source: "routed",
        source_note_id: "n-1",
      },
    ]);

    /* `noteLines` rather than a group of its own: this does literally what the
       debrief's leftovers do — ONE `staff_notes` row, linked by
       `source_note_id`, which is the link the journal's kept-lines chip
       resolves its door from. A second key would render the same chip in
       different words. */
    const note = updates.find((u) => u.table === "workboard_notes")!;
    expect(note.patch.status).toBe("applied");
    expect(note.patch.applied).toEqual({
      noteLines: ["Ring the wholesaler back about pricing."],
    });
  });

  it("keeps nothing, and says so, when the note is already gone", async () => {
    rows.workboard_notes = null;
    expect((await keepNoteForMe("n-1")).ok).toBe(false);
    expect(inserts).toHaveLength(0);
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
    const res = await applyNote("n-1", confirmed(), { kind: "job", id: "job-uuid" });
    expect(res.ok).toBe(true);
  });

  it("NEVER writes on the mirror — the words land on the note row itself", async () => {
    const res = await keepNoteOnJob("n-1");
    expect(res).toEqual({ ok: true, summary: "Kept on the job's diary." });
    expect(patchesTo("sm8_jobs")).toHaveLength(0);
    expect(inserts.some((i) => i.table === "sm8_jobs")).toBe(false);
    /* Filed applied with `jobNotes` — the group the diary reads and the
       journal already counts. */
    const patch = patchesTo("workboard_notes")[0]?.patch as Record<string, unknown>;
    expect(patch.status).toBe("applied");
    expect(patch.applied).toEqual({ jobNotes: ["…"] });
  });

  it("puts the words in the diary whatever else the note did", async () => {
    lists.staff_profiles = [{ id: "s-luke" }];
    const res = await applyNote(
      "n-1",
      confirmed({
        tasks: [{ title: "Order the grilles", detail: "", assigneeId: "s-luke", dueDate: null }],
      })
    );
    expect(res.ok).toBe(true);
    const patch = patchesTo("workboard_notes").at(-1)?.patch as Record<string, unknown>;
    /* "Get Luke to order the grilles" is a task AND a thing that was said on
       this job; a feed that showed only the half that grew a row would lie. */
    expect(patch.applied).toMatchObject({ taskIds: expect.any(Array), jobNotes: ["…"] });
    expect(res).toMatchObject({ summary: expect.stringContaining("note on the job") });
  });

  it("lands bring-items on the job's own checklist as materials", async () => {
    const res = await applyNote("n-1", confirmed({ bringItems: ["1060 × 175 linear grille"] }));
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
    const res = await applyNote(
      "n-1",
      confirmed({ progressBullets: ["Bulkheads in"], commissioningEntries: ["Charge 3.1kg"] })
    );
    expect(res.ok).toBe(true);
    /* The three note-owning tables are untouched, and so is the mirror. */
    expect(patchesTo("sm8_jobs")).toHaveLength(0);
    expect(patchesTo("maintenance_visits")).toHaveLength(0);
    expect(inserts.some((i) => i.table === "project_entries")).toBe(false);
    /* Counted all the same, so the journal sees the work. */
    const patch = patchesTo("workboard_notes").at(-1)?.patch as Record<string, unknown>;
    expect(patch.applied).toMatchObject({
      entryLines: ["Bulkheads in", "Commissioning: Charge 3.1kg"],
    });
  });

  it("hangs a flag off the job, like any other target", async () => {
    await applyNote("n-1", confirmed({ flags: [{ message: "No roof access", severity: "warn" }] }));
    expect(rowsFor("workboard_flags")[0]).toMatchObject({
      target_kind: "job",
      target_id: "job-uuid",
    });
  });
});
