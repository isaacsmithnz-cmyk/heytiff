"use server";

/* QUEUEING AN ACCEPTED QUOTE FOR SERVICEM8 — the one door (quotes to
   ServiceM8, Isaac, 2026-10-05).

   The job card's Quote section calls this, and nothing else queues a quote
   row: a test holds that only this file passes `kind: "quote"` to the queue
   (sm8-press.test). It takes a PRESS, so a browser's copy of one is
   refused. Nothing happens unless the deployment sends quotes (SM8_WRITES
   names `quote`), and nothing is queued unless the owner has Accepted
   quotes switched on.

   One row per ServiceM8 record, under the press id: pressing the same send
   twice is the same rows. */

import { isSm8Press, type Sm8Press } from "@/lib/integrations/sm8-press";
import { enqueueSm8Writes, readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { offersSend, sendRefusal } from "@/lib/integrations/sm8-write-plan";
import { sm8QuotesAllowed } from "@/lib/integrations/sm8-kinds";
import { QUOTE_WORDS, type QuoteRowInput } from "@/lib/integrations/sm8-quote-plan";

export type QuoteQueueResult = { ok: true; ids: string[] } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function queueAcceptedQuote(press: Sm8Press, pressId: string, jobUuid: string, rows: QuoteRowInput[]): Promise<QuoteQueueResult> {
  if (!sm8QuotesAllowed()) return { ok: false, error: QUOTE_WORDS.card.quotesUnavailable };
  if (!isSm8Press(press)) return { ok: false, error: QUOTE_WORDS.press.unqueued };
  if (!UUID.test(pressId) || !UUID.test(jobUuid) || rows.length === 0) return { ok: false, error: QUOTE_WORDS.press.unqueued };
  if (rows.some((r) => r.op !== "create" && (!r.uuid || !UUID.test(r.uuid)))) return { ok: false, error: QUOTE_WORDS.press.unqueued };
  try {
    const state = await readSm8WriteState(press.orgId);
    if (!state.readable) return { ok: false, error: QUOTE_WORDS.press.unreadable };
    if (!offersSend(state, "quote")) return { ok: false, error: sendRefusal(state, "quote") ?? QUOTE_WORDS.press.kindOff };
    const out = await enqueueSm8Writes(
      press,
      state,
      rows.map((r) => ({
        kind: "quote" as const,
        jobUuid,
        subject: `quote:${pressId}:${r.key}`,
        payload: { name: r.label },
        ref: r.key,
        op: r.op,
        ...(r.op !== "create" ? { targetUuid: r.uuid! } : {}),
        quote: { object: r.object, fields: r.fields },
      }))
    );
    if (!out) return { ok: false, error: QUOTE_WORDS.press.unqueued };
    if (out.capped) return { ok: false, error: QUOTE_WORDS.press.capped };
    return { ok: true, ids: out.ids };
  } catch (err) {
    console.error(`[sm8] couldn't queue the accepted quote on job ${jobUuid}: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: QUOTE_WORDS.press.unqueued };
  }
}
