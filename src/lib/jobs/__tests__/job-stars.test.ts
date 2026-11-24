/**
 * @jest-environment node
 */

/* A job you starred (lib/jobs/job-stars): yours alone, by workspace and
   sign-in; only a job this workspace's mirror holds; and after a tick, the
   ask to take the star off only when that was your last open task on it. */

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};

jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const eqs: [string, unknown][] = [];
      let mode: "read" | "delete" = "read";
      let one = false;
      let head = false;
      let desc: string | null = null;
      const rows = () => (db[table] ?? []).filter((r) => eqs.every(([c, v]) => r[c] === v));
      const done = () => {
        if (mode === "delete") {
          const gone = new Set(rows());
          db[table] = (db[table] ?? []).filter((r) => !gone.has(r));
          return { data: null, error: null };
        }
        let out = rows();
        if (desc) out = [...out].sort((a, b) => String(b[desc!]).localeCompare(String(a[desc!])));
        if (head) return { data: null, count: out.length, error: null };
        return { data: one ? (out[0] ?? null) : out, error: null };
      };
      const q = {
        select: (_c: string, o?: { head?: boolean }) => ((head = !!o?.head), q),
        eq: (c: string, v: unknown) => (eqs.push([c, v]), q),
        order: (c: string, o?: { ascending?: boolean }) => ((desc = o?.ascending === false ? c : null), q),
        limit: () => q,
        maybeSingle: () => ((one = true), q),
        delete: () => ((mode = "delete"), q),
        upsert: (r: Row) => {
          const list = (db[table] ??= []);
          if (!list.some((x) => x.org_id === r.org_id && x.user_id === r.user_id && x.sm8_job_uuid === r.sm8_job_uuid))
            list.push({ ...r, created_at: `2026-11-24T0${list.length}:00:00Z` });
          return Promise.resolve({ error: null });
        },
        then: (res: (v: unknown) => unknown) => res(done()),
      };
      return q;
    },
  },
}));

import { isStarred, readStars, setStar, starredAmong, starredLastTask } from "../job-stars";

const me = { orgId: "org-a", userId: "auth0|me" };
const other = { orgId: "org-a", userId: "auth0|luke" };

beforeEach(() => {
  db.job_stars = [];
  db.sm8_jobs = [
    { org_id: "org-a", uuid: "job-3602", generated_job_id: "3602" },
    { org_id: "org-a", uuid: "job-3611", generated_job_id: "3611" },
    { org_id: "org-b", uuid: "job-9001", generated_job_id: "9001" },
  ];
  db.tasks = [];
  db.mention_asks = [];
});

it("stars a job of this workspace, once, newest first, and is yours alone", async () => {
  expect(await setStar(me, "job-3602", true)).toEqual({ ok: true, starred: true });
  expect(await setStar(me, "job-3611", true)).toEqual({ ok: true, starred: true });
  expect(await setStar(me, "job-3602", true)).toEqual({ ok: true, starred: true });
  expect((await readStars(me)).map((s) => s.job)).toEqual(["job-3611", "job-3602"]);
  expect(await isStarred(other, "job-3602")).toBe(false);
  expect([...(await starredAmong(me, ["JOB-3602", "job-x"]))]).toEqual(["job-3602"]);
});

it("refuses another workspace's job", async () => {
  expect(await setStar(me, "job-9001", true)).toEqual({ ok: false, error: "That job isn't in HeyTiff." });
  expect(db.job_stars).toEqual([]);
});

it("takes the star off", async () => {
  await setStar(me, "job-3602", true);
  await setStar(other, "job-3602", true);
  expect(await setStar(me, "job-3602", false)).toEqual({ ok: true, starred: false });
  expect(await isStarred(me, "job-3602")).toBe(false);
  expect(await isStarred(other, "job-3602")).toBe(true);
});

it("asks after a tick only when the job is starred and that was your last open task on it", async () => {
  db.tasks = [
    { org_id: "org-a", id: "t1", sm8_job_uuid: "job-3602", assigned_to: "card-me", status: "done" },
    { org_id: "org-a", id: "t2", sm8_job_uuid: "job-3611", assigned_to: "card-me", status: "done" },
    { org_id: "org-a", id: "t3", sm8_job_uuid: "job-3611", assigned_to: "card-me", status: "open" },
  ];
  expect(await starredLastTask(me, "card-me", "t1")).toBeNull();
  await setStar(me, "job-3602", true);
  await setStar(me, "job-3611", true);
  expect(await starredLastTask(me, "card-me", "t1")).toEqual({ job: "job-3602", number: "3602" });
  expect(await starredLastTask(me, "card-me", "t2")).toBeNull();
  expect(await starredLastTask(me, null, "t1")).toBeNull();
});
