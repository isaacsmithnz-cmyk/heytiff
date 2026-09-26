/* When the diary asks for the page again: the copy of ServiceM8 it was
   drawn from was stale, or the page is old. The server's own number for
   "stale" is the one it uses. */

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { STALE_AFTER_MS } from "@/lib/integrations/sm8-sync";
import { DIARY_RECHECK_MS, DIARY_STALE_MS, mirrorStale, pageStale } from "../diary-refresh";

const NOW = Date.parse("2026-09-25T04:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

it("calls a copy stale by the same ten minutes the page-load sync does", () => {
  expect(DIARY_STALE_MS).toBe(STALE_AFTER_MS);
  expect(DIARY_STALE_MS).toBe(10 * 60_000);
  expect(DIARY_RECHECK_MS).toBe(60_000);
});

it("is stale past ten minutes, or never synced, or unreadable", () => {
  expect(mirrorStale(ago(DIARY_STALE_MS + 1), NOW)).toBe(true);
  expect(mirrorStale(ago(DIARY_STALE_MS), NOW)).toBe(false);
  expect(mirrorStale(ago(60_000), NOW)).toBe(false);
  expect(mirrorStale(null, NOW)).toBe(true);
  expect(mirrorStale("not a date", NOW)).toBe(true);
});

it("calls a page old past ten minutes", () => {
  expect(pageStale(NOW - DIARY_STALE_MS - 1, NOW)).toBe(true);
  expect(pageStale(NOW - DIARY_STALE_MS, NOW)).toBe(false);
});
