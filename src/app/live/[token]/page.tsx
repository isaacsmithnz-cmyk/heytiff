import type { Metadata } from "next";
import { notFound } from "next/navigation";
/* the expired branch renders without LiveViewer, so bring its dress along */
import "@/components/studio/studio.css";
import { supabaseAdmin } from "@/lib/supabase-server";
import { migrateDesign } from "@/lib/studio/migrations";
import type { DesignDocument } from "@/lib/studio/document";
import { latestInstalledPack } from "@/lib/studio/packs/server";
import { loadPackWithOverrides } from "@/lib/studio/packs/overrides-server";
import { trimPackForLive } from "@/lib/studio/packs/live-trim";
import type { DataPack } from "@/lib/studio/packs/schema";
import { orgBrand } from "@/lib/org/query";
import { NO_BRAND } from "@/lib/org/brand";
import {
  buildDesignSnapshot,
  buildSummaryModel,
  designBasis,
} from "@/lib/studio/summary";
import { simApprovalState } from "@/lib/studio/sim-approval";
import { LiveSheet } from "./live-sheet";
import {
  isShareExpired,
  SHARE_TTL_DAYS,
  shareExpiresAt,
} from "@/lib/studio/share";

/** A link that has aged out. Wears the same dead-link dress as not-found and
    says nothing about the design — an expired token shouldn't confirm what it
    used to point at. */
function ExpiredLink() {
  return (
    <div className="ds-live-404">
      <span className="ds-live-brand">HeyTiff</span>
      <h1>This link has expired</h1>
      <p>
        Live design links stay open for {SHARE_TTL_DAYS} days. Ask whoever sent
        it for a fresh one.
      </p>
    </div>
  );
}

/* The customer live link — /live/<token>, public by design (proxy.ts guards
   only /dashboard and /hq). The token IS the authorization: it finds exactly
   one studio_designs row, and everything served derives from that row — the
   LATEST saved doc (force-dynamic, never a snapshot), a pack trimmed to the
   models the design references (the full catalogue is licensed data), and
   signed plan-image URLs minted here because the customer has no session to
   mint their own. Revoking nulls the token and this page 404s.

   WHAT IT SERVES IS THE DESIGN. This route used to mount the simulator, and
   a customer who opened the link their installer sent got a simulation rather
   than a drawing of their own house. It now serves the design SHEET — the
   same document, off the same derivation, as the Summary screen and the
   printed copy (buildSummaryModel; #411 existed to delete a parallel model of
   this artifact and there must not be a third).

   The simulation is still here, as a way IN from the sheet rather than the
   destination, and only where somebody has ticked it as fit to show — see
   sim-approval.ts.

   Links also age out on their own (SHARE_TTL_DAYS): the token is the only
   thing protecting a design that anyone can read without signing in, so it
   must not stay valid forever. An expired link gets a plain "ask for a new
   one" page rather than a 404 — the customer did nothing wrong and needs to
   know what to do next. */

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
    .select("doc, share_created_at, org_id")
    .eq("share_token", token)
    .maybeSingle();
  if (error || !data?.doc) notFound();

  /* enforced HERE, not just in the UI — this route is the only thing standing
     between a public token and the design */
  if (isShareExpired(data.share_created_at as string | null)) return <ExpiredLink />;

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

  /* WHOSE DESIGN THIS IS.

     The page said "HeyTiff" in its top-left corner — the name of the software,
     on a link a customer opens because a particular business sent it to them.
     The org comes off the same row the token found, so this costs one read and
     no new trust: the token already proved the right to see this design, and
     the business that owns it is the business that sent the link.

     Signed on the SIX-HOUR clock the plan rasters below use, not the
     one-page-view default. A customer keeps this tab open; a letterhead that
     dies an hour in, above drawings that are still there, looks like a broken
     page rather than an expired link.

     Fails soft — orgBrand returns NO_BRAND for a missing row, and the viewer
     falls back to the wording it had before. */
  const brand = data.org_id
    ? await orgBrand(data.org_id as string, { seconds: 21600 })
    : NO_BRAND;

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

  /* THE DOCUMENT, derived once on the server. Pure functions over the doc and
     the trimmed pack — the same three the Summary screen calls, so a figure
     the customer reads cannot disagree with the one the owner is looking at.

     Both dates are formatted HERE and shipped as strings: a date built in a
     render body is a hydration failure waiting for midnight. en-AU because
     the reader is the installer's customer, not the server's locale. */
  const model = buildSummaryModel(doc, pack);
  const snapshot = buildDesignSnapshot(doc);
  const basis = designBasis(doc);
  const day: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "long",
    year: "numeric",
  };
  /* "prepared" is when the design was last SAVED, because the link is a live
     window on it — dating it from when the link was made would put a date on
     the sheet that the numbers under it have since moved past. */
  const preparedOn = new Date(doc.meta.updatedAt).toLocaleDateString("en-AU", day);
  const expiresOn = shareExpiresAt(
    data.share_created_at as string
  ).toLocaleDateString("en-AU", { day: "numeric", month: "long" });

  return (
    <LiveSheet
      doc={doc}
      pack={pack}
      planUrls={planUrls}
      brand={brand}
      model={model}
      snapshot={snapshot}
      basis={basis}
      preparedOn={preparedOn}
      expiresOn={expiresOn}
      /* absent, not disabled: nothing on this sheet advertises a simulation
         the customer cannot open */
      simOffered={simApprovalState(doc, pack).offered}
    />
  );
}
