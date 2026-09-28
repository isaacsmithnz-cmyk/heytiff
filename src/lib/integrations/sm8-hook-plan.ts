/* Live updates from ServiceM8 (two-way phase 4, webhooks) — the decisions,
   pure.

   sm8-sync-plan's and sm8-write-plan's sibling. Everything here is a
   function of its arguments, so the rules are pinned in a test with no
   network and no database: which records can ping, how a ping is read,
   which subscriptions are ours and what to do about them, how healthy they
   are, and how long each holder of the sync lease may go on. The route,
   the drain and the subscriber carry these out (later PRs); none of them
   runs unless sm8-hooks-switch says `on`.

   A PING IS A DOORBELL, NEVER DATA. ServiceM8 POSTs
   {object, entry:[{uuid, changed_fields, time}], resource_url} and says the
   values aren't in it ("updates only indicate that a particular field has
   changed … you will need to use the REST API to retrieve the record",
   docs/webhooks-overview). So only two things are read from it: the object
   (normalised, and checked against the six we mirror) and the entries'
   uuids (pattern-checked, lowercased, at most ten). `resource_url`, `time`
   and `changed_fields` have no field in what parsePing returns: the record
   is fetched through the one door (sm8-http), and its own edit_date orders
   it, under the keep-newer guard.

   THE SECRET RIDES IN THE ADDRESS, and is never stored, logged or kept in
   any JSON. What the database holds is its SHA-256 (sm8_webhook_hooks);
   which of ServiceM8's listed subscriptions are ours is decided by hashing
   the address's last segment, on OUR origin and OUR path only, parsed —
   never by a prefix of the string. */

import { createHash } from "node:crypto";
import { SM8_OBJECTS, sm8LocalStamp, type Sm8ObjectName, type Sm8ObjectSpec } from "./sm8-sync-plan";

/* ── which records can ping ── */

/** The six mirrored objects ServiceM8 lets us subscribe to ("Job Activity,
    Job, Job Payment, Note, Task, Material, Company, Attachment, Form
    Response", docs/webhooks-overview), each with the names tried in order
    when subscribing. The first is the endpoint's own name ("Objects are the
    same as API Endpoints", docs/manifest-reference); the rest are tried on
    "does not support subscription" and the one that worked is recorded.
    Staff, contacts, checklists, job materials, categories and queues can't
    be subscribed and stay on the syncs. */
export const HOOK_OBJECTS = [
  { object: "jobs", spellings: ["job", "Job"] },
  { object: "job_activities", spellings: ["jobactivity", "JobActivity", "job_activity"] },
  { object: "job_payments", spellings: ["jobpayment", "JobPayment", "job_payment"] },
  { object: "job_notes", spellings: ["note", "Note"] },
  { object: "companies", spellings: ["company", "Company"] },
  { object: "attachments", spellings: ["attachment", "Attachment"] },
] as const satisfies readonly { object: Sm8ObjectName; spellings: readonly string[] }[];

export type HookObjectName = (typeof HOOK_OBJECTS)[number]["object"];

export const HOOK_OBJECT_NAMES: readonly HookObjectName[] = HOOK_OBJECTS.map((h) => h.object);

export function isHookObject(v: unknown): v is HookObjectName {
  return typeof v === "string" && (HOOK_OBJECT_NAMES as readonly string[]).includes(v);
}

/** The sync's own spec for a hook object: its endpoint, table and shape. */
export function hookSpecOf(object: HookObjectName): Sm8ObjectSpec {
  const spec = SM8_OBJECTS.find((s) => s.object === object);
  if (!spec) throw new Error(`sm8-hook-plan: no mirror spec for ${object}`);
  return spec;
}

/** An object's name as a ping or a listing may spell it, made comparable:
    lowercased, underscores and spaces removed (`Job` → `job`,
    `job_activity` → `jobactivity`). Null for anything that isn't a short
    string. */
export function normaliseHookObject(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0 || v.length > 64) return null;
  const n = v.toLowerCase().replace(/[_\s]/g, "");
  return n === "" ? null : n;
}

/** The mirror object a ServiceM8 name means, in any of its spellings. */
export function hookObjectOf(v: unknown): HookObjectName | null {
  const n = normaliseHookObject(v);
  if (n === null) return null;
  for (const h of HOOK_OBJECTS) {
    if (h.spellings.some((s) => normaliseHookObject(s) === n)) return h.object;
  }
  return null;
}

/** The names to try when subscribing `object`, the one that worked last
    time first. */
export function spellingsFor(object: HookObjectName, worked?: string | null): string[] {
  const all: string[] = [...HOOK_OBJECTS.find((h) => h.object === object)!.spellings];
  return worked && all.includes(worked) ? [worked, ...all.filter((s) => s !== worked)] : all;
}

/** ServiceM8's 400 for a name it doesn't subscribe ("Object Potato does not
    support subscription", reference/post_object_webhook_subscription): the
    next spelling is tried. */
export function isUnsupportedObject(status: number, body: string): boolean {
  return status === 400 && /does not support subscription/i.test(body);
}

/** The fields to watch: every column the mirror keeps for the object, as
    ServiceM8 names them (the shapes pick raw fields by their own names),
    without `uuid` and `edit_date` — which change with everything — and
    with `active`, so a removal pings. */
export function hookFieldsFor(spec: Sm8ObjectSpec): string[] {
  const keys = Object.keys(spec.shape({ uuid: "00000000-0000-4000-8000-000000000000" }) ?? {});
  const fields = keys.filter((k) => k !== "uuid" && k !== "edit_date");
  if (!fields.includes("active")) fields.push("active");
  return fields;
}

/* ── the address ── */

/** Where ServiceM8 sends pings; the secret follows it. */
export const HOOK_PATH = "/api/integrations/servicem8/webhook/";

/** 32 random bytes as base64url: exactly 43 characters. */
export const HOOK_SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

export function isHookSecret(v: unknown): v is string {
  return typeof v === "string" && HOOK_SECRET_RE.test(v);
}

/** The secret's SHA-256, hex: the only form of it the database holds. */
export function hookHashOf(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** A ServiceM8 message with any hook address in it made safe to keep: the
    43 characters after `webhook/` (plain, JSON-escaped `\/` or
    form-encoded `%2F`) become `[hook]`, and so does any secret the caller
    names wherever it appears. For the error bodies a subscription answer
    carries — which may echo the callback_url we sent. */
export function redactHook(text: string, secrets: readonly string[] = []): string {
  let out = text.replace(/webhook(\\?\/|%2F)[A-Za-z0-9_-]{43,}/gi, (_m, sep: string) => `webhook${sep}[hook]`);
  for (const s of secrets) if (s.length > 0) out = out.split(s).join("[hook]");
  return out;
}

/* ── reading a ping ── */

/** A body larger than this many BYTES (UTF-8) is never read: a real ping
    is a few hundred. */
export const PING_BODY_MAX = 16_384;

/** A ping names one record ("The entry parameter is an array which contains
    a single object"); ten is the most we take from one, whatever it says. */
export const PING_UUIDS_MAX = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Printable ASCII, no spaces, at most 256: what we will echo back. */
const CHALLENGE_RE = /^[\x21-\x7e]{1,256}$/;

/** How the body came: JSON, JSON sent as text, or a form field holding it.
    Logged, so the walk settles which ServiceM8 uses (the docs say both). */
export type PingBodyKind = "json" | "json_text" | "form";

export type Ping =
  | { kind: "challenge"; challenge: string; via: "query" | "form" | "json" }
  /** No field for resource_url, time or changed_fields: see the header. */
  | { kind: "change"; object: HookObjectName; uuids: string[]; body: PingBodyKind }
  /** A well-formed change for an object we don't mirror. */
  | { kind: "ignored"; body: PingBodyKind }
  /** Anything else. `challengeLength` is set for a challenge refused — the
      only thing about it that is logged. */
  | { kind: "junk"; challengeLength?: number };

type Params = { get(name: string): string | null };

function challengeOf(mode: unknown, challenge: unknown, via: "query" | "form" | "json"): Ping | null {
  if (mode !== "subscribe" || typeof challenge !== "string" || challenge === "") return null;
  if (!CHALLENGE_RE.test(challenge)) return { kind: "junk", challengeLength: challenge.length };
  return { kind: "challenge", challenge, via };
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function jsonObjectOf(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t.startsWith("{")) return null;
  try {
    return asObject(JSON.parse(t));
  } catch {
    return null;
  }
}

/** The uuids a ping's entries name: pattern-checked, lowercased, each once,
    at most PING_UUIDS_MAX, in order. */
function uuidsOf(entry: unknown): string[] {
  if (!Array.isArray(entry)) return [];
  const out: string[] = [];
  for (const e of entry) {
    const u = asObject(e)?.uuid;
    if (typeof u !== "string" || !UUID_RE.test(u)) continue;
    const low = u.toLowerCase();
    if (!out.includes(low)) out.push(low);
    if (out.length === PING_UUIDS_MAX) break;
  }
  return out;
}

function changeOf(body: Record<string, unknown>, kind: PingBodyKind): Ping {
  const challenge = challengeOf(body.mode, body.challenge, "json");
  if (challenge) return challenge;
  if (normaliseHookObject(body.object) === null) return { kind: "junk" };
  const uuids = uuidsOf(body.entry);
  if (uuids.length === 0) return { kind: "junk" };
  const object = hookObjectOf(body.object);
  if (object === null) return { kind: "ignored", body: kind };
  return { kind: "change", object, uuids, body: kind };
}

/** What a request to the hook address is: a challenge to echo, a change to
    queue, one to ignore, or junk. `query` is the address's query string (a
    challenge may come as a GET). Never throws. */
export function parsePing(contentType: string | null, text: string, query: Params): Ping {
  if (Buffer.byteLength(text, "utf8") > PING_BODY_MAX) return { kind: "junk" };
  const type = (contentType ?? "").toLowerCase();

  const json = jsonObjectOf(text);
  if (json) return changeOf(json, type.includes("json") ? "json" : "json_text");

  if (text.trim() !== "") {
    let form: URLSearchParams | null = null;
    try {
      form = new URLSearchParams(text.trim());
    } catch {
      form = null;
    }
    if (form) {
      const challenge = challengeOf(form.get("mode"), form.get("challenge"), "form");
      if (challenge) return challenge;
      for (const [key, value] of form) {
        const held = jsonObjectOf(value) ?? (value === "" ? jsonObjectOf(key) : null);
        if (held) {
          const ping = changeOf(held, "form");
          return ping.kind === "challenge" ? { ...ping, via: "form" } : ping;
        }
      }
    }
  }

  return challengeOf(query.get("mode"), query.get("challenge"), "query") ?? { kind: "junk" };
}

/* ── ServiceM8's list of subscriptions, and which are ours ── */

/** One listed subscription (reference/get_webhook_subscriptions). */
export type HookSub = {
  uuid: string;
  type: string;
  /** Null for an event subscription. */
  object: string | null;
  callbackUrl: string;
  fields: string[];
  active: boolean;
  lastFailureReason: string | null;
  lastFailureAt: string | null;
};

/** The list's JSON, read defensively: an entry without a uuid, a type or a
    callback_url is left out. */
export function readHookList(json: unknown): HookSub[] {
  if (!Array.isArray(json)) return [];
  const out: HookSub[] = [];
  for (const raw of json) {
    const r = asObject(raw);
    if (!r) continue;
    if (typeof r.uuid !== "string" || typeof r.type !== "string" || typeof r.callback_url !== "string") continue;
    out.push({
      uuid: r.uuid,
      type: r.type,
      object: typeof r.object === "string" ? r.object : null,
      callbackUrl: r.callback_url,
      fields: Array.isArray(r.fields) ? r.fields.filter((f): f is string => typeof f === "string") : [],
      active: r.active === true || r.active === 1 || r.active === "1",
      lastFailureReason: typeof r.last_failure_reason === "string" && r.last_failure_reason !== "" ? r.last_failure_reason : null,
      lastFailureAt: typeof r.last_failure_at === "string" && r.last_failure_at !== "" ? r.last_failure_at : null,
    });
  }
  return out;
}

/** The hashes a workspace holds: the one current (null before the first
    mint) and those retired inside their 72 hours. */
export type OurHashes = { current: string | null; retired: readonly string[] };

/** current: at the address in use. retired: an address still inside its
    grace. dead: at our path, with a hash we don't hold or one past its
    grace. */
export type HookAge = "current" | "retired" | "dead";

export type OurSub = HookSub & { age: HookAge; hookObject: HookObjectName | null };

/** The secret in a listed address, when the address is ours: an object
    subscription on our ORIGIN (parsed, never a prefix), at exactly our PATH
    plus 43 characters, with no credentials, query or fragment. */
export function ourSecretIn(callbackUrl: string, origin: string): string | null {
  let url: URL;
  let base: URL;
  try {
    url = new URL(callbackUrl);
    base = new URL(origin);
  } catch {
    return null;
  }
  if (url.origin !== base.origin) return null;
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return null;
  if (!url.pathname.startsWith(HOOK_PATH)) return null;
  const tail = url.pathname.slice(HOOK_PATH.length);
  return isHookSecret(tail) ? tail : null;
}

/** The listed subscriptions that are ours, each with its age. Nothing else
    is returned, so nothing else can be touched. */
export function classifyOurs(subs: readonly HookSub[], origin: string, hashes: OurHashes): OurSub[] {
  const out: OurSub[] = [];
  for (const s of subs) {
    if (s.type !== "object") continue;
    const secret = ourSecretIn(s.callbackUrl, origin);
    if (secret === null) continue;
    const hash = hookHashOf(secret);
    const age: HookAge = hash === hashes.current ? "current" : hashes.retired.includes(hash) ? "retired" : "dead";
    out.push({ ...s, age, hookObject: hookObjectOf(s.object) });
  }
  return out;
}

/** Turned off by ServiceM8: inactive, at the address in use, with a reason
    recorded. An inactive retired or dead entry is our own delete, and is
    left alone. */
export function isDeactivated(s: OurSub): boolean {
  return s.age === "current" && !s.active && s.lastFailureReason !== null;
}

export type HookPlan = {
  /** Objects to POST at the current address: missing, too narrow, or
      deactivated. */
  post: HookObjectName[];
  /** Deactivated entries, whose reason is recorded before the re-POST
      clears it ("When a subscription is successfully reactivated, its
      stored failure snapshot is cleared"). */
  deactivated: { object: HookObjectName; sub: string; reason: string; at: string | null }[];
  /** Subscription uuids to DELETE: ours, ACTIVE in this list, and at a
      retired or dead address. Each once. */
  del: string[];
  /** ACTIVE entries at the current address whose object isn't one of the
      six in any spelling we know: never deleted — ServiceM8 may list one of
      ours under another spelling (U2), and deleting it would re-POST it on
      the next reconcile, and delete it again — and logged by the caller. */
  leftAlone: { sub: string; object: string | null }[];
};

/** What a reconcile does about one listing (status=all). The POSTs come
    from the first listing; the DELETEs are decided on a second, taken after
    the POSTs ("Create or Update" may have moved an entry in place). Run over
    the state it leads to, the plan is empty. */
export function planSubscriptions(input: {
  subs: readonly HookSub[];
  origin: string;
  hashes: OurHashes;
  /** The fields each object must watch (hookFieldsFor), by object. */
  wanted: Readonly<Record<HookObjectName, readonly string[]>>;
}): HookPlan {
  const ours = classifyOurs(input.subs, input.origin, input.hashes);
  const post: HookObjectName[] = [];
  const deactivated: HookPlan["deactivated"] = [];
  for (const object of HOOK_OBJECT_NAMES) {
    const wanted = input.wanted[object];
    const here = ours.filter((s) => s.age === "current" && s.hookObject === object);
    const covered = here.some((s) => s.active && wanted.every((f) => s.fields.includes(f)));
    if (!covered) post.push(object);
    for (const s of here) {
      if (isDeactivated(s)) deactivated.push({ object, sub: s.uuid, reason: s.lastFailureReason!, at: s.lastFailureAt });
    }
  }
  const del: string[] = [];
  const leftAlone: HookPlan["leftAlone"] = [];
  for (const s of ours) {
    if (!s.active) continue;
    if (s.age !== "current") {
      if (!del.includes(s.uuid)) del.push(s.uuid);
    } else if (s.hookObject === null && !leftAlone.some((l) => l.sub === s.uuid)) {
      leftAlone.push({ sub: s.uuid, object: s.object });
    }
  }
  return { post, deactivated, del, leftAlone };
}

/* ── what is kept per object (sm8_webhooks.objects), and how healthy ── */

/** Per object, as stored in sm8_webhooks.objects. NEVER an address. */
export type HookObjectState = {
  /** The spelling ServiceM8 accepted. */
  name?: string;
  /** Its subscription's uuid at the current address. */
  sub?: string | null;
  active?: boolean;
  /** ServiceM8's refusal, redacted (redactHook). */
  error?: string | null;
  /** ServiceM8's reason for turning it off, redacted the same way. */
  failure_reason?: string | null;
  failure_at?: string | null;
  /** Records the drain wrote that the mirror didn't have, and had. */
  new?: number;
  changed?: number;
};

export type HookObjectsState = Partial<Record<HookObjectName, HookObjectState>>;

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const count = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : undefined);

/** The stored JSON, read defensively: only the six objects, only the
    known fields, and nothing that looks like an address. */
export function readHookObjects(json: unknown): HookObjectsState {
  const src = asObject(json);
  const out: HookObjectsState = {};
  if (!src) return out;
  for (const object of HOOK_OBJECT_NAMES) {
    const r = asObject(src[object]);
    if (!r) continue;
    const s: HookObjectState = {};
    if (str(r.name)) s.name = str(r.name)!;
    if ("sub" in r) s.sub = str(r.sub);
    if (typeof r.active === "boolean") s.active = r.active;
    if ("error" in r) s.error = str(r.error) === null ? null : redactHook(str(r.error)!);
    if ("failure_reason" in r) s.failure_reason = str(r.failure_reason) === null ? null : redactHook(str(r.failure_reason)!);
    if ("failure_at" in r) s.failure_at = str(r.failure_at);
    if (count(r.new) !== undefined) s.new = count(r.new);
    if (count(r.changed) !== undefined) s.changed = count(r.changed);
    out[object] = s;
  }
  return out;
}

/** Pings stopped when the last one (or the subscribing) is more than a day
    old... */
export const QUIET_AFTER_MS = 24 * 3_600_000;
/** ...and at least this many covered records were edited since. Edits to
    fields we don't watch move edit_date too, so one or two prove nothing. */
export const QUIET_EDITS = 10;
/** Edits counted from this long after the last ping, so the record that
    pinged doesn't count against it. */
export const QUIET_GRACE_MS = 10 * 60_000;

export type Sm8HooksHealth =
  | { state: "ok" }
  /** Nothing subscribed at the address in use. */
  | { state: "none" }
  /** Fewer than six active, or a refusal recorded: which objects. */
  | { state: "partial"; missing: HookObjectName[]; errors: HookObjectName[] }
  /** ServiceM8 turned one off, and said why. */
  | { state: "deactivated"; object: HookObjectName; reason: string; at: string | null }
  /** Pings stopped while records went on changing. */
  | { state: "quiet"; since: number };

/** How live updates are, from what the reconcile stored and a count the
    caller made: covered records whose edit_date is later than
    quietStampFrom(lastPing, tz). `editedSince` null means not counted. The
    most specific wins: deactivated, then none, then partial, then quiet. */
export function sm8HooksHealth(input: {
  objects: HookObjectsState;
  subscribedAt: number | null;
  lastPingAt: number | null;
  editedSince: number | null;
  now: number;
}): Sm8HooksHealth {
  for (const object of HOOK_OBJECT_NAMES) {
    const o = input.objects[object];
    if (o && o.active === false && o.failure_reason) {
      return { state: "deactivated", object, reason: o.failure_reason, at: o.failure_at ?? null };
    }
  }
  const missing = HOOK_OBJECT_NAMES.filter((o) => input.objects[o]?.active !== true);
  if (missing.length === HOOK_OBJECT_NAMES.length) return { state: "none" };
  const errors = HOOK_OBJECT_NAMES.filter((o) => !!input.objects[o]?.error);
  if (missing.length > 0 || errors.length > 0) return { state: "partial", missing, errors };
  const last = input.lastPingAt ?? input.subscribedAt;
  if (last !== null && input.now - last > QUIET_AFTER_MS && input.editedSince !== null && input.editedSince >= QUIET_EDITS) {
    return { state: "quiet", since: last };
  }
  return { state: "ok" };
}

/** The stamp edits are counted from, for the quiet check: the last ping
    (or the subscribing) plus the grace, in the account's clock, to compare
    with edit_date as text. Null for a zone Intl doesn't know. */
export function quietStampFrom(lastPingAt: number, tz: string): string | null {
  return sm8LocalStamp(lastPingAt + QUIET_GRACE_MS, tz);
}

/* ── budgets: every one from the function's own deadline ── */

/** Left at the end of every function for the database and the answer. */
export const FUNCTION_MARGIN_MS = 20_000;
/** How long a drain holds the sync lease at a time. */
export const HOOK_LEASE_MS = 45_000;
/** One record's read. */
export const HOOK_READ_TIMEOUT_MS = 8_000;
/** Shaping and upserting what it read. */
export const HOOK_WRITE_MARGIN_MS = 4_000;
/** The longest a read sleeps for the meter's turn: the `hook` lane's
    patience (sm8-meter's SM8_METER.maxWaitMs.hook is this number). */
export const HOOK_METER_WAIT_MS = 3_000;
/** What one read needs to finish inside the lease: its timeout, the
    meter's longest wait on the `hook` lane, and the write. */
export const READ_NEED_MS = HOOK_READ_TIMEOUT_MS + HOOK_METER_WAIT_MS + HOOK_WRITE_MARGIN_MS;
/** At most one read a second. */
export const HOOK_READ_GAP_MS = 1_000;
/** The route's drain, and the page-load and nightly backstops. */
export const ROUTE_DRAIN_MS = 120_000;
export const BACKSTOP_DRAIN_MS = 20_000;
/** How long the single flight is claimed for at a time. */
export const DRAIN_FLIGHT_MS = 60_000;
/** A record is read once this long has passed with no new ping... */
export const QUIET_MS = 8_000;
/** ...or once it has waited this long, whatever it does. */
export const STALE_ROW_MS = 60_000;
/** A sync that asked for the lease within this long is waited for. */
export const WANTED_FRESH_MS = 60_000;
/** Rows per round, and more than this many ready for one object are handed
    to the next ordinary sync instead of read one at a time. */
export const DRAIN_ROUND = 40;
export const HAND_OVER_AT = 60;
/** The queue's cap per workspace (sm8_take_ping's p_cap). */
export const PING_QUEUE_CAP = 2_000;
/** Hook calls per workspace per UTC day (sm8_take_hook_call's budget). */
export const HOOK_DAILY_BUDGET = 3_000;
/** A read that finds ServiceM8 unavailable this many times drops its row. */
export const HOOK_MAX_ATTEMPTS = 5;
/** A retired secret stays valid this long: ServiceM8's retry window. */
export const HOOK_GRACE_MS = 72 * 3_600_000;
/** Rows for an account that is no longer the connection's are dropped
    after this long. */
export const MISMATCH_DROP_MS = 24 * 3_600_000;
/** A reconcile: the subscribing POST outlasts a challenge round trip. */
export const HOOK_POST_TIMEOUT_MS = 25_000;
export const HOOK_LIST_TIMEOUT_MS = 10_000;
/** The nightly ensure step, the page-load one, and what a connect must
    have left to try. */
export const ENSURE_BUDGET_MS = 30_000;
export const ENSURE_MIN_LEFT_MS = 60_000;
/** Kept back from an ensure step's end for the reconcile's own last
    writes, so recording what it found never runs past the step. */
export const ENSURE_FINISH_MARGIN_MS = 2_000;
/** Kept back between the page-load backstop drain's end and the sync's
    start-by, for the drain's own last writes (its counters, the flight and
    the lease given back). */
export const BACKSTOP_FINISH_MARGIN_MS = 3_000;
/** An owed ensure on a page load runs at most this often. */
export const ENSURE_EVERY_MS = 3_600_000;
/** A disconnect's unsubscribing. */
export const REMOVE_BUDGET_MS = 8_000;

/** The end of a function that began at `startedAt` with a maxDuration of
    `maxDurationS` seconds, less the margin. */
export function functionDeadline(startedAt: number, maxDurationS: number): number {
  return startedAt + maxDurationS * 1000 - FUNCTION_MARGIN_MS;
}

/** When a drain started at `startedAt` must stop: its own budget, or its
    function's deadline, whichever is first. */
export function drainEnd(startedAt: number, maxDurationS: number, maxMs: number): number {
  return Math.min(functionDeadline(startedAt, maxDurationS), startedAt + maxMs);
}

/** Whether a span of `ms` from `now` still ends by `end`: a lease claimed
    or extended for HOOK_LEASE_MS, or one more read (READ_NEED_MS). */
export function fitsLease(now: number, ms: number, end: number): boolean {
  return now + ms <= end;
}

/** Whether one more read fits inside the lease held until `leaseUntil`;
    when it doesn't, the holder extends first, or stops. */
export function readFits(leaseUntil: number, now: number): boolean {
  return leaseUntil - now >= READ_NEED_MS;
}
