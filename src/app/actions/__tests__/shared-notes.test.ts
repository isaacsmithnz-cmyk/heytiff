/* New › Note's actions (Isaac, 24 October 2026). A note with no job goes to
   the people named, or to the office (owners and admins) if nobody is; a
   reply puts it back in everyone else's feed; Done takes it out of yours,
   and the office's for one that came to you as one of them. Every query is
   narrowed to this workspace: supabaseAdmin passes RLS by, so `org_id` is
   the only thing keeping one workspace's note off another's people. */

type Op = { table: string; op: string; args: unknown[] };
let ops: Op[] = [];
/** What each read answers: by table and the first op after `from`. */
let answer: (table: string, chain: Op[]) => { data?: unknown; error?: unknown } = () => ({ data: null });

const table = (name: string) => {
  const mine: Op[] = [];
  const chain: Record<string, unknown> = {};
  const rec =
    (op: string) =>
    (...args: unknown[]) => {
      const o = { table: name, op, args };
      mine.push(o);
      ops.push(o);
      return chain;
    };
  for (const op of ["select", "eq", "neq", "in", "is", "or", "order", "limit", "insert", "update", "delete"]) chain[op] = rec(op);
  chain.single = async () => answer(name, mine);
  chain.maybeSingle = async () => answer(name, mine);
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(answer(name, mine)).then(res, rej);
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (name: string) => table(name) } }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn().mockResolvedValue({ user: { sub: "auth0|me" }, orgId: "org-1" }) },
}));
jest.mock("@/lib/fleet/query", () => ({
  staffProfileIdFor: jest.fn(async () => "s-me"),
  listFleetStaff: jest.fn(async () => [
    { id: "s-me", name: "David Hann", status: "Active" },
    { id: "s-isaac", name: "Isaac Smith", status: "Active" },
    { id: "s-gone", name: "Old Hand", status: "Inactive" },
  ]),
}));
jest.mock("@/lib/shell/revalidate-home", () => ({ revalidateHome: jest.fn() }));
const addJobNote = jest.fn(async () => ({ id: "wn-1" }));
jest.mock("../job-notes", () => ({ addJobNote: (...a: unknown[]) => addJobNote(...(a as [])) }));

import { doneNote, notePeople, replyNote, sendNote } from "../shared-notes";

const inserted = (t: string) => ops.filter((o) => o.table === t && o.op === "insert").map((o) => o.args[0]);
const has = (chain: Op[], op: string, ...args: unknown[]) => chain.some((o) => o.op === op && JSON.stringify(o.args) === JSON.stringify(args));

beforeEach(() => {
  ops = [];
  addJobNote.mockClear();
  answer = (t, chain) => {
    if (t === "memberships") return { data: [{ user_id: "auth0|isaac", role: "owner" }, { user_id: "auth0|me", role: "admin" }] };
    if (t === "staff_profiles" && has(chain, "in", "user_id", ["auth0|isaac", "auth0|me"])) return { data: [{ id: "s-isaac" }, { id: "s-me" }] };
    if (t === "staff_profiles") return { data: (chain.find((o) => o.op === "in")?.args[1] as string[]).map((id) => ({ id })) };
    if (t === "shared_notes" && chain[0]?.op === "insert") return { data: { id: "t-1" } };
    if (t === "shared_note_people" && chain[0]?.op === "select") return { data: { via_office: false } };
    return { data: null, error: null };
  };
});

it("offers everyone on the team but you, and nobody who has left", async () => {
  expect(await notePeople()).toEqual({ me: "s-me", people: [{ id: "s-isaac", name: "Isaac Smith" }] });
});

it("(F) sends a note with no job and nobody named to the office, and never to its writer", async () => {
  expect(await sendNote({ text: "  Ute 2's reverse camera is out again ", jobUuid: null, to: [], toOffice: false })).toEqual({ ok: true });
  expect(inserted("shared_notes")).toEqual([
    { org_id: "org-1", author_id: "s-me", body: "Ute 2's reverse camera is out again", job_uuid: null, job_note_id: null, to_office: true },
  ]);
  expect(inserted("shared_note_people")[0]).toEqual([
    expect.objectContaining({ staff_id: "s-me", via_office: false, done_at: expect.any(String) }),
    { thread_id: "t-1", staff_id: "s-isaac", org_id: "org-1", via_office: true, done_at: null },
  ]);
  expect(ops.filter((o) => o.table === "memberships").some((o) => o.op === "eq" && o.args[0] === "org_id" && o.args[1] === "org-1")).toBe(true);
  expect(addJobNote).not.toHaveBeenCalled();
});

it("(F) sends to the people named, checked against this workspace", async () => {
  await sendNote({ text: "Can you grab the ladder", jobUuid: null, to: ["s-isaac", "s-me"], toOffice: false });
  const people = inserted("shared_note_people")[0] as { staff_id: string; via_office: boolean }[];
  expect(people.map((p) => [p.staff_id, p.via_office])).toEqual([
    ["s-me", false],
    ["s-isaac", false],
  ]);
  expect(ops.some((o) => o.table === "staff_profiles" && o.op === "eq" && o.args[1] === "org-1")).toBe(true);
  expect(inserted("shared_notes")[0]).toEqual(expect.objectContaining({ to_office: false }));
});

it("refuses someone who isn't on the team", async () => {
  answer = (t) => (t === "staff_profiles" ? { data: [] } : { data: null });
  expect(await sendNote({ text: "Hi", jobUuid: null, to: ["s-other-org"], toOffice: false })).toEqual({
    ok: false,
    error: "Someone you named isn't on the team any more.",
  });
  expect(inserted("shared_notes")).toEqual([]);
});

it("(F) keeps a note with a job on the job, and with nobody named it is the job's alone", async () => {
  expect(await sendNote({ text: "Return air is 600 x 400", jobUuid: "job-3450", to: [], toOffice: false })).toEqual({ ok: true });
  expect(addJobNote).toHaveBeenCalledWith("job-3450", "Return air is 600 x 400");
  expect(inserted("shared_notes")).toEqual([]);
});

it("(F) a job's note to someone is kept on the job and goes to them, naming the job's note", async () => {
  await sendNote({ text: "Return air is 600 x 400", jobUuid: "job-3450", to: ["s-isaac"], toOffice: false });
  expect(inserted("shared_notes")[0]).toEqual(expect.objectContaining({ job_uuid: "job-3450", job_note_id: "wn-1", to_office: false }));
});

it("says nothing is written when the words are empty", async () => {
  expect(await sendNote({ text: "   ", jobUuid: null, to: [], toOffice: true })).toEqual({ ok: false, error: "Write the note first." });
  expect(ops).toEqual([]);
});

it("(F) a reply is only for someone in the thread", async () => {
  answer = () => ({ data: null });
  expect(await replyNote("t-1", "On it")).toEqual({ ok: false, error: "That note isn't yours to answer." });
  expect(inserted("shared_notes")).toEqual([]);
});

it("(F) a reply puts the note back in everyone else's feed, and out of yours", async () => {
  expect(await replyNote("t-1", "Booked it in for Tuesday")).toEqual({ ok: true });
  expect(inserted("shared_notes")).toEqual([{ org_id: "org-1", thread_id: "t-1", author_id: "s-me", body: "Booked it in for Tuesday" }]);
  const updates = ops.filter((o) => o.table === "shared_note_people" && o.op === "update").map((o) => o.args[0]);
  expect(updates).toEqual([{ done_at: null }, { done_at: expect.any(String) }]);
  expect(ops.some((o) => o.op === "neq" && o.args[0] === "staff_id" && o.args[1] === "s-me")).toBe(true);
});

it("(F) Done is yours alone, or the whole office's for a note that came to you as one of them", async () => {
  await doneNote("t-1");
  let after = ops.slice(ops.findIndex((o) => o.op === "update"));
  expect(after.some((o) => o.op === "eq" && o.args[0] === "staff_id" && o.args[1] === "s-me")).toBe(true);
  ops = [];
  answer = (t, chain) => (t === "shared_note_people" && chain[0]?.op === "select" ? { data: { via_office: true } } : { data: null });
  await doneNote("t-1");
  after = ops.slice(ops.findIndex((o) => o.op === "update"));
  expect(after.some((o) => o.op === "eq" && o.args[0] === "via_office" && o.args[1] === true)).toBe(true);
  expect(after.some((o) => o.op === "eq" && o.args[0] === "org_id" && o.args[1] === "org-1")).toBe(true);
});
