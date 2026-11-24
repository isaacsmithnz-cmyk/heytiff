"use server";

import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { setStar, type StarResult } from "@/lib/jobs/job-stars";

/* STAR A JOB from the web: the job page's Actions › Star the job (rule 53:
   Actions holds what's done to the record itself, its pin among them).
   Yours alone, as the phone's (lib/jobs/job-stars), behind the job page's
   own gate. */
export async function starJob(jobUuid: string, on: boolean): Promise<StarResult> {
  if (!(await can("workboard"))) return { ok: false, error: "You don't have access to jobs." };
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return { ok: false, error: "Sign in again to star it." };
  if (typeof jobUuid !== "string" || typeof on !== "boolean") return { ok: false, error: "Which job?" };
  return setStar({ orgId, userId }, jobUuid, on);
}
