/* YOUR NEXT DAY, WHEN TODAY HAS NOTHING ON (Isaac, 2026-09-26): the first
   day in the fortnight with a booking in your own lane, read and narrowed
   as today's is. */

type Asked = { eq: Record<string, unknown>; gte?: [string, unknown]; lt?: [string, unknown]; order?: unknown; limit?: number };
const asked: Asked[] = [];
let found: { start_date: string | null }[] | null = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const a: Asked = { eq: {} };
      asked.push(a);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (c: string, v: unknown) => {
        a.eq[c] = v;
        return chain;
      };
      chain.gte = (c: string, v: unknown) => {
        a.gte = [c, v];
        return chain;
      };
      chain.lt = (c: string, v: unknown) => {
        a.lt = [c, v];
        return chain;
      };
      chain.order = (c: string, o: unknown) => {
        a.order = [c, o];
        return chain;
      };
      chain.limit = (n: number) => {
        a.limit = n;
        return chain;
      };
      chain.then = (res: (v: unknown) => unknown) =>
        Promise.resolve(found === null ? { data: null, error: { message: "down" } } : { data: found, error: null }).then(res);
      return chain;
    },
  },
}));

const loadScheduleDay = jest.fn();
jest.mock("@/lib/workboard/schedule-query", () => ({ loadScheduleDay: (...a: unknown[]) => loadScheduleDay(...a) }));
const layoutScheduleDay = jest.fn();
jest.mock("@/lib/workboard/schedule", () => ({ layoutScheduleDay: (...a: unknown[]) => layoutScheduleDay(...a) }));

import { loadNextDay, NEXT_DAY_REACH } from "../next-day";

it("looks a fortnight ahead", () => expect(NEXT_DAY_REACH).toBe(14));

const blk = (key: string, remoteId: string, startMin: number) => ({ key, remoteId, startMin });

beforeEach(() => {
  asked.length = 0;
  found = [{ start_date: "2026-09-28 09:30:00" }];
  loadScheduleDay.mockReset().mockResolvedValue({
    activities: [],
    staff: [],
    jobs: [
      { remoteId: "j2313", jobNumber: "2313" },
      { remoteId: "j1377", jobNumber: "1377" },
      { remoteId: "j9", jobNumber: "9" },
    ],
    onSite: [],
    addresses: { j2313: "Oxford St", j9: "Elsewhere St" },
  });
  layoutScheduleDay.mockReset().mockReturnValue({
    lanes: [
      { staffUuid: "u-isaac", name: "Isaac Smith", blocks: [blk("m2", "j1377", 720), blk("m1", "j2313", 570)] },
      { staffUuid: "u-luke", name: "Luke Ingold", blocks: [blk("l1", "j2313", 570), blk("l2", "j9", 600)] },
    ],
    tracksTime: false,
  });
});

it("finds the first booked day of yours in the next fortnight, and reads that day as today's is read", async () => {
  const next = await loadNextDay("org-1", "u-isaac", "2026-09-26");
  expect(asked[0]).toEqual({
    eq: { org_id: "org-1", staff_uuid: "u-isaac", active: 1, activity_was_scheduled: 1 },
    gte: ["start_date", "2026-09-27 00:00:00"],
    // the fortnight after today, the 27th to the 10th inclusive
    lt: ["start_date", "2026-10-11 00:00:00"],
    order: ["start_date", { ascending: true }],
    limit: 1,
  });
  expect(loadScheduleDay).toHaveBeenCalledWith("org-1", "2026-09-28");
  expect(next).toEqual({
    dayISO: "2026-09-28",
    // your lane alone, in time order
    blocks: [blk("m1", "j2313", 570), blk("m2", "j1377", 720)],
    jobs: [
      { remoteId: "j2313", jobNumber: "2313" },
      { remoteId: "j1377", jobNumber: "1377" },
    ],
    where: { j2313: "Oxford St" },
    crew: { j2313: ["Luke"] },
  });
});

it("is no next day when nothing is booked for a fortnight, or the read fails", async () => {
  found = [];
  expect(await loadNextDay("org-1", "u-isaac", "2026-09-26")).toBeNull();
  found = null;
  expect(await loadNextDay("org-1", "u-isaac", "2026-09-26")).toBeNull();
  expect(loadScheduleDay).not.toHaveBeenCalled();
});

it("is no next day when the day's layout puts nothing in your lane", async () => {
  layoutScheduleDay.mockReturnValue({ lanes: [{ staffUuid: "u-luke", name: "Luke Ingold", blocks: [blk("l1", "j9", 600)] }], tracksTime: false });
  expect(await loadNextDay("org-1", "u-isaac", "2026-09-26")).toBeNull();
});
