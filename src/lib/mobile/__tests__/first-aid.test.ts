/**
 * @jest-environment node
 */

/* First aid's "On today's job": the job you're on now, else next, else the last today; its latest
   SWMS's first aider (with the number off their card, only when the name is theirs alone) and
   hospital; where the SWMS names nobody, someone else booked on the job with a current first aid
   ticket, and where it names no hospital, the nearest emergency department to the job's pin; and
   nothing made up past that. Every read is the phone's own workspace's. Fake people and sites only;
   the hospitals are the list's own. */

import { bookedFirstAider, callable, namedOrNull, todaysBooking } from "../first-aid-plan";

type Rows = Record<string, Record<string, unknown>[]>;
let rows: Rows = {};
const asked: string[] = [];
jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (name: string) => {
      const eq: Record<string, unknown> = {};
      const inn: Record<string, unknown[]> = {};
      let order: string | null = null;
      const pick = () => {
        let out = (rows[name] ?? []).filter(
          (r) => Object.entries(eq).every(([c, v]) => r[c] === v) && Object.entries(inn).every(([c, v]) => v.includes(r[c]))
        );
        if (order) out = [...out].sort((a, b) => String(b[order!]).localeCompare(String(a[order!])));
        return out;
      };
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => ((eq[c] = v), q),
        in: (c: string, v: unknown[]) => ((inn[c] = v), q),
        gte: () => q,
        lte: () => q,
        order: (c: string) => ((order = c), q),
        limit: () => q,
        maybeSingle: async () => (asked.push(`${name}@${String(eq.org_id)}`), { data: pick()[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => (asked.push(`${name}@${String(eq.org_id)}`), res({ data: pick(), error: null })),
      };
      return q;
    },
  },
}));
jest.mock("@/lib/integrations/sm8-writes", () => ({ readSm8WriteState: async () => ({ tenantId: "t1" }) }));
jest.mock("@/lib/integrations/sm8-booking-zone", () => ({ bookingZone: async () => ({ zone: "Australia/Sydney" }) }));
jest.mock("../clock", () => {
  const { localNow } = jest.requireActual("@/lib/integrations/sm8-booking-plan");
  return { wallMinute: (iso: string, zone: string) => `${String(localNow(zone, Date.parse(iso))).slice(0, 16)}:00` };
});
/* you are p0, STAFF-1 in ServiceM8; Sam Lee is p1 (STAFF-2), Alex Example p2 (STAFF-3) */
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async () => "p0" }));
jest.mock("@/lib/integrations/links", () => ({
  listSm8StaffLinks: async () => [
    { remoteId: "STAFF-1", staffProfileId: "p0" },
    { remoteId: "staff-2", staffProfileId: "p1" },
    { remoteId: "STAFF-3", staffProfileId: "p2" },
  ],
}));

import { readFirstAid } from "../first-aid";
import type { MobileCtx } from "../auth";

const ctx = { orgId: "org-1", userId: "u1", role: "member", caps: new Set(), orgIds: ["org-1"] } as unknown as MobileCtx;
/* 24 Nov 2026, 10:30 in Sydney */
const NOW = Date.parse("2026-11-23T23:30:00Z");
const act = (job: string, start: string, end: string, org = "org-1") => ({
  org_id: org, job_uuid: job, staff_uuid: "STAFF-1", active: 1, activity_was_scheduled: 1, start_date: `2026-11-24 ${start}:00`, end_date: `2026-11-24 ${end}:00`,
});
/* a pin a short walk from Westmead Hospital */
const job = (uuid: string, n: string, pin: [number, number] = [-33.8, 150.99]) => ({
  org_id: "org-1", uuid, generated_job_id: n, job_address: "12 Example Street\nSampleton NSW 2000", geo_city: "Sampleton", geo_state: "NSW", geo_postcode: "2000", lat: pin[0], lng: pin[1],
});
const booked = (job: string, staff: string) => ({ ...act(job, "10:00", "12:00"), staff_uuid: staff });
const ticket = (id: string, type = "Provide First Aid HLTAID011", expiry: string | null = "2027-06-30") => ({ org_id: "org-1", staff_profile_id: id, type_name: type, expiry_date: expiry });
const swmsFor = (jobUuid: string, versionId: string, emergency: Record<string, string>, issued = "2026-11-20T00:00:00Z") => [
  { table: "swms", row: { org_id: "org-1", id: `s-${versionId}`, sm8_job_uuid: jobUuid } },
  { table: "swms_versions", row: { org_id: "org-1", id: versionId, swms_id: `s-${versionId}`, issued_at: issued, content: { emergency } } },
];
const put = (...xs: { table: string; row: Record<string, unknown> }[]) => {
  for (const x of xs) (rows[x.table] ??= []).push(x.row);
};

beforeEach(() => {
  rows = {
    sm8_job_activities: [act("job-a", "08:00", "10:00"), act("job-b", "10:00", "12:00"), act("job-c", "13:00", "15:00"), act("job-x", "10:00", "12:00", "org-2")],
    sm8_jobs: [job("job-a", "100"), job("job-b", "101"), job("job-c", "102")],
    swms_people: [
      { org_id: "org-1", version_id: "v2", staff_profile_id: "p1" },
      { org_id: "org-1", version_id: "v2", staff_profile_id: "p2" },
    ],
    staff_profiles: [
      { org_id: "org-1", id: "p0", first_name: "Jo", last_name: "Viewer", full_name: "Jo Viewer", preferred_name: null, phone: "0422 222 222", status: "Active" },
      { org_id: "org-1", id: "p1", first_name: "Sam", last_name: "Lee", full_name: "Sam Lee", preferred_name: null, phone: "0400 000 000", status: "Active" },
      { org_id: "org-1", id: "p2", first_name: "Alex", last_name: "Example", full_name: "Alex Example", preferred_name: null, phone: "0411 111 111", status: "Active" },
    ],
    staff_licences: [],
  };
  asked.length = 0;
});

describe("todaysBooking", () => {
  const b = (jobUuid: string, start: string, end: string | null) => ({ jobUuid, start: `2026-11-24 ${start}:00`, end: end && `2026-11-24 ${end}:00` });
  const day = [b("a", "08:00", "10:00"), b("b", "10:00", "12:00"), b("c", "13:00", "15:00")];
  it("is the one you're on, the latest-started when two overlap", () => {
    expect(todaysBooking(day, "2026-11-24 09:00:00")?.jobUuid).toBe("a");
    expect(todaysBooking(day, "2026-11-24 10:00:00")?.jobUuid).toBe("b");
  });
  it("is the next one between bookings and before the first", () => {
    expect(todaysBooking(day, "2026-11-24 12:30:00")?.jobUuid).toBe("c");
    expect(todaysBooking(day, "2026-11-24 06:00:00")?.jobUuid).toBe("a");
  });
  it("is the last one after the day's bookings, as you may still be there", () => {
    expect(todaysBooking(day, "2026-11-24 17:00:00")?.jobUuid).toBe("c");
  });
  it("is nothing with no booking today", () => {
    expect(todaysBooking([], "2026-11-24 09:00:00")).toBeNull();
    expect(todaysBooking([b("a", "08:00", "10:00")], "2026-11-25 09:00:00")).toBeNull();
  });
});

describe("namedOrNull and callable", () => {
  it("takes Not named, a dash and blanks as nobody", () => {
    expect(namedOrNull("Not named")).toBeNull();
    expect(namedOrNull("—")).toBeNull();
    expect(namedOrNull("  ")).toBeNull();
    expect(namedOrNull(undefined)).toBeNull();
    expect(namedOrNull(" Sam Lee ")).toBe("Sam Lee");
  });
  it("keeps a number a phone can dial, and nothing else", () => {
    expect(callable("0400 000 000")).toBe("0400000000");
    expect(callable("+61 (400) 000-000")).toBe("+61400000000");
    expect(callable("ask Sam")).toBeNull();
    expect(callable(null)).toBeNull();
  });
});

describe("bookedFirstAider", () => {
  it("is never you, and the same one each time", () => {
    const people = [{ staffProfileId: "p2", name: "Sam Lee" }, { staffProfileId: "p1", name: "Alex Example" }, { staffProfileId: "p0", name: "Aaron Viewer" }];
    expect(bookedFirstAider(people, "p0")?.staffProfileId).toBe("p1");
    expect(bookedFirstAider([{ staffProfileId: "p0", name: "Jo" }], "p0")).toBeNull();
  });
});

describe("readFirstAid", () => {
  it("names the SWMS's first aider with their number, and its hospital with how far when it's on the list", async () => {
    put(...swmsFor("job-b", "v1", { firstAider: "Alex Example", hospital: "Old Hospital", extinguisher: "In the van" }, "2026-11-01T00:00:00Z"));
    put(...swmsFor("job-b", "v2", { firstAider: "Sam Lee", hospital: "Westmead Hospital", extinguisher: "In the van" }));
    const got = await readFirstAid(ctx, NOW);
    expect(got.job).toMatchObject({
      jobUuid: "job-b",
      number: "101",
      where: "12 Example Street, Sampleton",
      swmsVersionId: "v2",
      firstAider: { name: "Sam Lee", phone: "0400000000", from: "swms" },
      hospital: { name: "Westmead Hospital", near: "Sampleton NSW 2000", from: "swms" },
      extinguisher: "In the van",
    });
    expect(got.job?.hospital?.km).toBeGreaterThan(0);
    expect(got.job?.hospital?.km).toBeLessThan(2);
    expect(got.job?.hospital?.lat).toBeCloseTo(-33.804, 2);
    /* nothing read outside the phone's workspace */
    expect(asked.every((a) => a.endsWith("@org-1"))).toBe(true);
  });

  it("keeps a hospital the SWMS names that isn't on the list, with no distance", async () => {
    put(...swmsFor("job-b", "v2", { firstAider: "Sam Lee", hospital: "Sampleton Private", extinguisher: "In the van" }));
    expect((await readFirstAid(ctx, NOW)).job?.hospital).toEqual({ name: "Sampleton Private", km: null, lat: null, lng: null, near: "Sampleton NSW 2000", from: "swms" });
  });

  it("with no SWMS, finds the nearest emergency department and someone booked on it with first aid", async () => {
    rows.sm8_job_activities.push(booked("job-b", "STAFF-2"), booked("job-b", "STAFF-3"));
    rows.staff_licences = [ticket("p1"), ticket("p2", "Provide CPR HLTAID009")];
    const got = await readFirstAid(ctx, NOW);
    expect(got.job?.swmsVersionId).toBeNull();
    expect(got.job?.firstAider).toEqual({ name: "Sam Lee", phone: "0400000000", from: "booked" });
    expect(got.job?.hospital).toMatchObject({ name: "Westmead Hospital", from: "nearest" });
    expect(got.job?.hospital?.km).toBeLessThan(2);
    expect(got.job?.extinguisher).toBeNull();
  });

  it("names no booked first aider whose ticket has run out, and never you", async () => {
    rows.sm8_job_activities.push(booked("job-b", "STAFF-2"));
    rows.staff_licences = [ticket("p1", "First Aid", "2026-01-01"), ticket("p0")];
    expect((await readFirstAid(ctx, NOW)).job?.firstAider).toBeNull();
  });

  it("leaves out a first aider nobody named and nobody booked has, and finds the hospital when the SWMS left it blank", async () => {
    put(...swmsFor("job-b", "v2", { firstAider: "Not named", hospital: "", extinguisher: "On site, marked" }));
    const got = await readFirstAid(ctx, NOW);
    expect(got.job?.firstAider).toBeNull();
    expect(got.job?.hospital?.from).toBe("nearest");
    expect(got.job?.extinguisher).toBe("On site, marked");
  });

  it("finds no hospital for a job with no pin", async () => {
    rows.sm8_jobs = [job("job-b", "101", [0, 0])];
    expect((await readFirstAid(ctx, NOW)).job?.hospital).toBeNull();
  });

  it("gives no number for a first aider from outside the business, or a name two people share", async () => {
    put(...swmsFor("job-b", "v2", { firstAider: "Jo Outside", hospital: "Westmead Hospital", extinguisher: "In the van" }));
    expect((await readFirstAid(ctx, NOW)).job?.firstAider).toEqual({ name: "Jo Outside", phone: null, from: "swms" });
    rows.staff_profiles[2] = { ...rows.staff_profiles[2], first_name: "Sam", last_name: "Lee", full_name: "Sam Lee" };
    rows.swms_versions[0] = { ...rows.swms_versions[0], content: { emergency: { firstAider: "Sam Lee", hospital: "Westmead Hospital", extinguisher: "In the van" } } };
    expect((await readFirstAid(ctx, NOW)).job?.firstAider).toEqual({ name: "Sam Lee", phone: null, from: "swms" });
  });

  it("is no job with no booking today", async () => {
    rows.sm8_job_activities = [];
    expect(await readFirstAid(ctx, NOW)).toEqual({ job: null });
  });
});
