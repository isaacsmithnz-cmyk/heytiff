/**
 * @jest-environment node
 */
/* Tiff's thread as the panel reads it: opened, the newest of it; polled,
   on from the last event it has, none skipped. A session past one read's
   worth of events used to show its first 500 for good, never her latest. */
jest.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
const TABLES: Record<string, Row[]> = {};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters: ((r: Row) => boolean)[] = [];
      let limitN: number | null = null;
      const orderBy: { c: string; asc: boolean }[] = [];
      const run = (): Row[] => {
        let out = (TABLES[table] ?? []).filter((r) => filters.every((f) => f(r)));
        for (const o of [...orderBy].reverse()) {
          out = [...out].sort((a, b) => ((a[o.c] as number) > (b[o.c] as number) ? 1 : (a[o.c] as number) < (b[o.c] as number) ? -1 : 0) * (o.asc ? 1 : -1));
        }
        return limitN == null ? out : out.slice(0, limitN);
      };
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        gt: (c: string, v: number) => (filters.push((r) => (r[c] as number) > v), q),
        order: (c: string, o?: { ascending?: boolean }) => (orderBy.push({ c, asc: o?.ascending !== false }), q),
        limit: (n: number) => ((limitN = n), q),
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: run(), error: null }),
      };
      return q;
    },
  },
}));

import { readThread } from "../store-server";

const ORG = "org-a";
const JOB = "job-3384";

beforeEach(() => {
  TABLES.quote_sessions = [
    { id: "s1", org_id: ORG, sm8_job_uuid: JOB, messages: [], summary: "", spent_usd: 0, turn_id: null, turn_since: null },
    { id: "s2", org_id: "org-b", sm8_job_uuid: JOB, messages: [], summary: "", spent_usd: 0, turn_id: null, turn_since: null },
  ];
  /* 620 events, past one read; another business's session beside it */
  TABLES.quote_session_events = [
    ...Array.from({ length: 620 }, (_, i) => ({ id: i + 1, org_id: ORG, session_id: "s1", turn_id: null, kind: "message", author: "tiff", body: { text: `${i + 1}` }, at: "2026-10-15T00:00:00Z" })),
    { id: 9001, org_id: "org-b", session_id: "s2", turn_id: null, kind: "message", author: "tiff", body: { text: "theirs" }, at: "2026-10-15T00:00:00Z" },
  ];
});

const ids = (events: { id: number }[]) => events.map((e) => e.id);
const run = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

it("opens on the newest of a long thread, oldest first", async () => {
  const { session, events } = await readThread(ORG, JOB);
  expect(session?.id).toBe("s1");
  expect(events).toHaveLength(500);
  expect(ids(events)).toEqual(run(121, 620));
  expect(events.at(-1)).toMatchObject({ id: 620, author: "tiff", body: { text: "620" } });
});

it("polls on from the last event it has, oldest first, so a burst bigger than one read skips nothing", async () => {
  const first = await readThread(ORG, JOB, 100);
  expect(ids(first.events)).toEqual(run(101, 600));
  const next = await readThread(ORG, JOB, first.events.at(-1)!.id);
  expect(ids(next.events)).toEqual(run(601, 620));
  expect((await readThread(ORG, JOB, 620)).events).toEqual([]);
});

it("a short thread is all of it, and nothing of another business's", async () => {
  TABLES.quote_session_events = TABLES.quote_session_events!.filter((e) => (e.id as number) <= 3 || e.id === 9001);
  expect(ids((await readThread(ORG, JOB)).events)).toEqual([1, 2, 3]);
  expect(await readThread(ORG, "another-job")).toEqual({ session: null, events: [] });
});
