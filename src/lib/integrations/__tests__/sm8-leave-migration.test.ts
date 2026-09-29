/**
 * @jest-environment node
 */

/* The leave migration, read as text. Only a real Postgres proves the shape
   check; what this holds is what a reviewer relies on: additive and
   idempotent, the three older kinds' rules exactly the bookings file's with
   the new columns null, the kind lists the code's own, and the fake
   database the engine's suites run on agreeing with the file. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SM8_WRITE_KIND_SCOPES } from "../providers";
import { sm8WriteShapeOk } from "./fixtures/sm8-fake-db";
import { LEAVE_WORDS } from "../sm8-leave-words";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const sql = read("docs/migrations/sm8_leave_queue.sql");
const bookings = read("docs/migrations/sm8_bookings_queue.sql");
const code = sql.replace(/--.*$/gm, "");
const bookingsCode = bookings.replace(/--.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const KINDS = Object.keys(SM8_WRITE_KIND_SCOPES);
const NEW_COLUMNS = ["leave_staff_uuid", "leave_start", "leave_end"];

function branchOf(src: string, kind: string): string {
  const shape = src.slice(src.indexOf("add constraint sm8_writes_shape_check"));
  const at = shape.indexOf(`when kind = '${kind}' then`);
  const rest = shape.slice(at + `when kind = '${kind}' then`.length);
  const next = rest.search(/\n    when kind = '|\n    else false/);
  return rest.slice(0, next);
}

describe("the leave migration", () => {
  it("says when to apply it, never to re-run the bookings file after it, and the bookings file says so too", () => {
    expect(sql).toMatch(/WHEN TO APPLY: BEFORE THE DEPLOY/);
    expect(sql).toMatch(/Additive and idempotent/);
    expect(sql).toMatch(/NEVER RE-RUN sm8_bookings_queue\.sql/);
    expect(bookings).toMatch(/AFTER sm8_leave_queue\.sql, NEVER RE-RUN THIS ONE/);
  });

  it("is additive: nullable columns added if missing, constraints dropped only to be added again, nothing deleted", () => {
    for (const col of NEW_COLUMNS) expect(code).toMatch(new RegExp(`add column if not exists ${col}\\s+text[,;]`));
    const adds = [...code.matchAll(/add constraint (\w+)/g)].map((m) => m[1]);
    const drops = [...code.matchAll(/drop constraint if exists (\w+)/g)].map((m) => m[1]);
    expect(drops.sort()).toEqual([...adds].sort());
    expect(code).not.toMatch(/drop (table|column|index|function|trigger)/);
    expect(code).not.toMatch(/\bdelete from\b|\btruncate\b|\bupdate public\.sm8_writes\b/);
  });

  it("lists exactly the code's four kinds in the kind check, the owner's switch and its function", () => {
    const listed = (re: RegExp) => [...(re.exec(code)?.[1] ?? "").matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(KINDS).toEqual(["attachment", "note", "booking", "leave"]);
    expect(listed(/sm8_writes_kind_check check \(kind in \(([^)]*)\)\)/)).toEqual(KINDS);
    expect(listed(/write_kinds <@ array\[([^\]]*)\]::text\[\]/)).toEqual(KINDS);
    expect(listed(/p_kind in \(([^)]*)\)/)).toEqual(KINDS);
    expect(code).toMatch(/revoke execute on function public\.sm8_set_write_kind[^;]*from public, anon, authenticated/);
  });

  it("keeps the bookings file's rule for its three kinds, with the new columns null in each", () => {
    for (const kind of ["attachment", "note", "booking"]) {
      const was = flat(branchOf(bookingsCode, kind));
      const now = flat(branchOf(code, kind));
      const leaveNull = "leave_staff_uuid is null and leave_start is null and leave_end is null";
      expect(now).toContain(leaveNull);
      // the rule, with the one line added taken out, is the old one word for word
      expect(now.replace(` and ${leaveNull}`, "").replace(`${leaveNull} and `, "")).toBe(was);
    }
  });

  it("gives leave a branch of its own: a create with its person and a whole-day span, a delete naming its create", () => {
    const leave = flat(branchOf(code, "leave"));
    expect(leave).toMatch(/^sm8_job_uuid is null and note_id is null/);
    expect(leave).toMatch(/when op = 'create' then depends_on is null and leave_staff_uuid is not null and leave_start is not null and leave_end is not null/);
    expect(leave).toMatch(/leave_start ~ '\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\} 00:00:00\$'/);
    expect(leave).toMatch(/leave_end ~ '\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\} 23:59:59\$'/);
    expect(leave).toMatch(/when op = 'delete' then depends_on is not null and taken_back_at is null and leave_staff_uuid is null/);
    expect(leave).toMatch(/else false end$/);
    expect(flat(code)).toMatch(/else false end, false\)\);/);
  });

  it("agrees with the fake database the engine's suites run on", () => {
    const create = {
      kind: "leave",
      op: "create",
      leave_staff_uuid: "s",
      leave_start: "2026-10-05 00:00:00",
      leave_end: "2026-10-06 23:59:59",
    };
    expect(sm8WriteShapeOk(create)).toBe(true);
    expect(sm8WriteShapeOk({ ...create, leave_end: "2026-10-06 17:00:00" })).toBe(false);
    expect(sm8WriteShapeOk({ ...create, sm8_job_uuid: "j" })).toBe(false);
    expect(sm8WriteShapeOk({ ...create, booking_staff_uuid: "s" })).toBe(false);
    expect(sm8WriteShapeOk({ kind: "leave", op: "delete", depends_on: "w1" })).toBe(true);
    expect(sm8WriteShapeOk({ kind: "leave", op: "delete", depends_on: "w1", leave_staff_uuid: "s" })).toBe(false);
    expect(sm8WriteShapeOk({ kind: "leave", op: "update" })).toBe(false);
    // and a file row may never carry a leave column
    expect(sm8WriteShapeOk({ kind: "attachment", op: "create", leave_start: "2026-10-05 00:00:00" })).toBe(false);
  });

  it("DEPLOY.md's rollback cancels in the very words new code reads, and names the order", () => {
    const deploy = read("DEPLOY.md");
    const section = deploy.slice(deploy.indexOf("#### Leave to ServiceM8"), deploy.indexOf("### Calls, echo and freshness"));
    expect(section).toContain(`last_error = '${LEAVE_WORDS.row.switchedOff}'`);
    expect(section).toMatch(/Apply `docs\/migrations\/sm8_leave_queue\.sql` before the deploy/);
    expect(section).toMatch(/SM8_WRITES=attachment,note,booking,leave/);
  });
});
