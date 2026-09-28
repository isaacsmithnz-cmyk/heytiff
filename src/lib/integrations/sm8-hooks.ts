/* Subscribing to live updates from ServiceM8 (two-way phase 4, PR C) —
   server only.

   sm8-hook-plan decides; this carries it out against ServiceM8's webhook
   subscriptions (through the one door's pinned second base, sm8-http) and
   the database (sm8_webhooks, sm8_webhook_hooks). Nothing here runs unless
   sm8-hooks-switch says `on`: every export asks first, before any read, and
   the callers load this module only after asking too.

   ensureSm8Webhooks, THE RECONCILE. One list; then, only when something is
   wrong, a new secret, the POSTs, a second list and the DELETEs:
   1. `GET /webhook_subscriptions?status=all`, and which entries are ours:
      an object subscription at OUR origin and OUR path, whose last segment
      hashes to a hash we hold (sm8-hook-plan's classifyOurs).
   2. THE ADDRESS. A rotation owed (a connect, or rotate_wanted_at) or no
      entry listed at the current address: a new secret is minted, and
      sm8_rotate_hook retires the old hash (still valid 72 h, ServiceM8's
      retry window, so a late retry to it is queued, never answered 410)
      and makes the new one current, before any POST names it. Otherwise
      the address is the one ServiceM8 lists for a current entry, exactly
      as listed. It is held in memory and nowhere else.
   3. A POST for each object with no active entry at the address that
      watches what we want: missing, too narrow, or turned off by ServiceM8
      (whose reason is recorded BEFORE the POST that clears it). A name
      ServiceM8 doesn't subscribe is tried in its next spelling.
   4. After any POST, the list again ("Create or Update" may have moved an
      entry in place), and a DELETE for each entry of ours that list shows
      ACTIVE and no longer needed — each once, judged against the hashes as
      the database holds them at that moment (deletableSubs): never one at
      the current address; one in its 72 h of grace only once the current
      address covers its object; a dead one as ever.
   5. What was found, per object (sm8_webhooks.objects: the spelling, the
      subscription's uuid, active, a refusal, a turn-off — NEVER an
      address), subscribed_at when all six are active at the address, and
      ensure_tried_at. A rotation owed is cleared only here, at the end,
      and only when this run minted.
   ONE AT A TIME per workspace: the reconcile claims ensure_tried_at for
   its budget before anything else (a conditional write), and a second
   finds it held and leaves. Every call starts only while its worst case
   still ends inside the caller's budget — a POST's wait is cut to what is
   left, never below what ServiceM8's challenge to us needs — no secret is
   minted unless its first POST can be made, and it never throws.

   THE SECRET IS NEVER KEPT. Not in a column, not in a log line, not in
   JSON. Every text of ServiceM8's that is stored or logged goes through
   redactHook first, with the secrets this run holds named, so a refusal
   that echoes the address keeps `[hook]` in its place.

   HOW THEY ARE (PR F): readSm8HooksHealth for the owner's screen, one read
   of one row, and checkSm8HooksQuiet for the night, which alone counts the
   mirror to tell `quiet`. See the section's note.

   A 401 FROM THE SUBSCRIPTION API IS NOT TAKEN AS THE GRANT'S DEATH until a
   plain read under the renewed token agrees (withSm8Renewal's
   confirmDead): whether an OAuth app needs anything more for webhooks is
   unknown (the spec's U3), and a refusal particular to them must never
   mark the whole connection for reconnecting. */

import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import { fetchSm8Vendor } from "./sm8";
import { sm8CallOf, sm8Request, type Sm8HooksMethod } from "./sm8-http";
import { sm8AccessResult, type Sm8Access } from "./sm8-store";
import { withSm8Renewal, type ConfirmDead } from "./sm8-renew";
import { sm8WebhooksState } from "./sm8-hooks-switch";
import {
  ENSURE_EVERY_MS,
  HOOK_LIST_TIMEOUT_MS,
  HOOK_METER_WAIT_MS,
  HOOK_OBJECT_NAMES,
  HOOK_PATH,
  HOOK_POST_TIMEOUT_MS,
  QUIET_AFTER_MS,
  QUIET_EDITS,
  classifyOurs,
  hookFieldsFor,
  hookHashOf,
  hookSpecOf,
  isUnsupportedObject,
  ourSecretIn,
  planSubscriptions,
  quietFrom,
  quietStampFrom,
  readHookList,
  readHookObjects,
  redactHook,
  sm8HooksHealth,
  spellingsFor,
  type HookObjectName,
  type HookObjectState,
  type HookObjectsState,
  type HookSub,
  type OurHashes,
  type Sm8HooksHealth,
} from "./sm8-hook-plan";

const WEBHOOKS = "sm8_webhooks";
const HOOKS = "sm8_webhook_hooks";

/** How much of a refusal is kept, after redaction. */
const ERROR_KEEP = 300;

const iso = (ms: number) => new Date(ms).toISOString();
const msOf = (v: unknown): number | null => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);

/** Where ServiceM8 sends pings: the deployment's own APP_BASE_URL, parsed —
    never a request's host. Null when it isn't set or isn't a URL. */
export function sm8HookOrigin(): string | null {
  const base = process.env.APP_BASE_URL;
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

/** The fields each object must watch. */
function wantedFields(): Record<HookObjectName, string[]> {
  const out = {} as Record<HookObjectName, string[]>;
  for (const o of HOOK_OBJECT_NAMES) out[o] = hookFieldsFor(hookSpecOf(o));
  return out;
}

/** A message of ServiceM8's, or an error's, safe to keep or log. */
function safe(text: string, secrets: readonly string[]): string {
  return stripAddresses(redactHook(text, secrets)).slice(0, ERROR_KEEP);
}

/** Every web address in a text, plain, JSON-escaped or form-encoded, as
    `[address]`: what is kept names what went wrong, never where. After
    redactHook, so a secret is gone even from a text this misses. */
function stripAddresses(text: string): string {
  return text
    .replace(/https?:(?:\\?\/){2}[^\s"'<>]*/gi, "[address]")
    .replace(/https?%3A%2F%2F[^\s"'<>&]*/gi, "[address]");
}

/* ── the rotation a connect owes ── */

/** A connect, a Reconnect or a change of account owes a rotation: marked
    here, synchronously, before the redirect, so the rotation happens even if
    the ensure behind the response never runs (the next page load or the
    nightly run finds the mark). `account` null (a connection whose account
    couldn't be named) only marks a row that exists. Nothing on any switch
    but `on`. Never throws. */
export async function markSm8RotationOwed(orgId: string, account: string | null, now: number = Date.now()): Promise<void> {
  if (sm8WebhooksState() !== "on") return;
  try {
    const { error } =
      account === null
        ? await supabaseAdmin.from(WEBHOOKS).update({ rotate_wanted_at: iso(now) }).eq("org_id", orgId)
        : await supabaseAdmin
            .from(WEBHOOKS)
            .upsert({ org_id: orgId, account_uuid: account, rotate_wanted_at: iso(now) }, { onConflict: "org_id" });
    if (error) console.error(`[sm8] couldn't mark a rotation owed for org ${orgId}: ${error.message ?? error.code}`);
  } catch (err) {
    console.error(`[sm8] couldn't mark a rotation owed for org ${orgId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/* ── one request to the subscriptions ── */

type Hit =
  | { kind: "response"; status: number; body: string }
  /** The meter had no turn, or ServiceM8 answered 429: stop. */
  | { kind: "throttled" }
  /** The request threw (a timeout, the network). */
  | { kind: "failed"; message: string }
  /** No time left for this request's worst case. */
  | { kind: "late" }
  /** The grant is dead or gone: stop. */
  | { kind: "dead" };

type Run = {
  orgId: string;
  access: Sm8Access;
  /** The end of the caller's budget. */
  end: number;
  clock: () => number;
  /** Every secret this run has held, for redaction. */
  secrets: string[];
  /** A disconnect's: each request's wait is cut to what is left, rather
      than a request not starting that couldn't wait its full time. */
  squeeze?: boolean;
};

/** The shortest wait a squeezed request is given; less, and it isn't made. */
const SQUEEZE_MIN_MS = 2_000;

/** The shortest wait a subscribing POST is given: ServiceM8 calls our
    address with a challenge before it answers, and gives that call 10 s
    ("must return a successful 2xx response within 10 seconds",
    reference/post_object_webhook_subscription), plus a margin. Less left
    than this, and no POST is made — nor a secret minted for one. */
const POST_FLOOR_MS = 12_000;

/** Whether a request with this timeout, and the meter's longest wait on the
    `hook` lane before it, still ends by the budget's end. */
function fits(run: Run, timeoutMs: number): boolean {
  return run.clock() + timeoutMs + HOOK_METER_WAIT_MS <= run.end;
}

async function hooksCall(run: Run, method: Sm8HooksMethod, path: string, init: { query?: Record<string, string>; body?: URLSearchParams } = {}): Promise<Hit> {
  let timeoutMs = method === "POST" ? HOOK_POST_TIMEOUT_MS : HOOK_LIST_TIMEOUT_MS;
  /* a POST, and a disconnect's every request, wait what is left, down to a floor */
  const floor = method === "POST" ? POST_FLOOR_MS : run.squeeze ? SQUEEZE_MIN_MS : null;
  if (floor !== null) {
    timeoutMs = Math.min(timeoutMs, run.end - run.clock() - HOOK_METER_WAIT_MS);
    if (timeoutMs < floor) return { kind: "late" };
  }
  if (!fits(run, timeoutMs)) return { kind: "late" };

  const once = async (a: Sm8Access): Promise<Hit> => {
    try {
      const answer = await sm8Request(sm8CallOf(a, "hook"), path, { api: "hooks", method, timeoutMs, ...init });
      if (answer.kind === "throttled") return { kind: "throttled" };
      if (answer.res.status === 429) return { kind: "throttled" };
      let body = "";
      try {
        body = await answer.res.text();
      } catch {
        body = "";
      }
      return { kind: "response", status: answer.res.status, body };
    } catch (err) {
      return { kind: "failed", message: err instanceof Error ? err.message : String(err) };
    }
  };

  /* a plain read under the renewed token: is it the GRANT that is refused? */
  const confirmDead: ConfirmDead = async (a) => {
    if (!fits(run, HOOK_LIST_TIMEOUT_MS)) return "unsure";
    const v = await fetchSm8Vendor(sm8CallOf(a, "hook")).catch(() => null);
    if (v?.ok) return "alive";
    return v && !v.ok && v.unauthorized ? "dead" : "unsure";
  };

  const got = await withSm8Renewal(run.orgId, run.access, once, (h) => h.kind === "response" && h.status === 401, {
    retry: () => fits(run, timeoutMs),
    confirmDead,
  });
  run.access = got.access;
  if (got.verdict === "dead" || got.verdict === "gone") return { kind: "dead" };
  if (got.verdict === "late") return { kind: "late" };
  return got.result;
}

async function listSubs(run: Run, status: "all" | "active"): Promise<{ ok: true; subs: HookSub[] } | { ok: false; stop: string }> {
  const hit = await hooksCall(run, "GET", "/webhook_subscriptions", { query: { status } });
  if (hit.kind !== "response") return { ok: false, stop: hit.kind === "failed" ? `list failed: ${safe(hit.message, run.secrets)}` : hit.kind };
  if (hit.status < 200 || hit.status > 299) {
    const stop = `list ${hit.status}: ${safe(hit.body, run.secrets)}`;
    console.error(`[sm8] live updates for org ${run.orgId}: ${stop}`);
    return { ok: false, stop };
  }
  try {
    return { ok: true, subs: readHookList(JSON.parse(hit.body)) };
  } catch {
    return { ok: false, stop: "list unreadable" };
  }
}

/** Whether a DELETE landed: a 2xx that doesn't say `"success": false`, or
    404 ("No matching webhook found") — gone either way. */
async function deleteSub(run: Run, uuid: string): Promise<"deleted" | "stop" | "failed"> {
  const hit = await hooksCall(run, "DELETE", `/webhook_subscriptions/${uuid}`);
  if (hit.kind === "response") {
    return (hit.status >= 200 && hit.status <= 299 && successOf(hit.body)) || hit.status === 404 ? "deleted" : "failed";
  }
  return hit.kind === "failed" ? "failed" : "stop";
}

/* ── the reconcile ── */

export type Sm8EnsureResult =
  /** `busy`: another reconcile of this workspace holds the flight. */
  | { ran: false; why: "off" | "not_connected" | "no_origin" | "failed" | "busy" }
  | {
      ran: true;
      rotated: boolean;
      posted: number;
      deleted: number;
      /** All six active at the address in use. */
      subscribed: boolean;
      /** Why it stopped short, when it did: the budget (`late`), the meter
          or ServiceM8's limit (`throttled`), the grant (`dead`), or a list
          it couldn't read. */
      stopped: string | null;
    };

type HookRow = { hook_hash: string; account_uuid: string; retired_at: string | null; valid_until: string | null };
type StateRow = {
  objects: unknown;
  subscribed_at: string | null;
  rotate_wanted_at: string | null;
  ensure_tried_at: string | null;
};

/** The hashes this workspace holds for `account`: the current one, and the
    retired ones still inside their 72 hours. A hash minted for another
    account is none of them — its entries are that account's. */
export function hashesFor(rows: readonly HookRow[], account: string, now: number): OurHashes {
  const mine = rows.filter((r) => r.account_uuid === account);
  const current = mine.find((r) => r.retired_at === null)?.hook_hash ?? null;
  const retired = mine
    .filter((r) => r.retired_at !== null && (msOf(r.valid_until) ?? 0) > now)
    .map((r) => r.hook_hash);
  return { current, retired };
}

/** The hashes the database holds for this workspace NOW: the account's
    current one, and every other still good — retired inside its 72 hours,
    or current for another account. Read again right before any DELETE is
    decided, so an entry another reconcile has just subscribed is never
    taken for dead. Null when it can't be read. */
async function heldHashes(orgId: string, account: string, now: number): Promise<OurHashes | null> {
  const { data, error } = await supabaseAdmin
    .from(HOOKS)
    .select("hook_hash, account_uuid, retired_at, valid_until")
    .eq("org_id", orgId);
  if (error) return null;
  const rows = (data ?? []) as HookRow[];
  const current = rows.find((r) => r.retired_at === null && r.account_uuid === account)?.hook_hash ?? null;
  const retired = rows
    .filter((r) => r.hook_hash !== current && (r.retired_at === null || (msOf(r.valid_until) ?? 0) > now))
    .map((r) => r.hook_hash);
  return { current, retired };
}

/** Which of our listed entries may be unsubscribed, against the hashes the
    database holds now: an ACTIVE entry, never at the current address, and
    - at an address nobody holds any more (dead), or for an object we
      don't know: as ever;
    - at an address still in its grace (another reconcile's, or the one a
      rotation just left): only once the current address covers its
      object — so a rotation whose POSTs all failed keeps the address that
      still works, and no reconcile takes down another's.
    Each once. */
export function deletableSubs(
  subs: readonly HookSub[],
  origin: string,
  held: OurHashes,
  wanted: Readonly<Record<HookObjectName, readonly string[]>>
): string[] {
  const ours = classifyOurs(subs, origin, held);
  const covered = (o: HookObjectName) =>
    ours.some((s) => s.age === "current" && s.hookObject === o && s.active && wanted[o].every((f) => s.fields.includes(f)));
  const out: string[] = [];
  for (const s of ours) {
    if (!s.active || s.age === "current") continue;
    if (s.age === "retired" && s.hookObject !== null && !covered(s.hookObject)) continue;
    if (!out.includes(s.uuid)) out.push(s.uuid);
  }
  return out;
}

/** The single flight: ensure_tried_at holds the END of a reconcile's budget
    while it runs (and when it last ran, once it has). Claimed only where
    it is empty or already past, by one conditional write; a workspace with
    no row yet is claimed by the insert that makes it. False: another
    reconcile holds it. */
async function claimEnsure(orgId: string, account: string, now: number, budgetMs: number): Promise<boolean> {
  const until = iso(now + Math.max(budgetMs, 0));
  const claimed = await supabaseAdmin
    .from(WEBHOOKS)
    .update({ ensure_tried_at: until })
    .eq("org_id", orgId)
    .or(`ensure_tried_at.is.null,ensure_tried_at.lte.${iso(now)}`)
    .select("org_id");
  if (claimed.error) throw new Error(`the flight couldn't be claimed: ${claimed.error.message}`);
  if ((claimed.data ?? []).length > 0) return true;
  const made = await supabaseAdmin
    .from(WEBHOOKS)
    .upsert({ org_id: orgId, account_uuid: account, ensure_tried_at: until }, { onConflict: "org_id", ignoreDuplicates: true })
    .select("org_id");
  if (made.error) throw new Error(`the flight couldn't be claimed: ${made.error.message}`);
  return (made.data ?? []).length > 0;
}

/** A listed failure time kept only when it reads as one. */
function stampOrNull(v: string | null): string | null {
  return v !== null && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?$/.test(v) ? v : null;
}

/** Bring this workspace's subscriptions to the six at one address. `rotate`
    mints a new secret whatever is listed (a connect). `budgetMs` bounds
    every request: none starts unless its worst case still ends inside it.
    Nothing happens unless the switch is `on`, the connection is connected
    with an account, and its access works. Never throws. */
export async function ensureSm8Webhooks(
  orgId: string,
  opts: { rotate?: boolean; budgetMs: number; clock?: () => number }
): Promise<Sm8EnsureResult> {
  if (sm8WebhooksState() !== "on") return { ran: false, why: "off" };
  const clock = opts.clock ?? Date.now;
  const started = clock();
  try {
    const origin = sm8HookOrigin();
    if (!origin) {
      console.error(`[sm8] live updates for org ${orgId}: APP_BASE_URL isn't set, so there is no address to subscribe`);
      return { ran: false, why: "no_origin" };
    }
    const accessed = await sm8AccessResult(orgId, started);
    if (!accessed.ok || !accessed.access.tenantId) return { ran: false, why: "not_connected" };
    const account = accessed.access.tenantId;
    if (!(await claimEnsure(orgId, account, started, opts.budgetMs))) return { ran: false, why: "busy" };

    const [hooksRes, stateRes] = await Promise.all([
      supabaseAdmin.from(HOOKS).select("hook_hash, account_uuid, retired_at, valid_until").eq("org_id", orgId),
      supabaseAdmin
        .from(WEBHOOKS)
        .select("objects, subscribed_at, rotate_wanted_at, ensure_tried_at")
        .eq("org_id", orgId)
        .maybeSingle(),
    ]);
    if (hooksRes.error || stateRes.error) {
      console.error(`[sm8] live updates for org ${orgId}: couldn't read what it holds: ${(hooksRes.error ?? stateRes.error)?.message}`);
      return { ran: false, why: "failed" };
    }
    const state = (stateRes.data as StateRow | null) ?? null;
    let hashes = hashesFor((hooksRes.data ?? []) as HookRow[], account, started);
    const owedAt = state?.rotate_wanted_at ?? null;

    const run: Run = { orgId, access: accessed.access, end: started + opts.budgetMs, clock, secrets: [] };
    const wanted = wantedFields();
    const known = readHookObjects(state?.objects);
    const found: HookObjectsState = {};
    const touch = (o: HookObjectName, patch: HookObjectState) => {
      found[o] = { ...found[o], ...patch };
    };

    /* what is written at the end, however the run ends */
    let rotated = false;
    let rotationStamp: string | null = null;
    let posted = 0;
    let deleted = 0;
    let stopped: string | null = null;
    const finish = async (): Promise<boolean> => {
      /* read again just before writing, so the drain's counters since the
         start are kept */
      const fresh = await supabaseAdmin.from(WEBHOOKS).select("objects").eq("org_id", orgId).maybeSingle();
      const stored = fresh.error ? state?.objects : (fresh.data as { objects?: unknown } | null)?.objects;
      const objects = mergeObjects(stored, found, run.secrets);
      const allActive = HOOK_OBJECT_NAMES.every((o) => objects[o]?.active === true);
      const subscribedAt = allActive ? (!rotated && state?.subscribed_at ? state.subscribed_at : iso(clock())) : null;
      const { error } = await supabaseAdmin.from(WEBHOOKS).upsert(
        {
          org_id: orgId,
          account_uuid: account,
          objects,
          subscribed_at: subscribedAt,
          ensure_tried_at: iso(clock()),
          last_error: stopped === null ? null : safe(stopped, run.secrets),
        },
        { onConflict: "org_id" }
      );
      if (error) console.error(`[sm8] live updates for org ${orgId}: couldn't record the reconcile: ${error.message}`);
      /* the rotation it owed is done: cleared at the END, and never a mark
         a later connect made meanwhile */
      if (rotated && !error) {
        const owed = rotationStamp ?? iso(started);
        await supabaseAdmin.from(WEBHOOKS).update({ rotate_wanted_at: null }).eq("org_id", orgId).lte("rotate_wanted_at", owed);
      }
      return allActive;
    };

    /* 1. the list */
    const first = await listSubs(run, "all");
    if (!first.ok) {
      stopped = first.stop;
      await finish();
      return { ran: true, rotated, posted, deleted, subscribed: false, stopped };
    }
    for (const s of classifyOurs(first.subs, origin, hashes)) {
      const tail = ourSecretIn(s.callbackUrl, origin);
      if (tail) run.secrets.push(tail);
    }

    /* 2. the address */
    const listedCurrent = classifyOurs(first.subs, origin, hashes).find((s) => s.age === "current");
    let address: string;
    let subs = first.subs;
    if (opts.rotate || owedAt !== null || !listedCurrent) {
      /* no secret is minted that no POST could be made for */
      if (run.end - clock() - HOOK_METER_WAIT_MS < POST_FLOOR_MS) {
        stopped = "late";
        await finish();
        return { ran: true, rotated, posted, deleted, subscribed: false, stopped };
      }
      const secret = randomBytes(32).toString("base64url");
      run.secrets.push(secret);
      const hash = hookHashOf(secret);
      const { error } = await supabaseAdmin.rpc("sm8_rotate_hook", { p_org: orgId, p_account: account, p_hash: hash });
      if (error) {
        stopped = `rotate failed: ${error.message}`;
        await finish();
        return { ran: true, rotated, posted, deleted, subscribed: false, stopped };
      }
      rotated = true;
      /* the RPC clears the mark at the mint; it is owed until the END, so
         it goes back — only where no later connect has marked it since —
         and nothing is subscribed at the new address yet */
      rotationStamp = owedAt ?? iso(started);
      const owe = await supabaseAdmin
        .from(WEBHOOKS)
        .update({ rotate_wanted_at: rotationStamp })
        .eq("org_id", orgId)
        .is("rotate_wanted_at", null);
      if (owe.error) console.error(`[sm8] live updates for org ${orgId}: couldn't keep the rotation owed: ${owe.error.message}`);
      const fresh = await supabaseAdmin.from(WEBHOOKS).update({ subscribed_at: null }).eq("org_id", orgId);
      if (fresh.error) console.error(`[sm8] live updates for org ${orgId}: couldn't record the new address: ${fresh.error.message}`);
      hashes = {
        current: hash,
        retired: [...hashes.retired, ...(hashes.current ? [hashes.current] : [])],
      };
      address = `${origin}${HOOK_PATH}${secret}`;
    } else {
      address = listedCurrent.callbackUrl;
    }

    /* 3. the POSTs, the turn-offs recorded first */
    const plan = planSubscriptions({ subs, origin, hashes, wanted });
    noteFromList(subs, origin, hashes, wanted, touch);
    if (plan.deactivated.length > 0) {
      for (const d of plan.deactivated) {
        touch(d.object, { active: false, failure_reason: safe(d.reason, run.secrets), failure_at: stampOrNull(d.at) });
      }
      const { error } = await supabaseAdmin
        .from(WEBHOOKS)
        .update({ objects: mergeObjects(state?.objects, found, run.secrets) })
        .eq("org_id", orgId);
      if (error) console.error(`[sm8] live updates for org ${orgId}: couldn't record a turn-off: ${error.message}`);
    }

    let attempted = 0;
    for (const object of plan.post) {
      if (stopped) break;
      attempted += 1;
      const outcome = await subscribe(run, object, address, wanted[object], known[object]?.name ?? null);
      if (outcome.kind === "stop") {
        stopped = outcome.why;
        break;
      }
      if (outcome.kind === "ok") {
        posted += 1;
        touch(object, { name: outcome.name, active: true, error: null, failure_reason: null, failure_at: null });
      } else {
        touch(object, { active: false, error: outcome.error });
        console.error(`[sm8] live updates for org ${orgId}: ServiceM8 refused ${object}: ${outcome.error}`);
      }
    }

    /* 4. after any POST, the list again — no time for it, no DELETEs this
       round; the DELETEs are judged on the latest list, against the hashes
       as the database holds them right then */
    let delPlan = plan;
    let latest = attempted === 0;
    if (attempted > 0 && !stopped) {
      const second = await listSubs(run, "all");
      if (!second.ok) {
        stopped = second.stop;
      } else {
        subs = second.subs;
        latest = true;
        delPlan = planSubscriptions({ subs, origin, hashes, wanted });
        noteFromList(subs, origin, hashes, wanted, touch);
      }
    }
    if (delPlan.leftAlone.length > 0) {
      console.warn(
        `[sm8] live updates for org ${orgId}: left alone ${delPlan.leftAlone.length} subscription(s) at our address for an object we don't know: ${delPlan.leftAlone
          .map((l) => `${l.sub} (${safe(l.object ?? "no object", run.secrets)})`)
          .join(", ")}`
      );
    }
    if (!stopped && latest && delPlan.del.length > 0) {
      const held = await heldHashes(orgId, account, clock());
      if (held === null) stopped = "hooks unreadable";
      const doomed = held === null ? [] : deletableSubs(subs, origin, held, wanted);
      for (const uuid of doomed) {
        const d = await deleteSub(run, uuid);
        if (d === "deleted") deleted += 1;
        else if (d === "stop") {
          stopped = "delete stopped";
          break;
        } else console.error(`[sm8] live updates for org ${orgId}: couldn't unsubscribe ${uuid}`);
      }
    }

    /* 5. what was found */
    const subscribed = await finish();
    return { ran: true, rotated, posted, deleted, subscribed, stopped };
  } catch (err) {
    console.error(`[sm8] live updates for org ${orgId}: the reconcile threw: ${safe(err instanceof Error ? err.message : String(err), [])}`);
    return { ran: false, why: "failed" };
  }
}

/** Per object, what a listing says about the address in use: its
    subscription, and whether it is active and watching what we want. */
function noteFromList(
  subs: readonly HookSub[],
  origin: string,
  hashes: OurHashes,
  wanted: Readonly<Record<HookObjectName, readonly string[]>>,
  touch: (o: HookObjectName, patch: HookObjectState) => void
): void {
  const current = classifyOurs(subs, origin, hashes).filter((s) => s.age === "current");
  for (const o of HOOK_OBJECT_NAMES) {
    const here = current.filter((s) => s.hookObject === o);
    const covering = here.find((s) => s.active && wanted[o].every((f) => s.fields.includes(f)));
    const pick = covering ?? here[0];
    touch(o, {
      sub: pick?.uuid ?? null,
      active: !!covering,
      /* covered: whatever was refused or turned off before isn't any more */
      ...(covering
        ? { error: null, failure_reason: null, failure_at: null, ...(covering.object ? { name: covering.object } : {}) }
        : {}),
    });
  }
}

type Subscribed =
  | { kind: "ok"; name: string }
  | { kind: "refused"; error: string }
  | { kind: "stop"; why: string };

/** One object's POST, in each spelling until ServiceM8 takes one. */
async function subscribe(run: Run, object: HookObjectName, address: string, fields: readonly string[], worked: string | null): Promise<Subscribed> {
  let last = "";
  for (const name of spellingsFor(object, worked)) {
    const body = new URLSearchParams({ object: name, fields: fields.join(","), callback_url: address });
    const hit = await hooksCall(run, "POST", "/webhook_subscriptions/object", { body });
    if (hit.kind === "failed") return { kind: "refused", error: safe(hit.message, run.secrets) };
    if (hit.kind !== "response") return { kind: "stop", why: hit.kind };
    if (hit.status >= 200 && hit.status <= 299 && successOf(hit.body)) return { kind: "ok", name };
    if (isUnsupportedObject(hit.status, hit.body)) {
      last = hit.body;
      continue;
    }
    return { kind: "refused", error: safe(`${hit.status}: ${hit.body}`, run.secrets) };
  }
  return { kind: "refused", error: safe(`400: ${last}`, run.secrets) };
}

/** `{"success": true}`, or a 2xx body that doesn't say otherwise. */
function successOf(body: string): boolean {
  try {
    const j = JSON.parse(body) as { success?: unknown };
    return !(j && typeof j === "object" && j.success === false);
  } catch {
    return true;
  }
}

/** The stored objects with this run's findings over them: the drain's
    counters kept, and every text redacted again on the way in. */
function mergeObjects(stored: unknown, found: HookObjectsState, secrets: readonly string[]): HookObjectsState {
  const base = readHookObjects(stored);
  const out: HookObjectsState = {};
  for (const o of HOOK_OBJECT_NAMES) {
    const merged: HookObjectState = { ...base[o], ...found[o] };
    for (const k of ["error", "failure_reason"] as const) {
      const v = merged[k];
      if (typeof v === "string") merged[k] = safe(v, secrets);
    }
    if (Object.keys(merged).length > 0) out[o] = merged;
  }
  return out;
}

/* ── when the page load or the night runs it ── */

/** A rotation a connect left owed is tried again this often at most. */
const ROTATION_RETRY_MS = 5 * 60_000;

/** Whether a reconcile is owed on a page load. A rotation waiting: when
    none was tried in the last five minutes. The six not all subscribed:
    when none was tried in the last hour. Never while one is in flight: its
    ensure_tried_at is still ahead, which reads as tried just now. */
export function sm8EnsureOwed(row: Pick<StateRow, "rotate_wanted_at" | "subscribed_at" | "ensure_tried_at"> | null, now: number): boolean {
  const tried = msOf(row?.ensure_tried_at ?? null);
  if (row?.rotate_wanted_at) return tried === null || now - tried > ROTATION_RETRY_MS;
  const owed = row === null || row.subscribed_at === null;
  return owed && (tried === null || now - tried > ENSURE_EVERY_MS);
}

/** The page load's reconcile: only when owed (sm8EnsureOwed), in `budgetMs`.
    One read of one row otherwise. Never throws. */
export async function ensureSm8WebhooksIfOwed(orgId: string, opts: { budgetMs: number; now?: number }): Promise<Sm8EnsureResult | null> {
  if (sm8WebhooksState() !== "on") return null;
  try {
    const { data, error } = await supabaseAdmin
      .from(WEBHOOKS)
      .select("rotate_wanted_at, subscribed_at, ensure_tried_at")
      .eq("org_id", orgId)
      .maybeSingle();
    if (error) return null;
    if (!sm8EnsureOwed((data as StateRow | null) ?? null, opts.now ?? Date.now())) return null;
    return await ensureSm8Webhooks(orgId, { budgetMs: opts.budgetMs });
  } catch {
    return null;
  }
}

/** Housekeeping, nightly: hook rows whose 72 hours have passed. A ping to
    one is already `unknown` (sm8_take_ping checks valid_until); this only
    tidies. Returns how many went. Never throws. */
export async function dropExpiredSm8Hooks(now: number = Date.now()): Promise<number> {
  if (sm8WebhooksState() !== "on") return 0;
  try {
    const { data, error } = await supabaseAdmin.from(HOOKS).delete().lt("valid_until", iso(now)).select("hook_hash");
    return error ? 0 : (data ?? []).length;
  } catch {
    return 0;
  }
}

/* ── how live updates are (PR F) ──

   THE OWNER SEES NOTHING WHILE THEY WORK (the spec's decision D2). One line
   on the ServiceM8 screen, naming the thing, only when sm8-hook-plan's
   sm8HooksHealth says `none`, `partial`, `deactivated` or `quiet`; the
   words are sm8-hook-words'. Nothing on Home, nothing in the bell.

   `none`, `partial` and `deactivated` are read off what the reconcile
   stored (sm8_webhooks.objects). `quiet` needs a count of the mirror, so it
   is the NIGHTLY check's, after the syncs have brought the day's edits in:
   it marks quiet_since, and the next ping clears it (sm8_take_ping). The
   screen reads the mark and never counts. */

type HealthRow = {
  objects: unknown;
  subscribed_at: string | null;
  last_ping_at: string | null;
  quiet_since: string | null;
  rotate_wanted_at: string | null;
  ensure_tried_at: string | null;
};

const HEALTH_COLUMNS = "objects, subscribed_at, last_ping_at, quiet_since, rotate_wanted_at, ensure_tried_at";

/** Whether no reconcile has had its go at what is there yet: none has ever
    tried, a connect has owed a rotation since the last one tried, or one is
    running now (its ensure_tried_at holds the end of its budget). What the
    row says then is being put right, so nothing is said of it. */
export function sm8HooksSettling(row: Pick<HealthRow, "rotate_wanted_at" | "ensure_tried_at"> | null, now: number): boolean {
  const tried = msOf(row?.ensure_tried_at ?? null);
  if (tried === null || tried > now) return true;
  const owed = msOf(row?.rotate_wanted_at ?? null);
  return owed !== null && owed > tried;
}

/** How live updates are by the one row, with no count made: `quiet` is
    what the nightly check last found (quiet_since), never counted again
    here. */
export function sm8HooksHealthOf(row: Pick<HealthRow, "objects" | "subscribed_at" | "last_ping_at" | "quiet_since"> | null, now: number): Sm8HooksHealth {
  return sm8HooksHealth({
    objects: readHookObjects(row?.objects),
    subscribedAt: msOf(row?.subscribed_at ?? null),
    lastPingAt: msOf(row?.last_ping_at ?? null),
    editedSince: row?.quiet_since ? QUIET_EDITS : null,
    now,
  });
}

/** What the owner's ServiceM8 screen says of live updates: null — nothing —
    while they work, while a reconcile is still to have its go, when the row
    can't be read, and on any switch but `on`, where nothing is read at all.
    One read of one row otherwise. Never throws. */
export async function readSm8HooksHealth(orgId: string, now: number = Date.now()): Promise<Sm8HooksHealth | null> {
  if (sm8WebhooksState() !== "on") return null;
  try {
    const { data, error } = await supabaseAdmin.from(WEBHOOKS).select(HEALTH_COLUMNS).eq("org_id", orgId).maybeSingle();
    if (error) return null;
    const row = (data as HealthRow | null) ?? null;
    if (sm8HooksSettling(row, now)) return null;
    const health = sm8HooksHealthOf(row, now);
    return health.state === "ok" ? null : health;
  } catch {
    return null;
  }
}

export type Sm8QuietCheck = {
  /** `settling`: a reconcile is still to have its go (sm8HooksSettling).
      `unread`: the row, the account's clock or a count couldn't be read. */
  state: Sm8HooksHealth["state"] | "settling" | "unread";
  /** The mirror was counted. */
  counted: boolean;
  /** Quiet, and a reconcile was run for it. */
  ensured: boolean;
};

/** Covered records edited after `stamp` (the account's clock, as the mirror
    keeps edit_date), counted table by table and no further than
    QUIET_EDITS. Null when a count fails. */
async function editedSince(orgId: string, stamp: string): Promise<number | null> {
  let n = 0;
  for (const o of HOOK_OBJECT_NAMES) {
    const { count, error } = await supabaseAdmin
      .from(hookSpecOf(o).table)
      .select("uuid", { count: "exact", head: true })
      .eq("org_id", orgId)
      .gt("edit_date", stamp);
    if (error || typeof count !== "number") return null;
    n += count;
    if (n >= QUIET_EDITS) break;
  }
  return n;
}

/** THE NIGHTLY CHECK, after the syncs have brought the day's edits in:
    1. the row; a reconcile still to have its go is left alone (the
       screen's rule too);
    2. the state from what the reconcile stored — and only when that is
       `ok` and the last ping (or the subscribing) is more than a day old,
       the count: covered records edited since quietStampFrom, in the
       account's clock;
    3. quiet: quiet_since marked, only where it isn't already and no ping
       has come since the row was read (a ping clears the mark and moves
       last_ping_at, and must win), then a reconcile in what is left of
       `budgetMs`. `ok`: a mark from an earlier night cleared.
    Any other state is the reconcile's to put right, and the screen's to
    say. Nothing on any switch but `on`. Never throws. */
export async function checkSm8HooksQuiet(orgId: string, opts: { budgetMs: number; clock?: () => number }): Promise<Sm8QuietCheck> {
  const unread: Sm8QuietCheck = { state: "unread", counted: false, ensured: false };
  if (sm8WebhooksState() !== "on") return unread;
  const clock = opts.clock ?? Date.now;
  const started = clock();
  try {
    const { data, error } = await supabaseAdmin.from(WEBHOOKS).select(HEALTH_COLUMNS).eq("org_id", orgId).maybeSingle();
    if (error) return unread;
    const row = (data as HealthRow | null) ?? null;
    if (row === null || sm8HooksSettling(row, started)) return { state: "settling", counted: false, ensured: false };

    const stored = sm8HooksHealthOf({ ...row, quiet_since: null }, started);
    if (stored.state !== "ok") return { state: stored.state, counted: false, ensured: false };

    const last = quietFrom(msOf(row.last_ping_at), msOf(row.subscribed_at));
    let counted = false;
    let edits: number | null = null;
    if (last !== null && started - last > QUIET_AFTER_MS) {
      const tz = await accountClock(orgId);
      const stamp = tz === null ? null : quietStampFrom(last, tz);
      if (stamp === null) return unread;
      edits = await editedSince(orgId, stamp);
      if (edits === null) return unread;
      counted = true;
    }
    const health = sm8HooksHealth({
      objects: readHookObjects(row.objects),
      subscribedAt: msOf(row.subscribed_at),
      lastPingAt: msOf(row.last_ping_at),
      editedSince: edits,
      now: started,
    });

    if (health.state !== "quiet") {
      if (row.quiet_since !== null) {
        const { error: cleared } = await supabaseAdmin.from(WEBHOOKS).update({ quiet_since: null }).eq("org_id", orgId);
        if (cleared) console.error(`[sm8] live updates for org ${orgId}: couldn't clear the quiet mark: ${cleared.message}`);
      }
      return { state: health.state, counted, ensured: false };
    }

    if (row.quiet_since === null) {
      const mark = supabaseAdmin.from(WEBHOOKS).update({ quiet_since: iso(started) }).eq("org_id", orgId).is("quiet_since", null);
      const { error: marked } = await (row.last_ping_at === null ? mark.is("last_ping_at", null) : mark.eq("last_ping_at", row.last_ping_at));
      if (marked) console.error(`[sm8] live updates for org ${orgId}: couldn't mark it quiet: ${marked.message}`);
    }
    const left = started + opts.budgetMs - clock();
    const ensured = left > 0 ? (await ensureSm8Webhooks(orgId, { budgetMs: left, clock })).ran : false;
    return { state: "quiet", counted, ensured };
  } catch (err) {
    console.error(`[sm8] live updates for org ${orgId}: the health check threw: ${safe(err instanceof Error ? err.message : String(err), [])}`);
    return unread;
  }
}

/** The account's clock, as the last vendor read named it: the zone the
    mirror's edit_date is written in. Null when there is none. */
async function accountClock(orgId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from("sm8_vendor").select("timezone_name").eq("org_id", orgId).maybeSingle();
  if (error) return null;
  const tz = (data as { timezone_name: string | null } | null)?.timezone_name;
  return typeof tz === "string" && tz.trim() ? tz.trim() : null;
}

/* ── a disconnect ── */

export type Sm8RemoveResult = { ran: boolean; deleted: number; stopped: string | null };

/** Unsubscribe every active entry at our address — current, retired or
    dead: a disconnect takes them all. Before the wipe, which then makes any
    ping that still comes `unknown`, answered 410 (unsubscribing it too).
    Bounded by `budgetMs`; the caller also stops waiting at it. Nothing on
    any switch but `on`. Never throws. */
export async function removeSm8Webhooks(orgId: string, opts: { budgetMs: number; clock?: () => number }): Promise<Sm8RemoveResult> {
  if (sm8WebhooksState() !== "on") return { ran: false, deleted: 0, stopped: null };
  const clock = opts.clock ?? Date.now;
  const started = clock();
  try {
    const origin = sm8HookOrigin();
    if (!origin) return { ran: false, deleted: 0, stopped: "no_origin" };
    const accessed = await sm8AccessResult(orgId, started);
    if (!accessed.ok) return { ran: false, deleted: 0, stopped: accessed.reason };
    const run: Run = { orgId, access: accessed.access, end: started + opts.budgetMs, clock, secrets: [], squeeze: true };
    const listed = await listSubs(run, "active");
    if (!listed.ok) return { ran: true, deleted: 0, stopped: listed.stop };
    /* every entry at our path is ours to take down: none is `current`. That
       includes one the reconcile leaves alone (an object it doesn't know,
       at the current address): the reconcile keeps those because it would
       only re-POST what it deleted; a disconnect wants nothing left
       pinging an address about to be wiped. */
    const ours = classifyOurs(listed.subs, origin, { current: null, retired: [] }).filter((s) => s.active);
    let deleted = 0;
    for (const s of ours) {
      const d = await deleteSub(run, s.uuid);
      if (d === "deleted") deleted += 1;
      else if (d === "stop") return { ran: true, deleted, stopped: "stopped" };
    }
    return { ran: true, deleted, stopped: null };
  } catch (err) {
    console.error(`[sm8] live updates for org ${orgId}: unsubscribing threw: ${safe(err instanceof Error ? err.message : String(err), [])}`);
    return { ran: false, deleted: 0, stopped: "failed" };
  }
}
