/* WHICH INVITE THE DOOR ANSWERS WITH, when this address holds more than one.

   The screen only ever shows one, so the choice is the whole feature: pick
   wrong and someone with a working invitation is told it expired, on the one
   screen that has no other way forward. Newest-first is not that choice —
   `renewInvite` pushes `expires_at` and leaves `created_at` alone, so the two
   stamps come apart the moment an admin renews, and the newest row can be the
   dead one.

   The mock below actually honours `.gt()` and `.order()/.limit()` instead of
   handing back a fixed row. That is the point: a stub that ignores filters
   passes this suite whether the page reads live-first or not, which is how a
   query bug like this reaches prod under a green test. */

import { renderToStaticMarkup } from "react-dom/server";

type Row = { token: string; expires_at: string; org_id: string; created_at: string };

let rows: Row[] = [];
let sessionValue: Record<string, unknown> | null = null;
/* Every read's filters, so a test can say the LIVE read was actually asked of
   the database rather than sorted for afterwards. */
const reads: { gt: string | null }[] = [];

const NOW = new Date("2026-09-12T00:00:00.000Z");

const invitationsChain = () => {
  let gtExpires: string | null = null;
  let desc = true;
  let limit = Infinity;
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.is = () => chain;
  chain.gt = (col: string, val: string) => {
    if (col === "expires_at") gtExpires = val;
    return chain;
  };
  chain.order = (_col: string, opts?: { ascending?: boolean }) => {
    desc = opts?.ascending === false;
    return chain;
  };
  chain.limit = (n: number) => {
    limit = n;
    return chain;
  };
  chain.then = (res: (v: { data: Row[]; error: null }) => unknown) => {
    reads.push({ gt: gtExpires });
    /* `gt` is a DATABASE comparison: a row whose expiry is null never
       satisfies it, which is the null-safety the page leans on. */
    const kept = rows.filter((r) => (gtExpires ? r.expires_at > gtExpires : true));
    kept.sort((a, b) =>
      desc ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at),
    );
    return Promise.resolve({ data: kept.slice(0, limit), error: null }).then(res);
  };
  return chain;
};

const orgsChain = () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = async () => ({
    data: { name: "founder@example.com", trading_name: "Diamond Air Solutions" },
    error: null,
  });
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (name: string) => (name === "invitations" ? invitationsChain() : orgsChain()),
  },
}));

jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: async () => sessionValue },
}));

jest.mock("next/navigation", () => ({
  redirect: (to: string): never => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

/* The mark is decoration on this screen; its own suite covers how it draws. */
jest.mock("@/components/logo", () => ({
  Chevron: () => null,
  Wordmark: () => null,
}));

import NoOrgPage from "../page";

const render = async () => renderToStaticMarkup(await NoOrgPage());

const invite = (over: Partial<Row>): Row => ({
  token: "tok",
  org_id: "org",
  created_at: "2026-09-01T00:00:00.000Z",
  expires_at: "2026-09-20T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(NOW);
  rows = [];
  reads.length = 0;
  sessionValue = {
    user: { email: "newhire@example.com", email_verified: true },
  };
});

afterEach(() => {
  jest.useRealTimers();
});

it("offers the live invite even when a newer one has expired", async () => {
  rows = [
    // invited day 1, renewed on day 10 — created first, expires last
    invite({ token: "renewed", created_at: "2026-09-01T00:00:00.000Z", expires_at: "2026-09-17T00:00:00.000Z" }),
    // invited day 3 by another company, lapsed on day 10
    invite({ token: "lapsed", created_at: "2026-09-03T00:00:00.000Z", expires_at: "2026-09-10T00:00:00.000Z" }),
  ];

  const html = await render();

  expect(html).toContain("Accept invitation");
  expect(html).toContain("token=renewed");
  expect(html).not.toContain("has expired");
});

it("asks the database for a live invite rather than sorting for one", async () => {
  rows = [invite({ token: "renewed" })];

  await render();

  expect(reads[0].gt).toBe(NOW.toISOString());
});

it("still names the company when every invite has lapsed", async () => {
  rows = [
    invite({ token: "old", created_at: "2026-09-01T00:00:00.000Z", expires_at: "2026-09-08T00:00:00.000Z" }),
    invite({ token: "newer", created_at: "2026-09-03T00:00:00.000Z", expires_at: "2026-09-10T00:00:00.000Z" }),
  ];

  const html = await render();

  expect(html).toContain("Diamond Air Solutions");
  expect(html).toContain("has expired");
  expect(html).not.toContain("Accept invitation");
});

/* An expiry the DB never set can only come back from the second read, and the
   page has to read it as lapsed rather than as an invitation to click. */
it("treats a null expiry as expired instead of offering it", async () => {
  rows = [invite({ token: "nulled", expires_at: null as unknown as string })];

  const html = await render();

  expect(html).toContain("has expired");
  expect(html).not.toContain("Accept invitation");
});

it("tells a genuine stranger where they stand", async () => {
  const html = await render();

  expect(html).toContain("Ask your administrator");
  expect(html).not.toContain("Accept invitation");
});
