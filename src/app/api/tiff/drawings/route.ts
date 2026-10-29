import { after } from "next/server";
import { auth0 } from "@/lib/auth0";
import { authorised } from "@/lib/integrations/cron-auth";
import { can } from "@/lib/permissions-server";
import { describeDrawings } from "@/lib/tiff/drawings-run";
import { claimDocument, releaseLease, renewLease } from "@/lib/tiff/lease";

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
    /* the document's own lease, as ingestion and the scanned pages hold it: two writers numbering
       chunks from the same count would collide (the review of 29 October 2026) */
    if (!(await claimDocument(documentId, org))) {
      console.warn(`[kb-drawings] ${documentId}: busy, its drawings wait for the next ask`);
      return;
    }
    try {
      const r = await describeDrawings(documentId, org, () => renewLease(documentId, org)).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }));
      if (!r.ok) console.error(`[kb-drawings] ${documentId}: ${r.error}`);
    } finally {
      await releaseLease(documentId, org);
    }
  });
  return Response.json({ started: true });
}
