import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { readInvoiceDraft } from "@/lib/jobs/invoice-draft-server";
import type { Capability } from "@/lib/permissions";

/* THE INVOICE BUILDER BEHIND PRICE: what New invoice offers to put on the
   job in ServiceM8 (lib/jobs/invoice-draft.ts). Money: the board, money on
   jobs and the business's figures, as the quote's price asks. A route, as
   quote-price is, so the read never waits behind the card's server actions.
   It reads only; nothing goes to ServiceM8 from here. */

export async function GET(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("workboard")) || !(await can("workboard_money")) || !(await can("financials"))) {
    return Response.json({ ok: false, reason: "An invoice needs access to Jobs and Money on jobs." }, { status: 403 });
  }
  const job = (new URL(req.url).searchParams.get("job") ?? "").trim().slice(0, 80);
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  const caps = new Set<Capability>(["workboard", "workboard_money", "financials"]);
  const read = await readInvoiceDraft(orgId, caps, job).catch((err) => {
    console.error(`[invoice] couldn't read the draft for job ${job}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  if (!read) return Response.json({ ok: false, reason: "The job's hours and what was used couldn't be read." }, { status: 404 });
  return Response.json({ ok: true, draft: read.draft });
}
