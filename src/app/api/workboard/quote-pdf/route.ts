import { can, requireOrg } from "@/lib/permissions-server";
import { signQuoteTicket } from "@/lib/quotes/pdf-ticket";
import { renderPdfAt } from "@/lib/studio/pdf-render";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { readMirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import { todayInZone } from "@/lib/workboard/dates";
import { getSm8Timezone } from "@/lib/workboard/query";

/* A QUOTE AS A PDF — GET /api/workboard/quote-pdf?job=<id> (Isaac, 21
   October 2026: "We also need to be able to turn this into a PDF"): the
   quote's paper printed by a headless Chrome from /print/quote and handed
   back as a download. It carries the price, so it's for whoever sees the
   business's prices, as the paper is. A route handler, not a Server Function,
   for the minute Chromium needs. */

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  let orgId: string;
  let userId: string;
  try {
    ({ orgId, userId } = await requireOrg("workboard"));
  } catch {
    return new Response("Sign in to download the quote.", { status: 401 });
  }
  if (!(await can("financials"))) return new Response("The quote's PDF carries its prices: it needs money access.", { status: 403 });
  const job = (new URL(request.url).searchParams.get("job") ?? "").trim().slice(0, 80);
  if (!job) return new Response("Which job?", { status: 400 });
  const target = await resolveJobCard(orgId, job);
  const timezone = await getSm8Timezone(orgId);
  const detail = await readMirrorJobDetail(orgId, target.parentRemoteId, todayInZone(timezone), { includeMoney: false, timezone });
  if (!detail) return new Response("That job isn't here.", { status: 404 });

  let pdf: Uint8Array;
  try {
    pdf = await renderPdfAt("/print/quote", signQuoteTicket({ orgId, jobUuid: target.parentRemoteId, by: userId }), new URL(request.url).origin);
  } catch (err) {
    console.error(`[quote-pdf] render: ${String(err)}`);
    return new Response("Couldn't print the quote. Try again.", { status: 500 });
  }
  const name = `Quote ${detail.jobNumber ?? ""} ${detail.clientName ?? ""}`.replace(/\s+/g, " ").trim() + ".pdf";
  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "no-store",
    },
  });
}
