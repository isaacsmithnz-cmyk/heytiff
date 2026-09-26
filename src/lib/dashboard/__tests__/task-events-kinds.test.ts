/* The history's kinds against the table's own CHECKs.

   logTaskEvent swallows a failed insert on purpose (a history line must never
   cost the change it describes), which means a kind the migration does not
   allow would fail silently forever. This reads docs/migrations/
   task_events.sql and holds the code to it: every kind the code writes is
   one the CHECK allows, every kind the CHECK allows is one the reader knows,
   and each kind's row fills only the columns its kind may carry. */

import { readFileSync } from "fs";
import { join } from "path";

// the writer's module holds a client; nothing here writes
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { TASK_EVENT_KINDS, taskEventRow, type TaskEventWrite } from "../task-events";

const ROOT = join(__dirname, "..", "..", "..", "..");
const sql = readFileSync(join(ROOT, "docs", "migrations", "task_events.sql"), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

/** The quoted words in `constraint <name> check (kind in ('a', 'b'))`. */
function kindsIn(constraint: string): string[] {
  const m = new RegExp(`${constraint}\\s+check\\s*\\(\\s*kind\\s+in\\s*\\(([^)]*)\\)`, "i").exec(sql);
  if (!m) throw new Error(`${constraint} not found in task_events.sql`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

/** The one kind in `constraint <name> check (kind = 'x' or …)`. */
function kindIs(constraint: string): string {
  const m = new RegExp(`${constraint}\\s+check\\s*\\(\\s*kind\\s*=\\s*'([a-z_]+)'`, "i").exec(sql);
  if (!m) throw new Error(`${constraint} not found in task_events.sql`);
  return m[1];
}

const one: Record<(typeof TASK_EVENT_KINDS)[number], TaskEventWrite> = {
  created: { kind: "created", to: "s1" },
  due: { kind: "due", from: "2026-09-25", to: "2026-10-02" },
  given: { kind: "given", from: "s1", to: "s2" },
  done: { kind: "done" },
  reopened: { kind: "reopened" },
};

it("writes only kinds the CHECK allows, and knows every kind it allows", () => {
  expect([...kindsIn("task_events_kind_check")].sort()).toEqual([...TASK_EVENT_KINDS].sort());
});

it("names no kind in the actions that the CHECK lacks", () => {
  const allowed = new Set(kindsIn("task_events_kind_check"));
  const actions = readFileSync(join(ROOT, "src", "app", "actions", "dashboard.ts"), "utf8");
  const written = [...actions.matchAll(/logTaskEvent\([^;]*?kind:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  // one per writer: addTask's created, giveTask's given, done, reopened, due
  // (the old Home's createTask wrote a sixth, and went with it)
  expect(written.length).toBeGreaterThanOrEqual(5);
  for (const kind of written) expect(allowed).toContain(kind);
});

it("fills only the columns each kind may carry", () => {
  const due = kindIs("task_events_due_only");
  const from = kindIs("task_events_from_only");
  const to = new Set(kindsIn("task_events_to_only"));
  for (const kind of TASK_EVENT_KINDS) {
    const row = taskEventRow("org-1", "t1", "s1", one[kind]);
    if (kind !== due) expect([row.due_from, row.due_to]).toEqual([null, null]);
    if (kind !== from) expect(row.from_staff).toBeNull();
    if (!to.has(kind)) expect(row.to_staff).toBeNull();
    expect(row.kind).toBe(kind);
  }
  // and the ones that carry something, carry it
  expect(taskEventRow("org-1", "t1", "s1", one.due)).toMatchObject({ due_from: "2026-09-25", due_to: "2026-10-02" });
  expect(taskEventRow("org-1", "t1", "s1", one.given)).toMatchObject({ from_staff: "s1", to_staff: "s2" });
  expect(taskEventRow("org-1", "t1", "s1", one.created)).toMatchObject({ to_staff: "s1" });
});
