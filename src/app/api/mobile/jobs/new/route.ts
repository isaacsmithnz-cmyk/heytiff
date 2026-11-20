import { createNewJob, matchPreviousSite, nearNewJobSite, readNewJobCategories, searchClientSites, searchNewJobClients, type CreateAnswer } from "@/app/actions/job-new";
import { JOB_WORDS } from "@/lib/integrations/sm8-job-words";
import { actAsPhoneUser, ok, requireMobile } from "@/lib/mobile/auth";
import { newJobInputOf } from "@/lib/mobile/new-job-input";
import { newJobOffered } from "@/lib/workboard/new-job-offer";
import { supabaseAdmin } from "@/lib/supabase-server";

/* THE PHONE'S NEW › JOB (Isaac, 20 November 2026: "Yes, build it" to
   https://claude.ai/artifact/JLF86oYMASuBt4gKDRr1VR): the web's New job form's
   own actions (actions/job-new), run as the phone's verified person, so the
   same gates (new jobs sent here, the owner's switch, `workboard_manage`),
   the same one door to ServiceM8 (actions/sm8-job-queue) and the same press
   id rule: a Create pressed twice is one job.

   GET, by what's asked: `start` (whether new jobs go, the kinds, and with
   `near=lat,lng` the site you're standing at), `q` (customers), `sites` (a
   builder's, with `q`), `match` (a site we've been to at that address), or
   `landed` (whether the mirror holds the new job yet). POST is Create job. */

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

function nearOf(raw: string | null): { lat: number; lng: number } | null {
  const m = /^(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(raw?.trim() ?? "");
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const ctx = await requireMobile(request, "workboard_manage");
  if (ctx instanceof Response) return ctx;
  const p = new URL(request.url).searchParams;
  const q = (p.get("q") ?? "").slice(0, 60);

  if (p.has("start")) {
    if (!(await newJobOffered(ctx.orgId, true))) return ok({ offered: false, why: JOB_WORDS.press.kindOff, categories: [], here: null });
    const near = nearOf(p.get("near"));
    const [categories, here] = await actAsPhoneUser(ctx, () => Promise.all([readNewJobCategories(), near ? nearNewJobSite(near.lat, near.lng) : Promise.resolve(null)]));
    return ok({ offered: true, why: null, categories, here });
  }
  if (p.has("sites")) {
    const parent = p.get("sites") ?? "";
    if (!UUID.test(parent)) return no(400, "Whose sites?");
    return ok({ sites: await actAsPhoneUser(ctx, () => searchClientSites(parent, q)) });
  }
  if (p.has("match")) return ok({ match: await actAsPhoneUser(ctx, () => matchPreviousSite((p.get("match") ?? "").slice(0, 400))) });
  if (p.has("landed")) {
    const uuid = p.get("landed") ?? "";
    if (!UUID.test(uuid)) return no(400, "Which job?");
    const { data } = await supabaseAdmin.from("sm8_jobs").select("uuid, generated_job_id").eq("org_id", ctx.orgId).eq("uuid", uuid).maybeSingle();
    const row = data as { uuid: string; generated_job_id: string | null } | null;
    return ok({ landed: !!row, number: row?.generated_job_id ?? null });
  }
  return ok({ clients: await actAsPhoneUser(ctx, () => searchNewJobClients(q)) });
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request, "workboard_manage");
  if (ctx instanceof Response) return ctx;
  const read = newJobInputOf(await request.json().catch(() => null));
  if (!read.ok) return no(400, read.error);
  const answer = await actAsPhoneUser(ctx, () => createNewJob(read.input)).catch((err): CreateAnswer => {
    console.error(`[mobile] new job ${read.input.pressId}: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: JOB_WORDS.press.unqueued };
  });
  if (!answer.ok) return no(400, answer.error);
  /* failed or cancelled in ServiceM8 is said as the web says it, and Create asks again */
  if (answer.line.state === "failed" || answer.line.state === "cancelled") return no(400, answer.line.words);
  return ok({ jobUuid: answer.jobUuid, state: answer.line.state, words: answer.line.words, number: answer.line.number });
}
