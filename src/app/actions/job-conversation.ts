"use server";

import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { getSm8Timezone } from "@/lib/workboard/query";
import { readJobConversationFor } from "@/lib/jobs/job-conversation-query";
import type { JobConversationRead } from "@/lib/jobs/job-conversation";

/* A JOB'S OVERVIEW, ITS CONVERSATION'S READ (v2, step 6).

   What the job's page draws beyond the card's own record: what Tiff said
   back to each note on the job and what she made from it, with Undo where
   it would still take it back, and the job's open tasks. The card's gate is
   this read's gate (`workboard`), and the job must be one this workspace's
   mirror holds: the id came from a browser, so it names a choice.

   Nothing here writes. Saying something, keeping it as typed, Undo and a
   tick each go through the action that already does it (`routeNote` and
   `fileNote` through the conversation, `addJobNote`, `undoNote`,
   `completeTask`). Null when the reader may not ask, or the job isn't
   theirs. */

export async function readJobConversation(jobUuid: string): Promise<JobConversationRead | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  if (!(await can("workboard"))) return null;
  const job = typeof jobUuid === "string" ? jobUuid.trim().slice(0, 80) : "";
  if (!job) return null;

  const { data: real } = await supabaseAdmin.from("sm8_jobs").select("uuid").eq("org_id", orgId).eq("uuid", job).maybeSingle();
  if (!real) return null;

  const [staffId, tz, undoAny] = await Promise.all([staffIdFor(orgId, userId), getSm8Timezone(orgId), can("team")]);
  return readJobConversationFor({ orgId, staffId, jobUuid: job, tz, undoAny });
}
