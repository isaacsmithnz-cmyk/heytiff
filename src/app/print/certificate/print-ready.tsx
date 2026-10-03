"use client";

import { useEffect } from "react";

/* Says when the paper can be printed: the typeface has loaded and the logo
   and signature have decoded. The renderer waits on this flag
   (lib/studio/pdf-render.ts, renderPdfAt). */

declare global {
  interface Window {
    __htPdfReady?: boolean;
  }
}

export function PrintReady() {
  useEffect(() => {
    let live = true;
    const images = [...document.images].map((img) =>
      img.complete ? Promise.resolve() : img.decode().catch(() => undefined)
    );
    Promise.all([document.fonts.ready, ...images]).then(() => {
      if (live) window.__htPdfReady = true;
    });
    return () => {
      live = false;
    };
  }, []);
  return null;
}
