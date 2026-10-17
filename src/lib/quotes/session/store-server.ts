import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { Msg } from "./model";
import type { EventDraft, SessionState } from "./turn";
import { openQuestionsOf } from "./answers";

/* TIFF'S SESSION, KEPT (docs/migrations/quote_sessions.sql). One per
   quote. A turn holds it from start to end, so two never run at once; a
   turn whose function stopped (a deploy, a timeout) is let go once its hold
   is older than any turn can run. Every round is saved under the hold, and
   a save from a turn that lost it is refused. Service role, by org; the
   route gates. */

/** Longer than a turn can run (the route's maxDuration is 300 s). */
export const HOLD_MS = 6 * 60_000;

/** A session as everything but a turn reads it: its hold, its spend and
    whether it's begun, never its conversation. The panel polls every few
    seconds, and every poll read the whole conversation: on 16 October two
    held a drawing set each (7 MB and 11 MB) and the database slowed for
    everyone, ServiceM8's webhooks with it. */
export type SessionHead = { id: string; spentUsd: number; turnId: string | null; turnSince: string | null };
/** A session as a turn reads it: the conversation too. */
export type SessionRow = SessionHead & { messages: Msg[]; summary: string };

/* never the conversation: even one message of it out of the column unpacks the whole of it */
const HEAD_COLS = "id, spent_usd, turn_id, turn_since";
const COLS = "id, messages, summary, spent_usd, turn_id, turn_since";

const headOf = (r: Record<string, unknown>): SessionHead => ({
  id: r.id as string,
  spentUsd: Number(r.spent_usd) || 0,
  turnId: (r.turn_id as string | null) ?? null,
  turnSince: (r.turn_since as string | null) ?? null,
});

const rowOf = (r: Record<string, unknown>): SessionRow => ({
  ...headOf(r),
  messages: Array.isArray(r.messages) ? (r.messages as Msg[]) : [],
  summary: typeof r.summary === "string" ? r.summary : "",
});

export async function readSession(orgId: string, jobUuid: string): Promise<SessionHead | null> {
  const { data } = await supabaseAdmin.from("quote_sessions").select(HEAD_COLS).eq("org_id", orgId).eq("sm8_job_uuid", jobUuid).maybeSingle();
  return data ? headOf(data as Record<string, unknown>) : null;
}

/** Whether anyone has said anything to her on the session yet. */
export async function hasTalked(orgId: string, sessionId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from("quote_session_events").select("id").eq("org_id", orgId).eq("session_id", sessionId).eq("kind", "message").limit(1);
  return (data ?? []).length > 0;
}

/** The session with its conversation: for a turn only. */
async function readSessionState(orgId: string, jobUuid: string): Promise<SessionRow | null> {
  const { data } = await supabaseAdmin.from("quote_sessions").select(COLS).eq("org_id", orgId).eq("sm8_job_uuid", jobUuid).maybeSingle();
  return data ? rowOf(data) : null;
}

async function openSession(orgId: string, jobUuid: string): Promise<SessionRow | null> {
  const had = await readSessionState(orgId, jobUuid);
  if (had) return had;
  const { data } = await supabaseAdmin
    .from("quote_sessions")
    .upsert({ org_id: orgId, sm8_job_uuid: jobUuid }, { onConflict: "org_id,sm8_job_uuid", ignoreDuplicates: true })
    .select(COLS)
    .maybeSingle();
  return data ? rowOf(data) : readSessionState(orgId, jobUuid);
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

/** The most of a thread one read brings. */
const THREAD_READ = 500;

/** The thread as a person reads it, after `since` (an event id), oldest
    first. Opened (since 0), it's the newest THREAD_READ: read from the
    start, a session past them showed its first 500 events for good and
    never what she'd just said. A poll reads on from `since`, oldest first,
    and the panel's next poll carries on from the last of them, so a burst
    bigger than one read skips nothing. */
export async function readThread(orgId: string, jobUuid: string, since = 0): Promise<{ session: SessionHead | null; events: ThreadEvent[] }> {
  const session = await readSession(orgId, jobUuid);
  if (!session) return { session: null, events: [] };
  const q = supabaseAdmin.from("quote_session_events").select("id, turn_id, kind, author, body, at").eq("org_id", orgId).eq("session_id", session.id);
  const { data } = since > 0 ? await q.gt("id", since).order("id", { ascending: true }).limit(THREAD_READ) : await q.order("id", { ascending: false }).limit(THREAD_READ);
  const rows = (data ?? []) as { id: number; turn_id: string | null; kind: AnyEvent["kind"]; author: string; body: Record<string, unknown>; at: string }[];
  const events = (since > 0 ? rows : [...rows].reverse()).map((e) => ({
    id: e.id,
    turnId: e.turn_id,
    kind: e.kind,
    author: e.author,
    body: e.body,
    at: e.at,
  }));
  return { session, events };
}

/** A thread from one event on, all of it, oldest first: what a tapped
    answer or a used price acts on, with everything said since (any answer
    to it among them). The panel holds the newest THREAD_READ it opened on
    and every poll after, so what it shows can sit further back than one
    read of the newest by the time it's tapped. */
export async function readThreadFrom(orgId: string, jobUuid: string, id: number): Promise<ThreadEvent[]> {
  if (!(id >= 1)) return [];
  const out: ThreadEvent[] = [];
  for (let since = id - 1; ; ) {
    const { events } = await readThread(orgId, jobUuid, since);
    out.push(...events);
    if (events.length < THREAD_READ) return out;
    since = events.at(-1)!.id;
  }
}

/** Her questions still open in a session, oldest first (answers.ts). */
export async function readOpenQuestions(orgId: string, sessionId: string): Promise<{ id: number; question: string; put: string }[]> {
  const { data } = await supabaseAdmin
    .from("quote_session_events")
    .select("id, kind, author, body, at")
    .eq("org_id", orgId)
    .eq("session_id", sessionId)
    .in("kind", ["question", "message", "tool"])
    .order("id", { ascending: true })
    .limit(2000);
  return openQuestionsOf((data ?? []) as { id: number; kind: string; author: string; body: Record<string, unknown>; at: string }[]);
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
