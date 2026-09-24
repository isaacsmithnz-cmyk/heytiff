/* Cancelling and counting the writes still waiting to go to ServiceM8 —
   server only.

   Its own module so the connection store can reach it: sm8-writes.ts imports
   sm8-store.ts for tokens, and disconnect and an account switch in the store
   must cancel what is waiting without importing the sender back. sm8-writes
   re-exports the cancel, so nothing that already called it moves.

   ONE DEFINITION OF "WAITING", used by the cancel and by the count the
   disconnect confirm reads, so the number the owner is shown is the number
   that goes: a queued row, or a send whose claim has lapsed (its worker died
   mid-request). A send holding a live claim is IN FLIGHT: pulling its row
   from under it would record a file ServiceM8 may already hold as never sent,
   so it is left to land or not, and only counted. */

import { supabaseAdmin } from "@/lib/supabase-server";

const TABLE = "sm8_writes";

/** The PostgREST filter for "waiting at this instant". */
const waitingAt = (iso: string) => `status.eq.queued,and(status.eq.sending,lease_until.lt.${iso})`;

/** One write that was cancelled, named as it would have gone. */
export type CancelledWrite = { id: string; name: string | null };

function payloadName(payload: unknown): string | null {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return typeof p.name === "string" && p.name.trim() ? p.name.trim() : null;
}

/** Cancel what is waiting, with the reason the row will show. Returns what
    it cancelled, so the caller can say so; empty when nothing matched or the
    write failed (logged).

    `exceptFor` spares the writes queued for that ServiceM8 account — a change
    of account cancels only what was asked of the old one. (tenant_id is NOT
    NULL on every row, so the inequality can't drop one silently.) */
export async function cancelWaitingSm8Writes(
  orgId: string,
  reason: string,
  now: number = Date.now(),
  opts: { exceptFor?: string } = {}
): Promise<CancelledWrite[]> {
  const iso = new Date(now).toISOString();
  let q = supabaseAdmin
    .from(TABLE)
    .update({ status: "cancelled", last_error: reason, lease_until: null, updated_at: iso })
    .eq("org_id", orgId)
    .or(waitingAt(iso));
  if (opts.exceptFor) q = q.neq("tenant_id", opts.exceptFor);
  const { data, error } = await q.select("id, payload");
  if (error) {
    console.error(`[sm8] couldn't cancel the waiting writes for org ${orgId}:`, error);
    return [];
  }
  return ((data ?? []) as { id: string; payload: unknown }[]).map((r) => ({
    id: r.id,
    name: payloadName(r.payload),
  }));
}

/** How many writes are waiting to go — what a cancel would take now. Zero
    when the count can't be read: it only ever adds a line to a confirm. */
export async function countWaitingSm8Writes(orgId: string, now: number = Date.now()): Promise<number> {
  const iso = new Date(now).toISOString();
  const { count, error } = await supabaseAdmin
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .or(waitingAt(iso));
  return error ? 0 : count ?? 0;
}

/** How many sends are mid-request right now: claimed, the claim still live.
    A cancel leaves these alone, and they may still arrive. */
export async function countSm8WritesInFlight(orgId: string, now: number = Date.now()): Promise<number> {
  const iso = new Date(now).toISOString();
  const { count, error } = await supabaseAdmin
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "sending")
    .gte("lease_until", iso);
  return error ? 0 : count ?? 0;
}

/** How many writes were cancelled for `reason` since `sinceIso` — the
    account-switch notice's figure, read from the rows rather than carried in
    a URL. */
export async function countSm8WritesCancelledSince(
  orgId: string,
  reason: string,
  sinceIso: string
): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "cancelled")
    .eq("last_error", reason)
    .gte("updated_at", sinceIso);
  return error ? 0 : count ?? 0;
}
