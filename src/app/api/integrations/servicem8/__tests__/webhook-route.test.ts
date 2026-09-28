/**
 * @jest-environment node
 */

/* Where ServiceM8's pings land (two-way phase 4, PR E). The ping parser is
   the real one (sm8-hook-plan) and so is the switch; the database's one
   round trip (sm8_take_ping) and the drain are fakes, so what is under test
   is the route's decisions: what each verdict answers, when the drain is
   started behind the answer, and that nothing is read, run or written
   down that shouldn't be. */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

/* ── the database: one RPC, recorded; any table touched is a failure ── */

type RpcAnswer = { data: unknown; error: { message: string } | null } | Error;
let rpcAnswer: RpcAnswer = { data: [{ verdict: "queued", hook_org: "org-7e1a" }], error: null };
const rpc = jest.fn(async (_name: string, _args: Record<string, unknown>) => {
  if (rpcAnswer instanceof Error) throw rpcAnswer;
  return rpcAnswer;
});
const from = jest.fn();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    rpc: (name: string, args: Record<string, unknown>) => rpc(name, args),
    from: (...a: unknown[]) => from(...a),
  },
}));

const scheduled: (() => Promise<unknown> | unknown)[] = [];
jest.mock("next/server", () => ({
  ...jest.requireActual("next/server"),
  after: (fn: () => unknown) => void scheduled.push(fn),
}));

let drainLoaded = false;
const drainSm8Hooks = jest.fn(async (_org: string, _opts: { deadline: number; maxMs: number; wait: boolean }) => ({
  ran: true,
  read: 1,
  written: 1,
  handed: 0,
  dropped: 0,
  stopped: null,
}));
jest.mock("@/lib/integrations/sm8-hook-drain", () => {
  drainLoaded = true;
  return { drainSm8Hooks: (org: string, opts: { deadline: number; maxMs: number; wait: boolean }) => drainSm8Hooks(org, opts) };
});

/* nothing here may start a sync: a ping is a doorbell for the drain */
const runSm8Sync = jest.fn();
const runSm8SyncWhenFree = jest.fn();
jest.mock("@/lib/integrations/sm8-sync", () => ({
  runSm8Sync: (...a: unknown[]) => runSm8Sync(...a),
  runSm8SyncWhenFree: (...a: unknown[]) => runSm8SyncWhenFree(...a),
}));

import * as route from "../webhook/[hook]/route";

/* made up: 43 base64url characters, the shape of a minted hook */
const HOOK = "Qm8tLw2vXp4Rk9sJ0yN3cB7dF1gH5aE6uZ-iO_TqK2m";
const HASH = createHash("sha256").update(HOOK).digest("hex");
const ORG = "org-7e1a";
const U1 = "5b1d2f3e-4a6c-4d8e-9f01-23456789abcd";
const U2 = "6c2e3f4a-5b7d-4e9f-8a12-3456789abcde";

const env = { ...process.env };
const realFetch = global.fetch;
const fetchSpy = jest.fn(async () => new Response("{}"));
const logs: unknown[][] = [];
const consoleSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  process.env = { ...env, VERCEL_ENV: "production", SM8_WEBHOOKS: "1" };
  rpcAnswer = { data: [{ verdict: "queued", hook_org: ORG }], error: null };
  rpc.mockClear();
  from.mockClear();
  drainSm8Hooks.mockClear();
  runSm8Sync.mockClear();
  runSm8SyncWhenFree.mockClear();
  fetchSpy.mockClear();
  scheduled.length = 0;
  logs.length = 0;
  global.fetch = fetchSpy as unknown as typeof fetch;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    consoleSpies.push(jest.spyOn(console, level).mockImplementation((...a: unknown[]) => void logs.push(a)));
  }
});
afterEach(() => {
  for (const s of consoleSpies.splice(0)) s.mockRestore();
  process.env = { ...env };
  global.fetch = realFetch;
});

type Send = {
  method?: "GET" | "POST";
  hook?: string;
  query?: string;
  body?: string | ReadableStream<Uint8Array>;
  type?: string;
  headers?: Record<string, string>;
};

async function send(s: Send = {}): Promise<Response> {
  const method = s.method ?? "POST";
  const hook = s.hook ?? HOOK;
  const headers: Record<string, string> = { ...(s.headers ?? {}) };
  if (s.type) headers["content-type"] = s.type;
  /* a stream body needs duplex, which the init's type doesn't name */
  const init = { method, headers, ...(s.body !== undefined ? { body: s.body } : {}), ...(typeof s.body === "object" ? { duplex: "half" } : {}) };
  const req = new NextRequest(
    `https://go.example.test/api/integrations/servicem8/webhook/${hook}${s.query ?? ""}`,
    init as ConstructorParameters<typeof NextRequest>[1]
  );
  const handler = method === "GET" ? route.GET : route.POST;
  return handler(req, { params: Promise.resolve({ hook }) });
}

const pingOf = (object: string, uuids: string[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    object,
    entry: uuids.map((uuid) => ({ uuid, changed_fields: ["status"], time: "2026-09-28 01:02:03" })),
    resource_url: `https://api.servicem8.com/api_1.0/${object}/${uuids[0]}.json`,
    ...extra,
  });

const json = (body: string) => ({ body, type: "application/json" });

async function runScheduled() {
  for (const fn of scheduled.splice(0)) await fn();
}

/* ── the switch ── */

describe("with the switch off", () => {
  it("answers 404 to everything, before any read, and starts nothing", async () => {
    const offs: [string | undefined, string | undefined][] = [
      ["production", undefined],
      ["production", "0"],
      ["production", ""],
      ["preview", "1"],
      ["preview", "gone"],
      [undefined, "1"],
    ];
    for (const [vercel, hooks] of offs) {
      process.env = { ...env };
      if (vercel !== undefined) process.env.VERCEL_ENV = vercel;
      else delete process.env.VERCEL_ENV;
      if (hooks !== undefined) process.env.SM8_WEBHOOKS = hooks;
      else delete process.env.SM8_WEBHOOKS;
      for (const s of [
        json(pingOf("job", [U1])),
        { method: "GET" as const, query: "?mode=subscribe&challenge=c-1" },
        { hook: "not-a-hook" },
      ]) {
        const res = await send(s);
        expect([vercel, hooks, res.status]).toEqual([vercel, hooks, 404]);
      }
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(0);
    expect(drainLoaded).toBe(false);
  });
});

describe("gone, the rollback", () => {
  beforeEach(() => {
    process.env.SM8_WEBHOOKS = "gone";
  });

  it("answers 410 to a well-formed hook, GET or POST, with no database read", async () => {
    expect((await send(json(pingOf("job", [U1])))).status).toBe(410);
    expect((await send({ method: "GET", query: "?mode=subscribe&challenge=c-1" })).status).toBe(410);
    expect((await send({ body: "x".repeat(20_000), headers: { "content-length": "20000" } })).status).toBe(410);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(0);
  });

  it("answers 404 to anything else", async () => {
    for (const hook of [HOOK.slice(1), `${HOOK}x`, `${HOOK.slice(1)}.`, "hook"]) {
      expect([hook, (await send({ hook, ...json(pingOf("job", [U1])) })).status]).toEqual([hook, 404]);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

/* ── on ── */

describe("the hook", () => {
  it("is 404 unless it is 43 base64url characters, with no database read", async () => {
    for (const hook of [HOOK.slice(1), `${HOOK}A`, `${HOOK.slice(1)}=`, `${HOOK.slice(1)}+`, "", "a".repeat(44)]) {
      expect([hook, (await send({ hook, ...json(pingOf("job", [U1])) })).status]).toEqual([hook, 404]);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("is looked up by its SHA-256, in one round trip, never a table", async () => {
    await send(json(pingOf("job", [U1])));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toEqual([
      "sm8_take_ping",
      { p_hash: HASH, p_object: "jobs", p_uuids: [U1], p_cap: 2000 },
    ]);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(HOOK);
    expect(from).not.toHaveBeenCalled();
  });

  it("names the workspace the lookup found in the one line logged, and none it didn't", async () => {
    await send(json(pingOf("job", [U1])));
    rpcAnswer = { data: [{ verdict: "unknown", hook_org: null }], error: null };
    await send(json(pingOf("job", [U1])));
    expect(logs.map((l) => l.join(" "))).toEqual([
      "[sm8] webhook: queued for org org-7e1a (json, 1 uuid)",
      "[sm8] webhook: unknown (json, 1 uuid)",
    ]);
  });
});

describe("what each verdict answers", () => {
  it("unknown and stale: 410, for a change and for a challenge, and nothing starts", async () => {
    for (const verdict of ["unknown", "stale"]) {
      rpcAnswer = { data: [{ verdict, hook_org: verdict === "stale" ? ORG : null }], error: null };
      const change = await send(json(pingOf("job", [U1])));
      const challenge = await send({ method: "GET", query: "?mode=subscribe&challenge=c-1" });
      expect([verdict, change.status, challenge.status]).toEqual([verdict, 410, 410]);
      expect(await challenge.text()).toBe("");
    }
    expect(scheduled).toHaveLength(0);
  });

  it("a failed lookup is 503, never 410: a blip must not unsubscribe us", async () => {
    const failures: RpcAnswer[] = [
      { data: null, error: { message: "canceling statement due to statement timeout" } },
      new Error("fetch failed"),
      { data: [], error: null },
      { data: null, error: null },
      { data: [{ verdict: "maybe", hook_org: ORG }], error: null },
    ];
    for (const f of failures) {
      rpcAnswer = f;
      const change = await send(json(pingOf("job", [U1])));
      const challenge = await send({ method: "GET", query: "?mode=subscribe&challenge=c-1" });
      expect([change.status, challenge.status]).toEqual([503, 503]);
    }
    expect(scheduled).toHaveLength(0);
  });

  it("queued: 200, and behind it the drain, waiting for quiet, inside this function's deadline", async () => {
    const t0 = 1_790_000_000_000;
    const now = jest.spyOn(Date, "now").mockReturnValue(t0);
    try {
      const res = await send(json(pingOf("job", [U1])));
      expect(res.status).toBe(200);
      expect(scheduled).toHaveLength(1);
      expect(drainSm8Hooks).not.toHaveBeenCalled();
      now.mockReturnValue(t0 + 5_000);
      await runScheduled();
    } finally {
      now.mockRestore();
    }
    expect(drainSm8Hooks).toHaveBeenCalledTimes(1);
    expect(drainSm8Hooks).toHaveBeenCalledWith(ORG, { deadline: t0 + 300_000 - 20_000, maxMs: 120_000, wait: true });
    expect(runSm8Sync).not.toHaveBeenCalled();
    expect(runSm8SyncWhenFree).not.toHaveBeenCalled();
  });

  it("merged: 200 and no after(): a drain is already on those rows", async () => {
    rpcAnswer = { data: [{ verdict: "merged", hook_org: ORG }], error: null };
    expect((await send(json(pingOf("job", [U1])))).status).toBe(200);
    expect(scheduled).toHaveLength(0);
    expect(drainSm8Hooks).not.toHaveBeenCalled();
  });

  it("full: 200, no after(), and no sync: the RPC asked for the next ordinary one", async () => {
    rpcAnswer = { data: [{ verdict: "full", hook_org: ORG }], error: null };
    expect((await send(json(pingOf("job", [U1])))).status).toBe(200);
    await runScheduled();
    expect(scheduled).toHaveLength(0);
    expect(drainSm8Hooks).not.toHaveBeenCalled();
    expect(runSm8Sync).not.toHaveBeenCalled();
    expect(runSm8SyncWhenFree).not.toHaveBeenCalled();
  });

  it("the answer is a single row or the row alone", async () => {
    rpcAnswer = { data: { verdict: "merged", hook_org: ORG }, error: null };
    expect((await send(json(pingOf("job", [U1])))).status).toBe(200);
  });

  it("never 429, whatever comes", async () => {
    const statuses = new Set<number>();
    for (const verdict of ["unknown", "stale", "known", "queued", "merged", "full", "odd"]) {
      rpcAnswer = { data: [{ verdict, hook_org: ORG }], error: null };
      for (const s of [
        json(pingOf("job", [U1])),
        { method: "GET" as const, query: "?mode=subscribe&challenge=c-1" },
        { body: "junk" },
        { body: "x".repeat(17_000) },
      ]) {
        statuses.add((await send(s)).status);
      }
    }
    expect(statuses.has(429)).toBe(false);
    expect([...statuses].sort()).toEqual([200, 410, 503]);
  });
});

describe("the challenge", () => {
  beforeEach(() => {
    rpcAnswer = { data: [{ verdict: "known", hook_org: ORG }], error: null };
  });

  async function expectEcho(res: Response, challenge: string) {
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(challenge);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
  }

  it("is echoed alone when it comes as a GET", async () => {
    await expectEcho(await send({ method: "GET", query: "?mode=subscribe&challenge=ab-12~Z" }), "ab-12~Z");
    expect(rpc.mock.calls[0]).toEqual(["sm8_take_ping", { p_hash: HASH, p_object: null, p_uuids: null, p_cap: 2000 }]);
    expect(scheduled).toHaveLength(0);
  });

  it("is echoed alone when it comes as a form", async () => {
    await expectEcho(await send({ body: "mode=subscribe&challenge=f0rm-c", type: "application/x-www-form-urlencoded" }), "f0rm-c");
  });

  it("is echoed alone when it comes as JSON", async () => {
    await expectEcho(await send(json(JSON.stringify({ mode: "subscribe", challenge: "js0n.c" }))), "js0n.c");
  });

  it("is echoed only when the hook is known", async () => {
    rpcAnswer = { data: [{ verdict: "unknown", hook_org: null }], error: null };
    const res = await send({ method: "GET", query: "?mode=subscribe&challenge=secret-ish" });
    expect(res.status).toBe(410);
    expect(await res.text()).not.toContain("secret-ish");
  });

  it("with a control character or past 256 is junk: 200, no lookup, and only its length logged", async () => {
    for (const challenge of ["a b", "a\u0007b", "x".repeat(257)]) {
      const res = await send({ method: "GET", query: `?mode=subscribe&challenge=${encodeURIComponent(challenge)}` });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("");
    }
    expect(rpc).not.toHaveBeenCalled();
    const text = logs.map((l) => l.join(" ")).join("\n");
    expect(text).toContain("a challenge of 257 refused");
    expect(text).not.toContain("x".repeat(20));
  });
});

describe("reading a change", () => {
  it("takes JSON, JSON sent as text, and a form field holding it", async () => {
    const body = pingOf("job", [U1]);
    for (const s of [json(body), { body, type: "text/plain" }, { body: `data=${encodeURIComponent(body)}`, type: "application/x-www-form-urlencoded" }]) {
      expect((await send(s)).status).toBe(200);
    }
    expect(rpc.mock.calls.map((c) => c[1].p_object)).toEqual(["jobs", "jobs", "jobs"]);
    const text = logs.map((l) => l.join(" ")).join("\n");
    for (const kind of ["(json,", "(json_text,", "(form,"]) expect(text).toContain(kind);
  });

  it("reads the object loosely and the uuids lowercased, at most ten of a many-entry ping", async () => {
    const many = Array.from({ length: 12 }, (_v, i) => `${i.toString(16).padStart(8, "0")}-4a6c-4d8e-9f01-23456789ABCD`);
    await send(json(pingOf("JobActivity", many)));
    await send(json(pingOf("job_activity", [U1.toUpperCase(), U1])));
    await send(json(pingOf("Note", [U2])));
    expect(rpc.mock.calls.map((c) => [c[1].p_object, c[1].p_uuids])).toEqual([
      ["job_activities", many.slice(0, 10).map((u) => u.toLowerCase())],
      ["job_activities", [U1]],
      ["job_notes", [U2]],
    ]);
  });

  it("uses nothing but the object and the uuids: a hostile resource_url is never fetched, and changes nothing", async () => {
    await send(json(pingOf("job", [U1])));
    await send(
      json(pingOf("job", [U1], { resource_url: "https://evil.example/steal?x=1", time: "1999-01-01", mode: "nope" }))
    );
    await runScheduled();
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("junk, or an object we don't mirror: 200 with no lookup", async () => {
    for (const s of [
      { body: "" },
      { body: "hello" },
      json("{not json"),
      json(JSON.stringify({ object: "job", entry: [{ uuid: "not-a-uuid" }] })),
      json(JSON.stringify({ object: "job" })),
      json(pingOf("task", [U1])),
      json(pingOf("staff", [U1])),
      { method: "GET" as const },
      { method: "GET" as const, query: `?object=job&uuid=${U1}` },
    ]) {
      expect((await send(s)).status).toBe(200);
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(0);
  });
});

describe("the body's size", () => {
  it("a Content-Length over 16 KB is answered 200 without reading a byte", async () => {
    let pulled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled = true;
        c.enqueue(new TextEncoder().encode(pingOf("job", [U1])));
        c.close();
      },
    }, { highWaterMark: 0 });
    const res = await send({ body: stream, type: "application/json", headers: { "content-length": "16385" } });
    expect(res.status).toBe(200);
    expect(pulled).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(logs.map((l) => l.join(" ")).join("\n")).toContain("oversized");
  });

  it("is counted in bytes, and a body that runs past the cap unannounced is left unread past it", async () => {
    /* 8,500 characters, 17,000 bytes */
    const wide = `{"object":"job","entry":[{"uuid":"${U1}"}],"pad":"${"é".repeat(8_500)}"}`;
    const chunks = [wide.slice(0, 4_000), wide.slice(4_000)].map((t) => new TextEncoder().encode(t));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent < chunks.length) c.enqueue(chunks[sent++]);
        else c.close();
      },
    });
    expect((await send({ body: stream, type: "application/json" })).status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
    /* stopped by the read's own cap, not by the parser's second look */
    expect(logs.map((l) => l.join(" ")).join("\n")).toContain("oversized");
  });

  it("a body at the cap is read", async () => {
    const base = pingOf("job", [U1]);
    const body = base.slice(0, -1) + `,"pad":"${"a".repeat(16_384 - Buffer.byteLength(base) - 9)}"}`;
    expect(Buffer.byteLength(body)).toBe(16_384);
    expect((await send({ ...json(body), headers: { "content-length": "16384" } })).status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("the secret is never written down", () => {
  it("no console line, in any outcome, carries the hook or its path", async () => {
    const outcomes: RpcAnswer[] = [
      { data: [{ verdict: "queued", hook_org: ORG }], error: null },
      { data: [{ verdict: "unknown", hook_org: null }], error: null },
      { data: null, error: { message: `permission denied near /api/integrations/servicem8/webhook/${HOOK}` } },
      new Error(`boom at /api/integrations/servicem8/webhook/${HOOK}`),
      { data: [{ verdict: "odd", hook_org: ORG }], error: null },
    ];
    drainSm8Hooks.mockImplementationOnce(async () => {
      throw new Error(`drain blew up on ${HOOK}`);
    });
    for (const o of outcomes) {
      rpcAnswer = o;
      await send(json(pingOf("job", [U1])));
      await send({ method: "GET", query: "?mode=subscribe&challenge=c-1" });
      await send({ body: "junk" });
      await send({ body: "x", headers: { "content-length": "99999" } });
      await runScheduled();
    }
    expect(logs.length).toBeGreaterThan(10);
    const text = logs.map((l) => l.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(" ")).join("\n");
    expect(text).not.toContain(HOOK);
    expect(text).not.toContain(HOOK.slice(0, 16));
    expect(text).toContain("[hook]");
  });
});

describe("the function", () => {
  it("has the platform's whole 300 s, spelled as the literal Next reads", () => {
    expect(route.maxDuration).toBe(300);
    expect(route.runtime).toBe("nodejs");
    const src = readFileSync(join(__dirname, "..", "webhook", "[hook]", "route.ts"), "utf8");
    expect(src).toMatch(/^export const maxDuration = 300;$/m);
  });

  it("never reads a session, and never runs a sync", () => {
    const src = readFileSync(join(__dirname, "..", "webhook", "[hook]", "route.ts"), "utf8");
    expect(src).not.toMatch(/auth0|getSession/);
    expect(src).not.toMatch(/runSm8Sync|sm8-sync"/);
    /* the ping's link is never followed: no request of any kind leaves */
    expect(src).not.toMatch(/\.resource_url|\["resource_url"\]|\bfetch\(/);
  });
});
