/* Who owns a document while it is being read.

   THE LOOP LIVES IN THE BROWSER, so "who is working on this" is a question the
   database has to answer. Every open library tab drives ingestion; without a
   claim, two of them read the same bookmark, read the same twenty pages, and
   insert the same chunks. That is not a thought experiment — 122 of prod's
   2,256 chunks were byte-identical duplicates when this was written.

   A LEASE, NOT A LOCK. The holder is a serverless invocation that can vanish
   mid-batch without ever releasing anything, so ownership has to expire on its
   own. Claiming is ONE conditional UPDATE, which Postgres applies atomically:
   of two simultaneous claims exactly one comes back with a row, and the loser
   learns it lost by getting nothing. No RPC, no advisory lock, no second
   round trip to check first — checking and taking must be the same statement
   or they race with each other.

   SHORTER THAN A BATCH WOULD BE USELESS, longer than a batch is the point: the
   lease has to outlive the slowest single batch or a worker would lose its own
   document mid-read, and it is renewed after every batch so a long document
   never outruns it. */

import { supabaseAdmin } from "@/lib/supabase-server";

/** How long a claim is good for. Comfortably past the ~20s a batch takes, so
    a slow batch never loses its own lease; short enough that a worker killed
    mid-flight frees the document while somebody is still watching. */
export const LEASE_SECONDS = 90;

const stamp = (now: Date, seconds: number) => new Date(now.getTime() + seconds * 1000).toISOString();

/** Take ownership if it is free, in one statement. True when this caller now
    owns it — false means somebody else is already reading it, which is a
    normal answer and not an error. */
export async function claimDocument(
  documentId: string,
  orgId: string,
  now: Date = new Date()
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("kb_documents")
    .update({ lease_until: stamp(now, LEASE_SECONDS) })
    .eq("org_id", orgId)
    .eq("id", documentId)
    /* The whole race, in one filter: free means never claimed or claimed by
       somebody who has since gone away. A worker that is still alive renews
       before this can ever be true of it. */
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .select("id");

  return (data?.length ?? 0) > 0;
}

/** Push the claim out again, between batches. Unconditional on purpose: the
    caller has already established that it owns this, and a renew that checked
    would be a second place for the same race to live. */
export async function renewLease(
  documentId: string,
  orgId: string,
  now: Date = new Date()
): Promise<void> {
  await supabaseAdmin
    .from("kb_documents")
    .update({ lease_until: stamp(now, LEASE_SECONDS) })
    .eq("org_id", orgId)
    .eq("id", documentId);
}

/** Hand it back the moment the work stops, rather than making the next caller
    wait out the clock. Best-effort: an invocation that dies without doing this
    is exactly what the expiry is for. */
export async function releaseLease(documentId: string, orgId: string): Promise<void> {
  await supabaseAdmin
    .from("kb_documents")
    .update({ lease_until: null })
    .eq("org_id", orgId)
    .eq("id", documentId);
}
