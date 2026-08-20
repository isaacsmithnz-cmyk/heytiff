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
import { NO_BRAND, type OrgBrand } from "@/lib/org/brand";

/* LAZY, like every other server action this screen reaches (share-card,
   job-attach, system-card). A static import of an "use server" module pulls
   next/cache into the client module graph, and a jsdom suite that renders this
   component then dies on `Request is not defined` before its first assertion —
   nine studio suites at once, none of which touch printing. The type above is
   erased and costs nothing. */
const orgActions = () => import("@/app/actions/org");

/* Export — WHAT ARE YOU SENDING, then how it should look.

   It used to lead with the mechanism: three buttons reading Print / PNG per
   floor / Design file, with the actual choice — how much of the design goes
   in — hidden behind a Customise disclosure underneath them. So the first
   decision the screen asked for was which machine to use, and the one that
   matters was the one you had to go looking for.

   Now the card is a list of the things you can send, each named by what comes
   out of it, and the options that follow are only the ones that apply to the
   pick. The button says what pressing it will do.

   AND NOTHING IS CALLED A PACK. That word promised a folder of documents —
   datasheets, schedules, compliance — and what comes out is the design
   summary, optionally followed by a page per floor. On a blank-canvas design
   with no plans it was the summary and nothing else. Each choice below states
   its own contents instead.

   Three machines still, underneath: the on-demand PrintDoc, PlanFigure →
   static markup → raster for the images, and the design-file JSON. */

const PNG_WIDTH_PX = 2600;

/* THE THINGS YOU CAN SEND, each named by what comes out of it rather than by
   the machine that makes it. `content` is the existing print model's own axis;
   `how` is which machine. A pick that produces no drawing hides every drawing
   option, and one that is not paper hides the paper options — an export sheet
   should not ask about A3 for a JSON file. */
type ExportHow = "print" | "png" | "file";

interface ExportPick {
  id: string;
  label: string;
  /** what comes out — the whole promise, in one line */
  detail: string;
  content: ExportContent;
  how: ExportHow;
}

const PICKS: ExportPick[] = [
  {
    id: "summary",
    label: "The design summary",
    detail: "One document: the figures, each system, its rooms and materials.",
    content: "schedule",
    how: "print",
  },
  {
    id: "summary-plans",
    label: "The summary and the plans",
    detail: "The document, then one page per floor.",
    content: "full",
    how: "print",
  },
  {
    id: "plans",
    label: "The plans",
    detail: "One page per floor, and nothing else.",
    content: "plans",
    how: "print",
  },
  {
    id: "plan-images",
    label: "The plans as images",
    detail: "A PNG per floor, for dropping into an email or a report.",
    content: "plans",
    how: "png",
  },
  {
    id: "design-file",
    label: "The design file",
    detail: "A backup you can re-open with Import. Not for a customer.",
    content: "full",
    how: "file",
  },
];

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
  /* the pick's content, read by startPrint. Written in an effect rather than
     during render — a ref touched while rendering is the "cannot access refs
     during render" rule, and this is the same shape print-doc.tsx uses to let
     a callback see the latest prop without rebuilding itself. */
  const pickContent = useRef<ExportContent>("full");

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
    brand: OrgBrand;
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

  /* Plain, not a `useCallback`. Its dependency list could never be right: it
     calls `resolveDocs`, which is rebuilt every render and reads `variantDocs`,
     so the honest list included a function identity that always changed — and
     the list it actually carried omitted both, behind an `exhaustive-deps`
     suppression. That is a stale closure, not just a lint complaint: a variant
     that finished loading after this callback was last memoised would be
     missing from the printed pack. It is also what stopped React Compiler
     compiling this component, since a `react-hooks` suppression makes it skip
     the whole file. Unmemoised, it always sees the current render's docs, and
     the compiler memoises it correctly. */
  const startPrint = async () => {
    if (preparing || printing) return;
    setPreparing(true);
    try {
      /* the pick decides how much of the design goes in — DERIVED here rather
         than mirrored into `opts` by an effect, which is a cascading render
         for a value that is already a function of the pick */
      const model = buildPrintModel(resolveDocs(), pack, {
        ...opts,
        content: pickContent.current,
      });
      const refs = collectSheetRefs(model);
      const urls: Record<string, string> = {};
      /* The letterhead is fetched HERE, alongside the rasters, and not when
         the page rendered: the logo is a private object behind a link that
         lives an hour, and this tab is open all afternoon. Minted at print
         time it is always minutes old.

         Its own catch, because a pack that prints without a logo is a pack;
         a pack that does not print because a logo could not be signed is
         not. */
      let brand: OrgBrand = NO_BRAND;
      await Promise.all([
        ...refs.map(async (ref) => {
          try {
            urls[ref] = await planImages.url(ref);
          } catch {
            /* a missing raster prints as white — never blocks the pack */
          }
        }),
        (async () => {
          try {
            brand = await (await orgActions()).getOrgBrand();
          } catch {
            /* prints under the platform eyebrow, exactly as it used to */
          }
        })(),
      ]);
      cleanupArmed.current = true;
      setPrinting({ model, urls, brand });
    } catch (err) {
      /* Cleared on both paths by hand rather than in a `finally`, which React
         Compiler 1.0 cannot lower at all — it refuses the whole component
         over one. What must not happen is the flag staying set: the button
         would read "Preparing…" for ever with no way back but a reload.

         LOGGED, NOT RETHROWN, and that is a deliberate change from the
         `finally` this replaced. Every caller is `void startPrint()`, so a
         thrown error had nowhere to go but an unhandled rejection — the same
         console line this writes, minus the name of the thing that failed. */
      console.error(`[export] print preparation failed: ${String(err)}`);
    }
    setPreparing(false);
  };

  /* PNG per floor: figure → static markup → data-URL rasters → canvas */
  const exportPngs = useCallback(async () => {
    if (pnging) return;
    setPnging(true);
    /* The loop lives in here rather than in the try below, because React
       Compiler 1.0 cannot lower ANY loop inside a try/catch — the iterator
       protocol (and even a plain `i < n` test) counts as a value block, and
       it refuses the whole component over it. The try then wraps a single
       await, which it handles fine. */
    const run = async () => {
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
    };

    try {
      await run();
    } catch (err) {
      // no `finally`, and logged rather than rethrown — see startPrint above
      console.error(`[export] PNG export failed: ${String(err)}`);
    }
    setPnging(false);
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

  /* the pick drives everything below it: `content` rides into the print
     model, `how` decides which machine runs and which options are even
     relevant. */
  const [pickId, setPickId] = useState<string>("summary-plans");
  const pick = PICKS.find((p) => p.id === pickId) ?? PICKS[1];
  /* the design file has no LOOK — it is the document, not a rendering of it,
     so every option below is gated on there being something to render */
  const renders = pick.how !== "file";
  const showsDrawing = renders && pick.content !== "schedule";
  const showsPaper = pick.how === "print";
  const showsFloors = showsDrawing && doc.floors.length > 1;
  useEffect(() => {
    pickContent.current = pick.content;
  });

  const busy = preparing || pnging;
  const go = () => {
    if (pick.how === "file") return onExportJson();
    if (pick.how === "png") return void exportPngs();
    return void startPrint();
  };

  /* the button says what pressing it will DO, not what mode you are in */
  const goLabel = (() => {
    if (preparing) return "Preparing…";
    if (pnging) return "Drawing…";
    if (pick.how === "file") return "Download the design file";
    if (pick.how === "png") {
      const n = opts.floorIds.length;
      return `Download ${n} ${n === 1 ? "image" : "images"}`;
    }
    return "Print or save as PDF";
  })();

  /* a design with no systems has nothing to put on a summary; the drawings and
     the backup are still real, so only the summary picks go dead */
  const goDisabled =
    busy ||
    (pick.how === "print" && pick.content !== "plans" && empty) ||
    (pick.how === "png" && opts.floorIds.length === 0);

  return (
    <div className="ds-act-card">
      <span className="ds-act-t">
        <Icon name="download" size={14} />
        Export
      </span>
      <span className="ds-act-s">What are you sending?</span>

      <div className="ds-export-picks" role="radiogroup" aria-label="What to export">
        {PICKS.map((p) => (
          <button
            key={p.id}
            role="radio"
            aria-checked={p.id === pick.id}
            /* the NAME is the artifact; the line under it is the description.
               Rolling both into the name would announce "The plans as images
               A PNG per floor, for dropping into an email or a report" every
               time the choice moved. */
            aria-labelledby={`ds-xp-t-${p.id}`}
            aria-describedby={`ds-xp-s-${p.id}`}
            className={`ds-export-pick${p.id === pick.id ? " on" : ""}`}
            onClick={() => setPickId(p.id)}
          >
            <span className="ds-export-pick-t" id={`ds-xp-t-${p.id}`}>
              {p.label}
            </span>
            <span className="ds-export-pick-s" id={`ds-xp-s-${p.id}`}>
              {p.detail}
            </span>
          </button>
        ))}
      </div>

      {renders &&
        (showsFloors || showsDrawing || showsPaper || doc.variants.length > 1) && (
        <button
          className="ds-export-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <Icon name={open ? "chevD" : "chevR"} size={12} />
          How it should look
        </button>
      )}

      {open && (
        <div className="ds-export-opts">
          {showsFloors && (
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

          {showsDrawing && (
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

          {showsPaper && (
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
          )}
        </div>
      )}

      <div className="ds-act-row">
        <button
          className="ds-tbbtn ds-act-go ds-job-print"
          onClick={go}
          disabled={goDisabled}
        >
          <Icon name="download" size={14} />
          {goLabel}
        </button>
      </div>

      {printing && (
        <PrintDoc
          model={printing.model}
          urls={printing.urls}
          brand={printing.brand}
          onReady={() => window.print()}
        />
      )}
    </div>
  );
}
