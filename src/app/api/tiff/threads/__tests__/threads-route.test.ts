/**
 * @jest-environment node
 */

/* A person's conversations with Tiff, on the server
   (docs/migrations/tiff_threads.sql, NOT YET APPLIED): only ever the
   writer's, behind `tiff` as asking is, checked before they are kept, and
   "not kept" while the table isn't there, so the page stays on the device.
   The database is a small recording stand-in. */

let session: { orgId?: string; user?: { sub?: string } } | null = { orgId: "org-1", user: { sub: "auth0|isaac" } };
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => session } }));
let tiff = true;
jest.mock("@/lib/permissions-server", () => ({ can: async () => tiff }));

const calls: string[] = [];
let tableThere = true;
let rows: { id: string; title: string; messages: unknown; updated_at: string }[] = [];
const missing = { code: "PGRST205", message: "Could not find the table 'public.tiff_threads' in the schema cache" };

jest.mock("@/lib/supabase-server", () => {
  const chain = (table: string) => {
    const filters: string[] = [];
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (c: string, v: string) => {
      filters.push(`${c}=${v}`);
      return q;
    };
    q.order = () => q;
    q.limit = async () => {
      calls.push(`read ${table} ${filters.join(" ")}`);
      return tableThere ? { data: rows, error: null } : { data: null, error: missing };
    };
    q.upsert = async (list: { org_id: string; user_sub: string; id: string; updated_at: string }[]) => {
      calls.push(`upsert ${table} ${list.map((r) => `${r.org_id}/${r.user_sub}/${r.id}@${r.updated_at}`).join(" ")}`);
      return { error: tableThere ? null : missing };
    };
    q.delete = () => {
      const d: Record<string, unknown> = {};
      d.eq = (c: string, v: string) => {
        filters.push(`${c}=${v}`);
        return d;
      };
      d.in = async (c: string, v: string[]) => {
        calls.push(`delete ${table} ${filters.join(" ")} ${c} in ${v.join(",")}`);
        return { error: tableThere ? null : missing };
      };
      return d;
    };
    return q;
  };
  return { supabaseAdmin: { from: (t: string) => chain(t) } };
});

import { GET, POST } from "../route";

const post = (body: unknown) => POST(new Request("http://x/api/tiff/threads", { method: "POST", body: JSON.stringify(body) }));

const thread = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: "Why P8?",
  updatedAt: Date.UTC(2026, 9, 13, 0, 42),
  messages: [{ role: "user", text: "why P8?", at: Date.UTC(2026, 9, 13, 0, 42) }],
  ...over,
});

beforeEach(() => {
  calls.length = 0;
  session = { orgId: "org-1", user: { sub: "auth0|isaac" } };
  tiff = true;
  tableThere = true;
  rows = [];
});

it("reads only the writer's own threads, and names them by a hash, not their sign-in", async () => {
  rows = [{ id: "t-1", title: "Why P8?", messages: thread("t-1").messages, updated_at: "2026-10-13T00:42:00.000Z" }];
  const res = await GET();
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.threads).toEqual([thread("t-1")]);
  expect(body.who).toMatch(/^[0-9a-f]{16}$/);
  expect(JSON.stringify(body)).not.toContain("auth0|isaac");
  expect(calls).toEqual(["read tiff_threads org_id=org-1 user_sub=auth0|isaac"]);
});

it("says the threads aren't kept while the table isn't there", async () => {
  tableThere = false;
  const res = await GET();
  expect(res.status).toBe(503);
  expect((await res.json()).ok).toBe(false);
});

it("keeps threads and removes others, by the writer's org and sign-in", async () => {
  const res = await post({ upsert: [thread("t-1")], remove: ["t-2"] });
  expect(await res.json()).toEqual({ ok: true });
  expect(calls).toEqual([
    "upsert tiff_threads org-1/auth0|isaac/t-1@2026-10-13T00:42:00.000Z",
    "delete tiff_threads org_id=org-1 user_sub=auth0|isaac id in t-2",
  ]);
});

it("refuses something that isn't a thread, and keeps nothing of the call", async () => {
  const res = await post({ upsert: [thread("t-1"), thread("bad id")] });
  expect(res.status).toBe(400);
  expect((await post({ remove: ["../x"] })).status).toBe(400);
  expect(calls).toEqual([]);
});

it("takes a bounded batch", async () => {
  const res = await post({ upsert: Array.from({ length: 41 }, (_, i) => thread(`t-${i}`)) });
  expect(res.status).toBe(413);
});

it("asks for a sign-in, and for Tiff", async () => {
  session = null;
  expect((await GET()).status).toBe(401);
  session = { orgId: "org-1", user: { sub: "auth0|isaac" } };
  tiff = false;
  expect((await GET()).status).toBe(403);
  expect((await post({ upsert: [thread("t-1")] })).status).toBe(403);
  expect(calls).toEqual([]);
});

it("fails a write as not kept when the table isn't there, so the browser's copy stands", async () => {
  tableThere = false;
  expect((await post({ upsert: [thread("t-1")] })).status).toBe(503);
});
