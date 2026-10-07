/**
 * @jest-environment node
 */
/* A quote's lines, stored: one at a time, against the version they were
   read at, every change kept and any change undone. */
jest.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
const TABLES: Record<string, Row[]> = {};
let nextId = 1;

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters: ((r: Row) => boolean)[] = [];
      let op: "select" | "insert" | "update" | "delete" = "select";
      let payload: Row | null = null;
      let limitN: number | null = null;
      const orderBy: { c: string; asc: boolean }[] = [];
      const rows = () => (TABLES[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const run = (): Row[] => {
        if (op === "insert") {
          const row: Row = {
            id: table === "quote_lines" ? `line-${nextId++}` : nextId++,
            version: table === "quote_lines" ? 1 : undefined,
            created_at: new Date(Date.now() + nextId).toISOString(),
            made_at: new Date(Date.now() + nextId).toISOString(),
            ...payload,
          };
          TABLES[table] = [...(TABLES[table] ?? []), row];
          return [row];
        }
        if (op === "update") {
          const hit = rows();
          for (const r of hit) Object.assign(r, payload);
          return hit;
        }
        if (op === "delete") {
          const gone = new Set(rows());
          TABLES[table] = (TABLES[table] ?? []).filter((r) => !gone.has(r));
          return [...gone];
        }
        let out = rows();
        for (const o of [...orderBy].reverse()) {
          out = [...out].sort((a, b) => ((a[o.c] as number) > (b[o.c] as number) ? 1 : (a[o.c] as number) < (b[o.c] as number) ? -1 : 0) * (o.asc ? 1 : -1));
        }
        return limitN == null ? out : out.slice(0, limitN);
      };
      const q = {
        select: () => q,
        insert: (p: Row) => ((op = "insert"), (payload = p), q),
        update: (p: Row) => ((op = "update"), (payload = p), q),
        delete: () => ((op = "delete"), q),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
        order: (c: string, o?: { ascending?: boolean }) => (orderBy.push({ c, asc: o?.ascending !== false }), q),
        limit: (n: number) => ((limitN = n), q),
        single: async () => ({ data: run()[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: run(), error: null }),
      };
      return q;
    },
  },
}));

import { addLine, changeLine, namesBySignIn, readChanges, readEngine, readLines, removeLine, setEngine, undoChange } from "../lines-server";

const ORG = "org-a";
const JOB = "job-3384";
const flex = { group: "Ductwork and grilles", system: "Upstairs", name: "Flex 250, 6 m bag", code: "VB250", supplierKey: "aad", kind: "material", qty: 5, costCents: 3045, source: "assumed" };

beforeEach(() => {
  for (const k of Object.keys(TABLES)) delete TABLES[k];
  nextId = 1;
});

it("adds lines at the end of their option, and reads them back in order", async () => {
  await addLine(ORG, JOB, flex, "isaac");
  await addLine(ORG, JOB, { ...flex, name: "Cone diffuser 250", code: "CD250" }, "isaac");
  await addLine(ORG, "another-job", flex, "isaac");
  const lines = await readLines(ORG, JOB);
  expect(lines.map((l) => [l.name, l.position])).toEqual([
    ["Flex 250, 6 m bag", 0],
    ["Cone diffuser 250", 1],
  ]);
  expect((await readChanges(ORG, JOB)).map((c) => c.action)).toEqual(["add", "add"]);
});

it("refuses a line with no name", async () => {
  expect(await addLine(ORG, JOB, { ...flex, name: "" }, "isaac")).toEqual({ ok: false, reason: "A line needs a name and a group." });
});

it("changes a line against the version it was read at, and keeps who and what", async () => {
  const added = await addLine(ORG, JOB, flex, "isaac");
  const line = added.ok ? added.line! : null!;
  const r = await changeLine(ORG, JOB, line.id, line.version, { qty: 6 }, "luke", "one more outlet");
  expect(r.ok && r.line).toMatchObject({ qty: 6, source: "by_hand", version: 2 });
  const [last] = await readChanges(ORG, JOB);
  expect(last).toMatchObject({ action: "change", before: { qty: 5, source: "assumed" }, after: { qty: 6, source: "by_hand" }, madeBy: "luke", why: "one more outlet" });
});

it("refuses a change made to an old copy, rather than losing the newer one", async () => {
  const added = await addLine(ORG, JOB, flex, "isaac");
  const line = added.ok ? added.line! : null!;
  await changeLine(ORG, JOB, line.id, line.version, { qty: 6 }, "luke");
  const late = await changeLine(ORG, JOB, line.id, line.version, { qty: 7 }, "isaac");
  expect(late).toMatchObject({ ok: false, stale: true });
  expect((await readLines(ORG, JOB))[0]!.qty).toBe(6);
});

it("takes a line off and keeps it, so it can be put back", async () => {
  const added = await addLine(ORG, JOB, flex, "isaac");
  const line = added.ok ? added.line! : null!;
  await removeLine(ORG, JOB, line.id, line.version, "isaac");
  expect(await readLines(ORG, JOB)).toEqual([]);
  const [removal] = await readChanges(ORG, JOB);
  expect(removal).toMatchObject({ action: "remove", after: null });
  await undoChange(ORG, JOB, removal!.id, "isaac");
  expect((await readLines(ORG, JOB)).map((l) => l.name)).toEqual(["Flex 250, 6 m bag"]);
});

it("undoes a change by putting the line back as it was", async () => {
  const added = await addLine(ORG, JOB, flex, "isaac");
  const line = added.ok ? added.line! : null!;
  await changeLine(ORG, JOB, line.id, line.version, { qty: 6 }, "luke");
  const [change] = await readChanges(ORG, JOB);
  await undoChange(ORG, JOB, change!.id, "isaac");
  expect((await readLines(ORG, JOB))[0]).toMatchObject({ qty: 5, source: "assumed", version: 3 });
});

it("undoes an add by taking the line off", async () => {
  await addLine(ORG, JOB, flex, "isaac");
  const [add] = await readChanges(ORG, JOB);
  await undoChange(ORG, JOB, add!.id, "isaac");
  expect(await readLines(ORG, JOB)).toEqual([]);
});

it("every quote is on the old engine until it's switched", async () => {
  expect(await readEngine(ORG, JOB)).toBe("old");
  TABLES.quote_drafts = [{ org_id: ORG, sm8_job_uuid: JOB, engine: "lines" }];
  expect(await readEngine(ORG, JOB)).toBe("lines");
});

it("switches a quote with a draft by its own row, and one with none by a row that holds only the switch", async () => {
  TABLES.quote_drafts = [{ org_id: ORG, sm8_job_uuid: "drafted", engine: "old", draft: { options: [1] } }];
  expect(await setEngine(ORG, "drafted", "lines", "isaac")).toBe(true);
  expect(TABLES.quote_drafts[0]).toMatchObject({ engine: "lines", draft: { options: [1] } });
  expect(await setEngine(ORG, JOB, "lines", "isaac")).toBe(true);
  expect(TABLES.quote_drafts.find((r) => r.sm8_job_uuid === JOB)).toMatchObject({ engine: "lines", draft: {}, brief: "" });
  expect(await readEngine(ORG, JOB)).toBe("lines");
  /* switching back never makes a row */
  expect(await setEngine(ORG, "never", "old", "isaac")).toBe(true);
  expect(TABLES.quote_drafts.find((r) => r.sm8_job_uuid === "never")).toBeUndefined();
});

it("names who made each change by their staff card, Tiff and the unknown left unnamed", async () => {
  TABLES.staff_profiles = [{ org_id: ORG, user_id: "auth0|luke", first_name: "Luke", last_name: "Bennett", full_name: null, preferred_name: null }];
  expect(await namesBySignIn(ORG, ["auth0|luke", "tiff", "auth0|gone"])).toEqual({ "auth0|luke": "Luke Bennett" });
});
