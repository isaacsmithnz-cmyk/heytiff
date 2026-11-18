"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { kbDocUrl } from "@/app/actions/kb";
import { JobMediaViewer } from "@/components/workboard/board/job-media-viewer";

/* A LIBRARY PDF OPENS IN HEYTIFF, not in a tab of its own (Isaac, 18
   November 2026: "when you open the PDF, it doesn't open it in TIFF, it
   opens it in a whole new tab instead of using TIFF's PDF display"). The
   document search's hits and Open the PDF, the Library search's pages and a
   source's Open document all came here through `window.open`; they now open
   the job card's own viewer (job-media-viewer), white over the darkened
   page with the document's name and the cross, the PDF in a frame that
   gives the browser's paging and zoom for free, at the page asked for:
   `#page=N` reads the same in a frame as in a tab.

   ASSEMBLY, NOT INVENTION, as the viewer itself says. The ⌘K photo viewer
   (shell/palette-photo-viewer) shows the way: portalled to <body>, outside
   the frame's stacking context, and after whatever dialog opened it, so it
   paints over that dialog on the same layer and the overlay stack sends
   Escape to it first. Closing it leaves you where you pressed. */

export type KbPdf = { title: string; url: string };

/** The signed link at a page. Pure. */
export const atPage = (url: string, page: number): string => `${url}#page=${Math.max(1, Math.floor(page) || 1)}`;

/** One Library PDF in the job card's viewer. */
export function KbPdfViewer({ pdf, onClose }: { pdf: KbPdf; onClose: () => void }) {
  return createPortal(
    <JobMediaViewer
      items={[
        {
          remoteId: pdf.url,
          name: pdf.title,
          fileType: "pdf",
          kind: "document",
          origin: null,
          takenAt: null,
          url: pdf.url,
          width: null,
          height: null,
          fromClaim: null,
        },
      ]}
      index={0}
      onNav={() => {}}
      onClose={onClose}
    />,
    document.body,
  );
}

/** Open a Library document's PDF at a page, in the viewer. `open` mints the
    signed link and answers null once the viewer is up, or why it couldn't,
    in words, for the caller to say where it always has. `viewer` is drawn
    by the caller, after its own dialog. */
export function useKbPdf(): {
  open: (documentId: string, title: string, page: number) => Promise<string | null>;
  viewer: ReactNode;
} {
  const [pdf, setPdf] = useState<KbPdf | null>(null);
  const open = async (documentId: string, title: string, page: number) => {
    const res = await kbDocUrl(documentId);
    if (!res.ok) return res.error;
    setPdf({ title, url: atPage(res.url, page) });
    return null;
  };
  return { open, viewer: pdf ? <KbPdfViewer pdf={pdf} onClose={() => setPdf(null)} /> : null };
}
