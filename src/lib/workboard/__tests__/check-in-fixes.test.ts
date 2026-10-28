/* A fixed end for a check-in left on: a time on the day it began, after it
   began, within a working day of it. */

jest.mock("server-only", () => ({}));
const asked: number[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.in = async (_c: string, ids: string[]) => {
        asked.push(ids.length);
        return { data: ids.filter((i) => i === "act-7").map((i) => ({ sm8_activity_uuid: i, ends_at: "2026-10-27 15:00:00" })), error: null };
      };
      return q;
    },
  },
}));

import { fixedEndOk, readCheckInFixes, withFix } from "@/lib/workboard/check-in-fixes";

test("a fixed end is later the same day, within twelve hours", () => {
  expect(fixedEndOk("2026-10-27 06:58:13", "2026-10-27 15:00:00")).toBe(true);
  expect(fixedEndOk("2026-10-27 06:58:13", "2026-10-27 06:30:00")).toBe(false);
  expect(fixedEndOk("2026-10-27 06:58:13", "2026-10-28 06:09:32")).toBe(false);
  expect(fixedEndOk("2026-10-27 06:58:13", "2026-10-27 19:30:00")).toBe(false);
  expect(fixedEndOk("2026-10-27 06:58:13", "3pm")).toBe(false);
  /* a time of day that doesn't exist (the review of 29 October 2026) */
  expect(fixedEndOk("2026-10-27 14:00:00", "2026-10-27 25:30:00")).toBe(false);
  expect(fixedEndOk("2026-10-27 06:58:13", "2026-10-27 14:75:00")).toBe(false);
});

/* a big job's check-ins, three spellings each, are asked about in pieces under the URL's limit */
test("reads a big job's fixes in pieces, and finds them", async () => {
  const uuids = Array.from({ length: 160 }, (_, i) => `act-${i}`);
  const fixes = await readCheckInFixes("org-1", uuids);
  expect(Math.max(...asked)).toBeLessThanOrEqual(150);
  expect(asked.reduce((a, b) => a + b, 0)).toBe(new Set(uuids.flatMap((u) => [u, u.toUpperCase()])).size);
  expect(fixes.get("act-7")).toBe("2026-10-27 15:00:00");
});

test("a row takes its fix's end, by its uuid in any case; one without keeps its own", () => {
  const fixes = new Map([["act-1", "2026-10-27 15:00:00"]]);
  expect(withFix({ uuid: "ACT-1", end_date: "2026-10-28 06:09:32" }, fixes).end_date).toBe("2026-10-27 15:00:00");
  expect(withFix({ uuid: "act-2", end_date: "2026-10-27 09:25:53" }, fixes).end_date).toBe("2026-10-27 09:25:53");
});
