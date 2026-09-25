"use server";

import { splitSendKeys, theirFileSendKey } from "@/lib/compliance/papers";
import { complianceContext, jobIsReal, outgoing, trimId } from "@/lib/compliance/send";
import { sm8PressFromSession } from "@/lib/integrations/sm8-press";
import {
  enqueueAttachments,
  readJobSends,
  readSm8WriteState,
  runSm8Writes,
  type Sm8WriteRun,
} from "@/lib/integrations/sm8-writes";
import { drainSm8WritesAfterResponse } from "@/lib/integrations/sm8-drain";
import {
  offersSend,
  sendHold,
  sendRefusal,
  WRITE_WORDS,
  type JobSend,
  type SendHold,
} from "@/lib/integrations/sm8-write-plan";

/* SEND TO SERVICEM8 — the Documents face's second door, beside Email
   documents, over the write path in lib/integrations/sm8-writes.

   THE SAME TICKS, THE SAME GATES. What a tick names, and whether this
   person may send it, is lib/compliance/send's answer for both doors: a
   ticket goes only where its scan may open for the sender, an expired
   certificate goes nowhere, and every id is re-resolved on this job in this
   org. Sending is `workboard_manage`, as email is: it puts the business's
   papers in front of everyone who can open the job in ServiceM8.

   OURS ONLY. ServiceM8's own files are in ServiceM8 already, so a tick on
   one of those is answered "already there" rather than sent back to where
   it came from.

   THE PRESS WAITS FOR ITS FILES, within a budget — AND NO LONGER. The
   person who pressed wants to know they went, so this press's files are
   sent in the foreground; the answer comes at SEND_BUDGET_MS whatever
   ServiceM8 is doing (a send already under way finishes behind it), and
   anything not done by then, or that meets a busy ServiceM8, stays queued
   and goes behind the response, on the next page load, or with the nightly
   sweep. The card says which.

   EVERY PRESS DRAINS (lib/integrations/sm8-drain). Behind the answer,
   whatever is due for the workspace goes — this press's leftovers, a file
   due again at once under a new uuid, and anything an earlier press left
   waiting. A run of this press's that outlived the answer is waited for
   first: nothing else keeps it alive once the answer is sent. The drain
   fits in this action's function, counted from the press, and with no time
   left there is none: the page loads and the nightly sweep take the rest.

   ONLY A PRESS QUEUES. The press is minted from the session here
   (lib/integrations/sm8-press), and the queue refuses anything else. */

/** How long a press waits on ServiceM8 before handing the rest to the
    queue. A few files are seconds; this is for the slow day. */
const SEND_BUDGET_MS = 20_000;

/** `p`'s answer, or null once `ms` have passed — whichever is first. The
    promise itself keeps going. */
async function settleWithin<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([p.catch(() => null), late]);
  } finally {
    clearTimeout(timer);
  }
}

export type JobSm8Read = {
  /** Whether this viewer is offered Send to ServiceM8, and on which
      setting. Null: not offered here. Paused still offers it as On: the
      press says it is paused. */
  send: "trial" | "live" | null;
  /** What has gone from this job, by file. */
  sends: JobSend[];
  /** What is holding the files waiting to go: a pause, or a reconnect. */
  hold: SendHold;
};

/** The job's writes, and whether this viewer gets the button. Null when the
    viewer can't open the job card at all. */
export async function readJobSm8(jobUuid: string): Promise<JobSm8Read | null> {
  const ctx = await complianceContext();
  if (!ctx) return null;
  const job = trimId(jobUuid);
  if (!job) return null;
  const [state, sends] = await Promise.all([readSm8WriteState(ctx.orgId), readJobSends(ctx.orgId, job)]);
  const offered = ctx.company && offersSend(state, "attachment");
  return {
    send: offered ? (state.mode === "trial" ? "trial" : "live") : null,
    sends,
    hold: sendHold(state, "attachment"),
  };
}

export type SendToSm8Input = { jobUuid: string; keys: string[] };

/** What became of each tick, by its key. */
export type SendToSm8Result =
  | {
      ok: true;
      /** A trial run: nothing went, and `sent` is what would have. */
      trial: boolean;
      sent: string[];
      /** Queued behind a busy or slow ServiceM8; they go by themselves. */
      waiting: string[];
      /** Refused, with the reason in our words. */
      failed: { key: string; error: string }[];
      /** In ServiceM8 already, or on the way from an earlier press. */
      already: string[];
      /** The job's writes after this press, for the rows' words. */
      sends: JobSend[];
    }
  | { ok: false; error: string };

export async function sendJobDocumentsToServiceM8(input: SendToSm8Input): Promise<SendToSm8Result> {
  /* the function's clock: a follow-up behind the answer is budgeted from it */
  const startedAt = Date.now();
  const ctx = await complianceContext();
  if (!ctx?.company) return { ok: false, error: "You can't send documents from jobs." };
  const press = await sm8PressFromSession();
  if (!press || press.orgId !== ctx.orgId) return { ok: false, error: "You can't send documents from jobs." };
  const job = trimId(input?.jobUuid);
  if (!job || !(await jobIsReal(ctx.orgId, job))) {
    return { ok: false, error: "That job isn't in ServiceM8's copy any more." };
  }

  const state = await readSm8WriteState(ctx.orgId);
  const refusal = sendRefusal(state, "attachment");
  if (refusal || !state.tenantId) return { ok: false, error: refusal ?? "ServiceM8 isn't connected." };

  const picks = splitSendKeys(Array.isArray(input.keys) ? input.keys.slice(0, 60) : []);
  const theirs = picks.files.map(theirFileSendKey);
  if (picks.papers.length + picks.documents.length === 0) {
    return {
      ok: false,
      error: theirs.length > 0 ? "Those came from ServiceM8, so they're there already." : "Tick at least one document to send.",
    };
  }

  const found = await outgoing(ctx, job, { papers: picks.papers, documents: picks.documents, files: [] });
  if (!found.ok) return found;

  const queued = await enqueueAttachments(
    press,
    state,
    found.files.map((f) => ({
      jobUuid: job,
      documentId: f.documentId,
      name: f.name,
      mimeType: f.mimeType,
      sizeBytes: f.size,
      key: f.key,
    }))
  );
  if (!queued) return { ok: false, error: "Couldn't queue those for ServiceM8. Try again." };
  /* this press would have taken the account past the hourly cap: nothing
     was queued, and sending is paused for the owner to look at */
  if (queued.capped) return { ok: false, error: WRITE_WORDS.paused };

  let running: Promise<Sm8WriteRun> | undefined;
  let stopped = false;
  if (queued.ids.length > 0) {
    const pressRun = runSm8Writes(ctx.orgId, "send", { ids: queued.ids, budgetMs: SEND_BUDGET_MS });
    const run = await settleWithin(pressRun, SEND_BUDGET_MS);
    /* still going at the budget: the drain waits for it behind the answer */
    if (run === null) running = pressRun;
    /* ended for the account's reasons (ServiceM8 unreachable, a limit, a
       reconnect, Pause): a drain now would only meet them again, spending
       the next file's attempt — see sm8-drain */
    else stopped = run.stopped !== null;
  }
  if (!stopped) drainSm8WritesAfterResponse(ctx.orgId, { startedAt, behind: running });

  const sends = await readJobSends(ctx.orgId, job);
  const sendOf = new Map(sends.map((s) => [s.documentId, s]));
  const earlier = new Set(queued.already);

  /* A tick is a paper or an upload, and a paper may be two files (a
     licence's front and back), so each tick is judged over its files. */
  const filesOf = new Map<string, string[]>();
  for (const f of found.files) filesOf.set(f.key, [...(filesOf.get(f.key) ?? []), f.documentId]);

  const sent: string[] = [];
  const waiting: string[] = [];
  const failed: { key: string; error: string }[] = [];
  const already: string[] = [...theirs];
  for (const [key, docs] of filesOf) {
    if (docs.every((d) => earlier.has(d))) {
      already.push(key);
      continue;
    }
    const rows = docs.map((d) => sendOf.get(d));
    const refused = rows.find((r) => r?.status === "failed" || r?.status === "cancelled");
    if (refused) {
      failed.push({ key, error: refused.error ?? WRITE_WORDS.refused });
      continue;
    }
    if (rows.every((r) => r?.status === "sent" || r?.status === "trial")) sent.push(key);
    else waiting.push(key);
  }

  return { ok: true, trial: state.mode === "trial", sent, waiting, failed, already, sends };
}
