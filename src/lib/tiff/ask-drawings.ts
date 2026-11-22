/* A DOCUMENT'S DRAWINGS NEXT, once it is read, in an invocation of their own
   (api/tiff/drawings), so reading them never runs out of the time ingestion
   has left; there a manual photographed on the phone has its pages read
   first (./after-ready). Best effort: a document whose drawings weren't asked
   for is as readable as it was. Every way a document finishes reading (the
   ingest route, the phone's photographed pages) asks here, so they all end in
   the same place. */

export async function askForDrawings(origin: string, documentId: string, orgId: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  const base = process.env.APP_BASE_URL ?? origin;
  await fetch(`${base}/api/tiff/drawings`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ documentId, orgId }),
  }).catch((err: unknown) => console.error(`[kb-drawings] couldn't ask for ${documentId}'s drawings: ${err instanceof Error ? err.message : String(err)}`));
}
