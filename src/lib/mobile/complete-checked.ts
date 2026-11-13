import "server-only";

import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { Sm8Press } from "@/lib/integrations/sm8-press";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { queueMarkCompleted } from "@/app/actions/sm8-booking-queue";

/* CHECKED COMPLETES THE JOB IN SERVICEM8 (Isaac, 11 November 2026: "complete
   the job or like mark it ready to invoice ... so that the office knows the
   clear end result"; the office checks first, then ServiceM8 hears; 13
   November 2026, "Start at 1": apply docs/migrations/sm8_writes_completed.sql
   and wire Checked to it).

   The office ticking Checked on Ready to invoice queues one status row, Work
   Order to Completed, as whoever ticked it, with the job's edit time as the
   mirror has it. The sender reads the job live again and goes only if it's
   still that Work Order, unchanged, so a job someone moved on in ServiceM8
   meanwhile is left alone. A job that isn't a Work Order here is left too:
   a Quote that was finished never became one, and Completed or Unsuccessful
   is already an end. */

export type Completing = { queued: true } | { queued: false; why: string };

export async function completeChecked(press: Sm8Press | null, orgId: string, job: string): Promise<Completing> {
  if (!press || press.orgId !== orgId) return { queued: false, why: "no press" };
  const { data } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, status, edit_date, active")
    .eq("org_id", orgId)
    .in("uuid", [...new Set([job, job.toLowerCase()])])
    .limit(1)
    .maybeSingle();
  const j = data as { uuid: string; status: string | null; edit_date: string | null; active: unknown } | null;
  if (!j) return { queued: false, why: "not in the mirror" };
  if (Number(j.active) !== 1) return { queued: false, why: "taken out of ServiceM8" };
  if (j.status !== "Work Order") return { queued: false, why: `it's ${j.status ?? "no status"}, not a Work Order` };
  if (!j.edit_date) return { queued: false, why: "no edit time" };
  const r = await queueMarkCompleted(press, await readSm8WriteState(orgId), { jobUuid: j.uuid, verbId: randomUUID(), seenEditDate: j.edit_date });
  return r.ok ? { queued: true } : { queued: false, why: r.refusal };
}
