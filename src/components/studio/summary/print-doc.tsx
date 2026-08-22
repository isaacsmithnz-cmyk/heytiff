"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { PrintModel, PrintVariant } from "@/lib/studio/export";
import { floorDisplayName } from "@/lib/studio/plans";
import { PicklistSection, SheetDoc } from "./sheet-doc";
import { PlanFigure } from "./plan-figure";
import { NO_BRAND, type OrgBrand } from "@/lib/org/brand";
import { documentTheme } from "@/lib/org/theme";

/* The print document — mounted ON DEMAND by the Export card with a built
   PrintModel and resolved sheet URLs, never rendered on screen. The print
   stylesheet reveals only #ds-printdoc; the .fg.dstudio wrapper resolves the
   design tokens and Jakarta (same trick as present mode).

   THE COVER IS THE DOCUMENT ITSELF — `SheetDoc`, the same component the
   Summary screen and the customer's live link render, off the same merged
   model. Paper is the third chrome, and the thinnest: no bar, nothing to
   press, and none of the owner-only slots (no editable letterhead, no
   provenance, no Add to job, no Contributors), because a page cannot take an
   action and a document a customer receives should not carry staff names.

   Then one page per selected floor with a static PlanFigure. The @page rule
   (paper size + orientation) is injected while mounted, and `onReady` fires
   once every plan raster is decoded so the caller can window.print() without
   racing the images. */

/** the date the document carries — the last save, in the one locale the
    sheet is written in. Formatted here rather than in SheetDoc because the
    other two chromes format it on the server. */
const formatDay = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

function VariantCover({
  v,
  brand,
  preparedOn,
}: {
  v: PrintVariant;
  brand: OrgBrand;
  preparedOn: string;
}) {
  return (
    <section className="ds-print-cover">
      <SheetDoc
        /* no `mark` any more: the business's mark is IN the masthead, on every
           copy of the document rather than in each chrome's own bar. A pack
           filed without the installer's mark on it is what #440 existed to
           fix, and it is fixed harder by the sheet carrying it than by three
           chromes each remembering to pass one. */
        doc={v.doc}
        model={v.sheet}
        snapshot={v.snapshot}
        basis={v.basis}
        brand={brand}
        eyebrow={
          v.label ? `Design summary, ${v.label.toLowerCase()}` : "Design summary"
        }
        preparedOn={preparedOn}
      >
        <PicklistSection rows={v.sheet.picklist} />
      </SheetDoc>
    </section>
  );
}

export function PrintDoc({
  model,
  urls,
  brand = NO_BRAND,
  onReady,
}: {
  model: PrintModel;
  urls: Record<string, string>;
  /** signed minutes ago by the Export card, not at page render — see the note
      on getOrgBrand */
  brand?: OrgBrand;
  /** every plan raster AND the logo is decoded — safe to window.print() */
  onReady: () => void;
}) {
  const { options } = model;
  /* onReady fires EXACTLY once per mount, however often the parent re-renders
     with a fresh callback identity — the latch is a ref, the callback is read
     through a ref, and only true unmount disarms (an `on` flag flipped in the
     data-effect's own cleanup died to StrictMode's mount→cleanup→mount). */
  const readyFired = useRef(false);
  const alive = useRef(true);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /* paper size + orientation ride an injected @page rule while mounted.

     A THEMED COVER PRINTS WITH NO MARGIN AT ALL. Its frame bleeds to the
     paper edge — inside the default margin the same shape read as a border
     drawn on the paper, not a ground the page sits in — and the frame's own
     thickness becomes the margin instead. It is a NAMED page (`cover`, set on
     .ds-print-cover in studio.css) so the plan pages behind it keep the 12mm
     they were measured for; and it is gated on the same derivation the frame
     is, because a margin removed for a frame that is not there would print
     the plain sheet flush against the paper's edge. */
  const themed = brand.color != null && documentTheme(brand.color) != null;
  useEffect(() => {
    const el = document.createElement("style");
    el.id = "ds-print-page-size";
    el.textContent =
      `@page { size: ${options.paper} ${options.orientation}; margin: 12mm; }` +
      /* full bleed, so the frame's corners ARE the paper's corners and a
         radius there would draw four white notches. The square-off ships with
         the margin strip rather than living in the sheet, so the two can never
         disagree about whether this document reaches the edge. */
      (themed
        ? ` @page cover { margin: 0; }` +
          ` @media print { .ds-print-cover .dsd-bband { border-radius: 0; } }`
        : "");
    document.head.appendChild(el);
    return () => el.remove();
  }, [options.paper, options.orientation, themed]);

  /* fire onReady once every sheet URL is decoded (the SVG <image>s share the
     browser cache, so decoding here means they render). Next paint via rAF,
     with a timeout fallback — a hidden/throttled document never paints, and
     print readiness must not hang on one. */
  /* The LOGO joins the rasters in this wait, and it has to: print fires the
     moment this resolves, and an <img> that has not decoded yet prints as
     nothing. It would come out with a hole where the letterhead is —
     intermittently, and only for people whose logo was slow. */
  const logoUrl = brand.logoUrl;
  useEffect(() => {
    if (readyFired.current) return;
    const jobs = [...Object.values(urls), ...(logoUrl ? [logoUrl] : [])].map(
      (u) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve(); // a missing raster never blocks print
          img.src = u;
        })
    );
    const fire = () => {
      if (alive.current && !readyFired.current) {
        readyFired.current = true;
        onReadyRef.current();
      }
    };
    void Promise.all(jobs).then(() => {
      const t = window.setTimeout(fire, 150);
      requestAnimationFrame(() => {
        window.clearTimeout(t);
        fire();
      });
    });
  }, [urls, logoUrl]);

  return createPortal(
    <div
      id="ds-printdoc"
      className={`fg dstudio paper-${options.paper.toLowerCase()} ${options.orientation}`}
    >
      {model.variants.map((v) => (
        <div key={v.doc.id} className="ds-print-variant-block">
          {options.content !== "plans" && (
            <VariantCover
              v={v}
              brand={brand}
              preparedOn={formatDay(v.doc.meta.updatedAt)}
            />
          )}
          {v.floors.map((floor) => (
            <section key={floor.id} className="ds-print-page">
              <div className="ds-print-cap">
                <b>{v.doc.meta.name || "Design"}</b>
                <span>
                  {floorDisplayName(floor)}
                  {v.label ? ` · ${v.label}` : ""}
                </span>
              </div>
              <div className="ds-print-plan">
                <PlanFigure
                  doc={v.doc}
                  floor={floor}
                  layers={options.layers}
                  grayscale={options.grayscale}
                  legend={options.legend}
                  urls={urls}
                />
              </div>
            </section>
          ))}
        </div>
      ))}
    </div>,
    document.body
  );
}
