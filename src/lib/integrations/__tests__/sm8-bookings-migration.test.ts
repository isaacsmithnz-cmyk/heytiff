/**
 * @jest-environment node
 */

/* The bookings migration and its rollback, read as text (two-way phase 3,
   PR A, A-14).

   Only a real Postgres proves the shape check — the legal and illegal rows,
   and the press's upsert with booking subjects, on a Supabase branch
   (A-16, the PR's gate). What this holds is the shape a reviewer relies on:
   additive, idempotent, the note and file rules exactly phase 2's, every
   column a booking needs named `is not null` inside coalesce(…, false),
   the kind lists the code's own, the function kept from the public keys,
   "never re-run sm8_notes_queue.sql" said in both places, and the rollback
   cancelling in the very words new code reads. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SM8_WRITE_KIND_SCOPES } from "../providers";
import { BOOKING_WORDS, slotOf } from "../sm8-booking-plan";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const sql = read("docs/migrations/sm8_bookings_queue.sql");
const notes = read("docs/migrations/sm8_notes_queue.sql");
const deploy = read("DEPLOY.md");
/** The statements, comments out. */
const code = sql.replace(/--.*$/gm, "");
const notesCode = notes.replace(/--.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

const NEW_COLUMNS = ["verb_id", "booking_staff_uuid", "booking_start", "booking_end", "booking_zone", "job_status_from", "job_status_to"];
/* The kinds of its day: the code's own, less leave, which
   sm8_leave_queue.sql added after it (sm8-leave-migration.test holds that
   file to all four). */
const KINDS = Object.keys(SM8_WRITE_KIND_SCOPES).filter((k) => k !== "leave");

/** One branch of the shape check's outer CASE, `when kind = '<kind>' then …`. */
function branch(kind: string): string {
  const shape = code.slice(code.indexOf("add constraint sm8_writes_shape_check"));
  const at = shape.indexOf(`when kind = '${kind}' then`);
  const rest = shape.slice(at + `when kind = '${kind}' then`.length);
  const next = rest.search(/\n    when kind = '|\n    else false/);
  return rest.slice(0, next);
}

describe("the bookings migration", () => {
  it("says when to apply it, what to check before and after, and never to re-run phase 2's after it", () => {
    expect(sql).toMatch(/WHEN TO APPLY: BEFORE THE DEPLOY OF PR A/);
    expect(sql).toMatch(/READ-ONLY, BEFORE:/);
    expect(sql).toMatch(/AFTER:/);
    expect(sql).toMatch(/Additive and idempotent/);
    expect(sql).toMatch(/AFTER THIS FILE, NEVER RE-RUN sm8_notes_queue\.sql/);
  });

  it("(F) checks what tells before from after: the new shape check by name, and the function naming 'booking'", () => {
    const before = sql.slice(sql.indexOf("READ-ONLY, BEFORE:"), sql.indexOf("-- AFTER:"));
    const after = sql.slice(sql.indexOf("-- AFTER:"), sql.indexOf("ROLLING BACK THE CODE"));
    // the AFTER constraint query names the shape check it says is present
    expect(flat(after.replace(/--/g, ""))).toMatch(/where conname in \([^)]*'sm8_writes_shape_check'[^)]*\)/);
    // the function check reads 'booking' on both sides: false before, true after ('note' is true on both)
    const functionCheck = (s: string) => /position\('''(\w+)''' in pg_get_functiondef\([\s\S]*?\)\) > 0;\s*--\s*(true|false)/.exec(s);
    expect(functionCheck(before)?.slice(1)).toEqual(["booking", "false"]);
    expect(functionCheck(after)?.slice(1)).toEqual(["booking", "true"]);
  });

  it("is wrapped in one transaction", () => {
    expect(code.trim().startsWith("begin;")).toBe(true);
    expect(code.trim().endsWith("commit;")).toBe(true);
  });

  it("(F) adds every column only if it isn't there, drops each constraint before its add, and drops no data", () => {
    for (const m of code.matchAll(/add column\s+(?!if not exists)/g)) throw new Error(`a bare add column at ${m.index}`);
    for (const col of NEW_COLUMNS) expect(code).toMatch(new RegExp(`add column if not exists ${col}\\s`));
    const adds = [...code.matchAll(/add constraint (\w+)/g)].map((m) => m[1]);
    const drops = [...code.matchAll(/drop constraint if exists (\w+)/g)].map((m) => m[1]);
    for (const name of adds) {
      const dropAt = code.indexOf(`drop constraint if exists ${name}`);
      expect([name, dropAt >= 0 && dropAt < code.indexOf(`add constraint ${name}`)]).toEqual([name, true]);
    }
    // the one dropped for good is phase 2's note-only rule, which the one rule for every kind replaces
    expect(drops.filter((d) => !adds.includes(d))).toEqual(["sm8_writes_note_shape_check"]);
    expect(adds).toContain("sm8_writes_shape_check");
    expect(code).not.toMatch(/drop (table|column|index|function|trigger)/);
    expect(code).not.toMatch(/\bdelete from\b|\btruncate\b|\bupdate public\.sm8_writes\b/);
    for (const m of code.matchAll(/create index (?!if not exists)/g)) throw new Error(`a bare create index at ${m.index}`);
  });

  it("(F) lists exactly the kinds the code had then, in the kind check, the owner's switch and its function", () => {
    const listed = (re: RegExp) => [...(re.exec(code)?.[1] ?? "").matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(listed(/sm8_writes_kind_check check \(kind in \(([^)]*)\)\)/)).toEqual(KINDS);
    expect(listed(/write_kinds <@ array\[([^\]]*)\]::text\[\]/)).toEqual(KINDS);
    expect(listed(/p_kind in \(([^)]*)\)/)).toEqual(KINDS);
  });

  it("(F) keeps phase 2's rule for file and note rows character for character, with the new columns null", () => {
    // the file branch: phase 2's, then the new columns null
    const phase2File = /when kind = 'attachment' then\s+([\s\S]*?)\s+when op = 'create'/.exec(notesCode)![1];
    expect(flat(branch("attachment")).startsWith(flat(phase2File))).toBe(true);
    // the note branch: phase 2's op CASE, word for word
    const phase2Ops = /(when op = 'create' then[\s\S]*?else false)\s+end\);/.exec(notesCode)![1];
    const noteOps = /(when op = 'create' then[\s\S]*?else false)\s+end/.exec(branch("note"))![1];
    expect(flat(noteOps)).toBe(flat(phase2Ops));
    for (const col of NEW_COLUMNS) {
      expect([col, flat(branch("attachment")).includes(`${col} is null`)]).toEqual([col, true]);
      expect([col, flat(branch("note")).includes(`${col} is null`)]).toEqual([col, true]);
    }
  });

  it("(F) names every column a booking needs `is not null`, and sits the whole CASE in coalesce(…, false)", () => {
    const booking = flat(branch("booking"));
    for (const col of ["sm8_job_uuid", "verb_id", "booking_staff_uuid", "booking_zone", "booking_start", "booking_end"]) {
      expect([col, booking.includes(`${col} is not null`)]).toEqual([col, true]);
    }
    for (const col of ["target_uuid", "job_status_from", "job_status_to", "seen_edit_date", "depends_on"]) {
      expect([col, booking.includes(`${col} is not null`)]).toEqual([col, true]);
    }
    expect(flat(code)).toMatch(/add constraint sm8_writes_shape_check check \(coalesce\( case .* end, false\)\);/);
    // a status change is only ever Quote to Work Order, on its own job
    expect(booking).toMatch(/job_status_from = 'Quote' and job_status_to = 'Work Order'/);
    expect(booking).toMatch(/target_uuid = sm8_job_uuid/);
    // a booking ends on the day it starts, after it starts
    expect(booking).toMatch(/left\(booking_start, 10\) = left\(booking_end, 10\)/);
    expect(booking).toMatch(/booking_start collate "C" < booking_end collate "C"/);
  });

  it("(F) takes every slot the plan makes, and nothing with a T or seconds in it", () => {
    const shapes = [...code.matchAll(/booking_start ~ '([^']+)'|booking_end\s+~ '([^']+)'/g)].map((m) => m[1] ?? m[2]);
    expect(shapes).toHaveLength(2);
    for (const shape of shapes) {
      const re = new RegExp(shape);
      const slot = slotOf("2026-10-06", "12:45", 30)!;
      expect(re.test(slot.start) && re.test(slot.end)).toBe(true);
      for (const bad of ["2026-10-06T12:45:00", "2026-10-06 12:45:30", "2026-10-06 12:45"]) expect(re.test(bad)).toBe(false);
    }
  });

  it("keeps the switch's function from the public keys", () => {
    expect(code).toMatch(
      /revoke execute on function public\.sm8_set_write_kind\(uuid, text, boolean, timestamptz\) from public, anon, authenticated;/
    );
    expect(code).toMatch(/grant\s+execute on function public\.sm8_set_write_kind\(uuid, text, boolean, timestamptz\) to service_role;/);
  });

  it("indexes a day's bookings and a verb's rows", () => {
    expect(flat(code)).toContain(
      "create index if not exists sm8_writes_booking_start_idx on public.sm8_writes (org_id, booking_start) where kind = 'booking';"
    );
    expect(flat(code)).toContain("create index if not exists sm8_writes_verb_idx on public.sm8_writes (org_id, verb_id) where verb_id is not null;");
  });
});

describe("never re-run phase 2's migration after this one", () => {
  it("(F) is said in sm8_notes_queue.sql's header, and in DEPLOY.md's order for both phases", () => {
    const header = notes.slice(0, notes.indexOf("begin;"));
    expect(header).toMatch(/SUPERSEDED IN PART by sm8_bookings_queue\.sql/);
    expect(header).toMatch(/never re-run this file after that one\./);
    // phase 2's order, and phase 3's first step
    expect(deploy).toMatch(/Once phase 3's `sm8_bookings_queue\.sql` is applied, \*\*never re-run `sm8_notes_queue\.sql`\*\*/);
    expect(deploy).toMatch(/Run its read-only checks before and after\. \*\*Never re-run `sm8_notes_queue\.sql` after it\.\*\*/);
  });
});

describe("DEPLOY.md's bookings section", () => {
  const section = deploy.slice(deploy.indexOf("#### Bookings to ServiceM8 (two-way phase 3)"), deploy.indexOf("### Calls, echo and freshness"));
  const rollback =
    /```sql\n\s*(begin;[\s\S]*?commit;)\n\s*```/.exec(section.slice(section.indexOf("**Rollback, word for word:**")))?.[1].replace(/\s+/g, " ") ??
    "";

  it("(F) cancels in the very words new code reads for Bookings Off, and only booking rows that could still move", () => {
    expect(rollback).toContain(`last_error = '${BOOKING_WORDS.row.switchedOff}'`);
    expect(rollback).toMatch(/where kind = 'booking' and status in \('queued', 'sending', 'failed', 'trial'\)/);
    expect(rollback).toMatch(/lease_until = null, claim_id = null/);
  });

  it("names booking in SM8_WRITES only after P0 to P6, the notes walk and PR D, and never reconnects in Trial", () => {
    expect(section).toMatch(/\*\*Only after P0 to P6, the notes walk, and PR D:\*\* set `SM8_WRITES=attachment,note,booking`/);
    expect(section).toMatch(/The owner sets \*\*Paused\*\*, then \*\*Bookings On\*\*\./);
    expect(section).toMatch(/approves `manage_schedule` and `manage_jobs`\. \*\*Never Reconnect in Trial\.\*\*/);
    expect(section).toMatch(/\*\*Bookings starts Off\.\*\*/);
  });

  it("says what returning to new code shows, in the lines' own words", () => {
    expect(section).toContain(`"Not booked. ${BOOKING_WORDS.row.switchedOff}" with Try again`);
  });
});
