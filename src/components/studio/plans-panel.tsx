"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import type { DesignDocument, Floor } from "@/lib/studio/document";
import { createPortal } from "react-dom";
import {
  applyBuilderRows,
  builderRowsFromPages,
  computeRowLevels,
  dropPageOnRow,
  dropRowOnRow,
  dropRowOnTop,
  formatLevel,
  imageToPage,
  movePageToNewRow,
  pdfToPages,
  removePageFromRows,
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
  /* stash carries names already typed in the naming step, so going Back and
     Continuing again never asks the installer to retype anything */
  | { kind: "picking"; pages: PageImage[]; selected: Set<number>; stash: Record<number, string> }
  /* verify/correct each selected page's floor name full-size before stacking */
  | { kind: "naming"; pages: PageImage[]; chosen: number[]; names: string[]; at: number }
  /* the floor-stack builder: rows bottom-up; drag page cards between rows */
  | { kind: "building"; pages: PageImage[]; names: Record<number, string>; rows: BuilderRow[] }
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
  const [preview, setPreview] = useState<number | null>(null);
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
      if (pages.length === 1) {
        // one page = nothing to pick; go straight to naming it
        setPhase({
          kind: "naming",
          pages,
          chosen: [0],
          names: [pages[0].label],
          at: 0,
        });
        return;
      }
      // nothing pre-selected — the user picks exactly the pages they want
      setPhase({ kind: "picking", pages, selected: new Set(), stash: {} });
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
          <PageGrid
            pages={phase.pages}
            selected={phase.selected}
            onPreview={setPreview}
            onToggle={(i) => {
              const next = new Set(phase.selected);
              if (next.has(i)) next.delete(i);
              else next.add(i);
              setPhase({ ...phase, selected: next });
            }}
          />
          {preview !== null && (
            <PageLightbox
              pages={phase.pages}
              index={preview}
              selected={phase.selected}
              onToggle={(i) => {
                const next = new Set(phase.selected);
                if (next.has(i)) next.delete(i);
                else next.add(i);
                setPhase({ ...phase, selected: next });
              }}
              onNav={setPreview}
              onClose={() => setPreview(null)}
            />
          )}
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
                  kind: "naming",
                  pages: phase.pages,
                  chosen,
                  // anything named on an earlier pass survives the round trip
                  names: chosen.map((i) => phase.stash[i] ?? phase.pages[i].label),
                  at: 0,
                });
              }}
            >
              Continue with {phase.selected.size}{" "}
              {phase.selected.size === 1 ? "page" : "pages"}
            </button>
          </div>
        </div>
      )}

      {phase.kind === "naming" && (
        <>
          {/* the picker stays behind as context; the lightbox does the work */}
          <div className="ds-pagepick">
            <div className="ds-pagepick-head">
              <span className="ds-cardt">Check each floor&apos;s name</span>
            </div>
            <PageGrid
              pages={phase.pages}
              selected={new Set(phase.chosen)}
              onPreview={(i) => {
                const at = phase.chosen.indexOf(i);
                if (at >= 0) setPhase({ ...phase, at });
              }}
            />
          </div>
          <NamingLightbox
            pages={phase.pages}
            chosen={phase.chosen}
            names={phase.names}
            at={phase.at}
            onName={(name) =>
              setPhase({
                ...phase,
                names: phase.names.map((n, k) => (k === phase.at ? name : n)),
              })
            }
            onNav={(at) => setPhase({ ...phase, at })}
            onBack={() => {
              const stash: Record<number, string> = {};
              phase.chosen.forEach((idx, k) => (stash[idx] = phase.names[k]));
              setPhase({
                kind: "picking",
                pages: phase.pages,
                selected: new Set(phase.chosen),
                stash,
              });
            }}
            onDone={() => {
              const names: Record<number, string> = {};
              phase.chosen.forEach((idx, k) => (names[idx] = phase.names[k]));
              setPhase({
                kind: "building",
                pages: phase.pages,
                names,
                rows: builderRowsFromPages(phase.pages, phase.chosen, doc.floors, names),
              });
            }}
          />
        </>
      )}

      {phase.kind === "building" && (
        <FloorStackBuilder
          pages={phase.pages}
          names={phase.names}
          rows={phase.rows}
          onRows={(rows) => setPhase({ ...phase, rows })}
          onBack={() => {
            const chosen = phase.rows.flatMap((r) => r.pageIdxs);
            setPhase({
              kind: "naming",
              pages: phase.pages,
              chosen,
              names: chosen.map((i) => phase.names[i] ?? phase.pages[i].label),
              at: 0,
            });
          }}
          onConfirm={() => void confirmBuild(phase.pages, phase.rows)}
        />
      )}

      {error && <div className="ds-ierr">{error}</div>}

      {/* ── floors ── (hidden during import; you're picking floors there) ── */}
      {phase.kind === "idle" && (
        <>
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
              <span className="ds-floor-lvl">{formatLevel(f.level)}</span>
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
        </>
      )}
    </div>
  );
}

/* ── Reusable page-thumbnail grid (picker + naming backdrop) ── */

function PageGrid({
  pages,
  selected,
  onToggle,
  onPreview,
}: {
  pages: PageImage[];
  selected: Set<number>;
  onToggle?: (i: number) => void;
  onPreview: (i: number) => void;
}) {
  return (
    <div className="ds-pages">
      {pages.map((p, i) => {
        const on = selected.has(i);
        return (
          <div key={i} className={`ds-page${on ? " on" : ""}`}>
            {/* image opens the full-size preview; the label row toggles */}
            <button
              className="ds-page-view"
              aria-label={`Preview ${p.label}`}
              onClick={() => onPreview(i)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumbUrl} alt={p.label} />
              <span className="ds-page-zoom">
                <Icon name="maximize" size={13} />
              </span>
            </button>
            <button
              className="ds-page-label"
              disabled={!onToggle}
              onClick={() => onToggle?.(i)}
            >
              <span className={`ds-page-check${on ? " on" : ""}`}>
                {on && <Icon name="check" size={11} />}
              </span>
              {p.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}


/* ── The floor-stack builder ──
   Rows read like the building: top row = highest level, ground line at the
   bottom (or the design's existing floors as the anchor). Everything is
   drag and drop: page cards join rows (east/west split = two cards on one
   line), whole rows reorder by their handle, and dropping below the ground
   line makes a subfloor. Level chips derive from position — nothing typed. */

function FloorStackBuilder({
  pages,
  names,
  rows,
  onRows,
  onBack,
  onConfirm,
}: {
  pages: PageImage[];
  names: Record<number, string>;
  rows: BuilderRow[];
  onRows: (rows: BuilderRow[]) => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const placed = rows.flatMap((r) => r.pageIdxs).length;
  const newFloorCount = rows.filter(
    (r) => r.kind === "floor" && r.floorId === null && r.pageIdxs.length > 0
  ).length;
  const levels = computeRowLevels(rows);
  const display = [...rows].reverse(); // top of the building first
  const nameFor = (idx: number) => names[idx] ?? pages[idx]?.label ?? "New floor";

  const handleDrop = (targetKey: string | null) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const payload = e.dataTransfer.getData("text/plain");
    if (payload.startsWith("p:")) {
      const idx = parseInt(payload.slice(2), 10);
      if (!Number.isFinite(idx)) return;
      onRows(
        targetKey === null
          ? movePageToNewRow(rows, idx, nameFor(idx))
          : dropPageOnRow(rows, idx, targetKey, nameFor(idx))
      );
    } else if (payload.startsWith("r:")) {
      const key = payload.slice(2);
      onRows(targetKey === null ? dropRowOnTop(rows, key) : dropRowOnRow(rows, key, targetKey));
    }
  };
  const allowDrop = (e: React.DragEvent) => e.preventDefault();

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
        Each row is one floor, stacked like the building. <b>Drag rows</b> by
        their handle to reorder, <b>drag a page</b> onto another row to make it
        a second sheet of that floor, and drop <b>below the ground line</b> for
        subfloor areas. Levels follow the stack.
      </div>

      <div className="ds-stack-newzone" onDragOver={allowDrop} onDrop={handleDrop(null)}>
        <Icon name="plus" size={13} />
        Drop here for a new top floor
      </div>

      <div className="ds-stack">
        {display.map((row) => {
          if (row.kind === "ground") {
            return (
              <div
                key={row.key}
                className="ds-groundline"
                onDragOver={allowDrop}
                onDrop={handleDrop(row.key)}
              >
                <span />
                <b>Ground line — drop below for subfloors</b>
                <span />
              </div>
            );
          }
          const level = levels.get(row.key) ?? 0;
          return (
            <div
              key={row.key}
              className={`ds-stack-row${row.floorId ? " existing" : ""}${level < 0 ? " sub" : ""}`}
              onDragOver={allowDrop}
              onDrop={handleDrop(row.key)}
            >
              {row.floorId === null ? (
                <span
                  className="ds-stack-grip"
                  draggable
                  aria-label={`Drag ${row.name}`}
                  onDragStart={(e) =>
                    e.dataTransfer.setData("text/plain", `r:${row.key}`)
                  }
                >
                  <Icon name="dots" size={14} />
                  <Icon name="dots" size={14} />
                </span>
              ) : (
                <span className="ds-stack-grip fixed" />
              )}
              <span className="ds-floor-lvl">{formatLevel(level)}</span>
              {/* names were verified in the naming step — the stack only
                  positions them (the floor list stays editable afterwards) */}
              <span className={`ds-stack-name-fixed${row.floorId ? "" : " new"}`}>
                {row.name}
              </span>
              <div className="ds-stack-cards">
                {row.pageIdxs.length === 0 && row.floorId && (
                  <span className="ds-stack-empty">drop a sheet to add it here</span>
                )}
                {row.pageIdxs.map((idx) => {
                  const p = pages[idx];
                  return (
                    <div
                      key={idx}
                      className="ds-stack-card"
                      draggable
                      onDragStart={(e) =>
                        e.dataTransfer.setData("text/plain", `p:${idx}`)
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

/* ── Full-size page preview ──
   Portalled to <body>: the shell's animated .page wrapper carries
   will-change, which breaks position:fixed for anything rendered inside it. */

export function PageLightbox({
  pages,
  index,
  selected,
  onToggle,
  onNav,
  onClose,
}: {
  pages: PageImage[];
  index: number;
  selected: Set<number>;
  onToggle: (i: number) => void;
  onNav: (i: number) => void;
  onClose: () => void;
}) {
  const page = pages[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < pages.length - 1) onNav(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onNav(index - 1);
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        onToggle(index);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, pages.length, onNav, onClose, onToggle]);

  if (!page) return null;
  const isOn = selected.has(index);

  return createPortal(
    <div className="ds-lightbox" role="dialog" aria-label={`Page preview: ${page.label}`}>
      <div className="ds-lb-backdrop" onClick={onClose} />
      <div className="ds-lb-frame">
        <div className="ds-lb-top">
          <span className="ds-lb-title">
            {page.label}
            <em>
              {index + 1} / {pages.length}
            </em>
          </span>
          <button
            className={`ds-lb-select${isOn ? " on" : ""}`}
            onClick={() => onToggle(index)}
          >
            <Icon name="check" size={14} />
            {isOn ? "Selected" : "Select this page"}
          </button>
          <button className="ds-lb-close" aria-label="Close preview" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="ds-lb-img">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={page.thumbUrl} alt={page.label} />
        </div>
        <button
          className="ds-lb-nav prev"
          aria-label="Previous page"
          disabled={index === 0}
          onClick={() => onNav(index - 1)}
        >
          <Icon name="chevL" size={20} />
        </button>
        <button
          className="ds-lb-nav next"
          aria-label="Next page"
          disabled={index === pages.length - 1}
          onClick={() => onNav(index + 1)}
        >
          <Icon name="chevR" size={20} />
        </button>
      </div>
    </div>,
    document.body
  );
}

/* ── Naming verification ──
   Step through the selected pages full-size and confirm each floor's name
   before stacking, so the stack already knows what everything is. */

export function NamingLightbox({
  pages,
  chosen,
  names,
  at,
  onName,
  onNav,
  onBack,
  onDone,
}: {
  pages: PageImage[];
  chosen: number[];
  names: string[];
  at: number;
  onName: (name: string) => void;
  onNav: (at: number) => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const isLast = at === chosen.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
      // don't hijack arrows while the name field is focused
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "ArrowRight" && at < chosen.length - 1) onNav(at + 1);
      if (e.key === "ArrowLeft" && at > 0) onNav(at - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, chosen.length, onNav, onBack]);

  const page = pages[chosen[at]];
  if (!page) return null;

  return createPortal(
    <div className="ds-lightbox" role="dialog" aria-label="Name floor plans">
      <div className="ds-lb-backdrop" onClick={onBack} />
      <div className="ds-lb-frame">
        <div className="ds-lb-top">
          <span className="ds-lb-step">
            Floor {at + 1} / {chosen.length}
          </span>
          <input
            className="ds-lb-name"
            value={names[at]}
            autoFocus
            aria-label="Floor name"
            placeholder="Name this floor"
            onChange={(e) => onName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (isLast) onDone();
              else onNav(at + 1);
            }}
          />
          <button className="ds-lb-close" aria-label="Close" onClick={onBack}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="ds-lb-img">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={page.thumbUrl} alt={names[at]} />
        </div>
        <button
          className="ds-lb-nav prev"
          aria-label="Previous page"
          disabled={at === 0}
          onClick={() => onNav(at - 1)}
        >
          <Icon name="chevL" size={20} />
        </button>
        <button
          className="ds-lb-nav next"
          aria-label="Next page"
          disabled={isLast}
          onClick={() => onNav(at + 1)}
        >
          <Icon name="chevR" size={20} />
        </button>
        <div className="ds-lb-foot">
          <button className="ds-calib-cancel" onClick={onBack}>
            Back to pages
          </button>
          {isLast ? (
            <button className="ds-calib-ok" onClick={onDone}>
              Continue to stacking
            </button>
          ) : (
            <button className="ds-calib-ok" onClick={() => onNav(at + 1)}>
              Next floor
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
