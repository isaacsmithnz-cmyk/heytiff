"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Icon } from "@/components/shell/icon";
import type { DesignDocument } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import { floorDisplayName, type PlanImages } from "@/lib/studio/plans";
import {
  buildPrintModel,
  collectSheetRefs,
  defaultExportOptions,
  type ExportContent,
  type ExportOptions,
  type PrintModel,
} from "@/lib/studio/export";
import {
  inlineImageUrls,
  pngFileName,
  svgToPngBlob,
} from "@/lib/studio/export-png";
import { PlanFigure } from "./plan-figure";
import { PrintDoc } from "./print-doc";

/* Export action card — the customizer. Content (full pack / plan drawings /
   materials schedule), floors, sibling variants (lazy-loaded through the
   store, incl. "all options"), layers, black & white, legend, paper +
   orientation — then three ways out: Print/Save PDF (the on-demand PrintDoc),
   PNG per floor (PlanFigure → static markup → raster; no extra DOM), and the
   design-file JSON. Defaults are "everything, in colour, A4" so the options
   live behind a Customise disclosure and the card stays calm. */

const PNG_WIDTH_PX = 2600;

export function ExportCard({
  doc,
  pack,
  planImages,
  empty,
  onExportJson,
  loadVariant,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  planImages: PlanImages;
  /** no systems yet — the printed pack would be blank */
  empty: boolean;
  onExportJson: () => void;
  /** sibling variant docs load through the store (org-scoped) */
  loadVariant: (id: string) => Promise<DesignDocument | null>;
}) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ExportOptions>(() =>
    defaultExportOptions(doc)
  );
  /* new floors/design → re-seed floor selection (keep the rest) */
  const seededFor = useRef(doc.id);
  useEffect(() => {
    if (seededFor.current !== doc.id) {
      seededFor.current = doc.id;
      setOpts(defaultExportOptions(doc));
    }
  }, [doc]);

  const [printing, setPrinting] = useState<{
    model: PrintModel;
    urls: Record<string, string>;
  } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [pnging, setPnging] = useState(false);
  const cleanupArmed = useRef(false);

  /* variant docs, cached per id; "error" renders the inline failure row */
  const [variantDocs, setVariantDocs] = useState<
    ReadonlyMap<string, DesignDocument | "error">
  >(new Map());

  const patch = (p: Partial<ExportOptions>) =>
    setOpts((o) => ({ ...o, ...p }));

  const toggleFloor = (id: string) =>
    setOpts((o) => ({
      ...o,
      floorIds: o.floorIds.includes(id)
        ? o.floorIds.filter((f) => f !== id)
        : [...o.floorIds, id],
    }));

  const toggleVariant = (id: string) => {
    setOpts((o) => ({
      ...o,
      variantIds: o.variantIds.includes(id)
        ? id === doc.id
          ? o.variantIds // the open design always prints
          : o.variantIds.filter((v) => v !== id)
        : [...o.variantIds, id],
    }));
    if (id !== doc.id && !variantDocs.has(id))
      void loadVariant(id)
        .then((d) => d ?? ("error" as const))
        .catch(() => "error" as const)
        .then((d) =>
          setVariantDocs((prev) => new Map(prev).set(id, d))
        );
  };

  const allVariantIds = doc.variants.map((v) => v.id);
  const allOn =
    doc.variants.length > 1 &&
    allVariantIds.every((id) => opts.variantIds.includes(id));
  const toggleAllVariants = () => {
    if (allOn) patch({ variantIds: [doc.id] });
    else for (const id of allVariantIds) if (!opts.variantIds.includes(id)) toggleVariant(id);
  };

  /** the docs to print, in chosen order, open design first; failed loads out */
  const resolveDocs = (): DesignDocument[] => {
    const out: DesignDocument[] = [doc];
    for (const id of opts.variantIds) {
      if (id === doc.id) continue;
      const d = variantDocs.get(id);
      if (d && d !== "error") out.push(d);
    }
    return out;
  };

  /* afterprint = the dialog closed (printed OR cancelled) — tear down */
  useEffect(() => {
    if (!printing) return;
    const done = () => {
      if (cleanupArmed.current) {
        cleanupArmed.current = false;
        setPrinting(null);
      }
    };
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, [printing]);

  const startPrint = useCallback(async () => {
    if (preparing || printing) return;
    setPreparing(true);
    try {
      const model = buildPrintModel(resolveDocs(), pack, opts);
      const refs = collectSheetRefs(model);
      const urls: Record<string, string> = {};
      await Promise.all(
        refs.map(async (ref) => {
          try {
            urls[ref] = await planImages.url(ref);
          } catch {
            /* a missing raster prints as white — never blocks the pack */
          }
        })
      );
      cleanupArmed.current = true;
      setPrinting({ model, urls });
    } finally {
      setPreparing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preparing, printing, doc, pack, opts, planImages]);

  /* PNG per floor: figure → static markup → data-URL rasters → canvas */
  const exportPngs = useCallback(async () => {
    if (pnging) return;
    setPnging(true);
    try {
      const floors = doc.floors.filter((f) => opts.floorIds.includes(f.id));
      for (const floor of floors) {
        const raw: Record<string, string> = {};
        await Promise.all(
          floor.plans.map(async (s) => {
            if (!opts.layers.plan) return;
            try {
              raw[s.imageRef] = await planImages.url(s.imageRef);
            } catch {
              /* sheet drops from the figure */
            }
          })
        );
        const inlined = await inlineImageUrls(raw);
        const markup = renderToStaticMarkup(
          <PlanFigure
            doc={doc}
            floor={floor}
            layers={opts.layers}
            grayscale={opts.grayscale}
            legend={opts.legend}
            urls={inlined}
          />
        );
        if (!markup) continue; // an empty floor draws nothing
        const blob = await svgToPngBlob(markup, PNG_WIDTH_PX);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = pngFileName(doc, floor);
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setPnging(false);
    }
  }, [pnging, doc, opts, planImages]);

  const seg = (
    label: string,
    active: boolean,
    onClick: () => void,
    disabled = false
  ) => (
    <button
      key={label}
      className={`ds-export-seg${active ? " on" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
    >
      {label}
    </button>
  );

  const planless = opts.content === "schedule";

  return (
    <div className="ds-act-card">
      <span className="ds-act-t">
        <Icon name="download" size={14} />
        Export
      </span>
      <span className="ds-act-s">
        The pack as a PDF — plan pages included — PNG drawings per floor, or
        the design file.
      </span>

      <button
        className="ds-export-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <Icon name={open ? "chevD" : "chevR"} size={12} />
        Customise
      </button>

      {open && (
        <div className="ds-export-opts">
          <div className="ds-export-grp">
            <span className="ds-export-cap">What</span>
            <div className="ds-export-segs">
              {(
                [
                  ["full", "Full pack"],
                  ["plans", "Plans"],
                  ["schedule", "Schedule"],
                ] as [ExportContent, string][]
              ).map(([v, label]) =>
                seg(label, opts.content === v, () => patch({ content: v }))
              )}
            </div>
          </div>

          {!planless && doc.floors.length > 1 && (
            <div className="ds-export-grp">
              <span className="ds-export-cap">Floors</span>
              {doc.floors.map((f) => (
                <label key={f.id} className="ds-export-row">
                  <input
                    type="checkbox"
                    checked={opts.floorIds.includes(f.id)}
                    onChange={() => toggleFloor(f.id)}
                  />
                  {floorDisplayName(f)}
                </label>
              ))}
            </div>
          )}

          {doc.variants.length > 1 && (
            <div className="ds-export-grp">
              <span className="ds-export-cap">Options</span>
              <label className="ds-export-row">
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={toggleAllVariants}
                />
                All options
              </label>
              {doc.variants.map((v) => {
                const failed = variantDocs.get(v.id) === "error";
                return (
                  <label key={v.id} className="ds-export-row">
                    <input
                      type="checkbox"
                      checked={opts.variantIds.includes(v.id)}
                      disabled={v.id === doc.id}
                      onChange={() => toggleVariant(v.id)}
                    />
                    {v.label}
                    {v.id === doc.id && <em>this one</em>}
                    {failed && <em className="err">couldn&apos;t load</em>}
                  </label>
                );
              })}
            </div>
          )}

          {!planless && (
            <div className="ds-export-grp">
              <span className="ds-export-cap">Drawing</span>
              {(
                [
                  ["plan", "Floor plan"],
                  ["units", "Units"],
                  ["pipes", "Pipework"],
                  ["labels", "Labels"],
                ] as [keyof ExportOptions["layers"], string][]
              ).map(([k, label]) => (
                <label key={k} className="ds-export-row">
                  <input
                    type="checkbox"
                    checked={opts.layers[k]}
                    onChange={() =>
                      patch({ layers: { ...opts.layers, [k]: !opts.layers[k] } })
                    }
                  />
                  {label}
                </label>
              ))}
              <label className="ds-export-row">
                <input
                  type="checkbox"
                  checked={opts.grayscale}
                  onChange={() => patch({ grayscale: !opts.grayscale })}
                />
                Black &amp; white
              </label>
              <label className="ds-export-row">
                <input
                  type="checkbox"
                  checked={opts.legend}
                  onChange={() => patch({ legend: !opts.legend })}
                />
                Legend on the drawing
              </label>
            </div>
          )}

          <div className="ds-export-grp">
            <span className="ds-export-cap">Paper</span>
            <div className="ds-export-segs">
              {seg("A4", opts.paper === "A4", () => patch({ paper: "A4" }))}
              {seg("A3", opts.paper === "A3", () => patch({ paper: "A3" }))}
            </div>
            <div className="ds-export-segs">
              {seg("Portrait", opts.orientation === "portrait", () =>
                patch({ orientation: "portrait" })
              )}
              {seg("Landscape", opts.orientation === "landscape", () =>
                patch({ orientation: "landscape" })
              )}
            </div>
          </div>
        </div>
      )}

      <div className="ds-act-row">
        <button
          className="ds-tbbtn ds-job-print"
          onClick={() => void startPrint()}
          disabled={empty || preparing}
        >
          <Icon name="download" size={14} />
          {preparing ? "Preparing…" : "Print / Save PDF"}
        </button>
        <button
          className="ds-tbbtn"
          onClick={() => void exportPngs()}
          disabled={planless || pnging || opts.floorIds.length === 0}
          title="One PNG image per selected floor, drawn with the options above"
        >
          <Icon name="file" size={14} />
          {pnging ? "Drawing…" : "PNG per floor"}
        </button>
        {/* stays enabled when empty — a backup of an empty design is still a
            valid backup */}
        <button
          className="ds-tbbtn ds-job-export"
          onClick={onExportJson}
          title="Download this design as a .heytiff-design.json backup — re-open it with Import on the studio home"
        >
          <Icon name="arrowUp" size={14} />
          Design file
        </button>
      </div>

      {printing && (
        <PrintDoc
          model={printing.model}
          pack={pack}
          urls={printing.urls}
          onReady={() => window.print()}
        />
      )}
    </div>
  );
}
