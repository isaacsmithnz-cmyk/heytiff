import { beginKbUpload } from "@/app/actions/kb";
import { actAsPhoneUser, ok, requireMobile } from "@/lib/mobile/auth";
import { kbOffer } from "@/lib/mobile/library-from-file";

/* ADDING A MANUAL FROM THE PHONE (Isaac, 30 October 2026: "Can you add to the
   library? On your phone yet? And does it give you the same result as
   uploading it via the web?"; the mock, "Build"). The web's own steps, so the
   same result: GET is what the web's drawer offers for a file's name, POST is
   the web's beginKbUpload as the token's person, which names `tiff_manage`
   again itself. The bytes go from the phone straight to the signed slot
   (/phone/pick), then /library/[id]/landed and /library/[id]/read. */

const refused = (error: string) => Response.json({ error }, { status: 409, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  const ctx = await requireMobile(request, "tiff_manage");
  if (ctx instanceof Response) return ctx;

  const q = new URL(request.url).searchParams;
  return ok(await kbOffer(ctx, (q.get("file") ?? "").slice(0, 300), Number(q.get("size")), q.get("mime") ?? ""));
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request, "tiff_manage");
  if (ctx instanceof Response) return ctx;

  let body: { title?: unknown; category?: unknown; tagIds?: unknown; fileName?: unknown; mime?: unknown; sizeBytes?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "That request couldn't be read." }, { status: 400 });
  }

  const slot = await actAsPhoneUser(ctx, () =>
    beginKbUpload({
      title: String(body.title ?? ""),
      category: String(body.category ?? ""),
      fileName: String(body.fileName ?? ""),
      tagIds: Array.isArray(body.tagIds) ? body.tagIds.map(String) : [],
      mime: String(body.mime ?? ""),
      sizeBytes: Number(body.sizeBytes),
    }),
  );
  if (!slot.ok) return refused(slot.error);
  return ok({ documentId: slot.documentId, bucket: slot.bucket, ref: slot.ref, token: slot.token });
}
