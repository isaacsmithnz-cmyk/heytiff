import { getDbRole, requireOrg } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles-shared";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { renderPdfAt } from "@/lib/studio/pdf-render";
import { signLetterTicket } from "@/lib/letters/pdf-ticket";
import { loadLetter, mayOpenLetter } from "@/lib/letters/query";
import { letterFileName } from "@/lib/letters/letter";
import { orgBrand } from "@/lib/org/query";

/* A LETTER AS A PDF — GET /api/letters/<id>/pdf, the saved letter printed by
   a headless Chrome from /print/letter and handed back as a download. Gated
   as the letter is: admin and up, and whoever may open this one. A route
   handler, not a Server Function, for the minute Chromium needs. */

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let orgId: string;
  let userId: string;
  try {
    ({ orgId, userId } = await requireOrg());
  } catch {
    return new Response("Sign in to download letters.", { status: 401 });
  }
  const role = await getDbRole();
  if (!hasMinRole(role, "admin")) return new Response("Letters are in Admin.", { status: 403 });
  const id = (await params).id.trim().slice(0, 80);
  const [letter, staffId, brand] = await Promise.all([loadLetter(orgId, id), staffIdFor(orgId, userId), orgBrand(orgId)]);
  if (!letter) return new Response("That letter is gone.", { status: 404 });
  if (!mayOpenLetter(letter, { staffId, isOwner: hasMinRole(role, "owner") })) return new Response("Not your letter.", { status: 403 });

  let pdf: Uint8Array;
  try {
    pdf = await renderPdfAt("/print/letter", signLetterTicket({ orgId, letterId: id }), new URL(request.url).origin);
  } catch (err) {
    console.error(`[letters/pdf] render: ${String(err)}`);
    return new Response("Couldn't print the letter. Try again.", { status: 500 });
  }
  const name = letterFileName(letter, brand.name);
  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "no-store",
    },
  });
}
