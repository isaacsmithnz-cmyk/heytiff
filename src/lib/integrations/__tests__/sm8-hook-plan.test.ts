/**
 * @jest-environment node
 */

/* Live updates from ServiceM8 (two-way phase 4): the pure decisions. Which
   records can ping, how a ping is read, which listed subscriptions are
   ours and what a reconcile does about them, how healthy they are, and how
   long a lease holder may go on. Every name and uuid here is made up. */

import {
  classifyOurs,
  drainEnd,
  fitsLease,
  FUNCTION_MARGIN_MS,
  functionDeadline,
  HOOK_LEASE_MS,
  HOOK_METER_WAIT_MS,
  HOOK_OBJECT_NAMES,
  HOOK_OBJECTS,
  HOOK_PATH,
  HOOK_READ_TIMEOUT_MS,
  HOOK_WRITE_MARGIN_MS,
  hookFieldsFor,
  hookHashOf,
  hookObjectOf,
  hookSpecOf,
  isHookSecret,
  isUnsupportedObject,
  normaliseHookObject,
  ourSecretIn,
  parsePing,
  planSubscriptions,
  quietStampFrom,
  readFits,
  READ_NEED_MS,
  readHookList,
  readHookObjects,
  redactHook,
  ROUTE_DRAIN_MS,
  BACKSTOP_DRAIN_MS,
  sm8HooksHealth,
  spellingsFor,
  type HookObjectName,
  type HookObjectsState,
  type HookSub,
} from "../sm8-hook-plan";
import { SM8_OBJECTS } from "../sm8-sync-plan";

const ORIGIN = "https://app.tiff-example.test";
const SECRET = "Qx7_k-2mZpL9vR4tY8wE1nB6cJ3hF5gD0aS2dK7uV9o"; // 43, made up
const RETIRED = "Rr7_k-2mZpL9vR4tY8wE1nB6cJ3hF5gD0aS2dK7uV9o";
const STRANGER = "Zz7_k-2mZpL9vR4tY8wE1nB6cJ3hF5gD0aS2dK7uV9o";
const U1 = "4c1f0b2a-7d3e-4f60-9a8b-1c2d3e4f5a61";
const U2 = "4c1f0b2a-7d3e-4f60-9a8b-1c2d3e4f5a62";

const q = (s = "") => new URLSearchParams(s);
const urlOf = (secret: string, origin = ORIGIN) => `${origin}${HOOK_PATH}${secret}`;
const hashes = { current: hookHashOf(SECRET), retired: [hookHashOf(RETIRED)] };
const WANTED = Object.fromEntries(HOOK_OBJECT_NAMES.map((o) => [o, hookFieldsFor(hookSpecOf(o))])) as Record<
  HookObjectName,
  string[]
>;
const firstSpelling = (o: HookObjectName) => HOOK_OBJECTS.find((h) => h.object === o)!.spellings[0];

let n = 0;
function sub(over: Partial<HookSub> & { hookObject?: HookObjectName } = {}): HookSub {
  const { hookObject = "jobs", ...rest } = over;
  n += 1;
  return {
    uuid: `9a9a9a9a-0000-4000-8000-${String(n).padStart(12, "0")}`,
    type: "object",
    object: firstSpelling(hookObject),
    callbackUrl: urlOf(SECRET),
    fields: [...WANTED[hookObject]],
    active: true,
    lastFailureReason: null,
    lastFailureAt: null,
    ...rest,
  };
}
const allSix = () => HOOK_OBJECT_NAMES.map((o) => sub({ hookObject: o }));

describe("which records can ping", () => {
  it("are six mirrored objects, each first spelled as its own endpoint", () => {
    expect([...HOOK_OBJECT_NAMES].sort()).toEqual(
      ["attachments", "companies", "job_activities", "job_notes", "job_payments", "jobs"].sort()
    );
    for (const o of HOOK_OBJECT_NAMES) expect(`${firstSpelling(o)}.json`).toBe(hookSpecOf(o).endpoint);
  });

  it("normalise a name as a ping may spell it", () => {
    expect(normaliseHookObject("Job")).toBe("job");
    expect(normaliseHookObject("job_activity")).toBe("jobactivity");
    expect(normaliseHookObject("Job Activity")).toBe("jobactivity");
    expect(normaliseHookObject("")).toBeNull();
    expect(normaliseHookObject(7)).toBeNull();
    expect(normaliseHookObject("x".repeat(65))).toBeNull();
    expect(hookObjectOf("JobActivity")).toBe("job_activities");
    expect(hookObjectOf("job_payment")).toBe("job_payments");
    expect(hookObjectOf("Note")).toBe("job_notes");
    expect(hookObjectOf("staff")).toBeNull();
    expect(hookObjectOf("Material")).toBeNull();
  });

  it("try the spelling that worked first, then the rest in order", () => {
    expect(spellingsFor("job_activities")).toEqual(["jobactivity", "JobActivity", "job_activity"]);
    expect(spellingsFor("job_activities", "JobActivity")).toEqual(["JobActivity", "jobactivity", "job_activity"]);
    expect(spellingsFor("jobs", "Potato")).toEqual(["job", "Job"]);
    expect(isUnsupportedObject(400, '{"success":false,"message":"Object Potato does not support subscription"}')).toBe(true);
    expect(isUnsupportedObject(403, "does not support subscription")).toBe(false);
    expect(isUnsupportedObject(400, "fields is required")).toBe(false);
  });

  it("watch every mirrored column but uuid and edit_date, with active", () => {
    for (const o of HOOK_OBJECT_NAMES) {
      const fields = hookFieldsFor(hookSpecOf(o));
      expect(fields).toContain("active");
      expect(fields).not.toContain("uuid");
      expect(fields).not.toContain("edit_date");
      expect(fields.length).toBeGreaterThan(1);
    }
    expect(hookFieldsFor(hookSpecOf("job_activities")).sort()).toEqual(
      ["active", "activity_was_scheduled", "end_date", "job_uuid", "staff_uuid", "start_date"].sort()
    );
    // and one mirror spec per hook object
    for (const o of HOOK_OBJECT_NAMES) expect(SM8_OBJECTS.some((s) => s.object === o)).toBe(true);
  });
});

describe("reading a ping", () => {
  const body = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      object: "job",
      entry: [{ changed_fields: ["status"], time: "2026-09-28 01:02:03", uuid: U1 }],
      resource_url: `https://api.servicem8.com/api_1.0/job/${U1}.json`,
      ...over,
    });

  it("takes a challenge by GET, form and JSON", () => {
    expect(parsePing(null, "", q("mode=subscribe&challenge=abc123"))).toEqual({ kind: "challenge", challenge: "abc123", via: "query" });
    expect(parsePing("application/x-www-form-urlencoded", "mode=subscribe&challenge=xyz", q())).toEqual({
      kind: "challenge",
      challenge: "xyz",
      via: "form",
    });
    expect(parsePing("application/json", JSON.stringify({ mode: "subscribe", challenge: "j-1" }), q())).toEqual({
      kind: "challenge",
      challenge: "j-1",
      via: "json",
    });
  });

  it("refuses a challenge of 257 characters, or one with a control character, saying only its length", () => {
    expect(parsePing(null, "", q(`mode=subscribe&challenge=${"a".repeat(256)}`))).toMatchObject({ kind: "challenge" });
    expect(parsePing(null, "", q(`mode=subscribe&challenge=${"a".repeat(257)}`))).toEqual({ kind: "junk", challengeLength: 257 });
    expect(parsePing(null, "", q("mode=subscribe&challenge=a%0Ab"))).toEqual({ kind: "junk", challengeLength: 3 });
    expect(parsePing(null, "", q("mode=subscribe&challenge=a%20b"))).toEqual({ kind: "junk", challengeLength: 3 });
    expect(parsePing(null, "", q("mode=other&challenge=abc"))).toEqual({ kind: "junk" });
  });

  it("reads raw JSON, a JSON text body, and one form field holding it", () => {
    const want = { kind: "change", object: "jobs", uuids: [U1] };
    expect(parsePing("application/json; charset=utf-8", body(), q())).toEqual({ ...want, body: "json" });
    expect(parsePing("text/plain", body(), q())).toEqual({ ...want, body: "json_text" });
    expect(parsePing(null, body(), q())).toEqual({ ...want, body: "json_text" });
    const form = new URLSearchParams({ data: body() }).toString();
    expect(parsePing("application/x-www-form-urlencoded", form, q())).toEqual({ ...want, body: "form" });
  });

  it("lowercases and de-duplicates the uuids, keeps the first ten, and drops a bad one", () => {
    const entry = [U1.toUpperCase(), U1, "not-a-uuid", U2, ...Array.from({ length: 10 }, (_, i) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`)].map(
      (uuid) => ({ uuid })
    );
    const p = parsePing("application/json", body({ entry }), q());
    expect(p.kind).toBe("change");
    if (p.kind !== "change") return;
    expect(p.uuids).toHaveLength(10);
    expect(p.uuids[0]).toBe(U1);
    expect(p.uuids[1]).toBe(U2);
    expect(p.uuids).not.toContain("not-a-uuid");
    expect(p.uuids.every((u) => u === u.toLowerCase())).toBe(true);
    expect(new Set(p.uuids).size).toBe(10);
  });

  it("is junk with no usable uuid, no object, bad JSON or an oversized body", () => {
    expect(parsePing("application/json", body({ entry: [{ uuid: "x" }] }), q())).toEqual({ kind: "junk" });
    expect(parsePing("application/json", body({ entry: "nope" }), q())).toEqual({ kind: "junk" });
    expect(parsePing("application/json", body({ object: null }), q())).toEqual({ kind: "junk" });
    expect(parsePing("application/json", "{not json", q())).toEqual({ kind: "junk" });
    expect(parsePing("application/json", "[1,2]", q())).toEqual({ kind: "junk" });
    expect(parsePing(null, "", q())).toEqual({ kind: "junk" });
    expect(parsePing("application/json", body({ pad: "x".repeat(17_000) }), q())).toEqual({ kind: "junk" });
  });

  it("normalises the object, and ignores one we don't mirror", () => {
    expect(parsePing("application/json", body({ object: "Job" }), q())).toMatchObject({ kind: "change", object: "jobs" });
    expect(parsePing("application/json", body({ object: "job_activity" }), q())).toMatchObject({
      kind: "change",
      object: "job_activities",
    });
    expect(parsePing("application/json", body({ object: "Material" }), q())).toEqual({ kind: "ignored", body: "json" });
  });

  it("reads two pings identical but for a hostile resource_url, time and changed_fields as the same", () => {
    const plain = parsePing("application/json", body(), q());
    const hostile = parsePing(
      "application/json",
      body({
        resource_url: "https://attacker.example/steal?token=1",
        entry: [{ uuid: U1, time: "1999-01-01 00:00:00", changed_fields: ["<script>"] }],
      }),
      q()
    );
    expect(hostile).toEqual(plain);
    expect(JSON.stringify(hostile)).not.toContain("attacker");
  });
});

describe("which subscriptions are ours", () => {
  it("reads ServiceM8's list defensively", () => {
    const list = readHookList([
      {
        uuid: "ccf2f8d5-0000-4000-8000-000000000001",
        type: "object",
        object: "job",
        callback_url: urlOf(SECRET),
        fields: ["status", 3],
        active: false,
        last_failure_reason: "Webhook request failed for over 12 hours",
        last_failure_at: "2026-04-14 03:25:00",
      },
      { uuid: "e1", type: "event", event: "job.created", callback_url: "https://x.test/h", active: true },
      { type: "object", callback_url: "https://x.test/h" },
      "junk",
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      uuid: "ccf2f8d5-0000-4000-8000-000000000001",
      type: "object",
      object: "job",
      callbackUrl: urlOf(SECRET),
      fields: ["status"],
      active: false,
      lastFailureReason: "Webhook request failed for over 12 hours",
      lastFailureAt: "2026-04-14 03:25:00",
    });
    expect(list[1].object).toBeNull();
    expect(readHookList({ nope: 1 })).toEqual([]);
  });

  it("are at our parsed origin and path, never another origin or path", () => {
    expect(ourSecretIn(urlOf(SECRET), ORIGIN)).toBe(SECRET);
    expect(ourSecretIn(urlOf(SECRET), `${ORIGIN}/`)).toBe(SECRET);
    // an origin that merely starts like ours
    expect(ourSecretIn(`${ORIGIN}.evil.example${HOOK_PATH}${SECRET}`, ORIGIN)).toBeNull();
    expect(ourSecretIn(`${ORIGIN}:8443${HOOK_PATH}${SECRET}`, ORIGIN)).toBeNull();
    expect(ourSecretIn(urlOf(SECRET, "http://app.tiff-example.test"), ORIGIN)).toBeNull();
    expect(ourSecretIn(`https://user:pw@app.tiff-example.test${HOOK_PATH}${SECRET}`, ORIGIN)).toBeNull();
    // another path, or more after ours
    expect(ourSecretIn(`${ORIGIN}/api/integrations/servicem8/webhooks/${SECRET}`, ORIGIN)).toBeNull();
    expect(ourSecretIn(`${ORIGIN}${HOOK_PATH}${SECRET}/more`, ORIGIN)).toBeNull();
    expect(ourSecretIn(`${ORIGIN}/elsewhere${HOOK_PATH}${SECRET}`, ORIGIN)).toBeNull();
    expect(ourSecretIn(`${ORIGIN}${HOOK_PATH}${SECRET}?x=1`, ORIGIN)).toBeNull();
    expect(ourSecretIn(`${ORIGIN}${HOOK_PATH}short`, ORIGIN)).toBeNull();
    expect(ourSecretIn("not a url", ORIGIN)).toBeNull();
  });

  it("classifies ours by the hash of the address's tail: current, retired or dead", () => {
    const subs = [
      sub({ callbackUrl: urlOf(SECRET) }),
      sub({ callbackUrl: urlOf(RETIRED) }),
      sub({ callbackUrl: urlOf(STRANGER) }),
      sub({ callbackUrl: `https://someone-else.test/hooks/JobChanged` }),
      sub({ callbackUrl: urlOf(SECRET, "https://app.tiff-example.test.evil.example") }),
      { ...sub(), type: "event", object: null },
    ];
    const ours = classifyOurs(subs, ORIGIN, hashes);
    expect(ours.map((s) => s.age)).toEqual(["current", "retired", "dead"]);
    expect(ours.every((s) => s.hookObject === "jobs")).toBe(true);
    expect(classifyOurs(subs, ORIGIN, { current: null, retired: [] }).map((s) => s.age)).toEqual(["dead", "dead", "dead"]);
  });

  it("knows a secret's shape and hashes it as hex", () => {
    expect(isHookSecret(SECRET)).toBe(true);
    expect(isHookSecret(`${SECRET}x`)).toBe(false);
    expect(isHookSecret("a/b".padEnd(43, "c"))).toBe(false);
    expect(hookHashOf(SECRET)).toMatch(/^[0-9a-f]{64}$/);
    expect(hookHashOf(SECRET)).not.toBe(hookHashOf(RETIRED));
  });
});

describe("what a reconcile does", () => {
  const plan = (subs: HookSub[], h = hashes) => planSubscriptions({ subs, origin: ORIGIN, hashes: h, wanted: WANTED });

  it("POSTs every object with nothing listed, and deletes nothing", () => {
    expect(plan([])).toEqual({ post: [...HOOK_OBJECT_NAMES], deactivated: [], del: [] });
  });

  it("is empty when all six are active at the current address", () => {
    expect(plan(allSix())).toEqual({ post: [], deactivated: [], del: [] });
  });

  it("never touches another origin's or another path's entry, active or not", () => {
    const foreign = [
      sub({ callbackUrl: "https://someone-else.test/hooks/JobChanged" }),
      sub({ callbackUrl: `${ORIGIN}/api/other/${SECRET}` }),
      sub({ callbackUrl: urlOf(STRANGER, "https://app.tiff-example.test.evil.example") }),
    ];
    const p = plan([...allSix(), ...foreign]);
    expect(p).toEqual({ post: [], deactivated: [], del: [] });
  });

  it("deletes a dead hash at our path only while it is active", () => {
    const live = sub({ callbackUrl: urlOf(STRANGER) });
    const gone = sub({ callbackUrl: urlOf(STRANGER), active: false });
    expect(plan([...allSix(), live, gone]).del).toEqual([live.uuid]);
  });

  it("deletes an active retired entry, and ignores an inactive one (our own delete)", () => {
    const retiredLive = sub({ callbackUrl: urlOf(RETIRED) });
    const retiredGone = sub({ callbackUrl: urlOf(RETIRED), active: false, lastFailureReason: "Webhook request failed for over 12 hours" });
    const p = plan([...allSix(), retiredLive, retiredGone]);
    expect(p.del).toEqual([retiredLive.uuid]);
    expect(p.deactivated).toEqual([]);
    expect(p.post).toEqual([]);
  });

  it("deletes an active entry of ours for an object we don't want", () => {
    const material = { ...sub(), object: "material" };
    expect(plan([...allSix(), material]).del).toEqual([material.uuid]);
  });

  it("re-POSTs a deactivated entry — inactive, current, with a reason — and records the reason first", () => {
    const six = allSix();
    const notes = six.find((s) => s.object === "note")!;
    notes.active = false;
    notes.lastFailureReason = "Webhook request failed for over 12 hours";
    notes.lastFailureAt = "2026-09-20 03:25:00";
    const p = plan(six);
    expect(p.post).toEqual(["job_notes"]);
    expect(p.deactivated).toEqual([
      { object: "job_notes", sub: notes.uuid, reason: "Webhook request failed for over 12 hours", at: "2026-09-20 03:25:00" },
    ]);
    expect(p.del).toEqual([]);
  });

  it("re-POSTs an entry watching narrower fields than we want", () => {
    const six = allSix();
    six.find((s) => s.object === "job")!.fields = ["status"];
    expect(plan(six).post).toEqual(["jobs"]);
  });

  it("re-POSTs every object when the current hash isn't listed (a rotation), and deletes the old ones after", () => {
    const old = HOOK_OBJECT_NAMES.map((o) => sub({ hookObject: o, callbackUrl: urlOf(RETIRED) }));
    const first = plan(old);
    expect(first.post).toEqual([...HOOK_OBJECT_NAMES]);
    expect(first.del.sort()).toEqual(old.map((s) => s.uuid).sort());
  });

  it("finds nothing to do when run again over the state it leads to", () => {
    const retiredLive = sub({ callbackUrl: urlOf(RETIRED) });
    const dead = sub({ callbackUrl: urlOf(STRANGER), hookObject: "attachments" });
    const narrow = sub({ hookObject: "companies", fields: ["name"] });
    const before = [...allSix().filter((s) => s.object !== "company"), narrow, retiredLive, dead];
    const p = plan(before);
    expect(p.post).toEqual(["companies"]);
    expect(p.del.sort()).toEqual([retiredLive.uuid, dead.uuid].sort());
    // after: the POST widened companies in place, and the DELETEs deactivated
    const after = before.map((s) =>
      s === narrow ? { ...s, fields: [...WANTED.companies] } : p.del.includes(s.uuid) ? { ...s, active: false } : s
    );
    expect(plan(after)).toEqual({ post: [], deactivated: [], del: [] });
  });
});

describe("keeping an address out of what is stored", () => {
  it("redacts a body echoing our address, plain, JSON-escaped or form-encoded", () => {
    const plain = `callback_url ${urlOf(SECRET)} is unreachable`;
    expect(redactHook(plain)).toBe(`callback_url ${ORIGIN}${HOOK_PATH}[hook] is unreachable`);
    const escaped = JSON.stringify({ message: `bad ${urlOf(SECRET)}` }).replace(/\//g, "\\/");
    expect(redactHook(escaped)).not.toContain(SECRET);
    expect(redactHook(escaped)).toContain("webhook\\/[hook]");
    const encoded = encodeURIComponent(urlOf(SECRET));
    expect(redactHook(encoded)).not.toContain(SECRET);
    expect(redactHook(`only the tail: ${SECRET}`, [SECRET])).toBe("only the tail: [hook]");
    expect(redactHook("Object Potato does not support subscription")).toBe("Object Potato does not support subscription");
  });

  it("reads the stored per-object state defensively, redacting any error", () => {
    const got = readHookObjects({
      jobs: { name: "job", sub: "s-1", active: true, new: 2, changed: 5, url: urlOf(SECRET) },
      job_notes: { active: false, failure_reason: "Webhook request failed for over 12 hours", failure_at: "2026-09-20 03:25:00" },
      companies: { error: `refused ${urlOf(SECRET)}` },
      staff: { active: true },
    });
    expect(got).toEqual({
      jobs: { name: "job", sub: "s-1", active: true, new: 2, changed: 5 },
      job_notes: { active: false, failure_reason: "Webhook request failed for over 12 hours", failure_at: "2026-09-20 03:25:00" },
      companies: { error: `refused ${ORIGIN}${HOOK_PATH}[hook]` },
    });
    expect(JSON.stringify(got)).not.toContain(SECRET);
    expect(readHookObjects(null)).toEqual({});
  });
});

describe("how healthy live updates are", () => {
  const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);
  const H = 3_600_000;
  const allActive = (): HookObjectsState =>
    Object.fromEntries(HOOK_OBJECT_NAMES.map((o) => [o, { active: true, name: firstSpelling(o) }])) as HookObjectsState;
  const health = (over: Partial<Parameters<typeof sm8HooksHealth>[0]> = {}) =>
    sm8HooksHealth({ objects: allActive(), subscribedAt: NOW - 48 * H, lastPingAt: NOW - H, editedSince: 0, now: NOW, ...over });

  it("is ok with six active and a recent ping", () => {
    expect(health()).toEqual({ state: "ok" });
  });

  it("is none with nothing subscribed", () => {
    expect(health({ objects: {} })).toEqual({ state: "none" });
    expect(health({ objects: { jobs: { active: false } } })).toEqual({ state: "none" });
  });

  it("is partial with fewer than six active, or a refusal recorded", () => {
    const five = allActive();
    delete five.attachments;
    expect(health({ objects: five })).toEqual({ state: "partial", missing: ["attachments"], errors: [] });
    const refused = allActive();
    refused.job_payments = { active: true, error: "403" };
    expect(health({ objects: refused })).toEqual({ state: "partial", missing: [], errors: ["job_payments"] });
  });

  it("is deactivated when ServiceM8 turned one off and said why, ahead of partial and none", () => {
    const off = allActive();
    off.job_notes = { active: false, failure_reason: "Webhook request failed for over 12 hours", failure_at: "2026-09-20 03:25:00" };
    expect(health({ objects: off })).toEqual({
      state: "deactivated",
      object: "job_notes",
      reason: "Webhook request failed for over 12 hours",
      at: "2026-09-20 03:25:00",
    });
    const allOff = Object.fromEntries(HOOK_OBJECT_NAMES.map((o) => [o, { active: false, failure_reason: "x" }]));
    expect(health({ objects: allOff }).state).toBe("deactivated");
  });

  it("is quiet only past 24 hours with at least 10 edits since", () => {
    expect(health({ lastPingAt: NOW - 25 * H, editedSince: 10 })).toEqual({ state: "quiet", since: NOW - 25 * H });
    expect(health({ lastPingAt: NOW - 23 * H, editedSince: 10 })).toEqual({ state: "ok" });
    expect(health({ lastPingAt: NOW - 25 * H, editedSince: 9 })).toEqual({ state: "ok" });
    expect(health({ lastPingAt: NOW - 24 * H, editedSince: 50 })).toEqual({ state: "ok" });
    expect(health({ lastPingAt: NOW - 25 * H, editedSince: null })).toEqual({ state: "ok" });
    // never pinged: counted from the subscribing
    expect(health({ lastPingAt: null, subscribedAt: NOW - 25 * H, editedSince: 10 })).toEqual({ state: "quiet", since: NOW - 25 * H });
    expect(health({ lastPingAt: null, subscribedAt: NOW - 23 * H, editedSince: 10 })).toEqual({ state: "ok" });
  });

  it("counts edits from ten minutes after the last ping, in the account's clock", () => {
    // 01:00 UTC is 11:00 in Sydney in September (AEST, +10)
    expect(quietStampFrom(Date.UTC(2026, 8, 28, 1, 0, 0), "Australia/Sydney")).toBe("2026-09-28 11:10:00");
    expect(quietStampFrom(0, "Not/AZone")).toBeNull();
  });
});

describe("budgets, from the function's own deadline", () => {
  it("needs 15 s for a read: its timeout, the hook lane's longest wait and the write", () => {
    expect(READ_NEED_MS).toBe(HOOK_READ_TIMEOUT_MS + HOOK_METER_WAIT_MS + HOOK_WRITE_MARGIN_MS);
    expect(READ_NEED_MS).toBe(15_000);
  });

  it("moves every end with the route's maxDuration", () => {
    const start = 1_000_000;
    expect(functionDeadline(start, 300)).toBe(start + 300_000 - FUNCTION_MARGIN_MS);
    expect(functionDeadline(start, 60)).toBe(start + 40_000);
    expect(drainEnd(start, 300, ROUTE_DRAIN_MS)).toBe(start + 120_000);
    // a shorter function shortens the drain, whatever its own budget says
    expect(drainEnd(start, 60, ROUTE_DRAIN_MS)).toBe(start + 40_000);
    expect(drainEnd(start, 120, ROUTE_DRAIN_MS)).toBe(start + 100_000);
    expect(drainEnd(start, 300, BACKSTOP_DRAIN_MS)).toBe(start + 20_000);
    // a lease fits a 300 s function late in its life, and a 60 s one barely
    expect(fitsLease(start + 235_000, HOOK_LEASE_MS, functionDeadline(start, 300))).toBe(true);
    expect(fitsLease(start + 235_001, HOOK_LEASE_MS, functionDeadline(start, 300))).toBe(false);
    expect(fitsLease(start, HOOK_LEASE_MS, functionDeadline(start, 60))).toBe(false);
  });

  it("claims a lease only when 45 s fit before the deadline", () => {
    expect(fitsLease(0, HOOK_LEASE_MS, 45_000)).toBe(true);
    expect(fitsLease(1, HOOK_LEASE_MS, 45_000)).toBe(false);
  });

  it("reads only with 15 s of lease left, and a read only while it fits the budget", () => {
    expect(readFits(115_000, 100_000)).toBe(true);
    expect(readFits(114_999, 100_000)).toBe(false);
    expect(fitsLease(100_000, READ_NEED_MS, 115_000)).toBe(true);
    expect(fitsLease(100_001, READ_NEED_MS, 115_000)).toBe(false);
  });
});
