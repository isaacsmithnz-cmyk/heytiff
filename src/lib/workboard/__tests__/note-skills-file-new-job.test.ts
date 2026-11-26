/**
 * @jest-environment node
 */

/* A NEW JOB GOES UNDER THE CUSTOMER THE BOOK IS SURE OF (lib/customers/
   find's ownClient). Before, only a client named exactly was found, so a
   customer whose name was heard with its spaces elsewhere ("DeVane" for "De
   Vane") got a second client in ServiceM8. Names here are made up. */
jest.mock("server-only", () => ({}));
jest.mock("@/app/actions/booking-sm8", () => ({}));
jest.mock("@/app/actions/fleet", () => ({}));
jest.mock("@/app/actions/job-customer", () => ({}));
jest.mock("@/app/actions/leave", () => ({}));
jest.mock("@/app/actions/site-notes", () => ({}));
jest.mock("@/lib/dashboard/reminders-query", () => ({}));
jest.mock("@/lib/fleet/query", () => ({}));
jest.mock("@/lib/integrations/sm8-kinds", () => ({}));
jest.mock("@/lib/integrations/sm8-press", () => ({}));
jest.mock("@/lib/jobs/job-stars", () => ({}));
jest.mock("@/lib/mobile/auth", () => ({}));
jest.mock("@/lib/mobile/complete-checked", () => ({}));
jest.mock("@/lib/mobile/day", () => ({}));
jest.mock("@/lib/mobile/schedule-change", () => ({}));
jest.mock("@/lib/mobile/used", () => ({}));
jest.mock("@/lib/mobile/used-plan", () => ({}));
jest.mock("@/lib/mobile/used-read", () => ({}));
jest.mock("@/lib/permissions-server", () => ({}));
jest.mock("@/lib/quotes/lines-job-server", () => ({}));
jest.mock("@/lib/quotes/lines-server", () => ({}));
jest.mock("@/lib/quotes/session/tools-server", () => ({}));
jest.mock("@/lib/schedule/blocks-store", () => ({}));
jest.mock("@/lib/supabase-server", () => ({}));
jest.mock("@/lib/workboard/note-move-read", () => ({}));
jest.mock("@/lib/workboard/query", () => ({}));
jest.mock("@/lib/workboard/visit-tasks-server", () => ({}));
let exact: { uuid: string; name: string; builder: boolean } | null = null;
jest.mock("@/lib/email/proposal-server", () => ({ clientMatchOf: async () => exact, siteMatchOf: async () => null }));
import type { CustomerHit } from "@/lib/customers/find";
let found: CustomerHit[] = [];
jest.mock("@/lib/customers/find-server", () => ({ findCustomers: async () => found }));
const made: Record<string, unknown>[] = [];
jest.mock("@/app/actions/job-new", () => ({
  createNewJob: async (input: Record<string, unknown>) => (made.push(input), { ok: true, jobUuid: "job-new" }),
}));

import { doSkill } from "../note-skills-file";

const ctx = { orgId: "org-1", userId: "auth0|me", staffId: "s-me", press: null };
const o = { today: "2026-11-26", jobLabel: null, receipt: null, who: "" };
const job = { kind: "new_job" as const, work: "Split system quote", address: "2/26 Lorem St, Sampleton NSW 2088", client: "Sam DeVane", phone: "", email: "" };
const hit = (over: Partial<CustomerHit>): CustomerHit => ({ name: "Sam De Vane", via: "client", client: null, address: "2/26 Lorem St\nSampleton NSW 2088", job: null, fit: 1, clientUuid: "c-1", ...over });

beforeEach(() => {
  exact = null;
  found = [];
  made.length = 0;
});

it("goes under the client the book is sure of, however the name was heard", async () => {
  found = [hit({})];
  const r = await doSkill(ctx, job, 0, { kind: "none" }, o);
  expect(made[0]).toMatchObject({ client: { kind: "existing", uuid: "c-1" }, clientName: "Sam De Vane" });
  expect(r.line).toBe("The job is made at 2/26 Lorem St, Sampleton NSW 2088, for Sam De Vane, as a Quote in ServiceM8.");
});

it("the client named exactly comes first", async () => {
  exact = { uuid: "c-9", name: "Sam DeVane", builder: false };
  found = [hit({})];
  await doSkill(ctx, job, 0, { kind: "none" }, o);
  expect(made[0]).toMatchObject({ client: { kind: "existing", uuid: "c-9" } });
});

it("makes a new client when the book isn't sure: a builder's job contact, or nobody", async () => {
  found = [hit({ via: "job contact", client: "QX Construct", clientUuid: null })];
  const r = await doSkill(ctx, job, 0, { kind: "none" }, o);
  expect(made[0]).toMatchObject({ client: { kind: "new", name: "Sam DeVane" } });
  expect(r.line).toBe("The job is made at 2/26 Lorem St, Sampleton NSW 2088, as a Quote in ServiceM8.");
});
