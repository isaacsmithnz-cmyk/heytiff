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
import { sm8NotesAllowed } from "./sm8-kinds";
import { NOTE_TEXT_DAYS } from "./sm8-note-plan";
import type { Sm8WriteKind } from "./sm8-write-plan";

const TABLE = "sm8_writes";

/** The PostgREST filter for "waiting at this instant". */
const waitingAt = (iso: string) => `status.eq.queued,and(status.eq.sending,lease_until.lt.${iso})`;

/** One write that was cancelled, named as it would have gone, and of which
    kind (a file, or a note — whose name is only its label). */
export type CancelledWrite = { id: string; name: string | null; kind: Sm8WriteKind };

const kindOf = (v: unknown): Sm8WriteKind => (v === "note" ? "note" : "attachment");

function payloadName(payload: unknown): string | null {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return typeof p.name === "string" && p.name.trim() ? p.name.trim() : null;
}

/** Cancel what is waiting, with the reason the row will show. Returns what
    it cancelled, so the caller can say so; empty when nothing matched or the
    write failed (logged).

    `exceptFor` spares the writes queued for that ServiceM8 account — a change
    of account cancels only what was asked of the old one. (tenant_id is NOT
    NULL on every row, so the inequality can't drop one silently.)

    `kind` narrows it to one kind: the owner switching Notes (or Files) off
    cancels only that kind's waiting rows — for notes, creates, flag changes
    and take-backs alike. */
export async function cancelWaitingSm8Writes(
  orgId: string,
  reason: string,
  now: number = Date.now(),
  opts: { exceptFor?: string; kind?: Sm8WriteKind } = {}
): Promise<CancelledWrite[]> {
  const iso = new Date(now).toISOString();
  let q = supabaseAdmin
    .from(TABLE)
    .update({ status: "cancelled", last_error: reason, lease_until: null, updated_at: iso })
    .eq("org_id", orgId)
    .or(waitingAt(iso));
  if (opts.exceptFor) q = q.neq("tenant_id", opts.exceptFor);
  if (opts.kind) q = q.eq("kind", opts.kind);
  const { data, error } = await q.select("id, payload, kind");
  if (error) {
    console.error(`[sm8] couldn't cancel the waiting writes for org ${orgId}:`, error);
    return [];
  }
  return ((data ?? []) as { id: string; payload: unknown; kind?: unknown }[]).map((r) => ({
    id: r.id,
    name: payloadName(r.payload),
    kind: kindOf(r.kind),
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

/** The same count, files and notes apart. ONLY WHEN THE DEPLOYMENT ALLOWS
    NOTES does it count per kind (one head count each); otherwise it is
    today's one query, and every row it counts is a file — so the owner's
    card, chip and bell gain no query on a deployment that sends files. */
export async function countWaitingSm8WritesByKind(
  orgId: string,
  now: number = Date.now()
): Promise<{ attachment: number; note: number }> {
  if (!sm8NotesAllowed()) return { attachment: await countWaitingSm8Writes(orgId, now), note: 0 };
  const iso = new Date(now).toISOString();
  const one = async (kind: Sm8WriteKind) => {
    const { count, error } = await supabaseAdmin
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("kind", kind)
      .or(waitingAt(iso));
    return error ? 0 : count ?? 0;
  };
  const [attachment, note] = await Promise.all([one("attachment"), one("note")]);
  return { attachment, note };
}

/* ── a note's words leave the queue ──

   A NOTE'S WORDS ARE KEPT ON ITS QUEUE ROW (note_text) only while they may
   still be needed to send it. Once the row settles (sent, failed, cancelled
   or a trial) they go 30 days later, and at once on a disconnect or for the
   account a switch left behind. HeyTiff's own row (workboard_notes) keeps
   them, and a later press — Send again, Try again — puts them back.

   ONLY ON NOTE ROWS THAT HOLD WORDS (the partial index's own condition,
   kind = 'note' and note_text is not null), so a file row's remote_message
   is never touched. NEVER updated_at: the 30 days count from it.

   NONE OF THIS RUNS unless the deployment allows notes. A deployment set
   back to files alone (the rollback) runs none of it; the rollback SQL
   clears every note row's words itself (DEPLOY.md). */

const SETTLED = ["sent", "failed", "cancelled", "trial"];
const NOTE_TEXT_DAYS_MS = NOTE_TEXT_DAYS * 86_400_000;

const CLEARED = (iso: string) => ({ note_text: null, text_cleared_at: iso, remote_message: null });

/** Clear the words of settled note rows. `orgId` narrows to one workspace;
    `olderThanDays` to rows settled that long ago; `exceptTenant` spares the
    rows asked of that account (a switch clears only the old account's). The
    number cleared, 0 when nothing ran. */
export async function clearSm8NoteText(
  opts: { orgId?: string; olderThanDays?: number; exceptTenant?: string },
  now: number = Date.now()
): Promise<number> {
  if (!sm8NotesAllowed()) return 0;
  const iso = new Date(now).toISOString();
  let q = supabaseAdmin
    .from(TABLE)
    .update(CLEARED(iso))
    .eq("kind", "note")
    .not("note_text", "is", null)
    .in("status", SETTLED);
  if (opts.orgId) q = q.eq("org_id", opts.orgId);
  if (opts.olderThanDays !== undefined) {
    q = q.lt("updated_at", new Date(now - opts.olderThanDays * 86_400_000).toISOString());
  }
  if (opts.exceptTenant) q = q.neq("tenant_id", opts.exceptTenant);
  const { data, error } = await q.select("id");
  if (error) {
    console.error(`[sm8] couldn't clear the words of settled notes${opts.orgId ? ` for org ${opts.orgId}` : ""}:`, error);
    return 0;
  }
  return (data ?? []).length;
}

/** The workspaces whose queue still holds a note's words and that have no
    ServiceM8 connection any more: a send that finished after a disconnect
    left its words behind, and the page-load clear can't reach an
    unconnected workspace. The nightly cron clears them all. */
export async function clearDisconnectedSm8NoteText(now: number = Date.now()): Promise<number> {
  if (!sm8NotesAllowed()) return 0;
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("org_id")
    .eq("kind", "note")
    .not("note_text", "is", null)
    .in("status", SETTLED)
    .limit(500);
  if (error) return 0;
  const orgs = [...new Set(((data ?? []) as { org_id: string }[]).map((r) => r.org_id))];
  if (orgs.length === 0) return 0;
  const { data: conns, error: connError } = await supabaseAdmin
    .from("integration_connections")
    .select("org_id")
    .eq("provider", "servicem8")
    .in("org_id", orgs);
  if (connError) return 0;
  const connected = new Set(((conns ?? []) as { org_id: string }[]).map((c) => c.org_id));
  let cleared = 0;
  for (const orgId of orgs) if (!connected.has(orgId)) cleared += await clearSm8NoteText({ orgId }, now);
  return cleared;
}

/** Whether one workspace has note words due to leave (settled more than 30
    days ago) — a one-row read on the partial index, so a page load that
    finds nothing gains no write. False when notes aren't allowed. */
export async function sm8NoteTextDue(orgId: string, now: number = Date.now()): Promise<boolean> {
  if (!sm8NotesAllowed()) return false;
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id")
    .eq("org_id", orgId)
    .eq("kind", "note")
    .not("note_text", "is", null)
    .in("status", SETTLED)
    .lt("updated_at", new Date(now - NOTE_TEXT_DAYS_MS).toISOString())
    .limit(1);
  return !error && (data ?? []).length > 0;
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
  sinceIso: string,
  kind?: Sm8WriteKind
): Promise<number> {
  let q = supabaseAdmin
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "cancelled")
    .eq("last_error", reason)
    .gte("updated_at", sinceIso);
  if (kind) q = q.eq("kind", kind);
  const { count, error } = await q;
  return error ? 0 : count ?? 0;
}
