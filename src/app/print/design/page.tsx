import { notFound } from "next/navigation";
import "@/components/studio/studio.css";
import { supabaseAdmin } from "@/lib/supabase-server";
import { orgBrand } from "@/lib/org/query";
import { migrateDesign } from "@/lib/studio/migrations";
import type { DesignDocument } from "@/lib/studio/document";
import { buildPrintModel, collectSheetRefs } from "@/lib/studio/export";
import { latestInstalledPack } from "@/lib/studio/packs/server";
import { loadPackWithOverrides } from "@/lib/studio/packs/overrides-server";
import type { DataPack } from "@/lib/studio/packs/schema";
import { readPdfTicket } from "@/lib/studio/pdf-request";
import { PdfPrint } from "./pdf-print";

/* WHAT THE HEADLESS BROWSER PRINTS — /print/design?t=<ticket>.

   The same PrintDoc the Share dialog mounts for the print window, off the same
   print model, so the file and the paper are one document. Nobody opens this
   by hand: lib/studio/pdf-render.ts sends a headless Chrome here with a ticket
   (lib/studio/pdf-request.ts) and waits for the page to say it is ready.

   The ticket is the only authority. It names the workspace; every design row
   below is read inside it, so a ticket for one business can never print
   another's. A missing, forged or stale ticket is a 404 and says nothing. */

export const dynamic = "force-dynamic";

const BUCKET = "studio-plans";
const BRAND = "mitsubishi-electric";

export default async function PrintDesignPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const ticket = readPdfTicket(t);
  if (!ticket) notFound();
  const { orgId, options } = ticket;

  const { data } = await supabaseAdmin
    .from("studio_designs")
    .select("id, doc")
    .eq("org_id", orgId)
    .in("id", options.variantIds);
  const rows = new Map((data ?? []).map((r) => [r.id as string, r.doc]));
  /* in the order asked, the open design first; one that fails to read drops */
  const docs: DesignDocument[] = [];
  for (const id of options.variantIds) {
    const raw = rows.get(id);
    if (!raw) continue;
    try {
      docs.push(migrateDesign(raw).doc);
    } catch {
      /* an unreadable sibling is left out, as the print window leaves it */
    }
  }
  if (docs.length === 0 || docs[0].id !== ticket.designId) notFound();

  let pack: DataPack | null = null;
  try {
    const latest = await latestInstalledPack(BRAND);
    if (latest) pack = (await loadPackWithOverrides(BRAND, latest.version)).pack;
  } catch {
    /* no pack — the document still prints, as the print window's does */
  }

  const model = buildPrintModel(docs, pack, options);
  const urls: Record<string, string> = {};
  await Promise.all(
    collectSheetRefs(model).map(async (ref) => {
      const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(ref, 600);
      if (signed?.signedUrl) urls[ref] = signed.signedUrl;
    })
  );
  const brand = await orgBrand(orgId, { seconds: 600 });

  return <PdfPrint model={model} urls={urls} brand={brand} />;
}
