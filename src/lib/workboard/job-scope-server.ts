import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  SCOPE_SCHEMA,
  SCOPE_SYSTEM_PROMPT,
  newlyAdded,
  proposalWords,
  scopeMoved,
  scopeOf,
  scopePrompt,
  scopeStamp,
  scopeWanted,
  stillAdded,
  withoutAdded,
  wordsWithoutMoney,
  sentVersion,
  type JobScopeRead,
  type ScopeAdded,
  type ScopeQuoted,
  type ScopeSetAside,
} from "@/lib/jobs/job-scope";
import { readByHand } from "@/lib/quotes/lines-job-server";
import { resolveJobCard } from "./all-jobs-query";
import { getSm8Timezone } from "./query";
import { wallInstant } from "@/lib/integrations/sm8-booking-plan";
import { zoneOr } from "@/lib/au-dates";
import { isMoneyStoryEntry, storyLineOf } from "./job-story";
import { readJobStoryForSummary } from "./job-summary";

/* A JOB'S SCOPE, WRITTEN AND KEPT (lib/jobs/job-scope.ts says what it is).

   WRITTEN FROM THE SAME STORY AS THE SUMMARY. The stored brief draws at once,
   and a rewrite runs only when a new note has moved `scopeStamp` past the one
   it was written at. A quiet job costs nothing; a new note costs one read.
   Only a job scopeWanted says yes to is written for.

   UNDO COSTS NO READ (feedback: Tiff's reads are paid once). A rewrite that
   changed the brief keeps the one before it, and Undo puts that back. A write
   is guarded by the `written_at` it started from, so a read that finishes
   after someone's Undo can't lay the old change back over it.

   THE QUOTE (slice 3). `quote_stamp` is the newest thing said or written on
   the quote that the brief has read, so a turn on the quote is one read at
   most, the next time someone looks. What a NOTE adds while the quote has
   lines waits on `since_priced` for the quote's rail; what the quote's own
   conversation adds never does, or she'd be asked to price her own work.

   AFTER IT'S SENT (slice 4). The same list is Since the quote once ServiceM8
   has sent it or the job's accepted: `withQuoteState` says which, from the
   job's own row, on every read, so a send in ServiceM8 shows the next time
   anyone looks and nothing is stored twice. */

const MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 6000;

const COLUMNS = "brief, previous_brief, set_aside, since_priced, quote_stamp, story_stamp, written_at";
type ScopeRow = { brief: unknown; previous_brief: unknown; set_aside: unknown; since_priced?: unknown; quote_stamp?: string | null; story_stamp: string; written_at: string };

const sincePricedOf = (row: ScopeRow | null): ScopeAdded[] => (Array.isArray(row?.since_priced) ? (row.since_priced as ScopeAdded[]) : []);

const asScope = (row: ScopeRow | null): JobScopeRead | null => {
  const scope = row ? scopeOf(row.brief) : null;
  return row && scope ? { ...scope, stamp: row.story_stamp, writtenAt: row.written_at, canUndo: !!scopeOf(row.previous_brief), sincePriced: stillAdded(sincePricedOf(row), scope) } : null;
};
const setAsideOf = (row: ScopeRow | null): ScopeSetAside[] => (Array.isArray(row?.set_aside) ? (row.set_aside as ScopeSetAside[]) : []);

async function readRow(orgId: string, jobUuid: string): Promise<ScopeRow | null> {
  const { data } = await supabaseAdmin.from("job_scopes").select(COLUMNS).eq("org_id", orgId).eq("job_uuid", jobUuid).maybeSingle();
  return data as ScopeRow | null;
}

export async function readStoredJobScope(orgId: string, jobUuid: string): Promise<JobScopeRead | null> {
  const row = await readRow(orgId, jobUuid);
  const scope = asScope(row);
  if (!scope) return null;
  const [quoteStamp, state] = await Promise.all([quoteStampOf(orgId, jobUuid), quoteStateOf(orgId, jobUuid)]);
  return { ...scope, quoteDue: quoteStamp !== (row?.quote_stamp ?? null), ...state };
}

/** Whether ServiceM8 has sent the quote, on what day and which version, and
    whether the job's past Quote. ServiceM8's stamp is its wall time. */
async function quoteStateOf(orgId: string, jobUuid: string): Promise<{ quoted: ScopeQuoted | null; accepted: boolean }> {
  const [{ data: job }, { data: kept }, timezone] = await Promise.all([
    supabaseAdmin.from("sm8_jobs").select("status, quote_sent_stamp").eq("org_id", orgId).eq("uuid", jobUuid).maybeSingle(),
    supabaseAdmin.from("quote_versions").select("made_at").eq("org_id", orgId).eq("sm8_job_uuid", jobUuid),
    getSm8Timezone(orgId),
  ]);
  const row = job as { status?: string | null; quote_sent_stamp?: string | null } | null;
  const accepted = !!row?.status && row.status.trim().toLowerCase() !== "quote";
  const zone = zoneOr(timezone);
  const sentMs = wallInstant(row?.quote_sent_stamp ?? null, zone, "earliest");
  if (sentMs == null) return { quoted: null, accepted };
  const on = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: zone }).format(new Date(sentMs)).replace(",", "");
  const keptAt = ((kept ?? []) as { made_at?: string | null }[]).map((k) => k.made_at ?? "").filter(Boolean);
  return { quoted: { on, version: sentVersion(sentMs, keptAt) }, accepted };
}

/** A brief as the Overview and the quote read it: with whether it's gone to
    the client. */
export async function withQuoteState(orgId: string, remoteId: string, scope: JobScopeRead | null): Promise<JobScopeRead | null> {
  if (!scope) return null;
  const { parentRemoteId } = await resolveJobCard(orgId, remoteId);
  return { ...scope, ...(await quoteStateOf(orgId, parentRemoteId)) };
}

/** The newest thing a person said on the quote or Tiff wrote for its proposal;
    null when nobody has talked to her about this job. */
async function quoteStampOf(orgId: string, jobUuid: string): Promise<string | null> {
  const { data: session } = await supabaseAdmin.from("quote_sessions").select("id").eq("org_id", orgId).eq("sm8_job_uuid", jobUuid).maybeSingle();
  const id = (session as { id?: string } | null)?.id;
  if (!id) return null;
  const { data } = await supabaseAdmin
    .from("quote_session_events")
    .select("id")
    .eq("org_id", orgId)
    .eq("session_id", id)
    .or("kind.eq.message,body->>name.eq.write_proposal")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const newest = (data as { id?: number } | null)?.id;
  return newest ? `q${newest}` : null;
}

/** What people have said on the quote, oldest first, and the proposal's
    words, none of it carrying money. */
async function readQuoteWords(orgId: string, jobUuid: string, timezone: string | null): Promise<{ said: string[]; proposal: string }> {
  const { data: session } = await supabaseAdmin.from("quote_sessions").select("id").eq("org_id", orgId).eq("sm8_job_uuid", jobUuid).maybeSingle();
  const id = (session as { id?: string } | null)?.id;
  const [events, byHand] = await Promise.all([
    id
      ? supabaseAdmin.from("quote_session_events").select("at, body").eq("org_id", orgId).eq("session_id", id).eq("kind", "message").order("id", { ascending: false }).limit(40)
      : Promise.resolve({ data: [] }),
    readByHand(orgId, jobUuid).catch(() => null),
  ]);
  const day = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: timezone ?? undefined });
  const said = ((events.data ?? []) as { at: string; body: { text?: unknown; read?: unknown } }[])
    .filter((e) => !e.body?.read && typeof e.body?.text === "string")
    .map((e) => ({ on: day.format(new Date(e.at)).replace(",", ""), text: wordsWithoutMoney(e.body.text as string) }))
    .filter((e) => e.text)
    .map((e) => `${e.on}: ${e.text}`)
    .reverse();
  return { said, proposal: byHand?.proposal ? proposalWords(byHand.proposal) : "" };
}

/** Whether the job's quote has any lines yet: before it does, nothing's been
    priced for a thing to have landed since. */
async function quoteHasLines(orgId: string, jobUuid: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from("quote_lines").select("id").eq("org_id", orgId).eq("sm8_job_uuid", jobUuid).limit(1).maybeSingle();
  return !!data;
}

/** Change a stored brief, unless someone else changed it since it was read.
    False when they did. */
async function writeOver(orgId: string, jobUuid: string, row: ScopeRow, change: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("job_scopes")
    .update(change)
    .eq("org_id", orgId)
    .eq("job_uuid", jobUuid)
    .eq("written_at", row.written_at)
    .select("job_uuid");
  return !error && (data as unknown[] | null)?.length === 1;
}

export type ScopeRefreshResult = { ok: true; scope: JobScopeRead | null; wrote: boolean } | { ok: false; reason: string };

function reasonFor(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return "Tiff is busy. Try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Tiff.";
  return "The scope couldn't be written.";
}

/** Derive, compare, maybe write, store. The stamp comparison is the cost
    guard: asking again when nothing moved costs a derive, never a read. */
export async function refreshJobScope(orgId: string, remoteId: string, client: Anthropic = new Anthropic()): Promise<ScopeRefreshResult> {
  const read = await readJobStoryForSummary(orgId, remoteId);
  if (!read) return { ok: false, reason: "That job isn't in the mirror." };

  const row = await readRow(orgId, read.cardId);
  const stored = asScope(row);
  const stamp = scopeStamp(read.entries);
  if (!stamp || !scopeWanted(read.status, read.createdOn)) return { ok: true, scope: stored, wrote: false };
  const quoteStamp = await quoteStampOf(orgId, read.cardId);
  if (stored && stored.stamp === stamp && quoteStamp === (row?.quote_stamp ?? null)) return { ok: true, scope: stored, wrote: false };
  const quote = quoteStamp ? await readQuoteWords(orgId, read.cardId, await getSm8Timezone(orgId)) : null;

  /* what the model never saw it cannot leak: no money-shaped entry */
  const lines = read.entries.filter((e) => !isMoneyStoryEntry(e)).map(storyLineOf);
  let scope;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCOPE_SCHEMA } },
      system: SCOPE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: scopePrompt({ status: read.status, clientName: read.clientName, scope: read.scope, workDone: read.workDone, lines, previous: stored, setAside: setAsideOf(row), quote }) }],
    });
    if (response.stop_reason === "refusal") return { ok: false, reason: "Tiff wouldn't write this job's scope." };
    const block = response.content.find((b) => b.type === "text");
    scope = block && block.type === "text" ? scopeOf(JSON.parse(block.text)) : null;
  } catch (err) {
    return { ok: false, reason: reasonFor(err) };
  }
  if (!scope) return { ok: true, scope: stored, wrote: false };

  const writtenAt = new Date().toISOString();
  if (row && stored) {
    /* handed back unchanged: the note is taken in, and the last change is still the one to undo */
    if (!scopeMoved(stored, scope)) {
      const kept = await writeOver(orgId, read.cardId, row, { story_stamp: stamp, quote_stamp: quoteStamp, written_at: writtenAt });
      return { ok: true, scope: kept ? { ...stored, stamp, writtenAt } : await readStoredJobScope(orgId, read.cardId), wrote: false };
    }
    /* only a note's addition waits on the quote: the quote's own words are on it already */
    const landed = stored.stamp !== stamp ? newlyAdded(stored, scope) : [];
    const waiting = stillAdded([...sincePricedOf(row), ...(landed.length && (await quoteHasLines(orgId, read.cardId)) ? landed : [])], scope);
    const wrote = await writeOver(orgId, read.cardId, row, { brief: scope, previous_brief: row.brief, since_priced: waiting, story_stamp: stamp, quote_stamp: quoteStamp, written_at: writtenAt });
    if (!wrote) return { ok: true, scope: await readStoredJobScope(orgId, read.cardId), wrote: false };
    return { ok: true, scope: { ...scope, stamp, writtenAt, canUndo: true, sincePriced: waiting }, wrote: true };
  }
  const { error } = await supabaseAdmin
    .from("job_scopes")
    .upsert({ org_id: orgId, job_uuid: read.cardId, brief: scope, story_stamp: stamp, quote_stamp: quoteStamp, written_at: writtenAt }, { onConflict: "org_id,job_uuid" });
  if (error) return { ok: false, reason: "The scope couldn't be saved." };
  return { ok: true, scope: { ...scope, stamp, writtenAt, canUndo: false }, wrote: true };
}

/** Put the brief back as it was before Tiff's newest change, with no read.
    The stamp stays, so the note that made the change isn't read again; what
    it added goes on the set-aside list, so the next rewrite leaves it out. */
export async function undoJobScope(orgId: string, remoteId: string, who: string | null): Promise<ScopeRefreshResult> {
  const { parentRemoteId: jobUuid } = await resolveJobCard(orgId, remoteId);
  const row = await readRow(orgId, jobUuid);
  const current = row ? scopeOf(row.brief) : null;
  const previous = row ? scopeOf(row.previous_brief) : null;
  if (!row || !current || !previous) return { ok: false, reason: "There's nothing to undo." };

  const timezone = await getSm8Timezone(orgId);
  const on = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: timezone ?? undefined })
    .format(new Date())
    .replace(",", "");
  const said = current.undoSaid || "Took out the last change.";
  const brief = { ...previous, undoSaid: "", updates: [{ on, from: who ?? "", said }, ...previous.updates].slice(0, 4) };
  const setAside = [...setAsideOf(row), { on, said: current.updates[0]?.said ?? said }].slice(-12);
  const writtenAt = new Date().toISOString();
  const wrote = await writeOver(orgId, jobUuid, row, { brief, previous_brief: null, set_aside: setAside, written_at: writtenAt });
  if (!wrote) return { ok: false, reason: "The scope has just changed. Have another look." };
  return { ok: true, scope: { ...brief, stamp: row.story_stamp, writtenAt, canUndo: false, sincePriced: stillAdded(sincePricedOf(row), brief) }, wrote: true };
}

/** Off the quote's rail, priced or left out. It stays in the brief, and asks
    nothing of Tiff. */
export async function takeOffQuoteRail(orgId: string, remoteId: string, taken: readonly string[]): Promise<ScopeRefreshResult> {
  const { parentRemoteId: jobUuid } = await resolveJobCard(orgId, remoteId);
  const row = await readRow(orgId, jobUuid);
  const scope = asScope(row);
  if (!row || !scope) return { ok: false, reason: "There's no scope on this job." };
  const waiting = withoutAdded(sincePricedOf(row), taken);
  const writtenAt = new Date().toISOString();
  const wrote = await writeOver(orgId, jobUuid, row, { since_priced: waiting, written_at: writtenAt });
  if (!wrote) return { ok: false, reason: "The scope has just changed. Have another look." };
  return { ok: true, scope: { ...scope, writtenAt, sincePriced: stillAdded(waiting, scope) }, wrote: false };
}
