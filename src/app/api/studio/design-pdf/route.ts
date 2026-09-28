import { requireOrg } from "@/lib/permissions-server";
import { pdfFileName, readPdfOptions } from "@/lib/studio/pdf-request";
import { renderDesignPdf } from "@/lib/studio/pdf-render";

/* POST { designId, name, options } → the design as a PDF file, the parts the
   Share dialog ticked (lib/studio/pdf-request.ts, pdf-render.ts).

   `studio`-gated and org-scoped like every studio action: the org comes off
   the session, never the body, and the print page reads rows inside it. */

export const runtime = "nodejs";
/* a cold start unpacks Chromium before it prints anything */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  let orgId: string;
  try {
    ({ orgId } = await requireOrg("studio"));
  } catch {
    return new Response("Sign in to make a PDF.", { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    designId?: unknown;
    name?: unknown;
    options?: unknown;
  } | null;
  const designId = typeof body?.designId === "string" ? body.designId.slice(0, 80) : "";
  if (!designId) return new Response("Which design?", { status: 400 });

  try {
    const pdf = await renderDesignPdf(
      { orgId, designId, options: readPdfOptions(body?.options, designId) },
      new URL(request.url).origin
    );
    const name = pdfFileName(typeof body?.name === "string" ? body.name : "");
    return new Response(Buffer.from(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error(`[design-pdf] ${String(err)}`);
    return new Response("Couldn't make the PDF.", { status: 500 });
  }
}
