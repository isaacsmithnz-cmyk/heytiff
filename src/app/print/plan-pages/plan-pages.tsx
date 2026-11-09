"use client";

import { useEffect } from "react";
import type { PlanPagesTicket } from "@/lib/studio/pdf-request";
import { imageToPage, pdfPagesAt, pdfToPages, type PageImage } from "@/lib/studio/plans";

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

async function fileOf(t: PlanPagesTicket): Promise<File> {
  const res = await fetch(t.url);
  if (!res.ok) throw new Error(`the file answered ${res.status}`);
  const blob = await res.blob();
  const type = t.kind === "pdf" ? "application/pdf" : blob.type || "image/png";
  return new File([blob], t.kind === "pdf" ? "plan.pdf" : "plan.png", { type });
}

/* The words of a PDF page come with its full render (plans.ts renderPage),
   which is what the title block is read from; a preview carries none. So the
   first visit draws each page full once for its words, and small for its
   picture. A set of forty pages is forty renders; the words are what decide
   which pages are floors, so it is spent once, here. */
async function previewsOf(file: File, kind: PlanPagesTicket["kind"]): Promise<DrawnPreview[]> {
  if (kind === "image") {
    const p = await imageToPage(file);
    return [{ n: 1, width: p.width, height: p.height, jpeg: await asDataUrl(p.blob!) }];
  }
  const small = await pdfToPages(file, undefined, { preview: true });
  const out: DrawnPreview[] = [];
  for (const p of small) {
    const n = p.pageNumber ?? out.length + 1;
    const [full] = await pdfPagesAt(file, [n]);
    out.push({ n, width: full.width, height: full.height, ...(full.words?.length ? { words: full.words } : {}), jpeg: await asDataUrl(p.blob!) });
    if (full.thumbUrl) URL.revokeObjectURL(full.thumbUrl);
  }
  return out;
}

async function fullOf(file: File, kind: PlanPagesTicket["kind"], slots: NonNullable<PlanPagesTicket["full"]>): Promise<DrawnFull[]> {
  const { supabaseBrowser } = await import("@/lib/supabase-browser");
  const out: DrawnFull[] = [];
  for (const slot of slots) {
    const page = kind === "image" ? await imageToPage(file) : (await pdfPagesAt(file, [slot.n]))[0];
    if (!page?.blob) throw new Error(`page ${slot.n} didn't draw`);
    const { error } = await supabaseBrowser().storage.from("studio-plans").uploadToSignedUrl(slot.ref, slot.token, page.blob, { contentType: `image/${page.ext ?? "png"}` });
    if (error) throw new Error(error.message);
    out.push({ n: slot.n, ref: slot.ref, width: page.width, height: page.height, ...(page.trim ? { trim: page.trim } : {}), ...(page.words?.length ? { words: page.words } : {}) });
  }
  return out;
}

export function PlanPages({ ticket }: { ticket: PlanPagesTicket }) {
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const file = await fileOf(ticket);
        const answer: PlanPagesAnswer = ticket.full ? { full: await fullOf(file, ticket.kind, ticket.full) } : { previews: await previewsOf(file, ticket.kind) };
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
