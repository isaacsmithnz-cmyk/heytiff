/**
 * @jest-environment node
 */

/* The card's "Also called", saved — and the reads that tolerate a workspace
   without the table (Isaac, 2026-09-29). A small in-memory database, because
   the claims are about what is left in it. */

type Row = Record<string, unknown>;
let db: Record<string, Row[]> = {};
let missing = new Set<string>();
let seq = 0;

function from(table: string) {
  const filters: [string, string, unknown][] = [];
  let mode: "select" | "delete" = "select";
  const hit = () =>
    (db[table] ?? []).filter((r) =>
      filters.every(([op, c, v]) => (op === "eq" ? r[c] === v : (v as unknown[]).includes(r[c]))),
    );
  const fail = () => ({ data: null, error: { message: "relation does not exist" } });
  const run = () => {
    if (missing.has(table)) return fail();
    if (mode === "delete") {
      const gone = new Set(hit());
      db[table] = (db[table] ?? []).filter((r) => !gone.has(r));
      return { data: null, error: null };
    }
    return { data: hit().map((r) => ({ ...r })), error: null };
  };
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = (c: string, v: unknown) => (filters.push(["eq", c, v]), b);
  b.in = (c: string, v: unknown[]) => (filters.push(["in", c, v]), b);
  b.order = () => b;
  b.limit = () => b;
  b.delete = () => ((mode = "delete"), b);
  b.maybeSingle = async () => {
    const r = run();
    return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error };
  };
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res);
  b.upsert = (payload: Row | Row[]) => {
    if (missing.has(table)) return Object.assign(Promise.resolve(fail()), { select: async () => fail() });
    const made: Row[] = [];
    for (const p of Array.isArray(payload) ? payload : [payload]) {
      if ((db[table] ?? []).some((r) => r.org_id === p.org_id && r.alias_norm === p.alias_norm)) continue;
      const row = { id: `a-${++seq}`, created_at: `2026-09-29T00:00:0${seq}Z`, ...p };
      (db[table] ??= []).push(row);
      made.push(row);
    }
    const out = { data: made, error: null };
    return Object.assign(Promise.resolve(out), { select: async () => out });
  };
  return b;
}
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (t: string) => from(t) } }));

import { aliasesByStaff, learnAlias, saveCardAliases, spokenStaffNames } from "../aliases-query";

const person = (id: string, first: string, last: string, preferred: string | null = null) => ({
  id, org_id: "org-1", first_name: first, last_name: last, full_name: `${first} ${last}`, preferred_name: preferred,
});
const alias = (staff: string, name: string) => ({
  id: `x-${name}`, org_id: "org-1", staff_profile_id: staff, alias: name, alias_norm: name.toLowerCase(), source: "tiff", added_by: null, created_at: "2026-09-01T00:00:00Z",
});

beforeEach(() => {
  seq = 0;
  missing = new Set();
  db = {
    staff_profiles: [person("s-leo", "Leonardo", "Martins"), person("s-bobby", "Bobby", "Tran", "Bob"), person("s-me", "Isaac", "Smith")],
    staff_aliases: [alias("s-leo", "Bobo"), alias("s-bobby", "Tiny")],
  };
});

const namesOf = (staff: string) => (db.staff_aliases ?? []).filter((r) => r.staff_profile_id === staff).map((r) => r.alias);

describe("saveCardAliases", () => {
  it("(F) keeps what the list names and drops what it no longer does, as typed on the card", async () => {
    expect(await saveCardAliases("org-1", "s-leo", ["Big Leo"], "s-me")).toEqual({ ok: true });
    expect(namesOf("s-leo")).toEqual(["Big Leo"]);
    expect(db.staff_aliases.find((r) => r.alias === "Big Leo")).toMatchObject({ alias_norm: "big leo", source: "card", added_by: "s-me" });
    // somebody else's names are untouched
    expect(namesOf("s-bobby")).toEqual(["Tiny"]);
  });

  it("(F) never takes a name somebody else goes by: refuses the whole list, names them, writes nothing", async () => {
    const r = await saveCardAliases("org-1", "s-leo", ["Leo", "tiny"], "s-me");
    expect(r).toEqual({ ok: false, error: "tiny is already what Bobby Tran is called.", fields: ["aliases"] });
    expect(namesOf("s-leo")).toEqual(["Bobo"]);
  });

  it("(F) refuses a real name, and what isn't a name", async () => {
    expect(await saveCardAliases("org-1", "s-leo", ["Bobby"], "s-me")).toMatchObject({ ok: false, error: "Bobby is somebody's real name here, so it can't be a nickname." });
    expect(await saveCardAliases("org-1", "s-leo", ["R2D2"], "s-me")).toMatchObject({ ok: false, fields: ["aliases"] });
    expect(await saveCardAliases("org-1", "s-leo", "Bobo" as unknown, "s-me")).toEqual({ ok: true }); // not a list: an empty one
    expect(namesOf("s-leo")).toEqual([]);
  });

  it("says it couldn't save where the table isn't there yet", async () => {
    missing.add("staff_aliases");
    expect(await saveCardAliases("org-1", "s-leo", ["Leo"], "s-me")).toEqual({ ok: false, error: "The names couldn't be saved. Try again." });
  });
});

describe("learnAlias", () => {
  it("(F) keeps a learned name, and never moves one already somebody's", async () => {
    expect(await learnAlias("org-1", "s-leo", "Leo", "s-me")).toBe(true);
    expect(await learnAlias("org-1", "s-leo", "tiny", "s-me")).toBe(false);
    expect(namesOf("s-leo")).toEqual(["Bobo", "Leo"]);
    expect(namesOf("s-bobby")).toEqual(["Tiny"]);
  });
});

describe("reads", () => {
  it("read as no nicknames where the table isn't there yet", async () => {
    missing.add("staff_aliases");
    expect(await aliasesByStaff("org-1")).toEqual(new Map());
    expect(await spokenStaffNames("org-1")).toEqual(["Leonardo", "Martins", "Bobby", "Tran", "Isaac", "Smith", "Bob"]);
  });

  it("(F) give the transcriber everyone's names and every name they go by", async () => {
    expect(await spokenStaffNames("org-1")).toEqual(["Leonardo", "Martins", "Bobby", "Tran", "Isaac", "Smith", "Bob", "Bobo", "Tiny"]);
  });
});
