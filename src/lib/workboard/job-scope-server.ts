import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  SCOPE_SCHEMA,
  SCOPE_SYSTEM_PROMPT,
  scopeMoved,
  scopeOf,
  scopePrompt,
  scopeStamp,
  scopeWanted,
  type JobScopeRead,
  type ScopeSetAside,
} from "@/lib/jobs/job-scope";
import { resolveJobCard } from "./all-jobs-query";
import { getSm8Timezone } from "./query";
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
   after someone's Undo can't lay the old change back over it. */

const MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 6000;

const COLUMNS = "brief, previous_brief, set_aside, story_stamp, written_at";
type ScopeRow = { brief: unknown; previous_brief: unknown; set_aside: unknown; story_stamp: string; written_at: string };

const asScope = (row: ScopeRow | null): JobScopeRead | null => {
  const scope = row ? scopeOf(row.brief) : null;
  return row && scope ? { ...scope, stamp: row.story_stamp, writtenAt: row.written_at, canUndo: !!scopeOf(row.previous_brief) } : null;
};
const setAsideOf = (row: ScopeRow | null): ScopeSetAside[] => (Array.isArray(row?.set_aside) ? (row.set_aside as ScopeSetAside[]) : []);

async function readRow(orgId: string, jobUuid: string): Promise<ScopeRow | null> {
  const { data } = await supabaseAdmin.from("job_scopes").select(COLUMNS).eq("org_id", orgId).eq("job_uuid", jobUuid).maybeSingle();
  return data as ScopeRow | null;
}

export async function readStoredJobScope(orgId: string, jobUuid: string): Promise<JobScopeRead | null> {
  return asScope(await readRow(orgId, jobUuid));
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
  if (stored && stored.stamp === stamp) return { ok: true, scope: stored, wrote: false };

  /* what the model never saw it cannot leak: no money-shaped entry */
  const lines = read.entries.filter((e) => !isMoneyStoryEntry(e)).map(storyLineOf);
  let scope;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCOPE_SCHEMA } },
      system: SCOPE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: scopePrompt({ status: read.status, clientName: read.clientName, scope: read.scope, workDone: read.workDone, lines, previous: stored, setAside: setAsideOf(row) }) }],
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
      const kept = await writeOver(orgId, read.cardId, row, { story_stamp: stamp, written_at: writtenAt });
      return { ok: true, scope: kept ? { ...stored, stamp, writtenAt } : await readStoredJobScope(orgId, read.cardId), wrote: false };
    }
    const wrote = await writeOver(orgId, read.cardId, row, { brief: scope, previous_brief: row.brief, story_stamp: stamp, written_at: writtenAt });
    if (!wrote) return { ok: true, scope: await readStoredJobScope(orgId, read.cardId), wrote: false };
    return { ok: true, scope: { ...scope, stamp, writtenAt, canUndo: true }, wrote: true };
  }
  const { error } = await supabaseAdmin
    .from("job_scopes")
    .upsert({ org_id: orgId, job_uuid: read.cardId, brief: scope, story_stamp: stamp, written_at: writtenAt }, { onConflict: "org_id,job_uuid" });
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
  return { ok: true, scope: { ...brief, stamp: row.story_stamp, writtenAt, canUndo: false }, wrote: true };
}
