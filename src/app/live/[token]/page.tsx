import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-server";
import { migrateDesign } from "@/lib/studio/migrations";
import type { DesignDocument } from "@/lib/studio/document";
import { latestInstalledPack } from "@/lib/studio/packs/server";
import { loadPackWithOverrides } from "@/lib/studio/packs/overrides-server";
import { trimPackForLive } from "@/lib/studio/packs/live-trim";
import type { DataPack } from "@/lib/studio/packs/schema";
import { LiveViewer } from "./live-viewer";

/* The customer live link — /live/<token>, public by design (proxy.ts guards
   only /dashboard and /hq). The token IS the authorization: it finds exactly
   one studio_designs row, and everything served derives from that row — the
   LATEST saved doc (force-dynamic, never a snapshot), a pack trimmed to the
   models the design references (the full catalogue is licensed data), and
   signed plan-image URLs minted here because the customer has no session to
   mint their own. Revoking nulls the token and this page 404s. */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live design — HeyTiff",
  robots: { index: false, follow: false },
};

const BUCKET = "studio-plans";
const BRAND = "mitsubishi-electric";

export default async function LivePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token || token.length < 16) notFound();

  const { data, error } = await supabaseAdmin
    .from("studio_designs")
    .select("doc")
    .eq("share_token", token)
    .maybeSingle();
  if (error || !data?.doc) notFound();

  let doc: DesignDocument;
  try {
    doc = migrateDesign(data.doc).doc;
  } catch {
    notFound();
  }

  /* pack: latest installed + HQ overrides, then trimmed to this design */
  let pack: DataPack | null = null;
  try {
    const latest = await latestInstalledPack(BRAND);
    if (latest) {
      const loaded = await loadPackWithOverrides(BRAND, latest.version);
      pack = trimPackForLive(loaded.pack, doc);
    }
  } catch {
    /* no pack — the plan still renders; the sim just has no handlers */
  }

  /* plan rasters: sign every referenced sheet for the visit (6 h) */
  const refs = new Set<string>();
  for (const f of doc.floors)
    for (const s of f.plans) if (s.imageRef) refs.add(s.imageRef);
  const planUrls: Record<string, string> = {};
  await Promise.all(
    [...refs].map(async (ref) => {
      const { data: signed } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(ref, 21600);
      if (signed?.signedUrl) planUrls[ref] = signed.signedUrl;
    })
  );

  return <LiveViewer doc={doc} pack={pack} planUrls={planUrls} />;
}
