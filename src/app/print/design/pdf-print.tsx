"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { PrintModel } from "@/lib/studio/export";
import type { OrgBrand } from "@/lib/org/brand";
import { StudioFlowContext } from "@/components/studio/flow";

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
    /** the house in 3D, drawn by the browser that asked for the file and set
        here by the renderer before the page loads (lib/studio/pdf-render.ts) */
    __htPdfPictures?: Record<string, string>;
  }
}

export function PdfPrint({
  model,
  urls,
  brand,
  flow,
}: {
  model: PrintModel;
  urls: Record<string, string>;
  brand: OrgBrand;
  /** the flow the file was asked for from: there is no studio round this page
      to say so, and it has to come out the same as that flow's print window */
  flow?: "next";
}) {
  /* never drawn here: this Chrome has no graphics card, and a house drawn in
     software ran the file out of time and memory */
  const [drawn] = useState<Record<string, string>>(() => (typeof window === "undefined" ? {} : (window.__htPdfPictures ?? {})));
  return (
    <StudioFlowContext.Provider value={flow ?? "current"}>
      <PrintDoc
        model={model}
        urls={urls}
        brand={brand}
        drawn={drawn}
        onReady={() => {
          window.__htPdfReady = true;
        }}
      />
    </StudioFlowContext.Provider>
  );
}
