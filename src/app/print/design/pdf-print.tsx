"use client";

import dynamic from "next/dynamic";
import type { PrintModel } from "@/lib/studio/export";
import type { OrgBrand } from "@/lib/org/brand";

/* PrintDoc as the headless browser meets it. PrintDoc portals itself to
   <body>, which needs a document, so it loads in the browser only; and it
   says when every plan raster and the logo have decoded — the moment the
   print window would have opened. Here that moment raises a flag the renderer
   is waiting on (lib/studio/pdf-render.ts). */

const PrintDoc = dynamic(
  () => import("@/components/studio/summary/print-doc").then((m) => m.PrintDoc),
  { ssr: false }
);

declare global {
  interface Window {
    __htPdfReady?: boolean;
  }
}

export function PdfPrint({
  model,
  urls,
  brand,
}: {
  model: PrintModel;
  urls: Record<string, string>;
  brand: OrgBrand;
}) {
  return (
    <PrintDoc
      model={model}
      urls={urls}
      brand={brand}
      onReady={() => {
        window.__htPdfReady = true;
      }}
    />
  );
}
