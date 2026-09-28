/**
 * @jest-environment node
 *
 * The 30-day cap on HeyTiff's copies of ServiceM8's files. What matters most
 * is what it can NEVER reach: every other kind of document is somebody's
 * upload, and not one of them may go. Then the order — a reader treats a row
 * with `uploaded_at` as cached, so that mark comes off before the object
 * does, and a confirmed row never outlives its object. Then the stars, which
 * the showcase never fetches back.
 *
 * The database here is a small in-memory table that really applies the
 * filters the code sends, so a dropped filter shows up as a wrong row gone.
 */

import { DOCUMENT_KINDS } from "@/lib/documents/files";

type Row = Record<string, unknown>;
type DbError = { code?: string; message?: string };

const tables: Record<string, Row[]> = {};
const objects = new Set<string>();
const log: string[] = [];
/** Refusals, by `table.op` (or `storage.remove`). */
const refuse = new Map<string, DbError>();
/** Runs just before a delete of documents — a job's open racing the night. */
let beforeDelete: (() => void) | null = null;

/* ── a PostgREST filter, as much of it as the code speaks ── */
function splitTop(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of expr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function term(row: Row, t: string): boolean {
  const and = /^and\((.*)\)$/.exec(t);
  if (and) return splitTop(and[1]).every((x) => term(row, x));
  const m = /^(\w+)\.(lt|is|eq)\.(.*)$/.exec(t);
  if (!m) throw new Error(`unparsed filter ${t}`);
  const [, col, op, val] = m;
  const v = row[col];
  if (op === "is") return val === "null" ? v == null : String(v) === val;
  if (op === "eq") return String(v) === val;
  return v != null && String(v) < val;
}
const orOf = (row: Row, expr: string) => splitTop(expr).some((t) => term(row, t));

function query(table: string) {
  const rows = (tables[table] = tables[table] ?? []);
  const where: ((r: Row) => boolean)[] = [];
  const orders: { col: string; asc: boolean; nullsFirst: boolean }[] = [];
  let op: "select" | "update" | "delete" = "select";
  let patch: Row = {};
  let returning = false;
  let window: [number, number] | null = null;

  const run = (): { data: unknown; error: DbError | null } => {
    const refused = refuse.get(`${table}.${op}`);
    if (refused) return { data: null, error: refused };
    const hit = rows.filter((r) => where.every((w) => w(r)));
    if (op === "select") {
      const sorted = [...hit].sort((a, b) => {
        for (const o of orders) {
          const x = a[o.col] as string | null;
          const y = b[o.col] as string | null;
          if (x === y) continue;
          if (x == null) return o.nullsFirst ? -1 : 1;
          if (y == null) return o.nullsFirst ? 1 : -1;
          return (x < y ? -1 : 1) * (o.asc ? 1 : -1);
        }
        return 0;
      });
      const out = window ? sorted.slice(window[0], window[1] + 1) : sorted;
      return { data: out.map((r) => ({ ...r })), error: null };
    }
    if (op === "update") {
      for (const r of hit) Object.assign(r, patch);
      if (table === "documents" && "uploaded_at" in patch) log.push(`unconfirm:${hit.map((r) => r.id).join(",")}`);
      if (table === "documents" && "last_opened_at" in patch) log.push(`stamp:${hit.map((r) => r.id).join(",")}`);
      return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null };
    }
    beforeDelete?.();
    const gone = rows.filter((r) => where.every((w) => w(r)));
    tables[table] = rows.filter((r) => !gone.includes(r));
    log.push(`delete:${gone.map((r) => r.id).join(",")}`);
    return { data: returning ? gone.map((r) => ({ ...r })) : null, error: null };
  };

  const q: Record<string, unknown> = {
    select: () => {
      if (op !== "select") returning = true;
      return q;
    },
    update: (p: Row) => {
      op = "update";
      patch = p;
      return q;
    },
    delete: () => {
      op = "delete";
      return q;
    },
    eq: (col: string, v: unknown) => (where.push((r) => r[col] === v), q),
    in: (col: string, vs: unknown[]) => (where.push((r) => vs.includes(r[col])), q),
    is: (col: string, v: unknown) => (where.push((r) => (v === null ? r[col] == null : r[col] === v)), q),
    or: (expr: string) => (where.push((r) => orOf(r, expr)), q),
    order: (col: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) => (
      orders.push({ col, asc: o.ascending !== false, nullsFirst: !!o.nullsFirst }), q
    ),
    range: (from: number, to: number) => ((window = [from, to]), q),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return q;
}

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => query(table),
    storage: {
      from: () => ({
        remove: async (refs: string[]) => {
          const refused = refuse.get("storage.remove");
          if (refused) return { data: null, error: refused };
          log.push(`remove:${refs.join(",")}`);
          for (const r of refs) objects.delete(r);
          return { data: refs.map((name) => ({ name })), error: null };
        },
      }),
    },
  },
}));

import { evictStaleSm8Files, touchSm8Files, FILE_CACHE_DAYS } from "../sm8-file-cache";

const NOW = Date.parse("2026-09-28T20:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const OLD = daysAgo(45);
const FRESH = daysAgo(5);

let seq = 0;
/** A cached ServiceM8 file by default; override anything. */
function doc(over: Row = {}): Row {
  seq += 1;
  const org = (over.org_id as string) ?? "org-kestrel";
  const kind = (over.kind as string) ?? "job_file";
  const ref = (over.remote_ref as string | null | undefined) === undefined ? `att-${seq}` : over.remote_ref;
  const row: Row = {
    id: `doc-${String(seq).padStart(3, "0")}`,
    org_id: org,
    kind,
    source: "servicem8",
    remote_ref: ref,
    storage_ref: `org/${org}/${kind}/${ref ?? seq}.jpg`,
    size_bytes: 1_048_576,
    created_at: OLD,
    uploaded_at: OLD,
    last_opened_at: OLD,
    ...over,
  };
  tables.documents.push(row);
  objects.add(row.storage_ref as string);
  return row;
}
const star = (org: string, attachment: string) =>
  tables.job_photo_favourites.push({ org_id: org, sm8_attachment_uuid: attachment });
const ids = () => tables.documents.map((r) => r.id);

beforeEach(() => {
  tables.documents = [];
  tables.job_photo_favourites = [];
  objects.clear();
  log.length = 0;
  refuse.clear();
  beforeDelete = null;
  seq = 0;
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("what it may never reach", () => {
  it("leaves every other kind alone, however old and unopened", async () => {
    const others = DOCUMENT_KINDS.filter((k) => k !== "job_file").map((kind) => doc({ kind, remote_ref: `r-${kind}` }));
    /* and a job_file-shaped path on a licence, so the kind filter alone decides */
    const disguised = doc({ kind: "licence", storage_ref: "org/org-kestrel/job_file/disguised.jpg" });
    const cached = doc();
    const before = others.concat(disguised).map((r) => ({ ...r }));

    const result = await evictStaleSm8Files(NOW);

    expect(result.evicted).toBe(1);
    expect(ids()).not.toContain(cached.id);
    expect(tables.documents).toEqual(before);
    for (const r of before) expect(objects.has(r.storage_ref as string)).toBe(true);
  });

  it("leaves every other source alone — an upload, a file HeyTiff sent, anything not ServiceM8's copy", async () => {
    const manual = doc({ source: "manual", remote_ref: null });
    const sent = doc({ kind: "job_document", source: "manual", remote_ref: null });
    const otherSource = doc({ source: "xero" });
    const cached = doc();
    const before = [manual, sent, otherSource].map((r) => ({ ...r }));

    await evictStaleSm8Files(NOW);

    expect(ids()).not.toContain(cached.id);
    expect(tables.documents).toEqual(before);
    for (const r of before) expect(objects.has(r.storage_ref as string)).toBe(true);
  });

  it("never removes an object outside the org's own job_file folder", async () => {
    const stray = doc({ storage_ref: "org/org-kestrel/licence/stray.pdf" });
    const foreign = doc({ storage_ref: "org/org-heron/job_file/foreign.jpg" });
    await evictStaleSm8Files(NOW);
    expect(ids()).toEqual([stray.id, foreign.id]);
    expect(objects.has("org/org-kestrel/licence/stray.pdf")).toBe(true);
    expect(objects.has("org/org-heron/job_file/foreign.jpg")).toBe(true);
  });
});

describe(`the ${FILE_CACHE_DAYS}-day line`, () => {
  it("evicts a copy nobody was shown in 30 days, and keeps one shown since", async () => {
    const stale = doc({ last_opened_at: daysAgo(31) });
    const shown = doc({ created_at: daysAgo(200), last_opened_at: daysAgo(29) });
    await evictStaleSm8Files(NOW);
    expect(ids()).toEqual([shown.id]);
    expect(objects.has(stale.storage_ref as string)).toBe(false);
    expect(objects.has(shown.storage_ref as string)).toBe(true);
  });

  it("falls back to created_at on a row never stamped", async () => {
    const oldUnstamped = doc({ last_opened_at: null, created_at: daysAgo(40) });
    const newUnstamped = doc({ last_opened_at: null, created_at: FRESH });
    await evictStaleSm8Files(NOW);
    expect(ids()).toEqual([newUnstamped.id]);
    expect(ids()).not.toContain(oldUnstamped.id);
  });

  it("keeps a starred photo, whatever its age — the showcase never fetches one back", async () => {
    const starred = doc({ remote_ref: "att-starred" });
    const plain = doc();
    star("org-kestrel", "att-starred");
    const result = await evictStaleSm8Files(NOW);
    expect(ids()).toEqual([starred.id]);
    expect(objects.has(starred.storage_ref as string)).toBe(true);
    expect(result).toMatchObject({ evicted: 1, starred: 1 });
    expect(ids()).not.toContain(plain.id);
  });

  it("a star in another workspace keeps nothing here", async () => {
    doc({ remote_ref: "att-shared" });
    star("org-heron", "att-shared");
    await evictStaleSm8Files(NOW);
    expect(ids()).toEqual([]);
  });

  it("evicts nothing when it can't tell which are starred", async () => {
    doc();
    refuse.set("job_photo_favourites.select", { message: "down" });
    const result = await evictStaleSm8Files(NOW);
    expect(ids()).toHaveLength(1);
    expect(objects.size).toBe(1);
    expect(result).toMatchObject({ evicted: 0, skipped: true });
  });

  it("stands down, silently, on a database without the column", async () => {
    doc();
    refuse.set("documents.select", { code: "42703", message: "column documents.last_opened_at does not exist" });
    const result = await evictStaleSm8Files(NOW);
    expect(ids()).toHaveLength(1);
    expect(result).toMatchObject({ evicted: 0, skipped: true });
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("the order", () => {
  it("takes the cached mark off, then the object, then the row", async () => {
    const a = doc();
    await evictStaleSm8Files(NOW);
    expect(log).toEqual([`unconfirm:${a.id}`, `remove:${a.storage_ref}`, `delete:${a.id}`]);
  });

  it("a refused object leaves the row unconfirmed — no reader counts it cached, and tomorrow retries", async () => {
    const a = doc();
    refuse.set("storage.remove", { message: "busy" });
    const result = await evictStaleSm8Files(NOW);
    expect(tables.documents).toHaveLength(1);
    expect(tables.documents[0].uploaded_at).toBeNull();
    expect(objects.has(a.storage_ref as string)).toBe(true);
    expect(result).toMatchObject({ evicted: 0, failed: 1 });

    refuse.clear();
    await evictStaleSm8Files(NOW);
    expect(ids()).toEqual([]);
    expect(objects.size).toBe(0);
  });

  it("a job opened mid-eviction is not deleted, and is left for its next open to fetch", async () => {
    const a = doc();
    /* the open re-caches it between the object's removal and the row's delete */
    beforeDelete = () => {
      const row = tables.documents.find((r) => r.id === a.id);
      if (row && row.uploaded_at == null) row.uploaded_at = new Date(NOW).toISOString();
      beforeDelete = null;
    };
    const result = await evictStaleSm8Files(NOW);
    expect(ids()).toEqual([a.id]);
    /* its object may be the one just removed: never a confirmed row without it */
    expect(tables.documents[0].uploaded_at).toBeNull();
    expect(result.evicted).toBe(0);
  });

  it("a row opened after the candidates were read is left alone", async () => {
    const a = doc();
    /* the open lands between the read and the take: played by the star
       read, which falls between them */
    tables.job_photo_favourites = new Proxy([] as Row[], {
      get(target, prop, recv) {
        if (prop === "filter") {
          const row = tables.documents.find((r) => r.id === a.id);
          if (row) row.last_opened_at = new Date(NOW).toISOString();
        }
        return Reflect.get(target, prop, recv);
      },
    });
    await evictStaleSm8Files(NOW);
    expect(ids()).toEqual([a.id]);
    expect(tables.documents[0].uploaded_at).toBe(OLD);
    expect(objects.has(a.storage_ref as string)).toBe(true);
  });
});

describe("a night's bounds", () => {
  it("evicts at most `max`, oldest first, and says it stopped short", async () => {
    const rows = [40, 90, 60, 35, 70].map((d) => doc({ last_opened_at: daysAgo(d) }));
    const result = await evictStaleSm8Files(NOW, { max: 3 });
    expect(result).toMatchObject({ evicted: 3, capped: true });
    /* 90, 70 and 60 days went; 40 and 35 wait for tomorrow */
    expect(ids()).toEqual([rows[0].id, rows[3].id]);
  });

  it("stops taking more once its time is spent, and says it stopped short", async () => {
    for (let i = 0; i < 60; i++) doc();
    /* every look at the clock is ten seconds later: the page read and the
       first fifty fit a 25 s budget, the second fifty don't */
    let t = NOW;
    jest.spyOn(Date, "now").mockImplementation(() => (t += 10_000) - 10_000);
    const result = await evictStaleSm8Files(NOW, { budgetMs: 25_000 });
    expect(result).toMatchObject({ evicted: 50, capped: true });
    expect(ids()).toHaveLength(10);
  });

  it("stars at the head of the queue don't stall the night", async () => {
    for (let i = 0; i < 4; i++) {
      doc({ remote_ref: `att-star-${i}`, last_opened_at: daysAgo(100 + i) });
      star("org-kestrel", `att-star-${i}`);
    }
    const plain = doc({ last_opened_at: daysAgo(40) });
    const result = await evictStaleSm8Files(NOW, { max: 1 });
    expect(ids()).not.toContain(plain.id);
    expect(result).toMatchObject({ evicted: 1, starred: 4 });
  });

  it("counts the bytes it freed", async () => {
    doc({ size_bytes: 2_000_000 });
    doc({ size_bytes: 500_000 });
    const result = await evictStaleSm8Files(NOW);
    expect(result).toMatchObject({ evicted: 2, bytes: 2_500_000 });
  });
});

describe("the stamp", () => {
  it("marks the org's cached copies shown, now", async () => {
    const a = doc({ remote_ref: "att-a" });
    const other = doc({ remote_ref: "att-a", org_id: "org-heron" });
    await touchSm8Files("org-kestrel", ["att-a"], NOW);
    expect(a.last_opened_at).toBe(new Date(NOW).toISOString());
    expect(other.last_opened_at).toBe(OLD);
  });

  it("writes at most once a day per row", async () => {
    const recent = doc({ remote_ref: "att-r", last_opened_at: new Date(NOW - 3_600_000).toISOString() });
    await touchSm8Files("org-kestrel", ["att-r"], NOW);
    expect(recent.last_opened_at).toBe(new Date(NOW - 3_600_000).toISOString());
    expect(log).toEqual(["stamp:"]);
  });

  it("stamps nothing but ServiceM8's copies", async () => {
    const upload = doc({ remote_ref: "att-u", source: "manual" });
    const document = doc({ remote_ref: "att-d", kind: "job_document" });
    await touchSm8Files("org-kestrel", ["att-u", "att-d"], NOW);
    expect(upload.last_opened_at).toBe(OLD);
    expect(document.last_opened_at).toBe(OLD);
  });

  it("never throws, and is silent on a database without the column", async () => {
    doc({ remote_ref: "att-a" });
    refuse.set("documents.update", { code: "PGRST204", message: "no last_opened_at" });
    await expect(touchSm8Files("org-kestrel", ["att-a"], NOW)).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("asks nothing for nothing", async () => {
    await touchSm8Files("org-kestrel", [], NOW);
    expect(log).toEqual([]);
  });
});
