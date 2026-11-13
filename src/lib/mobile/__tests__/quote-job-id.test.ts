jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
jest.mock("@/app/actions/sm8-job-queue", () => ({ queueNewJob: async () => ({ ok: false, error: "x" }) }));

import { quotePressId } from "../quote-job";

/* The quote job's press is the job and the day: said again, the same job, never a second. */
it("is one id a job a day, uuid-shaped, whatever the case", () => {
  const a = quotePressId("org", "ABC-1", "2026-11-11");
  expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(quotePressId("org", "abc-1", "2026-11-11")).toBe(a);
  expect(quotePressId("org", "abc-1", "2026-11-12")).not.toBe(a);
});
