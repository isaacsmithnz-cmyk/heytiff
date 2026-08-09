import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { TiffAssistant } from "@/components/tiff/assistant";
import { kbCategoryCounts, kbRecentDocs } from "@/lib/tiff/query";
import { isTranscriptionConfigured } from "@/lib/voice/transcribe";

/* The assistant. `tiff` is on by default for every role but revocable — gate
   the route, not just the nav entry.

   THE COUNTS ARE READY DOCUMENTS ONLY, which is the same rule the rail's cards
   need: a half-ingested manual can't be cited yet, so counting it would
   promise coverage the library doesn't have — and at zero the Research toggle
   is disabled rather than sending somebody to search an empty shelf.

   `tiff_manage` is asked separately and only decides whether the rail offers
   "Add documents"; every write re-checks it server-side.

   `voiceEnabled` is passed rather than read from a NoteScopeProvider: this
   screen has no note scope and wants none — nothing said to the ask bar is a
   note, so there is no target, no job list and no sieve to feed. All the
   assistant needs is whether this deployment can hear at all. */
export default async function TiffPage() {
  if (!(await can("tiff"))) redirect("/dashboard");

  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const [counts, canManage, recentDocs] = await Promise.all([
    kbCategoryCounts(orgId),
    can("tiff_manage"),
    // the landing's "Recently added" strip: what the library HAS, shown rather
    // than promised, on the screen whose whole subject is asking it things
    kbRecentDocs(orgId),
  ]);
  const readyCount = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return (
    <TiffAssistant
      counts={counts}
      readyCount={readyCount}
      canManage={canManage}
      recentDocs={recentDocs}
      voiceEnabled={isTranscriptionConfigured()}
    />
  );
}
