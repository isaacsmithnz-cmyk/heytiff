/**
 * @jest-environment node
 */

/* The notes migration and the rollback, read as text (two-way phase 2).

   Only a real Postgres proves the trigger and the NO ACTION key (the PR's
   Supabase-branch gate); what this holds is the shape a reviewer relies on:
   additive, idempotent, safe before the deploy, and the rollback SQL in
   DEPLOY.md cancelling in the very words new code reads. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NOTE_WORDS, STORED_REFUSALS } from "../sm8-note-plan";
import { sm8QueueChip } from "@/lib/dashboard/chips";

const sql = readFileSync(join(process.cwd(), "docs", "migrations", "sm8_notes_queue.sql"), "utf8");
const deploy = readFileSync(join(process.cwd(), "DEPLOY.md"), "utf8");
/** The statements, comments out. */
const code = sql.replace(/--.*$/gm, "");

describe("the notes migration", () => {
  it("says when to apply it and what to check, before and after", () => {
    expect(sql).toMatch(/BEFORE THE DEPLOY/);
    expect(sql).toMatch(/READ-ONLY, BEFORE:/);
    expect(sql).toMatch(/AFTER:/);
  });

  it("is wrapped in one transaction", () => {
    expect(code.trim().startsWith("begin;")).toBe(true);
    expect(code.trim().endsWith("commit;")).toBe(true);
  });

  it("adds every column only if it isn't there, and drops a constraint only to add it back", () => {
    for (const m of code.matchAll(/add column\s+(?!if not exists)/g)) throw new Error(`a bare add column at ${m.index}`);
    const drops = [...code.matchAll(/drop constraint if exists (\w+)/g)].map((m) => m[1]);
    for (const name of drops) {
      const dropAt = code.indexOf(`drop constraint if exists ${name}`);
      const addAt = code.indexOf(`add constraint ${name}`);
      expect(addAt).toBeGreaterThan(dropAt);
    }
    // nothing is dropped outright: no table, no column, no data
    expect(code).not.toMatch(/drop (table|column)/);
    expect(code).not.toMatch(/\bdelete from\b|\btruncate\b/);
  });

  it("revokes both functions from the public keys", () => {
    for (const fn of ["sm8_mark_kind_refused", "sm8_set_write_kind"]) {
      expect(code).toMatch(new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
    }
  });

  it("refuses a note row naming who pressed it, at any value, and leaves file rows alone", () => {
    expect(code).toMatch(/before update of requested_by, requested_by_user on public\.sm8_writes/);
    expect(code).toMatch(/if old\.kind = 'note' then/);
    // it checks no value: a same-value update is refused too
    expect(code).not.toMatch(/new\.requested_by\s*(<>|!=|is distinct)/);
  });

  it("keeps HeyTiff's row while any queue row names it: note_id is ON DELETE NO ACTION", () => {
    expect(code).toMatch(/foreign key \(note_id, org_id\) references public\.workboard_notes \(id, org_id\)\s+on delete no action/);
  });

  it("adds the reply and Done columns PR B and PR C read, here", () => {
    for (const col of ["removed_at", "sm8_refusal", "reply_to_sm8_note_uuid", "task_id", "is_task_done"]) {
      expect(code).toMatch(new RegExp(`add column if not exists ${col}\\b`));
    }
  });

  it("stores exactly the eleven refusal codes", () => {
    const list = /workboard_notes_sm8_refusal_check[\s\S]*?in\s*\(([\s\S]*?)\)\);/.exec(code)![1];
    expect([...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...STORED_REFUSALS]);
  });

  it("starts every workspace with Notes off", () => {
    expect(code).toMatch(/write_kinds text\[\] not null default '\{attachment\}'/);
  });
});

describe("the rollback in DEPLOY.md", () => {
  const rollback =
    /```sql\n\s*(begin;[\s\S]*?commit;)\n\s*```/.exec(deploy.slice(deploy.indexOf("Rollback, word for word")))?.[1].replace(/\s+/g, " ") ?? "";

  it("(F) cancels in the very words new code reads for Notes Off", () => {
    expect(rollback).toContain(`last_error = '${NOTE_WORDS.row.notesSwitchedOff}'`);
    expect(rollback).toMatch(/where kind = 'note' and status in \('queued', 'sending', 'failed', 'trial'\)/);
  });

  it("clears every note row's words, and hides taken-back rows from old code's applied reads", () => {
    expect(rollback).toMatch(/set note_text = null, text_cleared_at = now\(\), remote_message = null\s+where kind = 'note' and note_text is not null/);
    expect(rollback).toMatch(/set status = 'dismissed'\s+where removed_at is not null and status = 'applied'/);
    // and never names requested_by, so the trigger never fires
    expect(rollback).not.toMatch(/requested_by/);
  });

  it("keeps SM8_WRITES at 1 until phase 1's live walk", () => {
    expect(deploy).toMatch(/Only after phase 1's live walk/);
    expect(deploy).toMatch(/`attachment,note`/);
  });
});

describe("the owner's chip", () => {
  it("(F) counts files and notes apart once notes go, and is word for word today's with none", () => {
    expect(sm8QueueChip({ reason: "reconnect", waiting: 3, kinds: { attachment: 1, note: 2 } })?.subject).toBe(
      "1 file and 2 notes waiting to go"
    );
    expect(sm8QueueChip({ reason: "reconnect", waiting: 2, kinds: { attachment: 2, note: 0 } })?.subject).toBe("2 files waiting to go");
    expect(sm8QueueChip({ reason: "reconnect", waiting: 1 })?.subject).toBe("1 file waiting to go");
    expect(sm8QueueChip({ reason: "cap", waiting: 3, kinds: { attachment: 1, note: 2 } })?.subject).toBe(
      "More than 60 in an hour, 1 file and 2 notes waiting"
    );
  });
});
