import { POST as readDocument } from "@/app/api/tiff/ingest/route";
import { actAsPhoneUser, requireMobile } from "@/lib/mobile/auth";

/* Reading a manual, asked from the phone: the web's own ingest route, as the
   token's person, so the same claim, the same page allowance and the same
   drawings after. As from an open Library tab, a call starts the reading or
   takes over one that stopped, and answers where the document is up to. */

export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "tiff_manage");
  if (ctx instanceof Response) return ctx;
  const documentId = (await params).id.trim().slice(0, 80);
  return actAsPhoneUser(ctx, () =>
    readDocument(new Request(request.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId }) })),
  );
}
