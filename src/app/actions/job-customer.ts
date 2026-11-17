"use server";

/* THE JOB CARD'S CUSTOMER DIALOG — its actions (Isaac, 2026-10-02: "editing
   the customer… pop-up modal… look at ServiceM8's job contact page… same
   information… lots of different site contacts… each with a role").

   Everything here answers before any session or database read where the
   deployment doesn't save customer changes (sm8CustomersAllowed), and asks
   workboard_manage of whoever is reading.

   The reading and the saving are lib/integrations/sm8-customer-edit's,
   shared with the phone's Contact sheet; here is the web's gate and its
   press. */

import { requireOrg } from "@/lib/permissions-server";
import { sm8CustomersAllowed } from "@/lib/integrations/sm8-kinds";
import { sm8PressFromSession } from "@/lib/integrations/sm8-press";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { offersSend } from "@/lib/integrations/sm8-write-plan";
import { CUSTOMER_WORDS, type CustomerForm } from "@/lib/integrations/sm8-customer-plan";
import { readCustomerFormIn, saveCustomerWith, type CustomerForEdit, type CustomerSaveAnswer } from "@/lib/integrations/sm8-customer-edit";

async function gate(): Promise<{ orgId: string } | { error: string }> {
  if (!sm8CustomersAllowed()) return { error: CUSTOMER_WORDS.card.customersUnavailable };
  try {
    const { orgId } = await requireOrg("workboard_manage");
    return { orgId };
  } catch {
    return { error: CUSTOMER_WORDS.press.noManage };
  }
}

/** Whether the card offers Edit on its contacts: the deployment saves
    customer changes, the reader runs the board, the owner has them on. */
export async function customerEditOffered(): Promise<boolean> {
  const g = await gate();
  if ("error" in g) return false;
  return offersSend(await readSm8WriteState(g.orgId), "customer");
}

/** What the dialog opens with. */
export async function readCustomerForEdit(jobUuid: string): Promise<CustomerForEdit> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  return readCustomerFormIn(g.orgId, jobUuid);
}

/** Save what the dialog holds, worked out against the job as it stands now
    (sm8-customer-edit's saveCustomerWith). */
export async function saveCustomer(pressId: string, after: CustomerForm): Promise<CustomerSaveAnswer> {
  const startedAt = Date.now();
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const press = await sm8PressFromSession();
  if (!press || press.orgId !== g.orgId) return { ok: false, error: CUSTOMER_WORDS.press.unqueued };
  return saveCustomerWith(press, pressId, after, startedAt);
}
