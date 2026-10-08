import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { Msg } from "./model";
import type { EventDraft, SessionState } from "./turn";

/* TIFF'S SESSION, KEPT (docs/migrations/quote_sessions.sql). One per
   quote. A turn holds it from start to end, so two never run at once; a
   turn whose function stopped (a deploy, a timeout) is let go once its hold
   is older than any turn can run. Every round is saved under the hold, and
   a save from a turn that lost it is refused. Service role, by org; the
   route gates. */

/** Longer than a turn can run (the route's maxDuration is 300 s). */
export const HOLD_MS = 6 * 60_000;

export type SessionRow = { id: string; messages: Msg[]; summary: string; spentUsd: number; turnId: string | null; turnSince: string | null };

const COLS = "id, messages, summary, spent_usd, turn_id, turn_since";

const rowOf = (r: Record<string, unknown>): SessionRow => ({
  id: r.id as string,
  messages: Array.isArray(r.messages) ? (r.messages as Msg[]) : [],
  summary: typeof r.summary === "string" ? r.summary : "",
  spentUsd: Number(r.spent_usd) || 0,
  turnId: (r.turn_id as string | null) ?? null,
  turnSince: (r.turn_since as string | null) ?? null,
});

export async function readSession(orgId: string, jobUuid: string): Promise<SessionRow | null> {
  const { data } = await supabaseAdmin.from("quote_sessions").select(COLS).eq("org_id", orgId).eq("sm8_job_uuid", jobUuid).maybeSingle();
  return data ? rowOf(data) : null;
}

async function openSession(orgId: string, jobUuid: string): Promise<SessionRow | null> {
  const had = await readSession(orgId, jobUuid);
  if (had) return had;
  const { data } = await supabaseAdmin
    .from("quote_sessions")
    .upsert({ org_id: orgId, sm8_job_uuid: jobUuid }, { onConflict: "org_id,sm8_job_uuid", ignoreDuplicates: true })
    .select(COLS)
    .maybeSingle();
  return data ? rowOf(data) : readSession(orgId, jobUuid);
}

/** Whether a turn's hold still stands at `now`. Pure. */
export const holding = (s: Pick<SessionRow, "turnId" | "turnSince">, now: number) => !!s.turnId && !!s.turnSince && now - Date.parse(s.turnSince) < HOLD_MS;

/** Starts a turn: the session held for it, or why not. */
export async function beginTurn(orgId: string, jobUuid: string): Promise<{ ok: true; session: SessionRow; turnId: string } | { ok: false; reason: string }> {
  const s = await openSession(orgId, jobUuid);
  if (!s) return { ok: false, reason: "Tiff's session couldn't be opened. Try again." };
  if (holding(s, Date.now())) return { ok: false, reason: "Tiff is still working on the last one." };
  const turnId = crypto.randomUUID();
  const now = new Date().toISOString();
  /* taken only from the hold that was read: a turn begun meanwhile wins */
  let q = supabaseAdmin.from("quote_sessions").update({ turn_id: turnId, turn_since: now, updated_at: now }).eq("id", s.id);
  q = s.turnId ? q.eq("turn_id", s.turnId) : q.is("turn_id", null);
  const { data } = await q.select("id");
  if (!data || data.length === 0) return { ok: false, reason: "Tiff is still working on the last one." };
  return { ok: true, session: { ...s, turnId, turnSince: now }, turnId };
}

/** One round kept: the conversation and what it cost, under the turn's
    hold, then the round's events. False: the hold was lost. */
export async function saveRound(orgId: string, sessionId: string, turnId: string, state: SessionState, spentUsd: number, events: EventDraft[]): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("quote_sessions")
    .update({ messages: state.messages, summary: state.summary, spent_usd: spentUsd, turn_since: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("turn_id", turnId)
    .select("id");
  if (!data || data.length === 0) return false;
  if (events.length) await addEvents(orgId, sessionId, turnId, events);
  return true;
}

export async function endTurn(sessionId: string, turnId: string): Promise<void> {
  await supabaseAdmin.from("quote_sessions").update({ turn_id: null, turn_since: null }).eq("id", sessionId).eq("turn_id", turnId);
}

type AnyEvent = EventDraft | { kind: "message" | "milestone"; author: string; body: Record<string, unknown> };

export async function addEvents(orgId: string, sessionId: string, turnId: string | null, events: readonly AnyEvent[]): Promise<void> {
  const { error } = await supabaseAdmin
    .from("quote_session_events")
    .insert(events.map((e) => ({ org_id: orgId, session_id: sessionId, turn_id: turnId, kind: e.kind, author: e.author, body: e.body })));
  if (error) console.error("[quote-session] events not kept:", error.message);
}

export type ThreadEvent = { id: number; turnId: string | null; kind: AnyEvent["kind"]; author: string; body: Record<string, unknown>; at: string };

/** The thread as a person reads it, after `since` (an event id), oldest first. */
export async function readThread(orgId: string, jobUuid: string, since = 0): Promise<{ session: SessionRow | null; events: ThreadEvent[] }> {
  const session = await readSession(orgId, jobUuid);
  if (!session) return { session: null, events: [] };
  const { data } = await supabaseAdmin
    .from("quote_session_events")
    .select("id, turn_id, kind, author, body, at")
    .eq("org_id", orgId)
    .eq("session_id", session.id)
    .gt("id", since)
    .order("id", { ascending: true })
    .limit(500);
  const events = ((data ?? []) as { id: number; turn_id: string | null; kind: AnyEvent["kind"]; author: string; body: Record<string, unknown>; at: string }[]).map((e) => ({
    id: e.id,
    turnId: e.turn_id,
    kind: e.kind,
    author: e.author,
    body: e.body,
    at: e.at,
  }));
  return { session, events };
}

/** The answers given since her last turn, taken into this one: each marked
    with the turn that told her. */
export async function takeAnswers(orgId: string, sessionId: string, turnId: string): Promise<{ question: string; answer: string }[]> {
  const { data } = await supabaseAdmin
    .from("quote_session_events")
    .select("id, body")
    .eq("org_id", orgId)
    .eq("session_id", sessionId)
    .eq("kind", "message")
    .is("turn_id", null)
    .not("body->answered", "is", null)
    .order("id", { ascending: true });
  const rows = (data ?? []) as { id: number; body: Record<string, unknown> }[];
  if (rows.length === 0) return [];
  await supabaseAdmin.from("quote_session_events").update({ turn_id: turnId }).in("id", rows.map((r) => r.id));
  return rows.map((r) => ({ question: String(r.body.question ?? ""), answer: String(r.body.text ?? "") }));
}
