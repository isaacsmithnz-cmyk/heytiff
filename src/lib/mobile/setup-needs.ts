import { onboardingPending } from "@/lib/staff/onboarding";
import { orgSetupPending } from "@/lib/org/query";
import type { MobileCtx } from "./auth";

/** Whether the phone still owes this person their first run. Fails closed to
    nothing owed, as the web's gates do: a read that goes wrong lands them on
    Today, never in a loop. */
export async function setupNeeds(ctx: MobileCtx): Promise<{ business: boolean; details: boolean }> {
  const owner = ctx.role === "owner";
  const business = owner ? await orgSetupPending(ctx.orgId).catch(() => false) : false;
  /* An owner's own details are asked only while their business is new: the
     web never asked an owner (app/welcome/details sends owners away), so an
     owner of a business already running has a null stamp and must not be
     sent through a first run on the next sign-in. */
  const details = owner ? business : await onboardingPending(ctx.orgId, ctx.userId).catch(() => false);
  return { business, details };
}
