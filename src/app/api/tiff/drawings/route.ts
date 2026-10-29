import { after } from "next/server";
import { auth0 } from "@/lib/auth0";
import { authorised } from "@/lib/integrations/cron-auth";
import { can } from "@/lib/permissions-server";
import { describeDrawings } from "@/lib/tiff/drawings-run";

/* A document's drawings, read into words (lib/tiff/drawings-run), in an
   invocation of their own: the ingest route asks for it once a document is
   ready, so the reading never competes with the page budget ingestion has
   left. Asked by the ingest route with CRON_SECRET (which names the org), or
   by a person who manages the Library. Answers at once; the reading happens
   after. */
export const maxDuration = 300;

export async function POST(request: Request) {
  const body = ((await request.json().catch(() => null)) ?? {}) as { documentId?: unknown; orgId?: unknown };
  const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
  if (!documentId) return Response.json({ error: "No document to read." }, { status: 400 });

  let orgId: string | null = null;
  if (authorised(request.headers.get("authorization"))) {
    orgId = typeof body.orgId === "string" ? body.orgId.trim() : null;
  } else {
    const session = await auth0.getSession();
    if (session?.orgId && (await can("tiff_manage"))) orgId = session.orgId as string;
  }
  if (!orgId) return Response.json({ error: "Not authorised." }, { status: 401 });

  const org = orgId;
  after(async () => {
    const r = await describeDrawings(documentId, org).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }));
    if (!r.ok) console.error(`[kb-drawings] ${documentId}: ${r.error}`);
  });
  return Response.json({ started: true });
}
