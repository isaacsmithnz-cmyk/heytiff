import "server-only";
import { sm8JobsAllowed } from "@/lib/integrations/sm8-kinds";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { offersSend } from "@/lib/integrations/sm8-write-plan";

/** Whether the Workboard offers New job to this reader: the deployment sends
    new jobs, they run the board, and the owner has New jobs on. Asks nothing
    of the database where the deployment doesn't send new jobs. */
export async function newJobOffered(orgId: string, manage: boolean): Promise<boolean> {
  if (!sm8JobsAllowed() || !manage) return false;
  const state = await readSm8WriteState(orgId);
  return offersSend(state, "job");
}
