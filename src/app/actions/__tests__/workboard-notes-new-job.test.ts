/**
 * @jest-environment node
 */

/* A NEW JOB FROM TIFF (workboard/new-job-check) — the server.

   Isaac's first hands-free talk, 26 November 2026, on the phone, with the
   names here made up: "It's for a split system. Client is Sam DeVane. Can
   you have a look and see if we have her as an existing customer?" She
   didn't look, and asked "Make the job in ServiceM8?". He said yes and it
   failed: "Where is the job? Add the site's address." He gave one, and she
   offered the job at the suburb the transcriber misheard.

   The router is faked (no model is called): its proposal is the new job it
   read. Everything after it is real `fileNote` and `answerVisit`; the
   customer lookup, the map and the job's making are the fakes, so these
   pin what she says and when the job is made. */
type Row = Record<string, unknown>;
type Filter = [op: "eq" | "in" | "is", column: string, value: unknown];

let db: Record<string, Row[]> = {};
let seq = 0;

function from(table: string) {
  const filters: Filter[] = [];
  let mode: "select" | "update" | "delete" = "select";
  let patch: Row = {};
  let returning = false;
  const match = (r: Row) =>
    filters.every(([op, col, val]) =>
      op === "eq" ? r[col] === val : op === "is" ? (r[col] ?? null) === val : (val as unknown[]).includes(r[col]),
    );
  const run = (one = false) => {
    const all = db[table] ?? [];
    const hit = all.filter(match);
    if (mode === "update") {
      for (const r of hit) Object.assign(r, structuredClone(patch));
      return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null };
    }
    if (mode === "delete") {
      if (db[table]) db[table] = all.filter((r) => !match(r));
      return { data: null, error: null };
    }
    if (one) return { data: hit[0] ? structuredClone(hit[0]) : null, error: null };
    return { data: hit.map((r) => structuredClone(r)), error: null };
  };
  const b: Record<string, unknown> = {};
  b.select = () => {
    if (mode !== "select") returning = true;
    return b;
  };
  b.eq = (col: string, val: unknown) => (filters.push(["eq", col, val]), b);
  b.in = (col: string, val: unknown[]) => (filters.push(["in", col, val]), b);
  b.is = (col: string, val: unknown) => (filters.push(["is", col, val]), b);
  b.gte = () => b;
  b.lt = () => b;
  b.order = () => b;
  b.limit = () => b;
  b.maybeSingle = async () => run(true);
  b.single = async () => run(true);
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej);
  b.update = (p: Row) => ((mode = "update"), (patch = p), b);
  b.delete = () => ((mode = "delete"), b);
  b.insert = (payload: Row | Row[]) => {
    const made = (Array.isArray(payload) ? payload : [payload]).map((p) => ({
      id: `${table}-${++seq}`,
      ...structuredClone(p),
    }));
    (db[table] ??= []).push(...made);
    const out = () => made.map((m) => ({ ...m }));
    return {
      select: () => ({
        single: async () => ({ data: out()[0], error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: out(), error: null }).then(res),
      }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
    };
  };
  return b;
}

const isObj = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
/* tiff_modal_record.sql's merge, as the database runs it */
async function rpc(name: string, a: Row) {
  if (name !== "workboard_note_file_record") return { data: false, error: null };
  const n = (db.workboard_notes ?? []).find((r) => r.org_id === a.p_org && r.id === a.p_note && r.status === "applied");
  if (!n || !isObj(a.p_applied)) return { data: false, error: null };
  n.applied = { ...(isObj(n.applied) ? n.applied : {}), ...structuredClone(a.p_applied) };
  return { data: true, error: null };
}

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (t: string) => from(t), rpc: (n: string, a: Row) => rpc(n, a) },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
/* a filed job note sends on to ServiceM8 after the answer; not these tests' business */
jest.mock("next/server", () => ({ after: () => undefined }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(async () => ({ user: { sub: "auth0|me" }, orgId: "org-1" })) },
}));

let caps = new Set<string>();
jest.mock("@/lib/permissions-server", () => ({
  can: async (c: string) => caps.has(c),
  getDbRole: async () => "owner",
}));
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: async () => "s-me" }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: async () => "Australia/Sydney" }));
jest.mock("@/lib/workboard/dates", () => ({
  ...jest.requireActual("@/lib/workboard/dates"),
  todayInZone: () => "2026-11-26",
}));
jest.mock("@/lib/brain/tools", () => ({
  jobHistory: async () => ({ equipment: [], issues: [], flags: [], recentNotes: [] }),
}));
jest.mock("@/lib/dashboard/job-candidates", () => ({ jobCandidates: async () => [] }));
jest.mock("@/lib/tiff/field-notes", () => ({ publishFieldNote: jest.fn() }));
jest.mock("@/lib/integrations/sm8-press", () => ({ sm8PressFromSession: async () => ({ orgId: "org-1", userId: "auth0|me", staffId: "s-me" }) }));

/* THE BOOK AND THE MAP, faked at their doors */
import type { CustomerHit } from "@/lib/customers/find";
import type { PlaceCheck } from "@/lib/address/place-check";
let customers: CustomerHit[] = [];
let places: Record<string, PlaceCheck> = {};
const lookedUp: string[] = [];
jest.mock("@/lib/customers/find-server", () => ({
  findCustomers: async (_org: string, name: string) => (lookedUp.push(name), customers),
}));
jest.mock("@/lib/address/places-proxy", () => ({
  checkPlace: async (said: string) => places[said] ?? { kind: "none" },
}));
/* the job's making: what it was asked to make */
const made: Row[] = [];
jest.mock("@/lib/workboard/note-skills-file", () => ({
  ...jest.requireActual("@/lib/workboard/note-skills-file"),
  doSkill: async (_ctx: unknown, k: Row) => {
    made.push(k);
    return k.address
      ? { made: { index: 0, kind: "new_job", line: "made", undo: null, undone: false }, line: `The job is made at ${k.address}, as a Quote in ServiceM8.` }
      : { made: null, line: "The job wasn't made: Where is the job? Add the site's address." };
  },
}));

import { answerVisit, fileNote } from "../workboard-notes";
import type { NoteProposal } from "@/lib/workboard/note-brain";
import type { ProposedSkill } from "@/lib/workboard/note-skills";

const EMPTY: NoteProposal = {
  tasks: [],
  visits: [],
  costs: [],
  variations: [],
  bringItems: [],
  flags: [],
  progressBullets: [],
  commissioningEntries: [],
  issueEntries: [],
  kbEntries: [],
  plainNote: "",
  jobNote: "",
  say: "",
  clarify: null,
};
const SAID = "It's for a split system. Client is Sam DeVane. Can you have a look and see if we have her as an existing customer?";
const t = (who: "you" | "tiff", text: string) => ({ who, text, at: "2026-11-26T01:05:00.000Z" });
const newJob = (over: Partial<Extract<ProposedSkill, { kind: "new_job" }>> = {}): ProposedSkill => ({ kind: "new_job", work: "Split system quote", address: "", client: "Sam DeVane", phone: "", email: "", ...over });
function note(skill: ProposedSkill, turns = [t("you", SAID)]) {
  db.workboard_notes = [
    {
      id: "n-1",
      org_id: "org-1",
      author_id: "s-me",
      target_kind: "none",
      target_id: null,
      transcript: SAID,
      source: "voice",
      status: "pending",
      proposal: { ...EMPTY, skills: [skill] },
      applied: null,
      turns,
    },
  ];
}
const noteRow = () => db.workboard_notes[0]!;
const FOUND: CustomerHit = {
  name: "Sam De Vane",
  via: "job contact",
  client: "QX Construct",
  address: "2/28 Lorem St\nSampleton NSW 2088",
  job: { number: "2951", status: "Completed", date: "2024-05-03" },
  fit: 1,
};
const asked = (res: Awaited<ReturnType<typeof fileNote>>) => ("ask" in res ? res.ask?.question : undefined);
const said = (res: Awaited<ReturnType<typeof fileNote>>) => (res.turns ?? []).filter((x) => x.who === "tiff").map((x) => x.text);

beforeEach(() => {
  db = { staff_profiles: [{ id: "s-me", first_name: "Isaac", last_name: "Smith", full_name: "Isaac Smith", org_id: "org-1" }] };
  seq = 0;
  caps = new Set(["workboard", "workboard_manage"]);
  customers = [];
  places = {};
  lookedUp.length = 0;
  made.length = 0;
});

describe("failure 1: asked whether she's an existing customer", () => {
  it("looks her up and says what it found before anything is offered", async () => {
    customers = [FOUND];
    note(newJob());
    const res = await fileNote("n-1");
    expect(lookedUp).toEqual(["Sam DeVane"]);
    expect(said(res)).toEqual([
      "Sam De Vane is already a customer: job 2951 at 2/28 Lorem St, Sampleton NSW 2088, Completed May 2024, through QX Construct.",
      "Is the new job at 2/28 Lorem St, Sampleton NSW 2088, or somewhere else?",
    ]);
    expect(asked(res)).not.toMatch(/Make the job/);
    expect(made).toEqual([]);
  });

  it("says she found nobody, when nobody's there", async () => {
    note(newJob());
    const res = await fileNote("n-1");
    expect(said(res)[0]).toBe("I couldn't find Sam DeVane among your customers, so they'd be a new client.");
  });
});

describe("failure 2: offered the job before it had a site address", () => {
  it("asks where the job is, in plain words, and makes nothing", async () => {
    note(newJob({ client: "" }));
    const res = await fileNote("n-1");
    expect(res.ok).toBe(false);
    expect(asked(res)).toBe("Where's the new job? Say the site's address, with the suburb.");
    expect(noteRow().status).toBe("clarifying");
    expect(made).toEqual([]);
  });

  it("offers the job once the address is there, and a yes makes it", async () => {
    places = { "2/26 Lorem Street, Sampleton": { kind: "found", address: "2/26 Lorem St, Sampleton NSW 2088" } };
    note(newJob({ client: "", address: "2/26 Lorem Street, Sampleton" }));
    const res = await fileNote("n-1");
    expect(res.ok).toBe(true);
    expect(asked(res)).toBe("Make the job at 2/26 Lorem St, Sampleton NSW 2088 in ServiceM8?");
    const yes = await answerVisit("n-1", "Make the job");
    expect(yes.ok).toBe(true);
    expect(made).toEqual([expect.objectContaining({ address: "2/26 Lorem St, Sampleton NSW 2088" })]);
  });
});

describe("failure 3: a misheard suburb went straight into the job", () => {
  it("offers the job at the place the map gives, in the map's spelling", async () => {
    places = { "2/26 Lorem Street, Samppleton": { kind: "found", address: "2/26 Lorem St, Sampleton NSW 2088" } };
    customers = [FOUND];
    note(newJob({ address: "2/26 Lorem Street, Samppleton" }));
    const res = await fileNote("n-1");
    expect(asked(res)).toBe(
      "Sam De Vane is already a customer: job 2951 at 2/28 Lorem St, Sampleton NSW 2088, Completed May 2024, through QX Construct. Make the job at 2/26 Lorem St, Sampleton NSW 2088 in ServiceM8?",
    );
    // the stored job is the map's, so a yes makes that one
    await answerVisit("n-1", "yes");
    expect(made).toEqual([expect.objectContaining({ address: "2/26 Lorem St, Sampleton NSW 2088" })]);
  });

  it("asks about an address the map doesn't know, offering the one on file", async () => {
    customers = [FOUND];
    note(newJob({ address: "Unit 2, 26 Wagon Street, Sampletin" }));
    const res = await fileNote("n-1");
    expect(asked(res)).toBe("I couldn't find Unit 2, 26 Wagon Street, Sampletin on the map. Is it 2/28 Lorem St, Sampleton NSW 2088?");
    expect(made).toEqual([]);
  });

  it("takes it as said when it's said again after she asked", async () => {
    note(newJob({ client: "", address: "Lot 4 Newbuild Rd, Sampleton" }), [t("you", SAID), t("tiff", "I couldn't find Lot 4 New Build Road on the map. What's the street number, street and suburb?"), t("you", "Lot 4 Newbuild Rd, Sampleton")]);
    const res = await fileNote("n-1");
    expect(asked(res)).toBe("Make the job at Lot 4 Newbuild Rd, Sampleton in ServiceM8?");
  });

  it("asks nothing of the map when the map didn't answer", async () => {
    places = { "2/26 Lorem Street, Sampleton": { kind: "off" } };
    note(newJob({ client: "", address: "2/26 Lorem Street, Sampleton" }));
    expect(asked(await fileNote("n-1"))).toBe("Make the job at 2/26 Lorem Street, Sampleton in ServiceM8?");
  });
});


