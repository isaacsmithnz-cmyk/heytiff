import { ok, requireMobile } from "@/lib/mobile/auth";
import { addFileToLibrary, manualFromFile, offerForFile } from "@/lib/mobile/library-from-file";

/* A PDF YOU GAVE TIFF, INTO THE LIBRARY (lib/mobile/library-from-file). GET says
   whether a file is in the Library yet, and with `offer` what the Add sheet offers
   for it. POST puts it in, then the reading goes as any manual's does, through
   /library/[id]/read. Behind `tiff_manage`, as every door into the Library is. */

const no = (error: string, status: number) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  const ctx = await requireMobile(request, "tiff_manage");
  if (ctx instanceof Response) return ctx;
  const q = new URL(request.url).searchParams;
  const file = (q.get("file") ?? "").trim();
  if (q.get("offer") === null) return ok({ manual: await manualFromFile(ctx.orgId, file) });
  const offer = await offerForFile(ctx, file);
  return offer ? ok(offer) : no("That file isn't here any more.", 404);
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request, "tiff_manage");
  if (ctx instanceof Response) return ctx;

  let body: { file?: unknown; title?: unknown; category?: unknown; tagIds?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return no("That request couldn't be read.", 400);
  }
  const r = await addFileToLibrary(ctx, String(body.file ?? "").trim(), {
    title: String(body.title ?? ""),
    category: String(body.category ?? ""),
    tagIds: Array.isArray(body.tagIds) ? body.tagIds.map(String) : [],
  });
  return r.ok ? ok(r.value) : no(r.error, r.status);
}
