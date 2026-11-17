import { readCustomerMessages } from "@/lib/jobs/customer-messages-query";
import { bookingZone } from "@/lib/integrations/sm8-booking-zone";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { companyName } from "@/lib/mobile/documents";
import { fileDoors, phoneMessages, shortBusinessName } from "@/lib/mobile/job-messages";
import { supabaseAdmin } from "@/lib/supabase-server";
import { familyMediaSources, resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { todayInZone } from "@/lib/workboard/dates";
import { readJobMediaGroups } from "@/lib/workboard/job-media-query";

/* A JOB'S TEXTS AND EMAILS for the phone (lib/mobile/job-messages), behind
   the job's own `workboard` grant, as the job page reads them on the web.
   What ServiceM8 says a quote or an invoice was worth stays with
   `workboard_money`, as there. Read only.

   The id is a CHOICE the phone hands in, so it is only read inside the
   caller's own workspace; a clone resolves to the job it claims against. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;

  const id = (await params).id.trim().slice(0, 80);
  if (!id) return Response.json({ error: "Which job?" }, { status: 400, headers: { "cache-control": "no-store" } });

  const money = ctx.caps.has("workboard_money");
  const { parentRemoteId } = await resolveJobCard(ctx.orgId, id);
  const [items, media, zone] = await Promise.all([
    /* the messages are a nicety beside the job: a read that fails is none.
       A send no staff member sent is from the business, by its short name */
    supabaseAdmin
      .from("organizations")
      .select("trading_name, legal_name, name")
      .eq("id", ctx.orgId)
      .maybeSingle()
      .then(
        ({ data }) => shortBusinessName(companyName(data)),
        () => null,
      )
      .then((business) => readCustomerMessages({ orgId: ctx.orgId, jobUuid: parentRemoteId, money, business }))
      .catch(() => []),
    familyMediaSources(ctx.orgId, parentRemoteId)
      .then((claims) => readJobMediaGroups(ctx.orgId, parentRemoteId, claims))
      .catch(() => null),
    bookingZone(ctx.orgId)
      .then((z) => z.zone)
      .catch(() => null),
  ]);
  return ok(phoneMessages(items, { today: todayInZone(zone ?? "Australia/Sydney"), doors: fileDoors(media, money) }));
}
