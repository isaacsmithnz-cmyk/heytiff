/**
 * @jest-environment node
 */

/* What was actually done on a day, beside its bookings: ServiceM8's own
   check-ins and the phone's own stints, the phone's put on the person their
   sign-in is linked to, on the account's wall clock; ServiceM8's wins where
   both cover the same person on the same job at the same time; a check-in
   left on into the next day is shown but counts no hours. Drawn on the real
   27 October 2026: Leonardo's ServiceM8 check-in at 2771 ran to the next
   morning, and Alex was at 3215. */

jest.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const tests: ((r: Row) => boolean)[] = [];
      const q: Record<string, unknown> = {};
      const keep = (t: (r: Row) => boolean) => (tests.push(t), q);
      q.select = () => q;
      q.eq = (c: string, v: unknown) => keep((r) => r[c] === v);
      q.in = (c: string, vs: unknown[]) => keep((r) => vs.includes(r[c]));
      q.gte = (c: string, v: string) => keep((r) => String(r[c]) >= v);
      q.lt = (c: string, v: string) => keep((r) => String(r[c]) < v);
      q.then = (res: (v: { data: Row[] }) => unknown) => Promise.resolve({ data: (tables[table] ?? []).filter((r) => tests.every((t) => t(r))) }).then(res);
      return q;
    },
  },
}));
jest.mock("@/lib/integrations/sm8-booking-zone", () => ({ bookingZone: async () => ({ zone: "Australia/Sydney" }) }));
jest.mock("@/lib/integrations/sm8-writes", () => ({ readSm8WriteState: async () => ({ tenantId: "t-1" }) }));
jest.mock("@/lib/integrations/links", () => ({
  listSm8StaffLinks: async () => [
    { staffProfileId: "card-alex", remoteId: "sm8-alex" },
    { staffProfileId: "card-isaac", remoteId: "sm8-isaac" },
  ],
}));
jest.mock("@/lib/mobile/clock", () => ({ ...jest.requireActual("@/lib/mobile/clock") }));
jest.mock("@/lib/integrations/sm8-press", () => ({}));
jest.mock("@/app/actions/sm8-booking-queue", () => ({}));
jest.mock("@/lib/integrations/sm8-drain", () => ({}));

import { actualOn } from "@/lib/mobile/schedule-actual";

const ORG = "org-1";
beforeEach(() => {
  tables.sm8_job_activities = [
    { org_id: ORG, active: 1, activity_was_scheduled: 0, job_uuid: "j-3215", staff_uuid: "sm8-alex", start_date: "2026-10-27 07:27:47", end_date: "2026-10-27 09:25:53" },
    { org_id: ORG, active: 1, activity_was_scheduled: 0, job_uuid: "j-2771", staff_uuid: "sm8-leonardo", start_date: "2026-10-27 06:58:13", end_date: "2026-10-28 06:09:32" },
    { org_id: ORG, active: 1, activity_was_scheduled: 1, job_uuid: "j-3304", staff_uuid: "sm8-leonardo", start_date: "2026-10-27 07:00:00", end_date: "2026-10-27 15:00:00" },
  ];
  tables.job_check_ins = [
    /* Alex's phone at 3215 at the same time: ServiceM8's wins */
    { org_id: ORG, sm8_job_uuid: "j-3215", user_id: "auth0|alex", checked_in_at: "2026-10-26T20:30:00.000Z", checked_out_at: "2026-10-26T22:30:00.000Z", reason: null },
    /* Alex's phone at 3304 on the way past, 1:00 to 1:30 pm Sydney: kept, with its reason */
    { org_id: ORG, sm8_job_uuid: "j-3304", user_id: "auth0|alex", checked_in_at: "2026-10-27T02:00:00.000Z", checked_out_at: "2026-10-27T02:30:00.000Z", reason: "site_meeting" },
    /* someone with no link to ServiceM8: nobody to put it on */
    { org_id: ORG, sm8_job_uuid: "j-9999", user_id: "auth0|nobody", checked_in_at: "2026-10-27T01:00:00.000Z", checked_out_at: null, reason: null },
  ];
  tables.sm8_jobs = [
    { org_id: ORG, uuid: "j-2771", generated_job_id: "2771", job_address: "46 Gordon Street\nClontarf NSW 2093", geo_city: "Clontarf", status: "Work Order", category_uuid: "cat-service" },
    { org_id: ORG, uuid: "j-3215", generated_job_id: "3215", job_address: "29 Wemyss St\nEnmore NSW 2042", geo_city: "Enmore", status: "Work Order", category_uuid: "cat-install" },
    { org_id: ORG, uuid: "j-3304", generated_job_id: "3304", job_address: "88 Kirribilli Ave,\nKirribilli NSW 2061", geo_city: "Kirribilli", status: "Work Order", category_uuid: "cat-install" },
  ];
  tables.sm8_categories = [
    { org_id: ORG, uuid: "cat-install", colour: "e7b5ff" },
    { org_id: ORG, uuid: "cat-service", colour: "ffb5b5" },
  ];
  tables.staff_profiles = [
    { org_id: ORG, id: "card-alex", user_id: "auth0|alex" },
    { org_id: ORG, id: "card-nobody", user_id: "auth0|nobody" },
  ];
});

test("everyone's actual time: ServiceM8's check-ins, the phone's stints on the wall clock, ServiceM8 winning, left-on shown with no hours", async () => {
  expect(await actualOn(ORG, "2026-10-27", null)).toEqual([
    expect.objectContaining({ staffUuid: "sm8-leonardo", jobUuid: "j-2771", start: "2026-10-27 06:58:13", end: "2026-10-28 06:09:32", how: "servicem8", leftOn: true, reason: null, number: "2771", where: "46 Gordon Street, Clontarf", colour: "ffb5b5" }),
    expect.objectContaining({ staffUuid: "sm8-alex", jobUuid: "j-3215", start: "2026-10-27 07:27:47", end: "2026-10-27 09:25:53", how: "servicem8", leftOn: false, reason: null, number: "3215" }),
    expect.objectContaining({ staffUuid: "sm8-alex", jobUuid: "j-3304", start: "2026-10-27 13:00:00", end: "2026-10-27 13:30:00", how: "phone", leftOn: false, reason: "site_meeting", number: "3304", colour: "e7b5ff" }),
  ]);
});

test("one person's actual time only, when that's all they may see", async () => {
  expect((await actualOn(ORG, "2026-10-27", "sm8-alex")).map((a) => a.jobUuid)).toEqual(["j-3215", "j-3304"]);
});
