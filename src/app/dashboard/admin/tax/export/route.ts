import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { todayInAu } from "@/lib/au-dates";
import { fyChoices, fyOf } from "@/lib/tax/fy";
import { taxYear } from "@/lib/tax/query";
import { taxCsv, taxCsvFilename } from "@/lib/tax/csv";

/* The CSV download.

   A ROUTE HANDLER, not a server action, because the browser has to be able to
   navigate to it — a download is a response with headers, and an action
   returns a value. It also means the file streams from the same request that
   asked for it, so a big year never gets buffered into a component's props.

   The gate is repeated here in full. A route handler is a URL: someone who
   knows it can request it directly, and "the link was only on the admin page"
   protects nothing. */

export async function GET(request: Request): Promise<Response> {
  const session = await auth0.getSession();
  if (!session) return new Response("Sign in first.", { status: 401 });
  if (!(await can("financials"))) return new Response("Not allowed.", { status: 403 });

  const orgId = session.orgId as string | undefined;
  if (!orgId) return new Response("No workspace.", { status: 400 });

  const today = todayInAu();
  const asked = Number(new URL(request.url).searchParams.get("fy"));
  /* Only a year the picker itself offers. Not paranoia about the number — an
     arbitrary one would simply return an empty file — but about the FILENAME,
     which is built from it and ends up on someone's desktop. */
  const fy = fyChoices(today).includes(asked) ? asked : fyOf(today);

  // No signed URLs: they expire in an hour, and a dead link in a file an
  // accountant opens in October is worse than an honest Yes/No column.
  const { items } = await taxYear(orgId, fy, { signReceipts: false });

  return new Response(taxCsv(items, fy), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${taxCsvFilename(fy)}"`,
      // A year's spending is not something to leave in a shared cache.
      "cache-control": "no-store",
    },
  });
}
