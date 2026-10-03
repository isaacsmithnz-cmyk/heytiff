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
   - the two functions (sm8_mark_kind_refused, sm8_set_write_kind), the
     second switching the four kinds sm8_leave_queue.sql allows;
   - sm8_leave_queue.sql's kind check and its ONE SHAPE RULE FOR EVERY KIND
     (sm8_writes_shape_check), on every insert and every update, a row that
     breaks either refused with 23514 as the database would;
   - dedupe_key GENERATED, so a subject that changes (a booking slot given
     back, ":was:<id>") moves its key, and meets the unique index again.
   Every statement is logged, so a test can hold a path to the queries it
   makes. It lives under fixtures/ so jest doesn't run it as a suite. */

import { randomUUID } from "node:crypto";

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

/** A booking's time as the shape check wants it: the wall clock, on the
    minute. */
const BOOKING_STAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:00$/;

const BOOKING_COLUMNS = ["verb_id", "booking_staff_uuid", "booking_start", "booking_end", "booking_zone", "job_status_from", "job_status_to"];

const LEAVE_COLUMNS = ["leave_staff_uuid", "leave_start", "leave_end"];

const JOB_COLUMNS = ["job_company_uuid", "job_company_new", "job_parent_uuid", "job_contact_uuid", "job_category_uuid", "job_draft", "job_done", "job_number"];

/** sm8_writes_kind_check and sm8_writes_shape_check, exactly as
    sm8_leave_queue.sql writes them: one CASE per kind, every column a
    branch needs named "is not null", and the whole in coalesce(…, false),
    so nothing passes by being null. `op` is the column's default,
    'create', when a row doesn't name it. */
export function sm8WriteShapeOk(r: Row): boolean {
  const none = (c: string) => r[c] == null;
  const some = (c: string) => r[c] != null;
  const op = r.op ?? "create";
  const bookingNone = BOOKING_COLUMNS.every(none);
  const leaveNone = LEAVE_COLUMNS.every(none);
  const jobNone = JOB_COLUMNS.every(none);
  if (r.kind !== "leave" && !leaveNone) return false;
  if (r.kind !== "job" && !jobNone) return false;
  switch (r.kind) {
    /* sm8_new_job_queue.sql's branch */
    case "job": {
      const draft = r.job_draft as Record<string, unknown> | null;
      const doneOk = r.job_done == null || (Array.isArray(r.job_done) && (r.job_done as unknown[]).every((d) => ["company", "job", "contact"].includes(String(d))));
      return (
        op === "create" &&
        none("sm8_job_uuid") &&
        none("note_id") &&
        none("depends_on") &&
        none("target_uuid") &&
        none("flag_done") &&
        none("note_text") &&
        bookingNone &&
        leaveNone &&
        some("job_company_uuid") &&
        (r.job_company_new == null || r.job_company_new === "client" || r.job_company_new === "site") &&
        (r.job_company_new === "site") === (r.job_parent_uuid != null) &&
        !!draft &&
        typeof draft === "object" &&
        !Array.isArray(draft) &&
        "address" in draft &&
        "description" in draft &&
        doneOk
      );
    }
    case "leave": {
      if (!(none("sm8_job_uuid") && none("note_id") && none("flag_done") && none("note_text") && none("target_uuid") && bookingNone)) return false;
      if (op === "create") {
        const start = String(r.leave_start ?? "");
        const end = String(r.leave_end ?? "");
        return (
          none("depends_on") &&
          LEAVE_COLUMNS.every(some) &&
          /^[0-9]{4}-[0-9]{2}-[0-9]{2} 00:00:00$/.test(start) &&
          /^[0-9]{4}-[0-9]{2}-[0-9]{2} 23:59:59$/.test(end) &&
          start < end
        );
      }
      if (op === "delete") return some("depends_on") && none("taken_back_at") && leaveNone;
      return false;
    }
    case "attachment":
      return (
        op === "create" &&
        none("note_id") &&
        none("depends_on") &&
        none("target_uuid") &&
        none("flag_done") &&
        none("note_text") &&
        none("taken_back_at") &&
        bookingNone
      );
    case "note":
      if (!bookingNone) return false;
      if (op === "create") return some("note_id") && none("depends_on") && none("target_uuid") && none("flag_done") && some("requested_by");
      if (op === "update") {
        return (
          none("note_id") &&
          some("target_uuid") &&
          some("flag_done") &&
          none("depends_on") &&
          none("note_text") &&
          none("taken_back_at") &&
          some("requested_by")
        );
      }
      if (op === "delete") {
        return (
          some("note_id") &&
          some("depends_on") &&
          none("flag_done") &&
          none("note_text") &&
          none("taken_back_at") &&
          some("requested_by")
        );
      }
      return false;
    case "booking": {
      if (!(none("note_id") && none("flag_done") && none("note_text") && some("sm8_job_uuid") && some("verb_id"))) return false;
      const start = String(r.booking_start ?? "");
      const end = String(r.booking_end ?? "");
      if (op === "create") {
        return (
          none("target_uuid") &&
          none("job_status_from") &&
          none("job_status_to") &&
          some("booking_staff_uuid") &&
          some("booking_zone") &&
          some("booking_start") &&
          some("booking_end") &&
          BOOKING_STAMP.test(start) &&
          BOOKING_STAMP.test(end) &&
          start.slice(0, 10) === end.slice(0, 10) &&
          start < end
        );
      }
      if (op === "update") {
        return (
          some("target_uuid") &&
          r.target_uuid === r.sm8_job_uuid &&
          none("depends_on") &&
          r.job_status_from === "Quote" &&
          r.job_status_to === "Work Order" &&
          some("seen_edit_date") &&
          none("booking_staff_uuid") &&
          none("booking_start") &&
          none("booking_end") &&
          none("booking_zone")
        );
      }
      if (op === "delete") {
        return (
          none("taken_back_at") &&
          none("job_status_from") &&
          none("job_status_to") &&
          none("booking_zone") &&
          ((some("depends_on") && none("booking_staff_uuid") && none("booking_start") && none("booking_end")) ||
            (none("depends_on") && some("target_uuid") && some("booking_staff_uuid") && some("booking_start") && some("booking_end")))
        );
      }
      return false;
    }
    default:
      return false;
  }
}

const SHAPE_REFUSED = { code: "23514", message: "fake: sm8_writes_shape_check" };

export function makeFakeDb() {
  const db: Record<string, Row[]> = {};
  const log: Statement[] = [];
  /** Tables whose every statement answers with an error. */
  const failing = new Set<string>();
  /** Columns this database doesn't have: a select naming one is refused. */
  const missing = new Set<string>();
  /** Runs before every statement on a table, to interleave a race by hand.
      Answering "fail" fails that one statement, as a blip would. */
  const before: Record<string, ((s: Statement) => void | "fail") | undefined> = {};
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
    /* task_done_sm8.sql: one Done per task that hasn't been taken back */
    const liveDone = (x: Row) => x.is_task_done === true && x.task_id != null && x.removed_at == null;
    if (
      table === "workboard_notes" &&
      liveDone(row) &&
      rows.some((x) => x !== row && liveDone(x) && x.org_id === row.org_id && x.task_id === row.task_id)
    ) {
      return { code: "23505", message: "fake: workboard_notes_one_done_uniq" };
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
      Object.assign(row, {
        removed_at: null,
        sm8_refusal: null,
        reply_to_sm8_note_uuid: null,
        task_id: null,
        is_task_done: false,
        /* the column's default, now() */
        created_at: new Date().toISOString(),
        ...r,
      });
    }
    /* a queue row's id is the database's gen_random_uuid(): the queue's
       helpers check a row id's shape before they read it */
    if (row.id === undefined) row.id = table === "sm8_writes" ? randomUUID() : `${table.slice(0, 2)}${++idSeq}`;
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
      const blip = before[table]?.(stmt) === "fail";
      log.push(stmt);
      if (blip || failing.has(table)) return { data: null, count: null, error: { code: "XX000", message: "fake: down" } };
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
          /* a CHECK is evaluated on the row before any conflict is looked for */
          if (table === "sm8_writes" && !sm8WriteShapeOk(row)) return { data: null, error: SHAPE_REFUSED };
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
        /* the two keys that name a task, ON DELETE SET NULL: a note stays
           answered and a Done stays a Done after its task goes */
        if (table === "tasks") {
          for (const t of hit) {
            for (const ref of ["workboard_notes", "job_note_actions"]) {
              for (const r of db[ref] ?? []) if (r.task_id === t.id && r.org_id === t.org_id) r.task_id = null;
            }
          }
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
        if (table === "sm8_writes") {
          for (const r of hit) {
            const next = { ...r, ...patch };
            /* the shape check holds on an update too. A row a suite wrote by
               hand, short of a column, is held to it only once it has met it
               — an update never makes a shaped row unshaped */
            if (sm8WriteShapeOk(r) && !sm8WriteShapeOk(next)) return { data: null, error: SHAPE_REFUSED };
            /* the generated key follows the subject, into the unique index */
            const key = dedupe(next);
            if ("subject" in patch && rows.some((x) => x !== r && x.org_id === next.org_id && x.dedupe_key === key)) {
              return { data: null, error: { code: "23505", message: "fake: sm8_writes_dedupe_uniq" } };
            }
          }
        }
        for (const r of hit) {
          Object.assign(r, patch);
          if (table === "sm8_writes" && "subject" in patch) r.dedupe_key = dedupe(r);
        }
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      if (order) {
        const { col, asc } = order;
        hit = [...hit].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      hit = hit.slice(0, limit);
      if (head) return { data: null, count: hit.length, error: null };
      /* the embeds the note code uses, each through the key it names: a
         create's note (note_id), and a Done's task (task_id) */
      const KEYS: Record<string, { table: string; via: string }> = {
        sm8_writes_note_id_fkey: { table: "workboard_notes", via: "note_id" },
        workboard_notes_task_fkey: { table: "tasks", via: "task_id" },
      };
      const embed = /(\w+):(\w+)!(\w+)\(([^)]*)\)/.exec(columns);
      const shaped = hit.map((r) => {
        const out: Row = { ...r };
        if (embed) {
          const key = KEYS[embed[3]];
          if (!key || key.table !== embed[2]) throw new Error(`fake: unknown embed ${embed[0]}`);
          const other = (db[key.table] ?? []).find((n) => n.id === r[key.via] && n.org_id === r.org_id);
          out[embed[1]] = other ? Object.fromEntries(embed[4].split(",").map((c) => [c.trim(), other[c.trim()] ?? null])) : null;
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
      gt: (c: string, v: string) => (described.push(`${c}>`), filters.push((r) => r[c] != null && String(r[c]) > v), q),
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
      if (!conn || !["attachment", "note", "booking", "leave", "job"].includes(String(args.p_kind))) return Promise.resolve({ data: null, error: null });
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
