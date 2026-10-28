import { supabaseAdmin } from "@/lib/supabase-server";
import { fixedEndOk } from "@/lib/workboard/check-in-fixes";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* A CHECK-IN LEFT ON, FIXED FROM THE PHONE (Isaac, 28 October 2026): someone
   who manages the schedule says when the person really finished, and from
   then on HeyTiff reads that ServiceM8 check-in as ending there
   (lib/workboard/check-in-fixes): the job card's time, its visits, and the
   phone's actual time. ServiceM8's own record is not changed.

   The end is the time on the day the check-in began ("HH:MM"), after it
   began, within a working day of it. Only a recorded check-in can be
   fixed, never a booking. */

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  if (!(ctx.role === "owner" || ctx.caps.has("workboard_manage"))) return no(403, "Only someone who manages the schedule can fix a check-in.");

  const body = (await request.json().catch(() => null)) as { activity?: unknown; end?: unknown } | null;
  const activity = typeof body?.activity === "string" && body.activity.length <= 80 ? body.activity : null;
  const hhmm = typeof body?.end === "string" && /^\d{2}:\d{2}$/.test(body.end) ? body.end : null;
  if (!activity || !hhmm) return no(400, "Say which check-in, and when it ended.");

  const spell = [...new Set([activity, activity.toLowerCase(), activity.toUpperCase()])];
  const { data } = await supabaseAdmin
    .from("sm8_job_activities")
    .select("uuid, start_date")
    .eq("org_id", ctx.orgId)
    .eq("active", 1)
    .eq("activity_was_scheduled", 0)
    .in("uuid", spell)
    .maybeSingle();
  const row = data as { uuid: string; start_date: string | null } | null;
  if (!row?.start_date) return no(404, "That check-in isn't in HeyTiff.");
  const end = `${row.start_date.slice(0, 10)} ${hhmm}:00`;
  if (!fixedEndOk(row.start_date, end)) return no(400, "It has to end after it started, the same day, within twelve hours.");

  const { error } = await supabaseAdmin
    .from("check_in_fixes")
    .upsert({ org_id: ctx.orgId, sm8_activity_uuid: row.uuid, ends_at: end, fixed_by: ctx.userId, fixed_at: new Date().toISOString() }, { onConflict: "org_id,sm8_activity_uuid" });
  if (error) return no(500, "That fix couldn't be saved. Try again.");
  return ok({ ok: true, end });
}
