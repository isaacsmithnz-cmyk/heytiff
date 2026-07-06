"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import type { DesignDocument, Floor } from "@/lib/studio/document";
import { createPortal } from "react-dom";
import {
  applyBuilderRows,
  builderStackFromFloors,
  computeRowLevels,
  dropPageOnRow,
  dropRowAt,
  formatLevel,
  imageToPage,
  insertPageRow,
  labelPagesSequentially,
  pdfToPages,
  previewInsertLevel,
  removePageFromRows,
  setAnchorLevel,
  trayPageIdxs,
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
  /* the building yard: pages start in the tray (chosen order) and get dragged
     onto floors; position sets the level, names are display labels */
  | {
      kind: "building";
      pages: PageImage[];
      chosen: number[];
      names: Record<number, string>;
      rows: BuilderRow[];
    }
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
      labelPagesSequentially(pages); // Page 1, Page 2, … across the whole upload
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
      // compute once (fresh floor ids) so we can commit AND land on one
      const committed = applyBuilderRows(rows, uploads, doc.floors);
      onMutate((d) => ({ ...d, floors: committed }));
      pages.forEach((p) => URL.revokeObjectURL(p.thumbUrl));
      // skip the floor-list step — go straight to the canvas on the ground
      // floor (or the lowest floor if there's no level 0)
      const landing =
        committed.find((f) => f.level === 0) ??
        [...committed].sort((a, b) => a.level - b.level)[0];
      if (landing) onOpenFloor(landing.id);
      else setPhase({ kind: "idle" });
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
              Click the pages you want to upload
            </span>
            <div className="ds-pagepick-right">
              <span className="ds-pagepick-n">
                {phase.selected.size} of {phase.pages.length} selected
              </span>
              <button
                className="ds-ai-btn"
                disabled
                title="Coming soon — scans your drawings and names each floor for you"
              >
                <Icon name="sparkles" size={14} />
                AI screening
                <span className="ds-ai-soon">Soon</span>
              </button>
            </div>
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
              <span className="ds-cardt">Name each floor</span>
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
                chosen: phase.chosen,
                names,
                rows: builderStackFromFloors(doc.floors),
              });
            }}
          />
        </>
      )}

      {phase.kind === "building" && (
        <FloorStackBuilder
          pages={phase.pages}
          chosen={phase.chosen}
          names={phase.names}
          rows={phase.rows}
          onRows={(rows) => setPhase({ ...phase, rows })}
          onBack={() =>
            setPhase({
              kind: "naming",
              pages: phase.pages,
              chosen: phase.chosen,
              names: phase.chosen.map((i) => phase.names[i] ?? phase.pages[i].label),
              at: 0,
            })
          }
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
  // clicking the card selects it; the expand button (hover-only) opens the
  // full-size preview. Naming backdrop has no toggle, so a card click previews.
  const primary = (i: number) => (onToggle ? onToggle(i) : onPreview(i));
  return (
    <div className="ds-pages">
      {pages.map((p, i) => {
        const on = selected.has(i);
        return (
          <div
            key={i}
            className={`ds-page${on ? " on" : ""}${onToggle ? " selectable" : ""}`}
            role="button"
            tabIndex={0}
            aria-pressed={onToggle ? on : undefined}
            aria-label={p.label}
            onClick={() => primary(i)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                primary(i);
              }
            }}
          >
            <div className="ds-page-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumbUrl} alt={p.label} />
              <button
                className="ds-page-expand"
                aria-label={`Preview ${p.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview(i);
                }}
              >
                <Icon name="maximize" size={14} />
              </button>
            </div>
            <span className="ds-page-label">
              <span className={`ds-page-check${on ? " on" : ""}`}>
                {on && <Icon name="check" size={11} />}
              </span>
              {p.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}


/* ── The floor-stack builder ──
   Left: a tray of uploaded pages (named in the previous step). Right: the
   building yard. The FIRST plan dropped becomes the anchor — its level is a
   dropdown on the card (ground floor by default) and every other plan
   numbers itself from its position around it. While dragging, every drop
   slot lights up labelled with the level it would create, like placing
   units on the canvas. Names are display labels only. */

const ANCHOR_LEVEL_OPTIONS = Array.from({ length: 26 }, (_, i) => i - 5); // B5..L20

function FloorStackBuilder({
  pages,
  chosen,
  names,
  rows,
  onRows,
  onBack,
  onConfirm,
}: {
  pages: PageImage[];
  chosen: number[];
  names: Record<number, string>;
  rows: BuilderRow[];
  onRows: (rows: BuilderRow[]) => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  // derive defensively — a hot-reload can preserve an older phase without it
  const chosenIdxs = chosen ?? Object.keys(names).map(Number);
  const tray = trayPageIdxs(rows, chosenIdxs);
  const levels = computeRowLevels(rows);
  const display = [...rows].reverse(); // top of the building first
  const [dragging, setDragging] = useState<null | "page" | "row">(null);
  const nameFor = (idx: number) => names[idx] ?? pages[idx]?.label ?? "New floor";

  const allow = (e: React.DragEvent) => e.preventDefault();
  const read = (e: React.DragEvent) => e.dataTransfer.getData("text/plain");
  const startDrag =
    (payload: string, kind: "page" | "row") => (e: React.DragEvent) => {
      e.dataTransfer.setData("text/plain", payload);
      setDragging(kind);
    };
  const endDrag = () => setDragging(null);

  // a gap between floors: page → new floor there; row → move there
  const dropAt = (anchorKey: string | null, side: "above" | "below") => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(null);
    const d = read(e);
    if (d.startsWith("p:")) {
      const idx = parseInt(d.slice(2), 10);
      if (Number.isFinite(idx)) onRows(insertPageRow(rows, idx, nameFor(idx), anchorKey, side));
    } else if (d.startsWith("r:") && anchorKey !== null) {
      onRows(dropRowAt(rows, d.slice(2), anchorKey, side));
    }
  };
  // a floor card centre: page → merge as a sheet; row → land above it
  const dropOnFloor = (targetKey: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(null);
    const d = read(e);
    if (d.startsWith("p:")) {
      const idx = parseInt(d.slice(2), 10);
      if (Number.isFinite(idx)) onRows(dropPageOnRow(rows, idx, targetKey));
    } else if (d.startsWith("r:")) {
      onRows(dropRowAt(rows, d.slice(2), targetKey, "above"));
    }
  };
  const dropToTray = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(null);
    const d = read(e);
    if (d.startsWith("p:")) {
      onRows(removePageFromRows(rows, parseInt(d.slice(2), 10)));
    } else if (d.startsWith("r:")) {
      const row = rows.find((r) => r.key === d.slice(2));
      if (row) {
        let next = rows;
        for (const i of row.pageIdxs) next = removePageFromRows(next, i);
        onRows(next);
      }
    }
  };

  const gap = (anchorKey: string, side: "above" | "below", key: string) => (
    <div
      key={key}
      className={`ds-dropzone${dragging ? " live" : ""}`}
      onDragOver={allow}
      onDrop={dropAt(anchorKey, side)}
    >
      <span className="ds-dropzone-inner">
        <Icon name="plus" size={13} />
        New floor · {formatLevel(previewInsertLevel(rows, anchorKey, side))}
      </span>
    </div>
  );

  /* the yard, top-down, with the ground line drawn at the 0/-1 boundary */
  const yard: React.ReactNode[] = [];
  if (display.length === 0) {
    yard.push(
      <div
        key="first"
        className={`ds-yard-first${dragging === "page" ? " live" : ""}`}
        onDragOver={allow}
        onDrop={dropAt(null, "above")}
      >
        <Icon name="arrowDown" size={18} />
        Drag your first plan here — it becomes the <b>ground floor</b>
        <span className="ds-yard-first-sub">
          (you can change its level on the card afterwards)
        </span>
      </div>
    );
  } else {
    const groundLine = (
      <div key="groundline" className="ds-groundline">
        <span />
        <b>ground line</b>
        <span />
      </div>
    );
    const lvl = (r: BuilderRow) => levels.get(r.key) ?? 0;
    if (lvl(display[0]) <= -1) yard.push(groundLine); // whole stack is below ground
    yard.push(gap(display[0].key, "above", "gap-top"));
    display.forEach((row, k) => {
      yard.push(
        <FloorCard
          key={row.key}
          row={row}
          level={lvl(row)}
          rows={rows}
          pages={pages}
          nameFor={nameFor}
          targetable={dragging === "page"}
          onRows={onRows}
          onDropFloor={dropOnFloor(row.key)}
          onStartDrag={startDrag}
          onEndDrag={endDrag}
          allow={allow}
        />
      );
      const next = display[k + 1];
      if (next) {
        if (lvl(row) >= 0 && lvl(next) < 0) yard.push(groundLine);
        yard.push(gap(next.key, "above", `gap-${next.key}`));
      } else {
        if (lvl(row) === 0) yard.push(groundLine);
        yard.push(gap(row.key, "below", "gap-bottom"));
      }
    });
  }

  return (
    <div className="ds-build">
      <div className="ds-pagepick-head">
        <span className="ds-cardt">Stack your floors</span>
        <span className="ds-pagepick-n">
          {tray.length > 0
            ? `${tray.length} ${tray.length === 1 ? "plan" : "plans"} to place`
            : "all placed"}
        </span>
      </div>
      <div className="ds-alloc-hint">
        Drag each plan from the left into the building — <b>where you drop it
        sets its level</b>. Drop zones light up as you drag: a slot makes a new
        floor there, a floor card adds the plan as a second sheet (east/west
        split).
      </div>

      <div className="ds-yard-wrap">
        <div
          className={`ds-tray${dragging ? " live" : ""}`}
          onDragOver={allow}
          onDrop={dropToTray}
        >
          <div className="ds-tray-head">Plans</div>
          {tray.length === 0 ? (
            <div className="ds-tray-empty">
              <Icon name="check" size={16} />
              Every plan placed
            </div>
          ) : (
            tray.map((idx) => {
              const p = pages[idx];
              return (
                <div
                  key={idx}
                  className="ds-tray-card"
                  draggable
                  onDragStart={startDrag(`p:${idx}`, "page")}
                  onDragEnd={endDrag}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumbUrl} alt={nameFor(idx)} />
                  <span className="ds-tray-name">{nameFor(idx)}</span>
                </div>
              );
            })
          )}
        </div>

        <div className="ds-yard">
          <div className="ds-yard-cap top">▲ upper floors</div>
          {yard}
          <div className="ds-yard-cap bottom">▼ subfloors</div>
        </div>
      </div>

      <div className="ds-pagepick-actions">
        <button className="ds-calib-cancel" onClick={onBack}>
          Back
        </button>
        <button
          className="ds-calib-ok"
          disabled={tray.length === chosenIdxs.length}
          onClick={onConfirm}
        >
          Start design
          <Icon name="arrowR" size={15} />
        </button>
      </div>
    </div>
  );
}

function FloorCard({
  row,
  level,
  rows,
  pages,
  nameFor,
  targetable,
  onRows,
  onDropFloor,
  onStartDrag,
  onEndDrag,
  allow,
}: {
  row: BuilderRow;
  level: number;
  rows: BuilderRow[];
  pages: PageImage[];
  nameFor: (idx: number) => string;
  targetable: boolean;
  onRows: (rows: BuilderRow[]) => void;
  onDropFloor: (e: React.DragEvent) => void;
  onStartDrag: (payload: string, kind: "page" | "row") => (e: React.DragEvent) => void;
  onEndDrag: () => void;
  allow: (e: React.DragEvent) => void;
}) {
  const isNew = row.floorId === null;
  return (
    <div
      className={`ds-floorcard${row.floorId ? " existing" : ""}${level < 0 ? " sub" : ""}${targetable ? " targetable" : ""}`}
      data-floor={row.name}
      onDragOver={allow}
      onDrop={onDropFloor}
    >
      {/* only the grip moves the whole floor — the card itself must not be
          draggable or it steals drags from the individual sheets inside it */}
      {isNew && (
        <span
          className="ds-floorcard-grip"
          draggable
          aria-label={`Move ${row.name}`}
          title="Drag to move this floor"
          onDragStart={onStartDrag(`r:${row.key}`, "row")}
          onDragEnd={onEndDrag}
        >
          <Icon name="dots" size={13} />
        </span>
      )}
      {row.anchorLevel !== undefined ? (
        <select
          className="ds-floor-lvl-select"
          value={row.anchorLevel}
          aria-label={`Level for ${row.name}`}
          onChange={(e) =>
            onRows(setAnchorLevel(rows, row.key, parseInt(e.target.value, 10)))
          }
        >
          {ANCHOR_LEVEL_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {formatLevel(n)}
            </option>
          ))}
        </select>
      ) : (
        <span className="ds-floor-lvl">{formatLevel(level)}</span>
      )}
      <div className="ds-floorcard-sheets">
        {row.pageIdxs.length === 0 && row.floorId && (
          <span className="ds-floorcard-empty">drop a plan to add a sheet</span>
        )}
        {row.pageIdxs.map((idx) => {
          const p = pages[idx];
          return (
            <div
              key={idx}
              className="ds-floorcard-sheet"
              draggable
              title="Drag to another floor"
              onDragStart={onStartDrag(`p:${idx}`, "page")}
              onDragEnd={onEndDrag}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumbUrl} alt={nameFor(idx)} />
              <button
                className="ds-floorcard-x"
                aria-label={`Remove ${nameFor(idx)}`}
                onClick={() => onRows(removePageFromRows(rows, idx))}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          );
        })}
      </div>
      <span className="ds-floorcard-name">{row.name}</span>
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
