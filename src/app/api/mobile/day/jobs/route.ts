import { ok, requireMobile } from "@/lib/mobile/auth";
import { dayJobs } from "@/lib/mobile/day";

/* WHICH JOB? for Add a job on your day: your jobs of the last two weeks, or
   `q`, any job by number or street, finished ones too. Number, street and
   status only, as the day's own rows; your own day needs no grant beyond
   being a member. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  return ok(await dayJobs(ctx, new URL(request.url).searchParams.get("q") ?? ""));
}
