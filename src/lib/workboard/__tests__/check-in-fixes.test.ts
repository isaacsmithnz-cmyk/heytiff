/* A fixed end for a check-in left on: a time on the day it began, after it
   began, within a working day of it. */

jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { fixedEndOk, withFix } from "@/lib/workboard/check-in-fixes";

test("a fixed end is later the same day, within twelve hours", () => {
  expect(fixedEndOk("2026-10-27 06:58:13", "2026-10-27 15:00:00")).toBe(true);
  expect(fixedEndOk("2026-10-27 06:58:13", "2026-10-27 06:30:00")).toBe(false);
  expect(fixedEndOk("2026-10-27 06:58:13", "2026-10-28 06:09:32")).toBe(false);
  expect(fixedEndOk("2026-10-27 06:58:13", "2026-10-27 19:30:00")).toBe(false);
  expect(fixedEndOk("2026-10-27 06:58:13", "3pm")).toBe(false);
});

test("a row takes its fix's end, by its uuid in any case; one without keeps its own", () => {
  const fixes = new Map([["act-1", "2026-10-27 15:00:00"]]);
  expect(withFix({ uuid: "ACT-1", end_date: "2026-10-28 06:09:32" }, fixes).end_date).toBe("2026-10-27 15:00:00");
  expect(withFix({ uuid: "act-2", end_date: "2026-10-27 09:25:53" }, fixes).end_date).toBe("2026-10-27 09:25:53");
});
