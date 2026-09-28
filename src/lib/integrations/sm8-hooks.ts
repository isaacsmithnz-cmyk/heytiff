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
      ACTIVE at a retired or dead address — each once.
   5. What was found, per object (sm8_webhooks.objects: the spelling, the
      subscription's uuid, active, a refusal, a turn-off — NEVER an
      address), subscribed_at when all six are active at the address, and
      ensure_tried_at. A rotation owed is cleared only here, at the end,
      and only when this run minted.
   Every call starts only while its worst case still ends inside the
   caller's budget, and it never throws.

   THE SECRET IS NEVER KEPT. Not in a column, not in a log line, not in
   JSON. Every text of ServiceM8's that is stored or logged goes through
   redactHook first, with the secrets this run holds named, so a refusal
   that echoes the address keeps `[hook]` in its place.

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
  classifyOurs,
  hookFieldsFor,
  hookHashOf,
  hookSpecOf,
  isUnsupportedObject,
  ourSecretIn,
  planSubscriptions,
  readHookList,
  readHookObjects,
  redactHook,
  spellingsFor,
  type HookObjectName,
  type HookObjectState,
  type HookObjectsState,
  type HookPlan,
  type HookSub,
  type OurHashes,
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

/** Whether a request with this timeout, and the meter's longest wait on the
    `hook` lane before it, still ends by the budget's end. */
function fits(run: Run, timeoutMs: number): boolean {
  return run.clock() + timeoutMs + HOOK_METER_WAIT_MS <= run.end;
}

async function hooksCall(run: Run, method: Sm8HooksMethod, path: string, init: { query?: Record<string, string>; body?: URLSearchParams } = {}): Promise<Hit> {
  let timeoutMs = method === "POST" ? HOOK_POST_TIMEOUT_MS : HOOK_LIST_TIMEOUT_MS;
  if (run.squeeze) {
    timeoutMs = Math.min(timeoutMs, run.end - run.clock() - HOOK_METER_WAIT_MS);
    if (timeoutMs < SQUEEZE_MIN_MS) return { kind: "late" };
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

/** Whether a DELETE landed: 2xx, or 404 ("No matching webhook found") —
    gone either way. */
async function deleteSub(run: Run, uuid: string): Promise<"deleted" | "stop" | "failed"> {
  const hit = await hooksCall(run, "DELETE", `/webhook_subscriptions/${uuid}`);
  if (hit.kind === "response") return (hit.status >= 200 && hit.status <= 299) || hit.status === 404 ? "deleted" : "failed";
  return hit.kind === "failed" ? "failed" : "stop";
}

/* ── the reconcile ── */

export type Sm8EnsureResult =
  | { ran: false; why: "off" | "not_connected" | "no_origin" | "failed" }
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
         it goes back, and nothing is subscribed at the new address yet */
      rotationStamp = owedAt ?? iso(started);
      const owe = await supabaseAdmin
        .from(WEBHOOKS)
        .update({ rotate_wanted_at: rotationStamp, subscribed_at: null })
        .eq("org_id", orgId);
      if (owe.error) console.error(`[sm8] live updates for org ${orgId}: couldn't keep the rotation owed: ${owe.error.message}`);
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
        touch(d.object, { active: false, failure_reason: safe(d.reason, run.secrets), failure_at: d.at });
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
        touch(object, { name: outcome.name, active: true, error: null });
      } else {
        touch(object, { active: false, error: outcome.error });
        console.error(`[sm8] live updates for org ${orgId}: ServiceM8 refused ${object}: ${outcome.error}`);
      }
    }

    /* 4. after any POST, the list again; the DELETEs come from the latest */
    let delPlan: HookPlan = plan;
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
    if (!stopped && latest) {
      for (const uuid of delPlan.del) {
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
      /* covered: whatever was refused before isn't any more */
      ...(covering ? { error: null, ...(covering.object ? { name: covering.object } : {}) } : {}),
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

/** Whether a reconcile is owed on a page load: a rotation is waiting, or
    the six aren't all subscribed — and none was tried in the last hour. */
export function sm8EnsureOwed(row: Pick<StateRow, "rotate_wanted_at" | "subscribed_at" | "ensure_tried_at"> | null, now: number): boolean {
  const owed = row === null || row.rotate_wanted_at !== null || row.subscribed_at === null;
  const tried = msOf(row?.ensure_tried_at ?? null);
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
    /* every hash at our path is ours to take down: none is `current` */
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
