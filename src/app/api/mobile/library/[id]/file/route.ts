import { supabaseAdmin } from "@/lib/supabase-server";
import { kbRefIsOrgs } from "@/lib/tiff/files";
import { signKbRef } from "@/lib/tiff/query";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* OPENING A LIBRARY DOCUMENT from the phone: a short-lived link to the
   stored PDF, as the Library's own Open does it (actions/kb's kbDocUrl),
   behind `tiff`. The document is looked up inside the caller's workspace,
   and its stored file must sit under that workspace's own prefix before it
   is signed. A field note has no file, and says so. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "tiff");
  if (ctx instanceof Response) return ctx;
  const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

  const id = (await params).id.trim().slice(0, 80);
  const { data } = await supabaseAdmin.from("kb_documents").select("storage_ref").eq("org_id", ctx.orgId).eq("id", id).maybeSingle();
  if (!data) return no(404, "That document isn't in the Library any more.");

  const ref = String((data as { storage_ref: string | null }).storage_ref ?? "");
  if (!ref) return no(404, "That one was written from a note, so there's no file to open.");
  if (!kbRefIsOrgs(ref, ctx.orgId)) return no(403, "That file doesn't belong to this workspace.");

  const url = await signKbRef(ref);
  if (!url) return no(404, "That file couldn't be opened.");
  return ok({ url });
}
