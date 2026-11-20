"use client";

import { useEffect } from "react";
import type { PlanPagesTicket } from "@/lib/studio/pdf-request";
import { imageToPage, pdfPagesAt, pdfPreviewsWithWords, type PageImage, type PdfSource } from "@/lib/studio/plans";

/* The pages of a plan, drawn in the headless browser (page.tsx). Two visits:
   the first draws every page small and reads its words, and hands them back
   as JPEGs in `window.__htPlanPages`; the second draws the pages named in
   full and puts each straight into its signed slot in the studio-plans
   bucket, the way the New design dialog does, so no full raster rides
   through the browser's bridge. `__htPdfReady` says the work is done, and
   `__htPlanPagesError` why it isn't. */

export type DrawnPreview = { n: number; width: number; height: number; words?: PageImage["words"]; jpeg: string };
export type DrawnFull = { n: number; ref: string; width: number; height: number; trim?: PageImage["trim"]; words?: PageImage["words"] };
export type PlanPagesAnswer = { previews?: DrawnPreview[]; full?: DrawnFull[] };

declare global {
  interface Window {
    __htPdfReady?: boolean;
    __htPlanPages?: PlanPagesAnswer;
    __htPlanPagesError?: string;
  }
}

const asDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("the page couldn't be read back"));
    r.readAsDataURL(blob);
  });

/* The set as bytes in the page's own memory, never a Blob: on Vercel's
   headless Chrome a body this size couldn't be taken in as one (3570, 20
   November 2026, 11 MB: "reading the file: Failed to fetch", after the set
   was handed to the page whole). A picture is small and goes as a File. */
async function fileOf(t: PlanPagesTicket): Promise<PdfSource> {
  /* handed over in pieces by the server that opened this page, where it was */
  const given = window as unknown as { __htFileSize?: () => Promise<number>; __htFileChunk?: (i: number) => Promise<string> };
  if (t.kind === "pdf" && given.__htFileSize && given.__htFileChunk) {
    const size = await given.__htFileSize();
    const out = new Uint8Array(size);
    for (let at = 0, i = 0; at < size; i++) {
      const piece = atob(await given.__htFileChunk(i));
      if (!piece.length) throw new Error(`reading the file: it stopped at ${at} of ${size} bytes`);
      for (let k = 0; k < piece.length; k++) out[at + k] = piece.charCodeAt(k);
      at += piece.length;
    }
    return out.buffer;
  }
  /* each step says its name with its error, so a failed read says where */
  const res = await fetch(t.url).catch((e: unknown) => {
    throw new Error(`fetching the file: ${e instanceof Error ? e.message : String(e)}`);
  });
  if (!res.ok) throw new Error(`the file answered ${res.status}`);
  const read = <T,>(p: Promise<T>) =>
    p.catch((e: unknown) => {
      throw new Error(`reading the file: ${e instanceof Error ? e.message : String(e)}`);
    });
  if (t.kind === "pdf") return read(res.arrayBuffer());
  const blob = await read(res.blob());
  return new File([blob], "plan.png", { type: blob.type || "image/png" });
}

/** Each page drawn, said to the server for the bar under the plan. */
const report = (done: number, total: number) => {
  void (window as unknown as { __htProgress?: (d: number, t: number) => Promise<void> }).__htProgress?.(done, total);
};

/** A picture's file: always one already, since only a PDF comes as bytes. */
const pictureOf = (f: PdfSource): File => (f instanceof File ? f : new File([f], "plan.png", { type: "image/png" }));

/* Each page drawn small for its picture, with its words read off the text
   layer at the full drawing's scale (which is what the title block is read
   from), all from one opening of the file: no page is drawn in full here.
   Drawing every page in full for its words, the file opened again for each,
   was minutes on a big set and ran out the server's wait (3570, 19 November
   2026: 27 A1 sheets, 11 MB). */
async function previewsOf(file: PdfSource, kind: PlanPagesTicket["kind"]): Promise<DrawnPreview[]> {
  if (kind === "image") {
    const p = await imageToPage(pictureOf(file));
    return [{ n: 1, width: p.width, height: p.height, jpeg: await asDataUrl(p.blob!) }];
  }
  const out: DrawnPreview[] = [];
  for (const { preview, width, height, words } of await pdfPreviewsWithWords(file, report, { print: true })) {
    out.push({ n: preview.pageNumber ?? out.length + 1, width, height, ...(words.length ? { words } : {}), jpeg: await asDataUrl(preview.blob!) });
    if (preview.thumbUrl) URL.revokeObjectURL(preview.thumbUrl);
  }
  return out;
}

async function fullOf(file: PdfSource, kind: PlanPagesTicket["kind"], slots: NonNullable<PlanPagesTicket["full"]>): Promise<DrawnFull[]> {
  const { supabaseBrowser } = await import("@/lib/supabase-browser");
  const out: DrawnFull[] = [];
  /* the floors drawn in full from one opening of the file */
  const drawn = kind === "image" ? [] : await pdfPagesAt(file, slots.map((s) => s.n), report, { print: true });
  for (const [i, slot] of slots.entries()) {
    const page = kind === "image" ? await imageToPage(pictureOf(file)) : drawn[i];
    if (!page?.blob) throw new Error(`page ${slot.n} didn't draw`);
    const { error } = await supabaseBrowser().storage.from("studio-plans").uploadToSignedUrl(slot.ref, slot.token, page.blob, { contentType: `image/${page.ext ?? "png"}` });
    if (error) throw new Error(error.message);
    out.push({ n: slot.n, ref: slot.ref, width: page.width, height: page.height, ...(page.trim ? { trim: page.trim } : {}), ...(page.words?.length ? { words: page.words } : {}) });
  }
  return out;
}

/** An error passed on with the step it came from. */
const named =
  (step: string) =>
  (e: unknown): never => {
    throw new Error(`${step}: ${e instanceof Error ? e.message : String(e)}`);
  };

export function PlanPages({ ticket }: { ticket: PlanPagesTicket }) {
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const file = await fileOf(ticket);
        const answer: PlanPagesAnswer = ticket.full
          ? { full: await fullOf(file, ticket.kind, ticket.full).catch(named("drawing the floors in full")) }
          : { previews: await previewsOf(file, ticket.kind).catch(named("drawing the pages small")) };
        if (!live) return;
        window.__htPlanPages = answer;
      } catch (e) {
        if (!live) return;
        window.__htPlanPagesError = e instanceof Error ? e.message : String(e);
      }
      window.__htPdfReady = true;
    })();
    return () => {
      live = false;
    };
  }, [ticket]);
  return <p style={{ font: "14px/20px system-ui", padding: 16 }}>Drawing the plan&rsquo;s pages</p>;
}
