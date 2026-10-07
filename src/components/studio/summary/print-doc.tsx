"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import {
  hasSheet,
  planPageOrientation,
  type PrintModel,
  type PrintVariant,
  type SheetSections,
} from "@/lib/studio/export";
import { planFigureBounds } from "@/lib/studio/figure-bounds";
import {
  floorDisplayName,
  trimOfImageUrl,
  withPrintTrims,
  type PixelTrim,
} from "@/lib/studio/plans";
import { PicklistSection, SheetDoc } from "./sheet-doc";
import { PlanFigure } from "./plan-figure";
import { NO_BRAND, type OrgBrand } from "@/lib/org/brand";
import { themeVars } from "@/lib/org/theme";

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
  sections,
}: {
  v: PrintVariant;
  brand: OrgBrand;
  preparedOn: string;
  /** what the Send dialog ticked — the customer's copy has no picklist */
  sections: SheetSections;
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
        sections={sections}
      >
        {sections.picklist && <PicklistSection rows={v.sheet.picklist} />}
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

     THE PAGE BOX HAS NO MARGIN, on every page and whatever the brand.

     A browser prints its own furniture — the date, the document title, the
     page URL, "1/1" — INTO the page margin, and nowhere else. Isaac's copy of
     85 West St came out with all four on a sheet a customer was meant to
     receive. With no margin there is nowhere to put them, verified by
     rendering with the header/footer switch explicitly on.

     What holds the paper margin open instead is the document: the sheet insets
     its own frame (`--dsd-edge`, sheet-doc.css) and the plan pages carry 12mm
     of padding (studio.css). Both are inside the printed area, so neither can
     be mistaken for somewhere to stamp a URL.

     No brand branch: `@page cover` existed only to strip the margin from a
     full-bleed frame, and the frame does not bleed any more — it is a rounded
     band inset from the paper, the same shape the Summary screen shows.

     ONE NAMED PAGE, `ds-turned`: the same paper the other way round, for a
     plan that prints bigger turned (`planPageOrientation` — a wide plan was a
     strip across a portrait page). It needs the print document IN FLOW, which
     it is now; a named page silently did nothing while `.fg` held it out. */
  useEffect(() => {
    const el = document.createElement("style");
    el.id = "ds-print-page-size";
    const turned = options.orientation === "portrait" ? "landscape" : "portrait";
    el.textContent =
      `@page { size: ${options.paper} ${options.orientation}; margin: 0; }\n` +
      `@page ds-turned { size: ${options.paper} ${turned}; margin: 0; }`;
    document.head.appendChild(el);
    return () => el.remove();
  }, [options.paper, options.orientation]);

  /* fire onReady once every sheet URL is decoded (the SVG <image>s share the
     browser cache, so decoding here means they render). Next paint via rAF,
     with a timeout fallback — a hidden/throttled document never paints, and
     print readiness must not hang on one. */
  /* The LOGO joins the rasters in this wait, and it has to: print fires the
     moment this resolves, and an <img> that has not decoded yet prints as
     nothing. It would come out with a hole where the letterhead is —
     intermittently, and only for people whose logo was slow. */
  /* AND EACH SHEET'S EMPTY MARGINS are read off its raster in the same wait,
     so a sheet nobody cropped prints framed on its drawing rather than on the
     viewer chrome it was screenshotted in (job 3375, 2026-10-07: a 3,680-wide
     lightbox capture printed as a small plan in a wide dark band, its labels
     sized to the band). Pages are trimmed at import now; this is for every
     sheet placed before that, and it writes nothing back. A raster whose
     pixels can't be read simply prints as it is. Ready waits for the trims
     to be DRAWN, not just found: they are committed synchronously before the
     paint that fires it. */
  const logoUrl = brand.logoUrl;
  const [trims, setTrims] = useState<Record<string, PixelTrim> | null>(null);
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
    const trimming = Promise.all(
      Object.entries(urls).map(async ([ref, u]) => [ref, await trimOfImageUrl(u)] as const)
    );
    const fire = () => {
      if (alive.current && !readyFired.current) {
        readyFired.current = true;
        onReadyRef.current();
      }
    };
    void Promise.all([Promise.all(jobs), trimming]).then(([, found]) => {
      if (!alive.current) return;
      const next: Record<string, PixelTrim> = {};
      for (const [ref, t] of found) if (t) next[ref] = t;
      flushSync(() => setTrims(next));
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
          {hasSheet(options.sections) && (
            <VariantCover
              v={v}
              brand={brand}
              preparedOn={formatDay(v.doc.meta.updatedAt)}
              sections={options.sections}
            />
          )}
          {v.floors.map((floor) => {
            const printed = trims ? withPrintTrims(floor, trims) : floor;
            /* which way up this plan's page goes: the frame it prints in,
               measured the way the figure measures itself */
            const frame = planFigureBounds(v.doc, printed);
            const way = frame
              ? planPageOrientation(frame, options.paper, options.orientation)
              : options.orientation;
            const turned = way !== options.orientation;
            /* A TURNED PAGE DRAWS ITS OWN FRAME. The sheet's is `position:
               fixed`, which the print engine stamps on every page at the
               FIRST page's size — so on a turned page it came out the wrong
               way round, cutting across the plan. This page covers it and
               draws the same band, the other way up; only where a sheet (and
               so a frame) is in the document at all. */
            return (
              <section
                key={floor.id}
                className={`ds-print-page ${way}${turned ? " turned" : ""}`}
                style={turned && hasSheet(options.sections) ? themeVars(brand.color) : undefined}
              >
                {turned && (
                  <>
                    <div className="ds-print-tband" aria-hidden="true" />
                    <div className="ds-print-twell" aria-hidden="true" />
                  </>
                )}
                <div className="ds-print-cap">
                  <b>{v.doc.meta.name || "Design"}</b>
                  <span>
                    {floorDisplayName(floor)}
                    {v.label ? `, ${v.label}` : ""}
                  </span>
                </div>
                <div className="ds-print-plan">
                  <PlanFigure
                    doc={v.doc}
                    floor={printed}
                    layers={options.layers}
                    grayscale={options.grayscale}
                    legend={options.legend}
                    urls={urls}
                    markOf={(m) => model.marks?.[m]}
                  />
                </div>
              </section>
            );
          })}
        </div>
      ))}
    </div>,
    document.body
  );
}
