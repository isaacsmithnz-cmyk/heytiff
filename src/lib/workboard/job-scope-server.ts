import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { SCOPE_SCHEMA, SCOPE_SYSTEM_PROMPT, scopeOf, scopePrompt, scopeWanted, type JobScopeRead } from "@/lib/jobs/job-scope";
import { isMoneyStoryEntry, storyLineOf } from "./job-story";
import { readJobStoryForSummary } from "./job-summary";

/* A JOB'S SCOPE, WRITTEN AND KEPT (lib/jobs/job-scope.ts says what it is).

   WRITTEN FROM THE SAME STORY AS THE SUMMARY, and refreshed the same way:
   the stored brief draws at once, and a rewrite runs only when the job's
   story stamp has moved past the one it was written at. A quiet job costs
   nothing; a job that something new lands on costs one read. Only a job
   being quoted or worked is written for (scopeWanted). */

const MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 6000;

type ScopeRow = { brief: unknown; story_stamp: string; written_at: string };

export async function readStoredJobScope(orgId: string, jobUuid: string): Promise<JobScopeRead | null> {
  const { data } = await supabaseAdmin
    .from("job_scopes")
    .select("brief, story_stamp, written_at")
    .eq("org_id", orgId)
    .eq("job_uuid", jobUuid)
    .maybeSingle();
  const row = data as ScopeRow | null;
  const scope = row ? scopeOf(row.brief) : null;
  return row && scope ? { ...scope, stamp: row.story_stamp, writtenAt: row.written_at } : null;
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

  const stored = await readStoredJobScope(orgId, read.cardId);
  if (!read.stamp || !scopeWanted(read.status)) return { ok: true, scope: stored, wrote: false };
  if (stored && stored.stamp === read.stamp) return { ok: true, scope: stored, wrote: false };

  /* what the model never saw it cannot leak: no money-shaped entry */
  const lines = read.entries.filter((e) => !isMoneyStoryEntry(e)).map(storyLineOf);
  let scope;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCOPE_SCHEMA } },
      system: SCOPE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: scopePrompt({ status: read.status, clientName: read.clientName, scope: read.scope, workDone: read.workDone, lines }) }],
    });
    if (response.stop_reason === "refusal") return { ok: false, reason: "Tiff wouldn't write this job's scope." };
    const block = response.content.find((b) => b.type === "text");
    scope = block && block.type === "text" ? scopeOf(JSON.parse(block.text)) : null;
  } catch (err) {
    return { ok: false, reason: reasonFor(err) };
  }
  if (!scope) return { ok: true, scope: stored, wrote: false };

  const writtenAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("job_scopes")
    .upsert({ org_id: orgId, job_uuid: read.cardId, brief: scope, story_stamp: read.stamp, written_at: writtenAt }, { onConflict: "org_id,job_uuid" });
  if (error) return { ok: false, reason: "The scope couldn't be saved." };
  return { ok: true, scope: { ...scope, stamp: read.stamp, writtenAt }, wrote: true };
}
