/* An in-memory Supabase for the note engine's suites (two-way phase 2).

   The PostgREST verbs the code uses, APPLIED FOR REAL over plain arrays, so
   a conditional update that matches nothing matches nothing, and the rules
   the notes migration puts in the database hold here too:
   - sm8_writes' generated dedupe_key, and its two unique indexes (one row
     per thing; one create per note);
   - the trigger that refuses any update of a note row naming requested_by
     or requested_by_user (sm8_writes_note_sender_fixed);
   - the note_id key, ON DELETE NO ACTION: a workboard_notes row any queue
     row names can't be deleted (23503);
   - the two functions (sm8_mark_kind_refused, sm8_set_write_kind).
   Every statement is logged, so a test can hold a path to the queries it
   makes. It lives under fixtures/ so jest doesn't run it as a suite. */

type Row = Record<string, unknown>;
type Err = { code: string; message: string };
type Result = { data: unknown; error: Err | null; count?: number | null };

export type Statement = { table: string; op: "select" | "update" | "upsert" | "insert" | "delete"; columns?: string; patch?: Row; filters: string[] };

function splitTop(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of expr) {
    if (ch === "(" || ch === "{") depth++;
    if (ch === ")" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseOr(expr: string): (r: Row) => boolean {
  const one = (t: string): ((r: Row) => boolean) => {
    const and = /^and\((.*)\)$/.exec(t);
    if (and) {
      const parts = splitTop(and[1]).map(one);
      return (r) => parts.every((p) => p(r));
    }
    const [col, op, ...rest] = t.split(".");
    const v = rest.join(".");
    if (op === "eq") return (r) => String(r[col]) === v;
    if (op === "lt") return (r) => r[col] != null && String(r[col]) < v;
    if (op === "is") return (r) => r[col] == null;
    if (op === "not" && v === "is.null") return (r) => r[col] != null;
    if (op === "in") {
      const vs = v.replace(/^\(|\)$/g, "").split(",");
      return (r) => vs.includes(String(r[col]));
    }
    if (op === "ov") {
      const vs = v.replace(/^\{|\}$/g, "").split(",");
      return (r) => Array.isArray(r[col]) && (r[col] as string[]).some((x) => vs.includes(x));
    }
    throw new Error(`fake: unknown op ${op}`);
  };
  const preds = splitTop(expr).map(one);
  return (r) => preds.some((p) => p(r));
}

const dedupe = (r: Row) => `${r.kind}:${r.sm8_job_uuid ?? ""}:${r.subject}`;

export function makeFakeDb() {
  const db: Record<string, Row[]> = {};
  const log: Statement[] = [];
  /** Tables whose every statement answers with an error. */
  const failing = new Set<string>();
  /** Columns this database doesn't have: a select naming one is refused. */
  const missing = new Set<string>();
  /** Runs before every statement on a table, to interleave a race by hand. */
  const before: Record<string, ((s: Statement) => void) | undefined> = {};
  let rpcMissing = false;
  let idSeq = 0;

  function unique(table: string, row: Row, rows: Row[]): Err | null {
    if (table === "sm8_writes") {
      if (rows.some((x) => x !== row && x.org_id === row.org_id && x.dedupe_key === row.dedupe_key)) {
        return { code: "23505", message: "fake: sm8_writes_dedupe_uniq" };
      }
      if (
        row.kind === "note" &&
        (row.op ?? "create") === "create" &&
        rows.some((x) => x !== row && x.org_id === row.org_id && x.kind === "note" && (x.op ?? "create") === "create" && x.note_id === row.note_id)
      ) {
        return { code: "23505", message: "fake: sm8_writes_one_create_per_note" };
      }
    }
    if (table === "workboard_notes" && rows.some((x) => x !== row && x.id === row.id)) {
      return { code: "23505", message: "fake: workboard_notes_pkey" };
    }
    return null;
  }

  function withDefaults(table: string, r: Row): Row {
    const row: Row = { ...r };
    if (table === "sm8_writes") {
      Object.assign(
        row,
        {
          replaced_uuids: [],
          free_retries: 0,
          maybe_landed: false,
          verify_uuids: [],
          claim_id: null,
          lease_until: null,
          op: "create",
          taken_back_at: null,
          last_error: null,
          ...r,
        },
        {}
      );
      row.dedupe_key = dedupe(row);
    }
    if (table === "workboard_notes") {
      Object.assign(row, { removed_at: null, sm8_refusal: null, reply_to_sm8_note_uuid: null, task_id: null, is_task_done: false, ...r });
    }
    if (row.id === undefined) row.id = `${table.slice(0, 2)}${++idSeq}`;
    return row;
  }

  function from(table: string) {
    db[table] ??= [];
    const filters: ((r: Row) => boolean)[] = [];
    const described: string[] = [];
    const filterCols: string[] = [];
    let op: Statement["op"] = "select";
    let columns = "*";
    let patch: Row = {};
    let incoming: Row[] = [];
    let conflict: string[] = [];
    let ignoreDuplicates = false;
    let order: { col: string; asc: boolean } | null = null;
    let limit = Infinity;
    let head = false;
    let returning = false;

    const exec = (): Result => {
      const stmt: Statement = { table, op, columns, patch: op === "update" ? patch : undefined, filters: described };
      before[table]?.(stmt);
      log.push(stmt);
      if (failing.has(table)) return { data: null, count: null, error: { code: "XX000", message: "fake: down" } };
      const rows = db[table];

      if (filterCols.some((c) => missing.has(c))) return { data: null, error: { code: "42703", message: "fake: no such column" } };
      if (op === "select" || returning) {
        const named = splitTop(columns)
          .map((c) => c.trim())
          .filter((c) => c && !c.includes("(") && c !== "*")
          .map((c) => c.split(":").pop()!.trim());
        if (named.some((c) => missing.has(c))) return { data: null, error: { code: "42703", message: "fake: no such column" } };
      }
      if (op === "update" && Object.keys(patch).some((c) => missing.has(c))) {
        return { data: null, error: { code: "PGRST204", message: "fake: no such column" } };
      }

      if (op === "upsert" || op === "insert") {
        const made: Row[] = [];
        for (const r of incoming) {
          if (Object.keys(r).some((c) => missing.has(c))) return { data: null, error: { code: "PGRST204", message: "fake: no such column" } };
          const row = withDefaults(table, r);
          const clash =
            op === "upsert" && conflict.length > 0
              ? rows.find((x) => conflict.every((c) => x[c] != null && x[c] === row[c]))
              : undefined;
          if (clash) {
            if (ignoreDuplicates) continue;
            /* an upsert that isn't told to ignore a clash merges into it */
            Object.assign(clash, r);
            made.push(clash);
            continue;
          }
          /* the foreign key a queue row's note_id holds */
          if (table === "sm8_writes" && row.note_id && !(db.workboard_notes ?? []).some((n) => n.id === row.note_id && n.org_id === row.org_id)) {
            return { data: null, error: { code: "23503", message: "fake: sm8_writes_note_id_fkey" } };
          }
          rows.push(row);
          const clashErr = unique(table, row, rows);
          if (clashErr) {
            rows.splice(rows.indexOf(row), 1);
            return { data: null, error: clashErr };
          }
          made.push(row);
        }
        return { data: made.map((r) => ({ ...r })), error: null };
      }

      let hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "delete") {
        if (table === "workboard_notes") {
          const named = hit.filter((n) => (db.sm8_writes ?? []).some((w) => w.note_id === n.id && w.org_id === n.org_id));
          if (named.length > 0) return { data: null, error: { code: "23503", message: "fake: sm8_writes_note_id_fkey" } };
        }
        db[table] = rows.filter((r) => !hit.includes(r));
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      if (op === "update") {
        /* the notes migration's trigger: a note row never changes who
           pressed it — naming either column refuses the update, whatever
           the value */
        if (
          table === "sm8_writes" &&
          ("requested_by" in patch || "requested_by_user" in patch) &&
          hit.some((r) => r.kind === "note")
        ) {
          return { data: null, error: { code: "23514", message: "a note row never changes who pressed it" } };
        }
        for (const r of hit) Object.assign(r, patch);
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      if (order) {
        const { col, asc } = order;
        hit = [...hit].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      hit = hit.slice(0, limit);
      if (head) return { data: null, count: hit.length, error: null };
      /* the one embed the note sender uses: a create's note, through note_id */
      const embed = /(\w+):workboard_notes!sm8_writes_note_id_fkey\(([^)]*)\)/.exec(columns);
      const shaped = hit.map((r) => {
        const out: Row = { ...r };
        if (embed) {
          const note = (db.workboard_notes ?? []).find((n) => n.id === r.note_id && n.org_id === r.org_id);
          out[embed[1]] = note ? Object.fromEntries(embed[2].split(",").map((c) => [c.trim(), note[c.trim()] ?? null])) : null;
        }
        return out;
      });
      return { data: shaped, error: null };
    };

    const q: Record<string, unknown> = {
      select: (cols?: string, opts?: { head?: boolean }) => {
        if (op !== "select") returning = true;
        if (cols && op === "select") columns = cols;
        if (opts?.head) head = true;
        return q;
      },
      update: (p: Row) => {
        op = "update";
        patch = p;
        return q;
      },
      insert: (v: Row | Row[]) => {
        op = "insert";
        incoming = Array.isArray(v) ? v : [v];
        return q;
      },
      upsert: (v: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) => {
        op = "upsert";
        incoming = Array.isArray(v) ? v : [v];
        conflict = opts.onConflict ? opts.onConflict.split(",") : [];
        ignoreDuplicates = !!opts.ignoreDuplicates;
        return q;
      },
      delete: () => {
        op = "delete";
        return q;
      },
      eq: (c: string, v: unknown) => (described.push(`${c}=${String(v)}`), filters.push((r) => r[c] === v), q),
      neq: (c: string, v: unknown) => (described.push(`${c}!=${String(v)}`), filters.push((r) => r[c] != null && r[c] !== v), q),
      in: (c: string, vs: unknown[]) => (described.push(`${c} in`), filters.push((r) => vs.includes(r[c])), q),
      is: (c: string, v: null) => (described.push(`${c} is ${String(v)}`), filterCols.push(c), filters.push((r) => r[c] == null), q),
      not: (c: string, o: string, v: unknown) => {
        described.push(`${c} not ${o} ${String(v)}`);
        if (o === "is" && v === null) filters.push((r) => r[c] != null);
        else throw new Error(`fake: unknown not ${o}`);
        return q;
      },
      lte: (c: string, v: string) => (described.push(`${c}<=`), filters.push((r) => r[c] != null && String(r[c]) <= v), q),
      lt: (c: string, v: string) => (described.push(`${c}<`), filters.push((r) => r[c] != null && String(r[c]) < v), q),
      gte: (c: string, v: string) => (described.push(`${c}>=`), filters.push((r) => r[c] != null && String(r[c]) >= v), q),
      or: (expr: string) => (described.push(`or(${expr})`), filters.push(parseOr(expr)), q),
      order: (col: string, o: { ascending: boolean }) => ((order = { col, asc: o.ascending }), q),
      limit: (n: number) => ((limit = n), q),
      maybeSingle: async () => {
        const res = exec();
        if (res.error) return { data: null, error: res.error };
        return { data: (res.data as Row[] | null)?.[0] ?? null, error: null };
      },
      single: async () => {
        const res = exec();
        if (res.error) return { data: null, error: res.error };
        const first = (res.data as Row[] | null)?.[0] ?? null;
        return first ? { data: first, error: null } : { data: null, error: { code: "PGRST116", message: "fake: no rows" } };
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(exec()).then(res, rej),
    };
    return q;
  }

  function rpc(name: string, args: Record<string, unknown>) {
    log.push({ table: `rpc:${name}`, op: "update", filters: [] });
    if (rpcMissing) return Promise.resolve({ data: null, error: { code: "PGRST202", message: "fake: no such function" } });
    const conn = (db.integration_connections ?? []).find((c) => c.org_id === args.p_org && c.provider === "servicem8");
    if (name === "sm8_mark_kind_refused") {
      if (conn) conn.write_scope_refused = { ...((conn.write_scope_refused ?? {}) as Row), [String(args.p_kind)]: args.p_at };
      return Promise.resolve({ data: !!conn, error: null });
    }
    if (name === "sm8_set_write_kind") {
      if (!conn || (args.p_kind !== "attachment" && args.p_kind !== "note")) return Promise.resolve({ data: null, error: null });
      const was = Array.isArray(conn.write_kinds) ? (conn.write_kinds as string[]) : ["attachment"];
      const kind = String(args.p_kind);
      conn.write_kinds = args.p_on ? [...new Set([...was, kind])].sort() : was.filter((k) => k !== kind);
      return Promise.resolve({ data: conn.write_kinds, error: null });
    }
    return Promise.resolve({ data: null, error: { code: "PGRST202", message: `fake: no ${name}` } });
  }

  return {
    db,
    log,
    failing,
    missing,
    before,
    from,
    rpc,
    setRpcMissing: (v: boolean) => {
      rpcMissing = v;
    },
    reset() {
      for (const k of Object.keys(db)) delete db[k];
      log.length = 0;
      failing.clear();
      missing.clear();
      for (const k of Object.keys(before)) delete before[k];
      rpcMissing = false;
    },
    /** Statements on one table since the log was last cleared. */
    on: (table: string) => log.filter((s) => s.table === table),
  };
}

export type FakeDb = ReturnType<typeof makeFakeDb>;
