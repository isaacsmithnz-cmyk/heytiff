/* A small in-memory stand-in for the Supabase client, enough for the SWMS
   reads and writes: eq / in filters, order, limit, single, maybeSingle,
   insert (with ids and the columns the database defaults), update, upsert and
   delete. Shared by the SWMS suites; lives under fixtures/ so jest never runs it. */

type Row = Record<string, unknown>;

export type FakeDb = {
  tables: Record<string, Row[]>;
  /** Make the next insert into a table fail with this error. */
  failInsert: Record<string, { code?: string; message?: string } | undefined>;
  client: { from: (table: string) => unknown };
};

export function fakeDb(): FakeDb {
  const tables: Record<string, Row[]> = {};
  const failInsert: FakeDb["failInsert"] = {};
  let seq = 0;

  const from = (table: string) => {
    const eqs: [string, unknown][] = [];
    const ins: [string, unknown[]][] = [];
    let order: { key: string; asc: boolean } | null = null;
    let limit: number | null = null;
    let deleting = false;
    let patch: Row | null = null;

    const match = (r: Row) => eqs.every(([k, v]) => r[k] === v) && ins.every(([k, vs]) => vs.includes(r[k]));
    const rows = () => {
      let out = (tables[table] ?? []).filter(match);
      if (order) {
        const { key, asc } = order;
        out = [...out].sort((a, b) => ((a[key] as number) > (b[key] as number) ? 1 : -1) * (asc ? 1 : -1));
      }
      return limit === null ? out : out.slice(0, limit);
    };

    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (k: string, v: unknown) => (eqs.push([k, v]), b);
    b.in = (k: string, vs: unknown[]) => (ins.push([k, vs]), b);
    b.order = (k: string, o?: { ascending?: boolean }) => ((order = { key: k, asc: o?.ascending !== false }), b);
    b.limit = (n: number) => ((limit = n), b);
    b.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
    b.single = async () => {
      const r = rows();
      return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { message: "not one row" } };
    };
    b.delete = () => ((deleting = true), b);
    b.update = (p: Row) => ((patch = p), b);
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (patch) {
        for (const r of (tables[table] ?? []).filter(match)) Object.assign(r, patch);
        return Promise.resolve({ error: null }).then(res, rej);
      }
      if (deleting) {
        tables[table] = (tables[table] ?? []).filter((r) => !match(r));
        return Promise.resolve({ error: null }).then(res, rej);
      }
      return Promise.resolve({ data: rows(), error: null }).then(res, rej);
    };
    b.insert = (payload: Row | Row[]) => {
      const err = failInsert[table];
      failInsert[table] = undefined;
      const list = (Array.isArray(payload) ? payload : [payload]).map((p): Row => ({
        id: `${table}-${++seq}`,
        created_at: `2026-09-16T07:${String(seq).padStart(2, "0")}:00.000Z`,
        ...(table === "swms_signons" ? { signed_at: "2026-09-16T07:58:00.000Z" } : {}),
        ...(table === "swms_versions" ? { issued_at: "2026-09-16T07:42:00.000Z" } : {}),
        ...p,
      }));
      if (!err) {
        /* the unique indexes the SWMS tables carry */
        const t = (tables[table] ??= []);
        for (const r of list) {
          const clash =
            (table === "swms_signons" && t.some((x) => x.person_id === r.person_id)) ||
            (table === "swms_versions" && t.some((x) => x.swms_id === r.swms_id && x.version === r.version));
          if (clash) {
            const e = { code: "23505", message: "duplicate key" };
            return { select: () => ({ single: async () => ({ data: null, error: e }) }), then: (res: (v: unknown) => unknown) => Promise.resolve({ error: e }).then(res) };
          }
        }
        t.push(...list);
      }
      return {
        select: () => ({ single: async () => (err ? { data: null, error: err } : { data: list[0], error: null }) }),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ error: err ?? null }).then(res, rej),
      };
    };
    b.upsert = (payload: Row) => {
      const t = (tables[table] ??= []);
      if (!t.some((r) => r.org_id === payload.org_id && r.library_version === payload.library_version)) {
        t.push({ id: `${table}-${++seq}`, ...payload });
      }
      return Promise.resolve({ error: null });
    };
    return b;
  };

  return { tables, failInsert, client: { from } };
}
