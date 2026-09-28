/**
 * @jest-environment node
 */

/* The one door to ServiceM8's REST API: the address is checked, a turn is
   taken from the account's counter, the request is made, and a 429 is
   recorded for every other caller. The counter here is a small stateful
   fake — a cooldown noted by one call is what the next call's turn sees —
   because the door's whole value is that its callers share one limit. */

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

type Refusal = { ok: false; waitMs: number; why: "minute" | "day" | "cooldown_minute" | "cooldown_day" };
let turns: ({ ok: true } | Refusal)[] = [];
let cooldown: "minute" | "day" | null = null;
const taken: [string, string][] = [];
const noted: [string, string][] = [];
jest.mock("../sm8-meter", () => {
  const actual = jest.requireActual("../sm8-meter");
  return {
    ...actual,
    takeSm8Call: async (meter: string, lane: string) => {
      taken.push([meter, lane]);
      if (cooldown) return { ok: false, waitMs: cooldown === "day" ? 3_600_000 : 60_000, why: `cooldown_${cooldown}` };
      return turns.shift() ?? { ok: true };
    },
    noteSm8Throttle: async (meter: string, limit: "minute" | "day") => {
      noted.push([meter, limit]);
      cooldown = limit;
    },
  };
});

import { sm8BusyOf, sm8HooksUrl, sm8Request, sm8Url } from "../sm8-http";

const fetchMock = jest.fn();
const realFetch = global.fetch;
const CALL = { accessToken: "secret-token-xyz", meter: "v-1", lane: "write" as const };
const sleep = jest.fn(async () => {});

beforeEach(() => {
  turns = [];
  cooldown = null;
  taken.length = 0;
  noted.length = 0;
  sleep.mockClear();
  fetchMock.mockReset().mockResolvedValue(new Response("[]", { status: 200 }));
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = realFetch;
});

describe("the address", () => {
  it("resolves a path under the API base", () => {
    expect(sm8Url("vendor.json").toString()).toBe("https://api.servicem8.com/api_1.0/vendor.json");
    expect(sm8Url("job.json", { cursor: "-1", $filter: "a eq 'b'" }).searchParams.get("$filter")).toBe("a eq 'b'");
  });

  it("refuses anything that leaves https://api.servicem8.com/api_1.0/", async () => {
    for (const path of [
      "https://evil.example/api_1.0/vendor.json",
      "http://api.servicem8.com/api_1.0/vendor.json",
      "//evil.example/x",
      "/vendor.json",
      "../vendor.json",
      "https://user:pass@api.servicem8.com/api_1.0/vendor.json",
      "https://api.servicem8.com.evil.example/api_1.0/vendor.json",
    ]) {
      expect(() => sm8Url(path)).toThrow();
      await expect(sm8Request(CALL, path)).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(taken).toHaveLength(0);
  });
});

describe("a turn first", () => {
  it("takes it from the caller's account, on the caller's lane", async () => {
    await sm8Request(CALL, "vendor.json", {}, { sleep });
    expect(taken).toEqual([["v-1", "write"]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a refused turn makes no request", async () => {
    turns = [{ ok: false, waitMs: 90_000, why: "day" }];
    expect(await sm8Request(CALL, "vendor.json", {}, { sleep })).toEqual({ kind: "throttled", waitMs: 90_000, why: "day" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("sleeps through a short wait for the bucket, once, and then asks", async () => {
    turns = [{ ok: false, waitMs: 1_500, why: "minute" }, { ok: true }];
    const answer = await sm8Request({ ...CALL, lane: "sync" }, "vendor.json", {}, { sleep });
    expect(sleep).toHaveBeenCalledWith(1_500);
    expect(answer.kind).toBe("response");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hands back a wait longer than the lane's patience rather than sleeping it", async () => {
    turns = [{ ok: false, waitMs: 2_500, why: "minute" }];
    const read = { ...CALL, lane: "read" as const }; // a read waits 2 s at most
    expect(await sm8Request(read, "vendor.json", {}, { sleep })).toEqual({ kind: "throttled", waitMs: 2_500, why: "minute" });
    expect(sleep).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up after its one sleep, if the bucket is still short", async () => {
    turns = [
      { ok: false, waitMs: 1_000, why: "minute" },
      { ok: false, waitMs: 1_000, why: "minute" },
    ];
    expect((await sm8Request({ ...CALL, lane: "sync" }, "vendor.json", {}, { sleep })).kind).toBe("throttled");
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never sleeps on lane `write`: its turns are taken under a row's claim, whose clocks have no room", async () => {
    turns = [{ ok: false, waitMs: 500, why: "minute" }, { ok: true }];
    expect(await sm8Request(CALL, "attachment.json", { method: "POST" }, { sleep })).toEqual({
      kind: "throttled",
      waitMs: 500,
      why: "minute",
    });
    expect(sleep).not.toHaveBeenCalled();
    expect(taken).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never sleeps through a cooldown", async () => {
    turns = [{ ok: false, waitMs: 1_000, why: "cooldown_minute" }];
    expect(await sm8Request(CALL, "vendor.json", {}, { sleep })).toMatchObject({ kind: "throttled", why: "cooldown_minute" });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("with no account to count against — the connect-time read — asks straight away", async () => {
    await sm8Request({ ...CALL, meter: null }, "vendor.json", {}, { sleep });
    expect(taken).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("the request", () => {
  it("carries the bearer token, the method, the body and a timeout", async () => {
    const timeout = jest.spyOn(AbortSignal, "timeout");
    const body = new FormData();
    await sm8Request(CALL, "attachment.json", { method: "POST", body, timeoutMs: 60_000 }, { sleep });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.servicem8.com/api_1.0/attachment.json");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(body);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token-xyz");
    expect(timeout).toHaveBeenLastCalledWith(60_000);
    await sm8Request(CALL, "vendor.json", {}, { sleep });
    expect(timeout).toHaveBeenLastCalledWith(10_000);
    timeout.mockRestore();
  });

  it("passes a network error on to the caller", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    await expect(sm8Request(CALL, "vendor.json", {}, { sleep })).rejects.toThrow("ECONNRESET");
  });

  it("never writes the token to a log", async () => {
    const lines: string[] = [];
    for (const level of ["log", "info", "warn", "error"] as const) {
      jest.spyOn(console, level).mockImplementation((...m: unknown[]) => void lines.push(m.map(String).join(" ")));
    }
    fetchMock.mockResolvedValue(new Response("Number of allowed API requests per day exceeded", { status: 429 }));
    await sm8Request(CALL, "vendor.json", {}, { sleep });
    turns = [{ ok: false, waitMs: 1, why: "day" }];
    await sm8Request(CALL, "vendor.json", {}, { sleep });
    await expect(sm8Request(CALL, "https://evil.example/x")).rejects.toThrow();
    expect(lines.join("\n")).not.toContain("secret-token-xyz");
    jest.restoreAllMocks();
  });
});

describe("a 429, shared", () => {
  it("per day: every caller on the account then waits an hour, and the caller still gets the answer", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"errorCode":429,"message":"Number of allowed API requests per day exceeded"}', { status: 429 })
    );
    const answer = await sm8Request(CALL, "attachment.json", { method: "POST" }, { sleep });
    expect(answer).toMatchObject({ kind: "response", limit: "day" });
    if (answer.kind === "response") {
      expect(answer.res.status).toBe(429);
      // the body is still there for the caller to read
      expect(await answer.res.text()).toContain("per day");
    }
    expect(noted).toEqual([["v-1", "day"]]);

    // the next caller, any lane, is refused before it reaches ServiceM8
    const next = await sm8Request({ ...CALL, lane: "sync" }, "job.json", {}, { sleep });
    expect(next).toEqual({ kind: "throttled", waitMs: 3_600_000, why: "cooldown_day" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("per minute: a minute's cooldown", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Number of allowed API requests per minute exceeded", { status: 429 }));
    expect(await sm8Request(CALL, "job.json", {}, { sleep })).toMatchObject({ kind: "response", limit: "minute" });
    expect(noted).toEqual([["v-1", "minute"]]);
    expect(await sm8Request(CALL, "job.json", {}, { sleep })).toMatchObject({ kind: "throttled", why: "cooldown_minute" });
  });

  it("any other answer carries no limit", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    expect(await sm8Request(CALL, "job.json", {}, { sleep })).toMatchObject({ kind: "response", limit: null });
    expect(noted).toHaveLength(0);
  });
});

/* What a refusal asks of whoever reads it: a daily limit is a daily limit
   however little of its wait is left, so the words can't be chosen by the
   wait's length. */
describe("sm8BusyOf", () => {
  it("a counter's refusal carries its wait, and is daily for its day cap or a daily 429's cooldown", () => {
    expect(sm8BusyOf({ kind: "throttled", waitMs: 800, why: "minute" })).toEqual({ waitMs: 800, day: false });
    expect(sm8BusyOf({ kind: "throttled", waitMs: 45_000, why: "cooldown_minute" })).toEqual({ waitMs: 45_000, day: false });
    expect(sm8BusyOf({ kind: "throttled", waitMs: 3_590_000, why: "cooldown_day" })).toEqual({ waitMs: 3_590_000, day: true });
    expect(sm8BusyOf({ kind: "throttled", waitMs: 1_800_000, why: "day" })).toEqual({ waitMs: 1_800_000, day: true });
  });

  it("ServiceM8's own 429 waits the cooldown the door recorded; any other answer asks nothing", () => {
    const res = (status: number) => new Response(null, { status });
    expect(sm8BusyOf({ kind: "response", res: res(429), limit: "minute" })).toEqual({ waitMs: 60_000, day: false });
    expect(sm8BusyOf({ kind: "response", res: res(429), limit: "day" })).toEqual({ waitMs: 3_600_000, day: true });
    expect(sm8BusyOf({ kind: "response", res: res(200), limit: null })).toBeNull();
  });
});

/* A NOTE GOES AS A PERSON (two-way phase 2): the door carries ServiceM8's
   impersonation header, a JSON body and a DELETE — and nothing but a staff
   uuid ever rides in that header. */
describe("acting as a person, JSON, and DELETE", () => {
  const STAFF = "5a1b2c3d-0000-4000-8000-00000000aaaa";
  const headersOf = (i: number) => (fetchMock.mock.calls[i][1] as RequestInit).headers as Record<string, string>;

  it("sends the impersonation header only when asked", async () => {
    await sm8Request(CALL, "note.json", { method: "POST", json: { note: "x" }, impersonate: STAFF });
    expect(headersOf(0)["x-impersonate-uuid"]).toBe(STAFF);
    await sm8Request(CALL, "note.json");
    expect(headersOf(1)).toEqual({ Authorization: "Bearer secret-token-xyz" });
  });

  it("throws on a malformed impersonation value before a turn is taken or anything is fetched", async () => {
    for (const bad of ["", "not-a-uuid", `${STAFF} `, `${STAFF}\r\nX-Other: 1`, "5a1b2c3d-0000-4000-8000-00000000aaa"]) {
      await expect(sm8Request(CALL, "note.json", { method: "POST", impersonate: bad })).rejects.toThrow();
    }
    expect(taken).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends DELETE, and a JSON body with its content type", async () => {
    await sm8Request(CALL, `dbonote/${STAFF}.json`, { method: "DELETE", impersonate: STAFF });
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
    await sm8Request(CALL, "note.json", { method: "POST", json: { a: 1 } });
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("refuses a JSON body beside another body", async () => {
    await expect(sm8Request(CALL, "note.json", { method: "POST", json: {}, body: "x" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* THE SECOND BASE, PINNED (two-way phase 4, PR C). ServiceM8's webhook
   subscriptions sit beside the API, at https://api.servicem8.com/
   webhook_subscriptions (docs/webhooks-overview), and the door reaches
   exactly three of their requests: the list, subscribing an object, and
   deleting one subscription. */
describe("the webhook subscriptions", () => {
  const HOOK = { accessToken: "secret-token-xyz", meter: "v-1", lane: "hook" as const };
  const SUB = "0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0";

  const verdict = (method: "GET" | "POST" | "DELETE", path: string, query?: Record<string, string>) => {
    try {
      sm8HooksUrl(method, path, query);
      return "allowed";
    } catch {
      return "refused";
    }
  };

  it("allows the three method and path pairs", () => {
    expect(sm8HooksUrl("GET", "/webhook_subscriptions").toString()).toBe("https://api.servicem8.com/webhook_subscriptions");
    expect(sm8HooksUrl("GET", "/webhook_subscriptions", { status: "all" }).toString()).toBe(
      "https://api.servicem8.com/webhook_subscriptions?status=all"
    );
    expect(sm8HooksUrl("POST", "/webhook_subscriptions/object").toString()).toBe(
      "https://api.servicem8.com/webhook_subscriptions/object"
    );
    expect(sm8HooksUrl("DELETE", `/webhook_subscriptions/${SUB}`).toString()).toBe(
      `https://api.servicem8.com/webhook_subscriptions/${SUB}`
    );
  });

  it("refuses /event, another segment, a bad uuid, another query, ../, other hosts and credentials", () => {
    const refused: ["GET" | "POST" | "DELETE", string, Record<string, string>?][] = [
      ["POST", "/webhook_subscriptions/event"],
      ["GET", "/webhook_subscriptions/x"],
      ["GET", "/webhook_subscriptions/object"],
      ["GET", `/webhook_subscriptions/${SUB}`],
      ["DELETE", "/webhook_subscriptions/not-a-uuid"],
      ["DELETE", `/webhook_subscriptions/${SUB}/x`],
      ["DELETE", `/webhook_subscriptions/${SUB}x`],
      ["DELETE", `/webhook_subscriptions/x${SUB}`],
      ["DELETE", "/webhook_subscriptions/"],
      ["DELETE", "/webhook_subscriptions/object"],
      ["POST", "/webhook_subscriptions"],
      ["POST", `/webhook_subscriptions/${SUB}`],
      ["GET", "/webhook_subscriptions", { status: "all", x: "1" }],
      ["GET", "/webhook_subscriptions", { page: "2" }],
      ["GET", "/webhook_subscriptions", { status: "deleted" }],
      ["POST", "/webhook_subscriptions/object", { status: "all" }],
      ["GET", "/webhook_subscriptions?status=all"],
      ["GET", "/webhook_subscriptions/../api_1.0/job.json"],
      ["POST", "/webhook_subscriptions/../webhook_subscriptions/object"],
      ["GET", "webhook_subscriptions"],
      ["GET", "https://evil.example/webhook_subscriptions"],
      ["GET", "//evil.example/webhook_subscriptions"],
      ["GET", "https://api.servicem8.com/webhook_subscriptions"],
      ["GET", "https://user:pass@api.servicem8.com/webhook_subscriptions"],
      ["GET", "/api_1.0/job.json"],
      ["GET", "/webhook_subscriptions#x"],
    ];
    for (const [method, path, query] of refused) {
      expect([method, path, query, verdict(method, path, query)]).toEqual([method, path, query, "refused"]);
    }
  });

  it("the door refuses them before a turn is taken or anything is fetched", async () => {
    await expect(sm8Request(HOOK, "/webhook_subscriptions/event", { api: "hooks", method: "POST" })).rejects.toThrow();
    await expect(sm8Request(HOOK, "/webhook_subscriptions/not-a-uuid", { api: "hooks", method: "DELETE" })).rejects.toThrow();
    // and the REST base never reaches them
    await expect(sm8Request(HOOK, "/webhook_subscriptions")).rejects.toThrow();
    await expect(sm8Request(HOOK, "../webhook_subscriptions")).rejects.toThrow();
    expect(taken).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("are asked for on the hook lane only, always counted", async () => {
    await expect(sm8Request({ ...HOOK, lane: "read" }, "/webhook_subscriptions", { api: "hooks" })).rejects.toThrow();
    await expect(sm8Request({ ...HOOK, meter: null }, "/webhook_subscriptions", { api: "hooks" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    await sm8Request(HOOK, "/webhook_subscriptions", { api: "hooks", query: { status: "all" } }, { sleep });
    expect(taken).toEqual([["v-1", "hook"]]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.servicem8.com/webhook_subscriptions?status=all");
  });

  it("subscribes form-encoded, waiting 25 s; the list and a delete wait 10 s", async () => {
    const timeout = jest.spyOn(AbortSignal, "timeout");
    const body = new URLSearchParams({ object: "job", fields: "status,active", callback_url: "https://app.test/x" });
    await sm8Request(HOOK, "/webhook_subscriptions/object", { api: "hooks", method: "POST", body }, { sleep });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(body);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(timeout).toHaveBeenLastCalledWith(25_000);
    // a longer wait asked for is capped
    await sm8Request(HOOK, "/webhook_subscriptions/object", { api: "hooks", method: "POST", body, timeoutMs: 90_000 }, { sleep });
    expect(timeout).toHaveBeenLastCalledWith(25_000);
    await sm8Request(HOOK, "/webhook_subscriptions", { api: "hooks" }, { sleep });
    expect(timeout).toHaveBeenLastCalledWith(10_000);
    await sm8Request(HOOK, `/webhook_subscriptions/${SUB}`, { api: "hooks", method: "DELETE" }, { sleep });
    expect((fetchMock.mock.calls[3][1] as RequestInit).method).toBe("DELETE");
    expect(timeout).toHaveBeenLastCalledWith(10_000);
    timeout.mockRestore();
  });

  it("a list or a delete carries no body; only the subscribing POST does", async () => {
    const body = new URLSearchParams({ object: "job" });
    await expect(sm8Request(HOOK, "/webhook_subscriptions", { api: "hooks", body })).rejects.toThrow();
    await expect(sm8Request(HOOK, `/webhook_subscriptions/${SUB}`, { api: "hooks", method: "DELETE", body })).rejects.toThrow();
    expect(taken).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the hook lane never writes to the API's records: a read only", async () => {
    for (const method of ["POST", "DELETE"] as const) {
      await expect(sm8Request(HOOK, "job.json", { method, body: "x" })).rejects.toThrow();
      await expect(sm8Request(HOOK, `note/${SUB}.json`, { method })).rejects.toThrow();
    }
    expect(taken).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    await sm8Request(HOOK, "job.json", { query: { $filter: `uuid eq '${SUB}'` } }, { sleep });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("carries no JSON body and acts as nobody", async () => {
    await expect(
      sm8Request(HOOK, "/webhook_subscriptions/object", { api: "hooks", method: "POST", json: { object: "job" } })
    ).rejects.toThrow();
    await expect(
      sm8Request(HOOK, "/webhook_subscriptions", { api: "hooks", impersonate: "5a1b2c3d-0000-4000-8000-00000000aaaa" })
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
