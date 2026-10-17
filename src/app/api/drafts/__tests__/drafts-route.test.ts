/**
 * @jest-environment node
 */

/* A reply box's unsent words (Isaac, 2026-10-18): only ever the writer's,
   the quote's box behind the Workboard as its conversation is, the job named
   as the quote's routes name it, and empty words leave no draft. The
   database is a small recording stand-in. */

let session: { orgId?: string; user?: { sub?: string } } | null = { orgId: "org-1", user: { sub: "auth0|isaac" } };
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => session } }));
let workboard = true;
jest.mock("@/lib/permissions-server", () => ({ can: async () => workboard }));
jest.mock("@/lib/workboard/all-jobs-query", () => ({ resolveJobCard: async (_o: string, id: string) => ({ parentRemoteId: id === "claim-7" ? "job-parent" : id }) }));

const calls: string[] = [];
let stored: string | null = "Quote it from Luke's design";
jest.mock("@/lib/supabase-server", () => {
  const chain = (table: string) => {
    const filters: string[] = [];
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (c: string, v: string) => {
      filters.push(`${c}=${v}`);
      return q;
    };
    q.maybeSingle = async () => {
      calls.push(`read ${table} ${filters.join(" ")}`);
      return { data: stored === null ? null : { body: stored }, error: null };
    };
    q.upsert = async (row: Record<string, unknown>) => {
      calls.push(`upsert ${table} ${row.org_id} ${row.user_sub} ${row.box} ${row.ref} ${row.body}`);
      return { error: null };
    };
    q.delete = () => {
      const d: Record<string, unknown> = {};
      d.eq = (c: string, v: string) => {
        filters.push(`${c}=${v}`);
        return d;
      };
      d.then = (res: (v: { error: null }) => unknown) => {
        calls.push(`delete ${table} ${filters.join(" ")}`);
        return res({ error: null });
      };
      return d;
    };
    return q;
  };
  return { supabaseAdmin: { from: (t: string) => chain(t) } };
});

import { GET, PUT } from "../route";

const get = (qs: string) => GET(new Request(`http://x/api/drafts?${qs}`));
const put = (body: unknown) => PUT(new Request("http://x/api/drafts", { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => {
  calls.length = 0;
  session = { orgId: "org-1", user: { sub: "auth0|isaac" } };
  workboard = true;
  stored = "Quote it from Luke's design";
});

it("reads the writer's own draft for the quote, by its job", async () => {
  const r = await get("box=quote&ref=job-3209");
  expect(await r.json()).toEqual({ ok: true, text: "Quote it from Luke's design" });
  expect(calls).toEqual(["read reply_drafts org_id=org-1 user_sub=auth0|isaac box=quote ref=job-3209"]);
});

it("reads nothing as an empty draft", async () => {
  stored = null;
  expect(await (await get("box=quote&ref=job-3209")).json()).toEqual({ ok: true, text: "" });
});

it("names a claim's quote by its parent job, as the quote's own routes do", async () => {
  await put({ box: "quote", ref: "claim-7", text: "two heads" });
  expect(calls).toEqual(["upsert reply_drafts org-1 auth0|isaac quote job-parent two heads"]);
});

it("keeps the words as typed, and removes the draft when the box is emptied", async () => {
  expect((await put({ box: "quote", ref: "job-3209", text: "  Plus the split  " })).status).toBe(200);
  expect(calls.at(-1)).toBe("upsert reply_drafts org-1 auth0|isaac quote job-3209   Plus the split  ");
  await put({ box: "quote", ref: "job-3209", text: "   " });
  expect(calls.at(-1)).toBe("delete reply_drafts org_id=org-1 user_sub=auth0|isaac box=quote ref=job-3209");
});

it("refuses without a sign-in, a box it knows, or the Workboard", async () => {
  session = null;
  expect((await get("box=quote&ref=job-3209")).status).toBe(401);
  session = { orgId: "org-1", user: { sub: "auth0|isaac" } };
  expect((await get("box=notes&ref=job-3209")).status).toBe(400);
  expect((await put({ box: "quote", ref: "  " })).status).toBe(400);
  workboard = false;
  expect((await put({ box: "quote", ref: "job-3209", text: "x" })).status).toBe(403);
  expect(calls).toEqual([]);
});
