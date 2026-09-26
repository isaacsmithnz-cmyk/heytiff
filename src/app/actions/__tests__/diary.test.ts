/* YOUR DIARY, KEPT TIDY (Isaac, 2026-09-26: "you should only be able to
   delete your own entries or edit. with the option to hide/archive other
   peoples").

   These are Server Functions, so each is reachable by a direct POST with
   any id at all: "the page only offered it on your own entries" is not a
   control, and the tests below are about what happens when it isn't true. */

type Op = { table: string; op: string; payload?: unknown; eq: Record<string, unknown>; in?: [string, unknown]; is?: [string, unknown] };

const ops: Op[] = [];
/** What a single-row read of a table finds. */
let rows: Record<string, Record<string, unknown> | null> = {};
/** What a list read (or a write's returned rows) of a table finds. */
let lists: Record<string, Record<string, unknown>[]> = {};
/** Tables whose writes answer with an error. */
const failing = new Set<string>();

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const op: Op = { table, op: "select", eq: {} };
      ops.push(op);
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = (col: string, val: unknown) => {
        op.eq[col] = val;
        return chain;
      };
      chain.in = (col: string, val: unknown) => {
        op.in = [col, val];
        return chain;
      };
      chain.is = (col: string, val: unknown) => {
        op.is = [col, val];
        return chain;
      };
      chain.limit = self;
      chain.update = (payload: unknown) => {
        op.op = "update";
        op.payload = payload;
        return chain;
      };
      chain.delete = () => {
        op.op = "delete";
        return chain;
      };
      chain.upsert = (payload: unknown) => {
        op.op = "upsert";
        op.payload = payload;
        return Promise.resolve({ error: failing.has(table) ? { message: "no" } : null });
      };
      chain.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
      chain.then = (res: (v: unknown) => unknown) =>
        Promise.resolve(
          failing.has(table) ? { data: null, error: { message: "no" } } : { data: lists[table] ?? [], error: null },
        ).then(res);
      return chain;
    },
  },
}));

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
let session: { orgId?: string; user?: { sub?: string } } | null = { orgId: "org-1", user: { sub: "auth0|me" } };
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => session } }));
let staff: string | null = "s-me";
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: async () => staff }));
const removeJobNote = jest.fn(async (..._a: unknown[]) => ({ ok: true as const, gone: true }));
jest.mock("../job-notes", () => ({ removeJobNote: (...a: unknown[]) => removeJobNote(...a) }));

import { revalidatePath } from "next/cache";
import { deleteDiaryEntry, editDiaryEntry, hideConversation, showConversation } from "../diary";

const ID = "7817c989-a2d3-43c6-974e-9f14d5cecc8d";
const mine = (over: Record<string, unknown> = {}) => ({
  id: ID,
  author_id: "s-me",
  status: "applied",
  target_kind: "none",
  target_id: null,
  reply_to_sm8_note_uuid: null,
  is_task_done: false,
  removed_at: null,
  ...over,
});
const writes = () => ops.filter((o) => o.op !== "select");

beforeEach(() => {
  ops.length = 0;
  failing.clear();
  session = { orgId: "org-1", user: { sub: "auth0|me" } };
  staff = "s-me";
  rows = { workboard_notes: mine() };
  lists = { workboard_notes: [{ id: ID }] };
  removeJobNote.mockClear();
  (revalidatePath as jest.Mock).mockClear();
});

describe("editDiaryEntry", () => {
  it("puts your words right, scoped to your own row, and refreshes Home", async () => {
    expect(await editDiaryEntry(ID, "  Luke to order two 20x20x2 filters for Kingsford  ")).toEqual({ ok: true });
    const [w] = writes();
    expect(w).toMatchObject({
      table: "workboard_notes",
      op: "update",
      payload: { transcript: "Luke to order two 20x20x2 filters for Kingsford" },
      eq: { org_id: "org-1", id: ID, author_id: "s-me" },
      is: ["removed_at", null],
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("refuses somebody else's entry, and writes nothing", async () => {
    rows.workboard_notes = mine({ author_id: "s-luke" });
    expect(await editDiaryEntry(ID, "mine now")).toEqual({ ok: false, error: "Only whoever wrote an entry can change it." });
    expect(writes()).toEqual([]);
  });

  it("refuses an entry that isn't on the diary: gone, taken back, or set aside", async () => {
    for (const row of [null, mine({ removed_at: "2026-09-26T00:00:00Z" }), mine({ status: "dismissed" }), mine({ status: "proposed" })]) {
      rows.workboard_notes = row;
      expect(await editDiaryEntry(ID, "words")).toEqual({ ok: false, error: "That entry is no longer here." });
    }
    expect(await editDiaryEntry("not-a-uuid", "words")).toEqual({ ok: false, error: "That entry is no longer here." });
    expect(writes()).toEqual([]);
  });

  it("refuses a note ServiceM8 holds too: a reply, a Done, or one ever queued to go", async () => {
    const said = { ok: false, error: "That one is in ServiceM8 now, so change it there." };
    rows.workboard_notes = mine({ target_kind: "job", reply_to_sm8_note_uuid: "sm8-1" });
    expect(await editDiaryEntry(ID, "words")).toEqual(said);
    rows.workboard_notes = mine({ target_kind: "job", is_task_done: true });
    expect(await editDiaryEntry(ID, "words")).toEqual(said);
    rows.workboard_notes = mine({ target_kind: "job" });
    lists.sm8_writes = [{ id: "w-1" }];
    expect(await editDiaryEntry(ID, "words")).toEqual(said);
    // and a read of the queue that fails refuses rather than risk two sets of words
    lists.sm8_writes = [];
    failing.add("sm8_writes");
    expect(await editDiaryEntry(ID, "words")).toEqual(said);
    expect(writes()).toEqual([]);
  });

  it("edits a job note that never left HeyTiff, and refreshes the board too", async () => {
    rows.workboard_notes = mine({ target_kind: "job", target_id: "job-1" });
    expect(await editDiaryEntry(ID, "words")).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/workboard");
  });

  it("keeps no empty entry: that is a delete", async () => {
    expect(await editDiaryEntry(ID, "   ")).toEqual({ ok: false, error: "There's nothing in it. Delete it instead." });
    expect(ops).toEqual([]);
  });

  it("says so when nobody is signed in, or has no staff card", async () => {
    session = null;
    expect(await editDiaryEntry(ID, "words")).toEqual({ ok: false, error: "Not signed in." });
    session = { orgId: "org-1", user: { sub: "auth0|me" } };
    staff = null;
    expect(await editDiaryEntry(ID, "words")).toEqual({ ok: false, error: "Your staff profile isn't set up yet." });
    expect(writes()).toEqual([]);
  });
});

describe("deleteDiaryEntry", () => {
  it("deletes your own entry, scoped to your row as the diary shows it", async () => {
    expect(await deleteDiaryEntry(ID)).toEqual({ ok: true });
    const [w] = writes();
    expect(w).toMatchObject({
      table: "workboard_notes",
      op: "delete",
      eq: { org_id: "org-1", id: ID, author_id: "s-me" },
      in: ["status", ["applied", "undone"]],
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(removeJobNote).not.toHaveBeenCalled();
  });

  it("takes a job note off by the job card's own rule", async () => {
    rows.workboard_notes = mine({ target_kind: "job", target_id: "job-1" });
    expect(await deleteDiaryEntry(ID)).toEqual({ ok: true });
    expect(removeJobNote).toHaveBeenCalledWith(ID);
    expect(writes()).toEqual([]);

    removeJobNote.mockResolvedValueOnce({ ok: false, error: "Still going to ServiceM8." } as never);
    expect(await deleteDiaryEntry(ID)).toEqual({ ok: false, error: "Still going to ServiceM8." });
  });

  it("refuses somebody else's entry, whatever kind it is", async () => {
    for (const kind of ["none", "job"]) {
      rows.workboard_notes = mine({ author_id: "s-luke", target_kind: kind });
      expect(await deleteDiaryEntry(ID)).toEqual({ ok: false, error: "Only whoever wrote an entry can change it." });
    }
    expect(writes()).toEqual([]);
    expect(removeJobNote).not.toHaveBeenCalled();
  });

  it("says the entry is gone when the delete found nothing to take", async () => {
    lists.workboard_notes = [];
    expect(await deleteDiaryEntry(ID)).toEqual({ ok: false, error: "That entry is no longer here." });
  });
});

describe("hideConversation and its Undo", () => {
  const KEY = "3f2b8c1e-0d4a-4b6f-9a2e-1c5d7e9f0a11:5b1d2c3e-aaaa-4bbb-8ccc-1d2e3f4a5b6c";

  it("hides it for you alone, and Undo brings it back", async () => {
    expect(await hideConversation(KEY)).toEqual({ ok: true });
    const [hide] = writes();
    expect(hide).toMatchObject({ table: "diary_hidden", op: "upsert" });
    expect(hide.payload).toMatchObject({ org_id: "org-1", staff_id: "s-me", conversation_key: KEY });

    expect(await showConversation(KEY)).toEqual({ ok: true });
    const show = writes()[1];
    expect(show).toMatchObject({
      table: "diary_hidden",
      op: "delete",
      eq: { org_id: "org-1", staff_id: "s-me", conversation_key: KEY },
    });
    // the conversation on screen stands as "Hidden." with Undo: no refresh
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a key that isn't a conversation's", async () => {
    expect(await hideConversation("drop table")).toEqual({ ok: false, error: "That conversation is no longer here." });
    expect(await showConversation("")).toEqual({ ok: false, error: "That conversation is no longer here." });
    expect(ops).toEqual([]);
  });

  it("says it couldn't where the write failed — the table not there yet, say", async () => {
    failing.add("diary_hidden");
    expect(await hideConversation(KEY)).toEqual({ ok: false, error: "Couldn't hide that." });
    expect(await showConversation(KEY)).toEqual({ ok: false, error: "Couldn't bring that back." });
  });
});
