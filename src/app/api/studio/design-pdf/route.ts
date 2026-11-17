import { requireOrg } from "@/lib/permissions-server";
import { pdfFileName, readPdfFlow, readPdfOptions } from "@/lib/studio/pdf-request";
import { renderDesignPdf } from "@/lib/studio/pdf-render";

/* POST { designId, name, options } → the design as a PDF file, the parts the
   Share dialog ticked (lib/studio/pdf-request.ts, pdf-render.ts).

   `studio`-gated and org-scoped like every studio action: the org comes off
   the session, never the body, and the print page reads rows inside it. */

export const runtime = "nodejs";
/* a cold start unpacks Chromium before it prints anything */
export const maxDuration = 120;

/* the house in 3D, drawn by the asking browser: data-URL pictures by design
   id, nothing else, and no more than the request can carry */
const MAX_PICTURES_BYTES = 3_000_000;
function readPictures(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  let total = 0;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>).slice(0, 11)) {
    if (id.length > 80 || typeof v !== "string" || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(v)) continue;
    total += v.length;
    if (total > MAX_PICTURES_BYTES) break;
    out[id] = v;
  }
  return out;
}

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
    flow?: unknown;
    pictures?: unknown;
  } | null;
  const designId = typeof body?.designId === "string" ? body.designId.slice(0, 80) : "";
  if (!designId) return new Response("Which design?", { status: 400 });

  try {
    const pdf = await renderDesignPdf(
      { orgId, designId, options: readPdfOptions(body?.options, designId), ...readPdfFlow(body?.flow) },
      new URL(request.url).origin,
      readPictures(body?.pictures)
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
