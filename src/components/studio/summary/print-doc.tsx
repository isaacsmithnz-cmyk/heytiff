"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { PrintModel, PrintVariant } from "@/lib/studio/export";
import { floorDisplayName } from "@/lib/studio/plans";
import { fmt, LinesTable, OutdoorBlock, RoomsTable } from "./sheet-tables";
import { PlanFigure } from "./plan-figure";
import { Letterhead } from "@/components/org/letterhead";
import { hasBrand, NO_BRAND, type OrgBrand } from "@/lib/org/brand";

/* The print document — mounted ON DEMAND by the Export card with a built
   PrintModel and resolved sheet URLs, never rendered on screen. The print
   stylesheet reveals only #ds-printdoc; the .fg.dstudio wrapper resolves the
   design tokens and Jakarta (same trick as present mode).

   The cover renders the SAME merged sheet model as the screen, through the
   SAME table components (sheet-tables.tsx) — issuer eyebrow, letterhead,
   snapshot, one section per system (outdoor → rooms served → materials),
   the unserved rooms, then the Material picklist. Then one page per selected
   floor with a static PlanFigure. The @page rule (paper size + orientation)
   is injected while mounted, and `onReady` fires once every plan raster is
   decoded so the caller can window.print() without racing the images. */

function VariantCover({ v, brand }: { v: PrintVariant; brand: OrgBrand }) {
  const doc = v.doc;
  const empty = v.sheet.systems.length === 0 && v.sheet.unserved.length === 0;
  return (
    <section className="ds-print-cover">
      <header className="ds-jobpack-head">
        <div>
          {/* THE ISSUER IS AN EYEBROW: the top-right corner belongs to the
              addressee, as on any document that gets sent to someone. What
              changed is WHOSE name is in it — this said "HeyTiff Design
              Studio", which named the software on a pack a customer receives
              from an installer. It is the installer's letterhead now, and the
              old eyebrow is the fallback for a workspace that has set neither
              a name nor a logo. */}
          {hasBrand(brand) ? (
            <Letterhead brand={brand} />
          ) : (
            <div className="ds-jobpack-brand">HeyTiff Design Studio</div>
          )}
          <h1>
            {doc.meta.name || "Design"}
            {doc.meta.jobNumber && (
              <span className="ds-print-job">Job {doc.meta.jobNumber}</span>
            )}
          </h1>
          {v.label && <span className="ds-letter-variant">{v.label}</span>}
          <div className="ds-jobpack-meta ds-print-basis">
            <span>
              Zone {v.basis.zone} · {v.basis.zoneCity}
            </span>
            <span>{v.basis.buildingLabel}</span>
            <span>{v.basis.basisLabel}</span>
          </div>
        </div>
        {(doc.meta.client || doc.meta.site) && (
          <div className="ds-letter-to print">
            {doc.meta.client && <b>{doc.meta.client}</b>}
            {doc.meta.site.split("\n").map(
              (line) => line.trim() && <span key={line}>{line}</span>
            )}
          </div>
        )}
      </header>

      {empty ? (
        <p className="ds-insp-hint">Nothing designed yet.</p>
      ) : (
        <>
          <section className="ds-jobpack-sec">
            <dl className="ds-letter-snap">
              <div className="lead">
                <dt>Design load</dt>
                <dd>{fmt(v.snapshot.totalLoadKw, "kW")}</dd>
              </div>
              <div>
                <dt>{v.snapshot.roomCount === 1 ? "Room" : "Rooms"}</dt>
                <dd>{v.snapshot.roomCount}</dd>
              </div>
              <div>
                <dt>Floor area</dt>
                <dd>{fmt(v.snapshot.areaM2, "m²")}</dd>
              </div>
              <div>
                <dt>{v.snapshot.systemCount === 1 ? "System" : "Systems"}</dt>
                <dd>{v.snapshot.systemCount}</dd>
              </div>
            </dl>
          </section>

          {v.sheet.systems.map((s) => (
            <section key={s.systemId} className="ds-jobpack-sec ds-print-sys">
              <div className="ds-print-sys-h">
                <h2>
                  {s.name} <span>{s.kindLabel}</span>
                </h2>
                <div className="ds-print-verdict">
                  <span>
                    <b>{fmt(s.loadKw, "kW")}</b> load
                  </span>
                  <span>
                    <b>{fmt(s.capacityKw, "kW")}</b> capacity
                  </span>
                  <span className={s.status === "covered" ? "ok" : "under"}>
                    <b>{s.pct == null ? "—" : `${s.pct}%`}</b> covered
                  </span>
                </div>
              </div>
              <OutdoorBlock sys={s} />
              <span className="ds-tcap">
                {s.rooms.length === 1 ? "Room served" : "Rooms served"}
              </span>
              <RoomsTable rooms={s.rooms} />
              {s.lines.length > 0 && (
                <>
                  <span className="ds-tcap">Materials</span>
                  <LinesTable lines={s.lines} />
                </>
              )}
            </section>
          ))}

          {v.sheet.unserved.length > 0 && (
            <section className="ds-jobpack-sec">
              <h2>Not served yet</h2>
              <RoomsTable rooms={v.sheet.unserved} />
            </section>
          )}

          {v.sheet.picklist.length > 0 && (
            <section className="ds-jobpack-sec">
              <h2>Material picklist</h2>
              <LinesTable lines={v.sheet.picklist} />
            </section>
          )}

          <footer className="ds-jobpack-foot">
            Verify all selections against manufacturer documentation. Loads are
            rule-of-thumb estimates.
          </footer>
        </>
      )}
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

  /* paper size + orientation ride an injected @page rule while mounted */
  useEffect(() => {
    const el = document.createElement("style");
    el.id = "ds-print-page-size";
    el.textContent = `@page { size: ${options.paper} ${options.orientation}; margin: 12mm; }`;
    document.head.appendChild(el);
    return () => el.remove();
  }, [options.paper, options.orientation]);

  /* fire onReady once every sheet URL is decoded (the SVG <image>s share the
     browser cache, so decoding here means they render). Next paint via rAF,
     with a timeout fallback — a hidden/throttled document never paints, and
     print readiness must not hang on one. */
  /* The LOGO joins the rasters in this wait, and it has to: print fires the
     moment this resolves, and an <img> that has not decoded yet prints as
     nothing. The pack would come out with a hole where the letterhead is —
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
          {options.content !== "plans" && <VariantCover v={v} brand={brand} />}
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
