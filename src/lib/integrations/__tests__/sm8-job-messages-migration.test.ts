/**
 * @jest-environment node
 */

/* docs/migrations/sm8_job_messages.sql, read as text: the table the sms and
   email walks write, shaped the way their shape writes it, and safe to apply
   ahead of the deploy. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SM8_OBJECTS } from "../sm8-sync-plan";

const sql = readFileSync(join(__dirname, "..", "..", "..", "..", "docs", "migrations", "sm8_job_messages.sql"), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("sm8_job_messages", () => {
  it("is the table both message kinds write", () => {
    const tables = SM8_OBJECTS.filter((s) => s.object === "sms" || s.object === "email").map((s) => s.table);
    expect(tables).toEqual(["sm8_job_messages", "sm8_job_messages"]);
    expect(code).toMatch(/create table if not exists public\.sm8_job_messages \(/);
  });

  it("has a column for every key the shape writes, keyed as the upsert's conflict target", () => {
    const shaped = SM8_OBJECTS.find((s) => s.object === "sms")!.shape({ uuid: "m-1" })!;
    for (const col of [...Object.keys(shaped), "org_id", "synced_at"]) {
      expect(code).toMatch(new RegExp(`^\\s+${col}\\s+\\w`, "m"));
    }
    expect(code).toMatch(/raw\s+jsonb not null/);
    expect(code).toMatch(/primary key \(org_id, uuid\)/);
    expect(code).toMatch(/check \(kind in \('sms', 'email'\)\)/);
  });

  it("is found by the record it hangs off, and closed to the public keys", () => {
    expect(code).toMatch(/on public\.sm8_job_messages \(org_id, related_object_uuid\)/);
    expect(code).toMatch(/alter table public\.sm8_job_messages enable row level security;/);
    expect(code).not.toMatch(/create policy/i);
  });

  it("only adds, and adds nothing twice", () => {
    expect(code).not.toMatch(/\b(drop|rename|truncate|delete\s+from|alter\s+column)\b/i);
    // the one alter turns RLS on for the new table, and nothing else
    expect(code.match(/\balter\b.*$/gim)).toEqual(["alter table public.sm8_job_messages enable row level security;"]);
    expect(code).toMatch(/create table if not exists/);
    expect(code).toMatch(/create index if not exists/);
  });
});
