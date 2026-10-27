import { ok, requireMobile } from "@/lib/mobile/auth";
import { leaveActor } from "@/lib/mobile/leave";
import { openSlot } from "@/lib/documents/upload-slots";

/* A MEDICAL CERTIFICATE from the phone, step one: a slot for its bytes (a
   signed URL the phone PUTs them to), as your own `medical_certificate`, the
   one intrinsic upload a leave request adopts. Step two lands it
   (certificate/[doc]); Send hands its id to the request, which adopts it. */
export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const actor = await leaveActor(ctx);
  if (!actor) return Response.json({ error: "There's no staff card for you here yet." }, { status: 404, headers: { "cache-control": "no-store" } });
  const b = (await request.json().catch(() => null)) as { fileName?: unknown; mimeType?: unknown; sizeBytes?: unknown } | null;
  const slot = await openSlot(actor.orgId, actor.staffId, "medical_certificate", {
    fileName: typeof b?.fileName === "string" ? b.fileName : "",
    mimeType: typeof b?.mimeType === "string" ? b.mimeType : "",
    sizeBytes: typeof b?.sizeBytes === "number" ? b.sizeBytes : 0,
  });
  if (!slot.ok) return Response.json({ error: slot.error }, { status: 400, headers: { "cache-control": "no-store" } });
  return ok({ documentId: slot.documentId, uploadUrl: slot.signedUrl });
}
