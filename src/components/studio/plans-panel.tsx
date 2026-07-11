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
  formatLevel,
  imageToPage,
  insertPageRow,
  labelPagesSequentially,
  pdfToPages,
  previewInsertLevel,
  removePageFromRows,
  restackLevels,
  setAnchorLevel,
  trayPageIdxs,
  type BuilderRow,
  type PageImage,
  type PlanImages,
  type UploadedSheet,
} from "@/lib/studio/plans";

/* Plans stage — upload PDF/image plans, pick the pages that matter, manage
   floors. Rasterisation happens in the browser; storage refs go in the doc. */

/* One-page import shown as a STEPPER: ① Add floor plans (compact drop bar),
   ② Select pages (the classic inline page grid — click to select, expand for
   a close-up lightbox), ③ Stack your floors (the yard) → Start design. All
   three live on the same page; only naming uses a lightbox. */

type Busy = { kind: "rendering" | "uploading"; done: number; total: number };

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
  /* the import session — all coexisting on one page */
  const [pages, setPages] = useState<PageImage[] | null>(null);
  /* the live grid selection (step ②); committed to `chosen` via naming */
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [chosen, setChosen] = useState<number[]>([]);
  const [names, setNames] = useState<Record<number, string>>({});
  const [rows, setRows] = useState<BuilderRow[]>([]);
  const [busy, setBusy] = useState<Busy | null>(null);
  /* the naming lightbox (the only overlay left in the flow) */
  const [naming, setNaming] = useState<{ at: number } | null>(null);
  /* which import step is open: choosing/naming pages, or stacking them.
     Completed steps collapse; the active one is revealed. */
  const [stage, setStage] = useState<"select" | "stack">("select");
  const stackRef = useRef<HTMLDivElement>(null);
  /* re-opened stacker on committed floors (top-to-bottom ids) */
  const [restack, setRestack] = useState<string[] | null>(null);
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
      setBusy({ kind: "rendering", done: 0, total: list.length });
      const fresh: PageImage[] = [];
      for (const f of list) {
        if (f.type === "application/pdf") {
          fresh.push(
            ...(await pdfToPages(f, (done, total) =>
              setBusy({ kind: "rendering", done, total })
            ))
          );
        } else if (f.type.startsWith("image/")) {
          fresh.push(await imageToPage(f));
        }
      }
      setBusy(null);
      if (fresh.length === 0) {
        setError("No usable pages — upload a PDF, PNG or JPG.");
        return;
      }
      /* a drop during an active import APPENDS — indices stay stable, so the
         chosen set and typed names survive */
      const all = [...(pages ?? []), ...fresh];
      labelPagesSequentially(all); // Page 1, Page 2, … across the whole upload
      setPages(all);
      setStage("select"); // new pages ⇒ back to choosing them
      if (pages === null) setRows(builderStackFromFloors(doc.floors));
      if (all.length === 1) {
        // one page = nothing to pick; go straight to naming it
        // (empty name ⇒ defaults to the stack position, not "Page 1")
        setSelected(new Set([0]));
        setChosen([0]);
        setNaming({ at: 0 });
      }
      // multi-page: nothing extra pre-selected — the grid on the page (step ②)
      // is the picker; the user clicks exactly the pages they want
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : "Couldn't read that file");
    }
  };

  const discardImport = () => {
    pages?.forEach((p) => URL.revokeObjectURL(p.thumbUrl));
    setPages(null);
    setSelected(new Set());
    setChosen([]);
    setNames({});
    setRows([]);
    setNaming(null);
    setPreview(null);
    setStage("select");
  };

  /* step ②'s Continue: commit the selection, drop de-selected pages off the
     stack, then verify/name each chosen page in the lightbox */
  const confirmPick = () => {
    setChosen([...selected].sort((a, b) => a - b));
    setRows((rs) => {
      let out = rs;
      for (const r of rs)
        for (const idx of r.pageIdxs) if (!selected.has(idx)) out = removePageFromRows(out, idx);
      return out;
    });
    setNaming({ at: 0 });
  };

  const togglePage = (i: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const confirmBuild = async () => {
    if (!pages) return;
    const pageIdxs = rows.flatMap((r) => r.pageIdxs);
    if (pageIdxs.length === 0) return;
    try {
      const uploads = new Map<number, UploadedSheet>();
      for (let k = 0; k < pageIdxs.length; k++) {
        setBusy({ kind: "uploading", done: k, total: pageIdxs.length });
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
      setBusy(null);
      discardImport(); // session done — URLs already revoked, this just resets
      // skip the floor-list step — go straight to the canvas on the ground
      // floor (or the lowest floor if there's no level 0)
      const landing =
        committed.find((f) => f.level === 0) ??
        [...committed].sort((a, b) => a.level - b.level)[0];
      if (landing) onOpenFloor(landing.id);
    } catch (e) {
      // keep the import session so a retry is one click
      setBusy(null);
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

  const tray = pages ? trayPageIdxs(rows, chosen) : [];

  // one always-mounted picker so "Add plans" works even when the upload
  // stepper (which owns the dropzone) is collapsed behind committed floors
  const pickFiles = () => fileRef.current?.click();

  return (
    <div className="ds-panel-card ds-plans">
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
      {busy && (
        <div className="ds-plans-busy">
          <div className="ds-plans-busy-t">
            {busy.kind === "rendering" ? "Reading pages…" : "Uploading plans…"}
          </div>
          <div className="ds-progress">
            <div
              style={{
                width: `${(busy.done / Math.max(1, busy.total)) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* ══ the import stepper: three collapsing sections, one page ══
         Shown while an import is live (pages loaded), or on a fresh plan design
         with nothing built yet. Once floors exist, stepping back to Plans lands
         on the committed Floors list below — not an empty stepper. */}
      {!busy && restack === null && (pages !== null || floors.length === 0) && (
        <>
          {/* ── ① Add floor plans ── */}
          <div className="ds-pstep-head">
            <span className={`ds-pstep-num${pages ? " done" : " active"}`}>
              {pages ? <Icon name="check" size={11} /> : 1}
            </span>
            <span className="ds-pstep-t">Add floor plans</span>
            {pages && (
              <button
                className="ds-rp-del ds-pstep-discard"
                title="Discard this import"
                aria-label="Discard this import"
                onClick={discardImport}
              >
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
          {(() => {
            const dropzone = (compact: boolean) => (
              <div
                className={`ds-upzone${compact ? " compact" : ""}${dragOver ? " drag" : ""}`}
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
                onClick={pickFiles}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && pickFiles()}
              >
                <span className="ds-upzone-ic">
                  <Icon name="arrowUp" size={15} />
                </span>
                <div className="ds-upzone-text">
                  <div className="ds-upzone-t">
                    {compact ? "Add more" : "Drop floor plans here"}
                  </div>
                  {!compact && <div className="ds-upzone-s">PDF, PNG or JPG</div>}
                </div>
              </div>
            );
            // once plans are in, show the upload as a file card + a compact
            // "add more" zone beside it
            return pages ? (
              <div className="ds-addrow">
                <div className="ds-addfile">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pages[0].thumbUrl} alt="" className="ds-addfile-thumb" />
                  <div className="ds-addfile-text">
                    <b>
                      {pages.length} {pages.length === 1 ? "page" : "pages"}
                    </b>
                    <span>added</span>
                  </div>
                </div>
                {dropzone(true)}
              </div>
            ) : (
              dropzone(false)
            );
          })()}

          {/* ── ② Select pages ── */}
          <div
            className={`ds-pstep-head${stage === "stack" ? " clickable" : ""}`}
            onClick={stage === "stack" ? () => setStage("select") : undefined}
            role={stage === "stack" ? "button" : undefined}
          >
            <span
              className={`ds-pstep-num${
                stage === "stack" ? " done" : pages ? " active" : ""
              }`}
            >
              {stage === "stack" ? <Icon name="check" size={11} /> : 2}
            </span>
            <span className="ds-pstep-t">Select pages</span>
            {pages && stage === "select" && (
              <div className="ds-pagepick-right">
                <span className="ds-pagepick-n">
                  {selected.size} of {pages.length} selected
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
            )}
            {stage === "stack" && (
              <span className="ds-pstep-collapsed">
                {chosen.length} {chosen.length === 1 ? "page" : "pages"} · edit
              </span>
            )}
          </div>
          {!pages ? (
            <div className="ds-pstep-empty">Add floor plans to get started.</div>
          ) : stage === "select" ? (
            <div className="ds-pagepick">
              <div className="ds-pstep-hint">
                Click the pages you want to upload — the magnifier opens a
                close-up.
              </div>
              <PageGrid
                pages={pages}
                selected={selected}
                onPreview={setPreview}
                onToggle={togglePage}
              />
              <div className="ds-pagepick-actions">
                <button
                  className="ds-calib-ok"
                  disabled={selected.size === 0}
                  onClick={confirmPick}
                >
                  Continue with {selected.size}{" "}
                  {selected.size === 1 ? "page" : "pages"}
                </button>
              </div>
            </div>
          ) : null}

          {/* ── ③ Stack your floors ── */}
          <div className="ds-pstep-head" ref={stackRef}>
            <span className={`ds-pstep-num${stage === "stack" ? " active" : ""}`}>
              3
            </span>
            <span className="ds-pstep-t">Stack your floors</span>
            {stage === "stack" && chosen.length > 0 && (
              <span className="ds-pagepick-n">
                {tray.length > 0
                  ? `${tray.length} ${tray.length === 1 ? "plan" : "plans"} to place`
                  : "all placed"}
              </span>
            )}
          </div>
          {stage === "stack" && pages && chosen.length > 0 ? (
            <FloorStackBuilder
              pages={pages}
              chosen={chosen}
              names={names}
              rows={rows}
              onRows={setRows}
              onConfirm={() => void confirmBuild()}
            />
          ) : (
            <div className="ds-pstep-empty">
              Select and name your pages, then stack them into floors here.
            </div>
          )}
        </>
      )}

      {/* full-size close-up (step ②'s magnifier) */}
      {preview !== null && pages && (
        <PageLightbox
          pages={pages}
          index={preview}
          selected={selected}
          onToggle={togglePage}
          onNav={setPreview}
          onClose={() => setPreview(null)}
        />
      )}

      {/* verify/name each chosen page (the only overlay in the flow) */}
      {naming && pages && (
        <NamingLightbox
          pages={pages}
          chosen={chosen}
          names={chosen.map((i) => names[i] ?? "")}
          at={naming.at}
          onName={(name) => setNames((n) => ({ ...n, [chosen[naming.at]]: name }))}
          onNav={(at) => setNaming({ at })}
          onBack={() => setNaming(null)}
          onDone={() => {
            setNaming(null);
            // pages named → collapse Select, reveal & scroll to the stacker
            setStage("stack");
            requestAnimationFrame(() =>
              stackRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" })
            );
          }}
        />
      )}

      {/* ── re-opened stacker: reorder the committed floors ── */}
      {restack !== null &&
        (() => {
          const byId = new Map(doc.floors.map((f) => [f.id, f]));
          const ordered = restack
            .map((id) => byId.get(id))
            .filter((f): f is Floor => f !== undefined);
          const levelsAsc = ordered.map((f) => f.level).sort((a, b) => a - b);
          const move = (i: number, dir: -1 | 1) => {
            const j = i + dir;
            if (j < 0 || j >= restack.length) return;
            const next = [...restack];
            [next[i], next[j]] = [next[j], next[i]];
            setRestack(next);
          };
          return (
            <div className="ds-build">
              <div className="ds-pagepick-head">
                <span className="ds-cardt">Rearrange floors</span>
              </div>
              <div className="ds-alloc-hint">
                Move floors up or down to re-order the stack — the level tags
                re-assign top-to-bottom.
              </div>
              <div className="ds-restack">
                {ordered.map((f, i) => (
                  <div key={f.id} className="ds-level existing">
                    <span className="ds-floor-lvl">
                      {formatLevel(levelsAsc[levelsAsc.length - 1 - i])}
                    </span>
                    <span className="ds-restack-name">{f.name}</span>
                    <span className="ds-floor-plan">
                      {f.plans.length === 0
                        ? "Blank"
                        : f.plans.length === 1
                          ? f.plans[0].pageNumber
                            ? `PDF p.${f.plans[0].pageNumber}`
                            : "Image"
                          : `${f.plans.length} sheets`}
                    </span>
                    <div className="ds-restack-moves">
                      <button
                        disabled={i === 0}
                        aria-label={`Move ${f.name} up`}
                        onClick={() => move(i, -1)}
                      >
                        <Icon name="arrowUp" size={13} />
                      </button>
                      <button
                        disabled={i === ordered.length - 1}
                        aria-label={`Move ${f.name} down`}
                        onClick={() => move(i, 1)}
                      >
                        <Icon name="arrowDown" size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="ds-pagepick-actions">
                <button
                  className="ds-calib-cancel"
                  onClick={() => setRestack(null)}
                >
                  Back
                </button>
                <button
                  className="ds-calib-ok"
                  onClick={() => {
                    onMutate((d) => ({
                      ...d,
                      floors: restackLevels(d.floors, restack),
                    }));
                    setRestack(null);
                  }}
                >
                  Save order
                </button>
              </div>
            </div>
          );
        })()}

      {error && <div className="ds-ierr">{error}</div>}

      {/* ── floors ── (hidden during an import; the stacker owns that view) ── */}
      {/* floors list only appears once floors exist — a fresh plans page is
         just the uploader (the section is deferred until there's something) */}
      {!busy && pages === null && restack === null && floors.length > 0 && (
        <>
          <div className="ds-plans-floors-head">
            <span className="ds-cardt">Floors</span>
            <div className="ds-plans-floors-actions">
              {doc.meta.mode === "plan" && (
                <button className="ds-import" onClick={pickFiles}>
                  <Icon name="arrowUp" size={13} />
                  Add plans
                </button>
              )}
              {floors.length > 1 && (
                <button
                  className="ds-import"
                  onClick={() =>
                    setRestack(
                      [...floors].sort((a, b) => b.level - a.level).map((f) => f.id)
                    )
                  }
                >
                  <Icon name="layers" size={13} />
                  Rearrange
                </button>
              )}
              {doc.meta.mode === "blank" && (
                <button className="ds-import" onClick={onAddFloor}>
                  <Icon name="plus" size={13} />
                  Blank floor
                </button>
              )}
            </div>
          </div>
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
   Left: a tray of plan cards (image + title, named in the previous step).
   Right: the building yard. The plan CARD is the only draggable thing — drag
   it from the tray or between levels. Drop it in a slot to make a new floor;
   drop it on a level to add it there as a second plan (east/west split). The
   first plan placed is the anchor with a level dropdown (ground floor by
   default); every other plan derives its level from position. Names are
   display labels only. */

const ANCHOR_LEVEL_OPTIONS = Array.from({ length: 26 }, (_, i) => i - 5); // B5..L20

/** A plan card — the exact image-over-title unit shown in the tray and used,
    identically, on each floor in the yard. This is the draggable thing. */
function PlanCard({
  idx,
  name,
  thumbUrl,
  onDragStart,
  onDragEnd,
  onRemove,
}: {
  idx: number;
  name: string;
  thumbUrl: string;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onRemove?: () => void;
}) {
  return (
    <div
      className="ds-plancard"
      data-planidx={idx}
      draggable
      title="Drag to a floor"
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="ds-plancard-thumb">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumbUrl} alt={name} />
        {onRemove && (
          <button
            className="ds-plancard-x"
            aria-label={`Remove ${name}`}
            onClick={onRemove}
          >
            <Icon name="x" size={11} />
          </button>
        )}
      </div>
      <span className="ds-plancard-name">{name}</span>
    </div>
  );
}

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
  /** absent on the one-page flow — there's nothing to go "back" to */
  onBack?: () => void;
  onConfirm: () => void;
}) {
  // derive defensively — a hot-reload can preserve an older phase without it
  const chosenIdxs = chosen ?? Object.keys(names).map(Number);
  const tray = trayPageIdxs(rows, chosenIdxs);
  const levels = computeRowLevels(rows);
  const display = [...rows].reverse(); // top of the building first
  const [dragging, setDragging] = useState(false);
  // which single drop target the cursor is actually over right now — CSS
  // :hover doesn't fire reliably during native HTML5 drag, so this is
  // tracked explicitly and drives the highlight instead
  const [overKey, setOverKey] = useState<string | null>(null);
  // plan-card display identity — falls through an empty name to the page label
  const nameFor = (idx: number) => names[idx] || pages[idx]?.label || "New floor";

  const allow = (e: React.DragEvent) => e.preventDefault();
  const pageIdx = (e: React.DragEvent) => {
    const d = e.dataTransfer.getData("text/plain");
    const i = d.startsWith("p:") ? parseInt(d.slice(2), 10) : NaN;
    return Number.isFinite(i) ? i : null;
  };
  const startDrag = (idx: number) => (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", `p:${idx}`);
    setDragging(true);
  };
  const endDrag = () => {
    setDragging(false);
    setOverKey(null);
    enterCounts.current = {};
  };
  /* A zone's children (plan cards) have no drag handlers of their own, so
     moving onto/off them still fires dragenter/dragleave that bubble up to
     the zone's single handler — which is what makes hover tracking work at
     all without relatedTarget (unreliable across environments; untestable
     under jsdom). Each crossing nets an enter+leave pair, so a plain enter
     counter — never negative — tells us whether the cursor is still
     somewhere inside the zone. Handlers read the zone's key off the element
     itself (data-dropkey) rather than a per-key closure, so there is one
     stable function reference — not a factory invoked during render. */
  const enterCounts = useRef<Record<string, number>>({});
  const onZoneDragEnter = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    const key = e.currentTarget.dataset.dropkey;
    if (!key) return;
    enterCounts.current[key] = (enterCounts.current[key] ?? 0) + 1;
    setOverKey(key);
  };
  const onZoneDragLeave = (e: React.DragEvent<HTMLElement>) => {
    const key = e.currentTarget.dataset.dropkey;
    if (!key) return;
    const next = Math.max(0, (enterCounts.current[key] ?? 1) - 1);
    enterCounts.current[key] = next;
    if (next === 0) setOverKey((k) => (k === key ? null : k));
  };

  // a slot between floors → the plan becomes a new floor there
  const dropAt = (anchorKey: string | null, side: "above" | "below") => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    setOverKey(null);
    const idx = pageIdx(e);
    // seed the floor with the TYPED name only (empty ⇒ stack-position default);
    // the page label is just the card's display identity, not the floor name
    if (idx !== null) onRows(insertPageRow(rows, idx, names[idx] ?? "", anchorKey, side));
  };
  // a level row → the plan joins that floor as a second card (east/west split)
  const dropOnLevel = (targetKey: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    setOverKey(null);
    const idx = pageIdx(e);
    if (idx !== null) onRows(dropPageOnRow(rows, idx, targetKey));
  };
  const dropToTray = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    setOverKey(null);
    const idx = pageIdx(e);
    if (idx !== null) onRows(removePageFromRows(rows, idx));
  };

  const gap = (anchorKey: string, side: "above" | "below", key: string) => (
    <div
      key={key}
      className={`ds-dropzone${dragging ? " live" : ""}${overKey === key ? " over" : ""}`}
      data-dropkey={key}
      onDragEnter={onZoneDragEnter}
      onDragOver={allow}
      onDragLeave={onZoneDragLeave}
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
        className={`ds-yard-first${dragging ? " live" : ""}${overKey === "first" ? " over" : ""}`}
        data-dropkey="first"
        onDragEnter={onZoneDragEnter}
        onDragOver={allow}
        onDragLeave={onZoneDragLeave}
        onDrop={dropAt(null, "above")}
      >
        <Icon name="arrowDown" size={18} />
        Drag your first plan here — it becomes the <b>ground floor</b>
        <span className="ds-yard-first-sub">
          (you can change its level afterwards)
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
        <LevelRow
          key={row.key}
          row={row}
          level={lvl(row)}
          rows={rows}
          pages={pages}
          nameFor={nameFor}
          targetable={dragging}
          isOver={overKey === row.key}
          onZoneDragEnter={onZoneDragEnter}
          onZoneDragLeave={onZoneDragLeave}
          onRows={onRows}
          onDropLevel={dropOnLevel(row.key)}
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
      {/* the step header (title + tray count) lives on the page above */}
      <div className="ds-alloc-hint">
        Drag each plan from the left into the building — <b>where you drop it
        sets its level</b>. Drop it in a slot to make a new floor, or onto a
        floor to add it there as a second plan (an east/west split).
      </div>

      <div className="ds-yard-wrap">
        {/* the tray stays mounted so it can animate its width to nothing when
           empty; the yard (flex:1) slides across to fill the space */}
        <div
          className={`ds-tray${dragging ? " live" : ""}${overKey === "tray" ? " over" : ""}${tray.length === 0 ? " empty" : ""}`}
          data-dropkey="tray"
          onDragEnter={onZoneDragEnter}
          onDragOver={allow}
          onDragLeave={onZoneDragLeave}
          onDrop={dropToTray}
        >
          {tray.length > 0 && (
            <>
              <div className="ds-tray-head">Plans</div>
              {tray.map((idx) => (
                <PlanCard
                  key={idx}
                  idx={idx}
                  name={nameFor(idx)}
                  thumbUrl={pages[idx].thumbUrl}
                  onDragStart={startDrag(idx)}
                  onDragEnd={endDrag}
                />
              ))}
            </>
          )}
        </div>

        <div className="ds-yard">
          <div className="ds-yard-cap top">▲ upper floors</div>
          {yard}
          <div className="ds-yard-cap bottom">▼ subfloors</div>
        </div>
      </div>

      <div className="ds-pstep-cta">
        {onBack && (
          <button className="ds-calib-cancel" onClick={onBack}>
            Back
          </button>
        )}
        <button
          className="ds-startdesign"
          disabled={tray.length === chosenIdxs.length}
          onClick={onConfirm}
        >
          Start design
          <Icon name="arrowR" size={16} />
        </button>
      </div>
    </div>
  );
}


/** One level in the yard: a level tag on the left (dropdown on the anchor
    floor) + the plan card(s) at that level. The row is a drop target for
    merging; only the plan cards inside it are draggable. */
function LevelRow({
  row,
  level,
  rows,
  pages,
  nameFor,
  targetable,
  isOver,
  onZoneDragEnter,
  onZoneDragLeave,
  onRows,
  onDropLevel,
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
  isOver: boolean;
  onZoneDragEnter: (e: React.DragEvent<HTMLElement>) => void;
  onZoneDragLeave: (e: React.DragEvent<HTMLElement>) => void;
  onRows: (rows: BuilderRow[]) => void;
  onDropLevel: (e: React.DragEvent) => void;
  onStartDrag: (idx: number) => (e: React.DragEvent) => void;
  onEndDrag: () => void;
  allow: (e: React.DragEvent) => void;
}) {
  return (
    <div
      className={`ds-level${row.floorId ? " existing" : ""}${level < 0 ? " sub" : ""}${targetable ? " targetable" : ""}${isOver ? " over" : ""}`}
      data-floor={row.name}
      data-rowkey={row.key}
      data-dropkey={row.key}
      onDragEnter={onZoneDragEnter}
      onDragOver={allow}
      onDragLeave={onZoneDragLeave}
      onDrop={onDropLevel}
    >
      <div className="ds-level-tag">
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
      </div>
      <div className="ds-level-cards">
        {row.pageIdxs.length === 0 && row.floorId && (
          <span className="ds-level-empty">drop a plan to add it here</span>
        )}
        {row.pageIdxs.map((idx) => (
          <PlanCard
            key={idx}
            idx={idx}
            name={nameFor(idx)}
            thumbUrl={pages[idx].thumbUrl}
            onDragStart={onStartDrag(idx)}
            onDragEnd={onEndDrag}
            onRemove={() => onRows(removePageFromRows(rows, idx))}
          />
        ))}
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
    <div className="ds-lightbox" role="dialog" aria-label="Name pages">
      <div className="ds-lb-backdrop" onClick={onBack} />
      <div className="ds-lb-frame">
        <div className="ds-lb-top">
          <div className="ds-lb-heading">
            <div className="ds-lb-headtext">
              <div className="ds-lb-eyebrow">Name your pages</div>
              <span className="ds-lb-step">
                Page {at + 1} of {chosen.length}
              </span>
            </div>
            <button className="ds-lb-close" aria-label="Close" onClick={onBack}>
              <Icon name="x" size={16} />
            </button>
          </div>
          <input
            className="ds-lb-name"
            value={names[at]}
            autoFocus
            aria-label="Page name"
            placeholder="e.g. Ground floor, First floor…"
            onChange={(e) => onName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (isLast) onDone();
              else onNav(at + 1);
            }}
          />
        </div>
        <div className="ds-lb-img">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={page.thumbUrl} alt={names[at]} />
        </div>
        <button
          className="ds-lb-nav prev"
          aria-label="Previous"
          disabled={at === 0}
          onClick={() => onNav(at - 1)}
        >
          <Icon name="chevL" size={20} />
        </button>
        <button
          className="ds-lb-nav next"
          aria-label="Next"
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
              Next page
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
