"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { DataPack } from "@/lib/studio/packs/schema";
import type { PrintModel, PrintVariant } from "@/lib/studio/export";
import { floorDisplayName } from "@/lib/studio/plans";
import { systemBadge, type BadgeStatus } from "@/lib/studio/split";
import { PlanFigure } from "./plan-figure";

/* The print document — mounted ON DEMAND by the Export card with a built
   PrintModel and resolved sheet URLs, never rendered on screen. The print
   stylesheet reveals only #ds-printdoc; the .fg.dstudio wrapper resolves the
   design tokens and Jakarta (same trick as present mode). Per variant: a
   cover of tables (job meta, design basis, systems, materials, rollup),
   then one page per selected floor with a static PlanFigure. The @page rule
   (paper size + orientation) is injected while mounted, and `onReady` fires
   once every plan raster is decoded so the caller can window.print()
   without racing the images. */

const BADGE_WORD: Record<BadgeStatus, string> = {
  green: "OK",
  amber: "Check",
  red: "Issues",
  empty: "Empty",
};

function VariantCover({
  v,
  pack,
}: {
  v: PrintVariant;
  pack: DataPack | null;
}) {
  const doc = v.doc;
  const empty = v.schedule.systems.length === 0;
  return (
    <section className="ds-print-cover">
      <header className="ds-jobpack-head">
        <div>
          <h1>
            {doc.meta.name || "Design"}
            {v.label && <span className="ds-print-variant">{v.label}</span>}
          </h1>
          <div className="ds-jobpack-meta">
            {doc.meta.jobNumber && <span>Job {doc.meta.jobNumber}</span>}
            {doc.meta.client && <span>{doc.meta.client}</span>}
            {doc.meta.site && <span>{doc.meta.site}</span>}
          </div>
          <div className="ds-jobpack-meta ds-print-basis">
            <span>
              Zone {v.basis.zone} · {v.basis.zoneCity}
            </span>
            <span>{v.basis.buildingLabel}</span>
            <span>{v.basis.basisLabel}</span>
          </div>
        </div>
        <div className="ds-jobpack-brand">HeyTiff Design Studio</div>
      </header>

      {empty ? (
        <p className="ds-insp-hint">Nothing designed yet.</p>
      ) : (
        <>
          <section className="ds-jobpack-sec">
            <h2>Systems overview</h2>
            <table className="ds-mat-table auto">
              <thead>
                <tr>
                  <th>System</th>
                  <th>Type</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {doc.systems.map((s) => {
                  const b = systemBadge(doc, pack, s);
                  return (
                    <tr key={s.id}>
                      <td className="ds-mat-model">{s.name}</td>
                      <td>{s.type}</td>
                      <td>{BADGE_WORD[b.status]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {v.schedule.systems.map((s) => (
            <section key={s.systemId} className="ds-jobpack-sec">
              <h2>{s.name} — materials</h2>
              {(s.units.length > 0 || s.pipe.length > 0) && (
                <table className="ds-mat-table take">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Description</th>
                      <th className="num">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.units.map((u) => (
                      <tr key={u.model}>
                        <td className="ds-mat-model">{u.model}</td>
                        <td>{u.description}</td>
                        <td className="num">{u.qty}</td>
                      </tr>
                    ))}
                    {s.pipe.map((p, i) => (
                      <tr key={`p${i}`}>
                        <td className="ds-mat-model">
                          ø{p.liquid_mm} / ø{p.gas_mm} pair coil
                        </td>
                        <td>liquid / gas mm</td>
                        <td>{p.lengthM} m</td>
                      </tr>
                    ))}
                    {s.charge && s.charge.grams > 0 && (
                      <tr>
                        <td className="ds-mat-model">Additional refrigerant</td>
                        <td>{s.charge.note}</td>
                        <td>{s.charge.grams} g</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
              {s.notes.map((n, i) => (
                <div key={i} className="ds-mat-note">
                  {n}
                </div>
              ))}
            </section>
          ))}

          {v.rollup.length > 0 && (
            <section className="ds-jobpack-sec">
              <h2>Whole-job unit schedule</h2>
              <table className="ds-mat-table take">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Description</th>
                    <th className="num">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {v.rollup.map((r) => (
                    <tr key={r.model}>
                      <td className="ds-mat-model">{r.model}</td>
                      <td>{r.description}</td>
                      <td className="num">{r.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
  pack,
  urls,
  onReady,
}: {
  model: PrintModel;
  /** for the systems-overview status badges (schedules are already built) */
  pack: DataPack | null;
  urls: Record<string, string>;
  /** every plan raster is decoded — safe to window.print() */
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
  useEffect(() => {
    if (readyFired.current) return;
    const jobs = Object.values(urls).map(
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
  }, [urls]);

  return createPortal(
    <div
      id="ds-printdoc"
      className={`fg dstudio paper-${options.paper.toLowerCase()} ${options.orientation}`}
    >
      {model.variants.map((v) => (
        <div key={v.doc.id} className="ds-print-variant-block">
          {options.content !== "plans" && <VariantCover v={v} pack={pack} />}
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
