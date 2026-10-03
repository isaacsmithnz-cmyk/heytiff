"use server";

/* QUEUEING CUSTOMER CHANGES FOR SERVICEM8 — the one door (customer details
   to ServiceM8).

   The job card's customer dialog calls this, and nothing else queues a
   customer row: a test holds that only this file passes `kind: "customer"`
   to the queue (sm8-press.test). It takes a PRESS, so a browser's copy of
   one is refused. Nothing happens unless the deployment sends customer
   changes (SM8_WRITES names `customer`), and nothing is queued unless the
   owner has Customer details switched on.

   One row per record changed, under the dialog's press id: saving the same
   dialog twice is the same rows. */

import { randomUUID } from "crypto";
import { isSm8Press, type Sm8Press } from "@/lib/integrations/sm8-press";
import { enqueueSm8Writes, readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { offersSend, sendRefusal } from "@/lib/integrations/sm8-write-plan";
import { sm8CustomersAllowed } from "@/lib/integrations/sm8-kinds";
import { CUSTOMER_WORDS, customerSubject, type CustomerChange } from "@/lib/integrations/sm8-customer-plan";

export type CustomerQueueResult = { ok: true; ids: string[] } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function queueCustomerChanges(press: Sm8Press, pressId: string, jobUuid: string, changes: CustomerChange[]): Promise<CustomerQueueResult> {
  if (!sm8CustomersAllowed()) return { ok: false, error: CUSTOMER_WORDS.card.customersUnavailable };
  if (!isSm8Press(press)) return { ok: false, error: CUSTOMER_WORDS.press.unqueued };
  if (!UUID.test(pressId) || !UUID.test(jobUuid)) return { ok: false, error: CUSTOMER_WORDS.press.unqueued };
  if (changes.length === 0) return { ok: false, error: CUSTOMER_WORDS.press.nothing };
  try {
    const state = await readSm8WriteState(press.orgId);
    if (!state.readable) return { ok: false, error: CUSTOMER_WORDS.press.unreadable };
    if (!offersSend(state, "customer")) return { ok: false, error: sendRefusal(state, "customer") ?? CUSTOMER_WORDS.press.kindOff };
    const out = await enqueueSm8Writes(
      press,
      state,
      changes.map((c) => {
        const key = c.uuid ?? randomUUID();
        return {
          kind: "customer" as const,
          jobUuid: c.object === "company" ? null : jobUuid,
          subject: customerSubject(pressId, c.object, key),
          payload: { name: c.label },
          ref: key,
          op: c.op,
          ...(c.op !== "create" ? { targetUuid: c.uuid! } : {}),
          customer: { object: c.object, fields: c.fields },
        };
      })
    );
    if (!out) return { ok: false, error: CUSTOMER_WORDS.press.unqueued };
    if (out.capped) return { ok: false, error: CUSTOMER_WORDS.press.capped };
    return { ok: true, ids: out.ids };
  } catch (err) {
    console.error(`[sm8] couldn't queue customer changes on job ${jobUuid}: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: CUSTOMER_WORDS.press.unqueued };
  }
}
