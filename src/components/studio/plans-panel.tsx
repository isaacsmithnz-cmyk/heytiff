"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import type { DesignDocument, Floor } from "@/lib/studio/document";
import {
  applyBuilderRows,
  builderRowsFromPages,
  imageToPage,
  movePageToNewRow,
  movePageToRow,
  moveRow,
  pdfToPages,
  removePageFromRows,
  renameRow,
  type BuilderRow,
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
  /* the floor-stack builder: rows bottom-up; drag page cards between rows */
  | { kind: "building"; pages: PageImage[]; rows: BuilderRow[] }
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

  const confirmBuild = async (pages: PageImage[], rows: BuilderRow[]) => {
    const pageIdxs = rows.flatMap((r) => r.pageIdxs);
    if (pageIdxs.length === 0) return;
    try {
      const uploads = new Map<number, UploadedSheet>();
      for (let k = 0; k < pageIdxs.length; k++) {
        setPhase({ kind: "uploading", done: k, total: pageIdxs.length });
        const page = pages[pageIdxs[k]];
        const ref = await planImages.upload(page);
        uploads.set(pageIdxs[k], {
          label: page.label,
          ref,
          pageNumber: page.pageNumber,
          width: page.width,
          height: page.height,
        });
      }
      onMutate((d) => ({ ...d, floors: applyBuilderRows(rows, uploads, d.floors) }));
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
                  kind: "building",
                  pages: phase.pages,
                  rows: builderRowsFromPages(phase.pages, chosen, doc.floors),
                });
              }}
            >
              Continue with {phase.selected.size}{" "}
              {phase.selected.size === 1 ? "page" : "pages"}
            </button>
          </div>
        </div>
      )}

      {phase.kind === "building" && (
        <FloorStackBuilder
          pages={phase.pages}
          rows={phase.rows}
          onRows={(rows) => setPhase({ ...phase, rows })}
          onBack={() =>
            setPhase({
              kind: "picking",
              pages: phase.pages,
              selected: new Set(phase.rows.flatMap((r) => r.pageIdxs)),
            })
          }
          onConfirm={() => void confirmBuild(phase.pages, phase.rows)}
        />
      )}

      {error && <div className="ds-ierr">{error}</div>}

      {/* ── floors ── (plan mode: every floor comes from a drawing) */}
      <div className="ds-plans-floors-head">
        <span className="ds-cardt">Floors</span>
        {doc.meta.mode === "blank" && (
          <button className="ds-import" onClick={onAddFloor}>
            <Icon name="plus" size={13} />
            Blank floor
          </button>
        )}
      </div>
      {floors.length === 0 ? (
        <div className="ds-insp-hint">
          {doc.meta.mode === "plan"
            ? "No floors yet — upload plans above and pick your pages."
            : "No floors yet — add a blank floor to sketch on, or upload a plan above."}
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

/* ── The floor-stack builder ──
   Rows read like a building: top row = highest level, ground at the bottom.
   Drag a page card onto another row to make it a sheet of that floor
   (an east/west split is two cards on one line); drop it on the top zone to
   start a new floor. Existing floors are fixed drop targets at the bottom. */

function FloorStackBuilder({
  pages,
  rows,
  onRows,
  onBack,
  onConfirm,
}: {
  pages: PageImage[];
  rows: BuilderRow[];
  onRows: (rows: BuilderRow[]) => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const placed = rows.flatMap((r) => r.pageIdxs).length;
  const newFloorCount = rows.filter(
    (r) => r.floorId === null && r.pageIdxs.length > 0
  ).length;
  const display = [...rows].reverse(); // top of the building first

  const dragPayload = (e: React.DragEvent) =>
    parseInt(e.dataTransfer.getData("text/plain"), 10);

  return (
    <div className="ds-pagepick">
      <div className="ds-pagepick-head">
        <span className="ds-cardt">Stack your floors</span>
        <span className="ds-pagepick-n">
          {placed} {placed === 1 ? "page" : "pages"} · {newFloorCount} new{" "}
          {newFloorCount === 1 ? "floor" : "floors"}
        </span>
      </div>
      <div className="ds-alloc-hint">
        Each row is one floor, stacked like the building — ground at the
        bottom. <b>Drag a page onto another row</b> to make it a second sheet
        of that floor (an east/west split), or onto the top zone to start a
        new floor above.
      </div>

      <div
        className="ds-stack-newzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const idx = dragPayload(e);
          if (Number.isFinite(idx))
            onRows(movePageToNewRow(rows, idx, pages[idx]?.label ?? "New floor"));
        }}
      >
        <Icon name="plus" size={13} />
        Drop here for a new top floor
      </div>

      <div className="ds-stack">
        {display.map((row) => {
          const level =
            rows.filter((r) => r.floorId !== null || r.pageIdxs.length > 0).indexOf(row);
          return (
            <div
              key={row.key}
              className={`ds-stack-row${row.floorId ? " existing" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const idx = dragPayload(e);
                if (Number.isFinite(idx)) onRows(movePageToRow(rows, idx, row.key));
              }}
            >
              <span className="ds-floor-lvl">L{level}</span>
              {row.floorId ? (
                <span className="ds-stack-name-fixed">{row.name}</span>
              ) : (
                <input
                  className="ds-stack-name"
                  value={row.name}
                  aria-label={`Floor name for row ${row.key}`}
                  onChange={(e) => onRows(renameRow(rows, row.key, e.target.value))}
                />
              )}
              <div className="ds-stack-cards">
                {row.pageIdxs.length === 0 && (
                  <span className="ds-stack-empty">
                    {row.floorId ? "drop a sheet to add it here" : ""}
                  </span>
                )}
                {row.pageIdxs.map((idx) => {
                  const p = pages[idx];
                  return (
                    <div
                      key={idx}
                      className="ds-stack-card"
                      draggable
                      onDragStart={(e) =>
                        e.dataTransfer.setData("text/plain", String(idx))
                      }
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.thumbUrl} alt={p.label} />
                      <span>{p.pageNumber ? `p.${p.pageNumber}` : "img"}</span>
                      <button
                        aria-label={`Remove page ${p.pageNumber ?? idx + 1}`}
                        onClick={() => onRows(removePageFromRows(rows, idx))}
                      >
                        <Icon name="x" size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
              {!row.floorId && (
                <span className="ds-stack-updown">
                  <button
                    aria-label={`Move ${row.name} up`}
                    onClick={() => onRows(moveRow(rows, row.key, 1))}
                  >
                    <Icon name="arrowUp" size={13} />
                  </button>
                  <button
                    aria-label={`Move ${row.name} down`}
                    onClick={() => onRows(moveRow(rows, row.key, -1))}
                  >
                    <Icon name="arrowDown" size={13} />
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="ds-pagepick-actions">
        <button className="ds-calib-cancel" onClick={onBack}>
          Back
        </button>
        <button className="ds-calib-ok" disabled={placed === 0} onClick={onConfirm}>
          Add to design
        </button>
      </div>
    </div>
  );
}
