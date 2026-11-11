/**
 * @jest-environment node
 */

/* A swipe on a notification: Clear writes the id and Undo takes it out; a
   notice's Done reads it at its revision; a reminder snoozes an hour and
   Undo puts it back; never another person's, never another workspace's. */

jest.mock("server-only", () => ({}));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async () => staff }));
let staff: string | null = "s-isaac";
const writes: { table: string; op: string; row?: unknown; where: Record<string, unknown> }[] = [];
let rows: Record<string, unknown> = {};
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      let op = "select";
      let row: unknown;
      const where: Record<string, unknown> = {};
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (k: string, v: unknown) => ((where[k] = v), q);
      q.upsert = (r: unknown) => ((op = "upsert"), (row = r), q);
      q.update = (r: unknown) => ((op = "update"), (row = r), q);
      q.delete = () => ((op = "delete"), q);
      q.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
      q.then = (res: (v: unknown) => unknown) => {
        writes.push({ table, op, row, where });
        return res({ data: null, error: null });
      };
      return q;
    },
  },
}));

import { actOnNotification, parseNotificationId } from "../notification-acts";
import type { MobileCtx } from "../auth";

const ctx = { userId: "auth0|isaac", orgId: "org-1", role: "owner", caps: new Set(), orgIds: ["org-1"] } as unknown as MobileCtx;
const T = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  writes.length = 0;
  rows = {};
  staff = "s-isaac";
});

it("reads an id's kind, keeping an ask's colons", () => {
  expect(parseNotificationId("mention:j-2935:u-mick")).toEqual({ id: "mention:j-2935:u-mick", kind: "mention", rest: "j-2935:u-mick" });
  expect(parseNotificationId("bogus:1")).toBeNull();
  expect(parseNotificationId(":x")).toBeNull();
});

it("Clear writes the id for you in your workspace; Undo takes it out", async () => {
  expect(await actOnNotification(ctx, { act: "clear", id: "leave:lv1" })).toEqual({ ok: true, value: {} });
  expect(writes[0]).toMatchObject({ table: "notification_clears", op: "upsert", row: { org_id: "org-1", staff_profile_id: "s-isaac", notification_id: "leave:lv1" } });
  await actOnNotification(ctx, { act: "unclear", id: "leave:lv1" });
  expect(writes[1]).toMatchObject({ table: "notification_clears", op: "delete", where: { org_id: "org-1", staff_profile_id: "s-isaac", notification_id: "leave:lv1" } });
});

it("a notice's Done reads it at its revision; only a notice is read", async () => {
  rows.notices = { id: T, revision: 3 };
  expect((await actOnNotification(ctx, { act: "read", id: `notice:${T}` })).ok).toBe(true);
  expect(writes.at(-1)).toMatchObject({ table: "notice_reads", op: "upsert", row: { notice_id: T, staff_profile_id: "s-isaac", revision: 3 } });
  expect(await actOnNotification(ctx, { act: "read", id: `task:${T}` })).toMatchObject({ ok: false, status: 400 });
});

it("a reminder snoozes an hour and Undo puts it back where it was; never someone else's", async () => {
  rows.tasks = { assigned_to: "s-isaac", status: "open", remind_at: "2026-11-11T20:00:00.000Z" };
  const before = Date.now();
  const r = await actOnNotification(ctx, { act: "snooze", id: `reminder:${T}` });
  expect(r).toEqual({ ok: true, value: { at: "2026-11-11T20:00:00.000Z" } });
  const moved = writes.at(-1)!;
  expect(moved).toMatchObject({ table: "tasks", op: "update", where: { org_id: "org-1", id: T, assigned_to: "s-isaac" } });
  const next = new Date((moved.row as { remind_at: string }).remind_at).getTime();
  expect(next - before).toBeGreaterThanOrEqual(3_600_000 - 50);
  expect(next - before).toBeLessThan(3_600_000 + 5_000);

  await actOnNotification(ctx, { act: "unsnooze", id: `reminder:${T}`, at: "2026-11-11T20:00:00.000Z" });
  expect((writes.at(-1)!.row as { remind_at: string }).remind_at).toBe("2026-11-11T20:00:00.000Z");

  writes.length = 0;
  rows.tasks = { assigned_to: "s-brent", status: "open", remind_at: null };
  expect(await actOnNotification(ctx, { act: "snooze", id: `reminder:${T}` })).toMatchObject({ ok: false, status: 403 });
  expect(writes).toEqual([]);
});

it("nothing without a staff card or with an act it doesn't know", async () => {
  expect(await actOnNotification(ctx, { act: "explode", id: "leave:lv1" })).toMatchObject({ ok: false, status: 400 });
  staff = null;
  expect(await actOnNotification(ctx, { act: "clear", id: "leave:lv1" })).toMatchObject({ ok: false, status: 403 });
  expect(writes).toEqual([]);
});
