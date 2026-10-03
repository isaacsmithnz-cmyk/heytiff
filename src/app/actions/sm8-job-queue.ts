"use server";

/* QUEUEING A NEW JOB FOR SERVICEM8 — the one door (new jobs to ServiceM8).

   The New job form's action calls this, and nothing else queues a job row:
   a test holds that only this file passes `kind: "job"` to the queue
   (sm8-press.test). It takes a PRESS (lib/integrations/sm8-press), so a
   browser's copy of one is refused.

   NOTHING HAPPENS unless the deployment sends new jobs (SM8_WRITES names
   `job`) — not even a read — and nothing is queued unless the owner has New
   jobs switched on.

   ITS UUIDS ARE CHOSEN HERE, ONCE: the job's (the row's remote_uuid, by the
   queue), a new client's or site's, and the contact's. A press of the same
   form again (the same press id) is the same row, and goes with the same
   uuids, so a Create pressed twice is one job. */

import { randomUUID } from "crypto";
import { isSm8Press, type Sm8Press } from "@/lib/integrations/sm8-press";
import { readSm8WriteState, enqueueSm8Writes } from "@/lib/integrations/sm8-writes";
import { offersSend, sendRefusal } from "@/lib/integrations/sm8-write-plan";
import { sm8JobsAllowed } from "@/lib/integrations/sm8-kinds";
import { drainSm8WritesAfterResponse } from "@/lib/integrations/sm8-drain";
import { fillWords } from "@/lib/integrations/sm8-note-words";
import { jobSubject, JOB_WORDS, type ValidNewJob } from "@/lib/integrations/sm8-job-plan";
import { supabaseAdmin } from "@/lib/supabase-server";

export type JobQueueResult = { ok: true; rowId: string; again: boolean } | { ok: false; error: string };

const PRESS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Queue one new job. `pressId` is the form's own, minted once per open. */
export async function queueNewJob(press: Sm8Press, pressId: string, job: ValidNewJob, clientName: string): Promise<JobQueueResult> {
  if (!sm8JobsAllowed()) return { ok: false, error: JOB_WORDS.card.jobsUnavailable };
  if (!isSm8Press(press)) return { ok: false, error: JOB_WORDS.press.unqueued };
  if (!PRESS_ID.test(pressId)) return { ok: false, error: JOB_WORDS.press.unqueued };
  try {
    const state = await readSm8WriteState(press.orgId);
    if (!state.readable) return { ok: false, error: JOB_WORDS.press.unreadable };
    if (!offersSend(state, "job")) return { ok: false, error: sendRefusal(state, "job") ?? JOB_WORDS.press.kindOff };

    const subject = jobSubject(pressId);
    const companyUuid = job.existingUuid ?? randomUUID();
    const out = await enqueueSm8Writes(press, state, [
      {
        kind: "job",
        jobUuid: null,
        subject,
        payload: { name: fillWords(JOB_WORDS.label.named, { name: clientName || JOB_WORDS.label.fallback }) },
        ref: pressId,
        op: "create",
        job: {
          companyUuid,
          companyNew: job.companyNew,
          parentUuid: job.parentUuid,
          contactUuid: job.draft.contact ? randomUUID() : null,
          categoryUuid: job.categoryUuid,
          draft: job.draft as unknown as Record<string, unknown>,
        },
      },
    ]);
    if (!out) return { ok: false, error: JOB_WORDS.press.unqueued };
    if (out.capped) return { ok: false, error: JOB_WORDS.press.capped };
    if (out.ids.length > 0) {
      drainSm8WritesAfterResponse(press.orgId);
      return { ok: true, rowId: out.ids[0]!, again: false };
    }
    /* already sent or on its way: the same press's row */
    const { data } = await supabaseAdmin
      .from("sm8_writes")
      .select("id")
      .eq("org_id", press.orgId)
      .eq("kind", "job")
      .eq("subject", subject)
      .maybeSingle();
    const id = (data as { id: string } | null)?.id;
    return id ? { ok: true, rowId: id, again: true } : { ok: false, error: JOB_WORDS.press.unqueued };
  } catch (err) {
    console.error(`[sm8] couldn't queue new job ${pressId}: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: JOB_WORDS.press.unqueued };
  }
}
