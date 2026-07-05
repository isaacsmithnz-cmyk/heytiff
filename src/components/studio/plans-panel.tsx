"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import type { DesignDocument, Floor } from "@/lib/studio/document";
import {
  applyPageAllocations,
  imageToPage,
  pdfToPages,
  type PageImage,
  type PlanImages,
  type UploadedSheet,
} from "@/lib/studio/plans";

/* Plans stage — upload PDF/image plans, pick the pages that matter, manage
   floors. Rasterisation happens in the browser; storage refs go in the doc. */

type Phase =
  | { kind: "idle" }
  | { kind: "rendering"; done: number; total: number }
  | { kind: "picking"; pages: PageImage[]; selected: Set<number> }
  /* chosen page indexes + an editable floor name per page — pages sharing a
     name become sheets of the same floor (east/west wings of one level) */
  | { kind: "allocating"; pages: PageImage[]; chosen: number[]; names: string[] }
  | { kind: "uploading"; done: number; total: number };

export function PlansPanel({
  doc,
  onMutate,
  onAddFloor,
  onOpenFloor,
  planImages,
}: {
  doc: DesignDocument;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onAddFloor: () => void;
  onOpenFloor: (id: string) => void;
  planImages: PlanImages;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const floors = [...doc.floors].sort((a, b) => a.level - b.level);

  const onFiles = async (files: FileList | File[]) => {
    setError(null);
    const list = [...files];
    if (list.length === 0) return;
    try {
      setPhase({ kind: "rendering", done: 0, total: list.length });
      const pages: PageImage[] = [];
      for (const f of list) {
        if (f.type === "application/pdf") {
          pages.push(
            ...(await pdfToPages(f, (done, total) =>
              setPhase({ kind: "rendering", done, total })
            ))
          );
        } else if (f.type.startsWith("image/")) {
          pages.push(await imageToPage(f));
        }
      }
      if (pages.length === 0) {
        setPhase({ kind: "idle" });
        setError("No usable pages — upload a PDF, PNG or JPG.");
        return;
      }
      // nothing pre-selected — the user picks exactly the pages they want
      setPhase({ kind: "picking", pages, selected: new Set() });
    } catch (e) {
      setPhase({ kind: "idle" });
      setError(e instanceof Error ? e.message : "Couldn't read that file");
    }
  };

  const confirmAllocations = async (
    pages: PageImage[],
    chosen: number[],
    names: string[]
  ) => {
    try {
      const entries: { floorName: string; sheet: UploadedSheet }[] = [];
      for (let k = 0; k < chosen.length; k++) {
        setPhase({ kind: "uploading", done: k, total: chosen.length });
        const page = pages[chosen[k]];
        const ref = await planImages.upload(page);
        entries.push({
          floorName: names[k],
          sheet: {
            label: page.label,
            ref,
            pageNumber: page.pageNumber,
            width: page.width,
            height: page.height,
          },
        });
      }
      onMutate((d) => ({ ...d, floors: applyPageAllocations(entries, d.floors) }));
      pages.forEach((p) => URL.revokeObjectURL(p.thumbUrl));
      setPhase({ kind: "idle" });
    } catch (e) {
      setPhase({ kind: "idle" });
      setError(
        e instanceof Error
          ? `Upload failed: ${e.message}`
          : "Upload failed — check your connection and try again"
      );
    }
  };

  const removeFloor = (floor: Floor) => {
    onMutate((d) => ({
      ...d,
      floors: d.floors.filter((f) => f.id !== floor.id),
      objects: d.objects.filter((o) => o.floorId !== floor.id),
    }));
    for (const sheet of floor.plans) {
      void planImages.remove(sheet.imageRef).catch(() => {});
    }
  };

  return (
    <div className="ds-panel-card ds-plans">
      {/* ── upload / picker ── */}
      {phase.kind === "idle" && (
        <div
          className={`ds-upzone${dragOver ? " drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void onFiles(e.dataTransfer.files);
          }}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
        >
          <span className="ds-upzone-ic">
            <Icon name="arrowUp" size={20} />
          </span>
          <div className="ds-upzone-t">Drop floor plans here</div>
          <div className="ds-upzone-s">
            PDF, PNG or JPG — pick the pages that matter, calibrate, design.
          </div>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => {
              if (e.target.files) void onFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {(phase.kind === "rendering" || phase.kind === "uploading") && (
        <div className="ds-plans-busy">
          <div className="ds-plans-busy-t">
            {phase.kind === "rendering" ? "Reading pages…" : "Uploading plans…"}
          </div>
          <div className="ds-progress">
            <div
              style={{
                width: `${(phase.done / Math.max(1, phase.total)) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {phase.kind === "picking" && (
        <div className="ds-pagepick">
          <div className="ds-pagepick-head">
            <span className="ds-cardt">
              Click the pages you want as floors
            </span>
            <span className="ds-pagepick-n">
              {phase.selected.size} of {phase.pages.length} selected
            </span>
          </div>
          <div className="ds-pages">
            {phase.pages.map((p, i) => {
              const on = phase.selected.has(i);
              return (
                <button
                  key={i}
                  className={`ds-page${on ? " on" : ""}`}
                  onClick={() => {
                    const next = new Set(phase.selected);
                    if (on) next.delete(i);
                    else next.add(i);
                    setPhase({ ...phase, selected: next });
                  }}
                >
                  {/* raster thumbnails are object URLs, not app assets */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumbUrl} alt={p.label} />
                  <span className="ds-page-label">
                    <span className={`ds-page-check${on ? " on" : ""}`}>
                      {on && <Icon name="check" size={11} />}
                    </span>
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="ds-pagepick-actions">
            <button
              className="ds-calib-cancel"
              onClick={() => {
                phase.pages.forEach((p) => URL.revokeObjectURL(p.thumbUrl));
                setPhase({ kind: "idle" });
              }}
            >
              Cancel
            </button>
            <button
              className="ds-calib-ok"
              disabled={phase.selected.size === 0}
              onClick={() => {
                const chosen = [...phase.selected].sort((a, b) => a - b);
                setPhase({
                  kind: "allocating",
                  pages: phase.pages,
                  chosen,
                  names: chosen.map((i) => phase.pages[i].label),
                });
              }}
            >
              Continue with {phase.selected.size}{" "}
              {phase.selected.size === 1 ? "page" : "pages"}
            </button>
          </div>
        </div>
      )}

      {phase.kind === "allocating" && (
        <div className="ds-pagepick">
          <div className="ds-pagepick-head">
            <span className="ds-cardt">Name the floor for each page</span>
          </div>
          <div className="ds-alloc-hint">
            Pages given the <b>same floor name</b> become sheets of one floor —
            that&apos;s how a level split across east/west drawings stays a
            single canvas. Names matching an existing floor add to it.
          </div>
          <div className="ds-alloc-rows">
            {phase.chosen.map((pageIdx, k) => {
              const p = phase.pages[pageIdx];
              return (
                <div key={pageIdx} className="ds-alloc-row">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumbUrl} alt={p.label} />
                  <span className="ds-alloc-page">
                    {p.pageNumber ? `p.${p.pageNumber}` : "img"}
                  </span>
                  <input
                    value={phase.names[k]}
                    aria-label={`Floor for ${p.label}`}
                    onChange={(e) => {
                      const names = [...phase.names];
                      names[k] = e.target.value;
                      setPhase({ ...phase, names });
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div className="ds-pagepick-actions">
            <button
              className="ds-calib-cancel"
              onClick={() =>
                setPhase({
                  kind: "picking",
                  pages: phase.pages,
                  selected: new Set(phase.chosen),
                })
              }
            >
              Back
            </button>
            <button
              className="ds-calib-ok"
              onClick={() =>
                void confirmAllocations(phase.pages, phase.chosen, phase.names)
              }
            >
              Add to design
            </button>
          </div>
        </div>
      )}

      {error && <div className="ds-ierr">{error}</div>}

      {/* ── floors ── */}
      <div className="ds-plans-floors-head">
        <span className="ds-cardt">Floors</span>
        <button className="ds-import" onClick={onAddFloor}>
          <Icon name="plus" size={13} />
          Blank floor
        </button>
      </div>
      {floors.length === 0 ? (
        <div className="ds-insp-hint">
          No floors yet — upload a plan above, or add a blank floor to sketch
          without one.
        </div>
      ) : (
        <div className="ds-floors">
          {floors.map((f) => (
            <div key={f.id} className="ds-floor">
              <span className="ds-floor-lvl">L{f.level}</span>
              <input
                className="ds-floor-name"
                value={f.name}
                aria-label={`Floor name L${f.level}`}
                onChange={(e) =>
                  onMutate((d) => ({
                    ...d,
                    floors: d.floors.map((fl) =>
                      fl.id === f.id ? { ...fl, name: e.target.value } : fl
                    ),
                  }))
                }
              />
              <span className={`ds-floor-scale${f.scaleMmPerUnit == null ? " none" : ""}`}>
                {f.scaleMmPerUnit == null
                  ? "Not calibrated"
                  : `${f.scaleMmPerUnit.toFixed(1)} mm/px`}
              </span>
              <span className="ds-floor-plan">
                {f.plans.length === 0
                  ? "Blank"
                  : f.plans.length === 1
                    ? f.plans[0].pageNumber
                      ? `PDF p.${f.plans[0].pageNumber}`
                      : "Image"
                    : `${f.plans.length} sheets`}
              </span>
              <button
                className="ds-floor-open"
                onClick={() => onOpenFloor(f.id)}
                title="Open on the canvas"
              >
                <Icon name="arrowR" size={14} />
                Design
              </button>
              <button
                className={`ds-rdel${armedDelete === f.id ? " arm" : ""}`}
                aria-label={`Delete ${f.name}`}
                onClick={() => {
                  if (armedDelete === f.id) {
                    setArmedDelete(null);
                    removeFloor(f);
                  } else {
                    setArmedDelete(f.id);
                  }
                }}
                onBlur={() => setArmedDelete(null)}
              >
                {armedDelete === f.id ? "Delete floor?" : <Icon name="x" size={15} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
