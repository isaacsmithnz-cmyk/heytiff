"use client";

import { useEffect, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Icon } from "@/components/shell/icon";
import type { DesignDocument } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import { floorDisplayName, type PlanImages } from "@/lib/studio/plans";
import {
  buildPrintModel,
  collectSheetRefs,
  defaultExportOptions,
  hasSheet,
  type ExportOptions,
  type PrintModel,
} from "@/lib/studio/export";
import type { DesignBasis, DesignSnapshot, SummaryModel } from "@/lib/studio/summary";
import { inlineImageUrls, pngFileName, svgToPngBlob } from "@/lib/studio/export-png";
import {
  AUDIENCE_PARTS,
  SEND_PARTS,
  audienceOf,
  linkScopeOf,
  notCarried,
  sameLinkScope,
  sectionsOf,
  type LinkScope,
  type SendAudience,
  type SendDest,
  type SendPart,
} from "@/lib/studio/send";
import { SHARE_TTL_DAYS } from "@/lib/studio/share";
import type { ShareLink } from "@/app/actions/studio-share";
import { PlanFigure } from "./plan-figure";
import { PrintDoc } from "./print-doc";
import { PicklistSection, SheetDoc } from "./sheet-doc";
import { SheetPlans } from "./sheet-plans";
import { SummaryModal } from "./summary-modal";
import { NO_BRAND, type OrgBrand } from "@/lib/org/brand";

/* SEND — the one way a design leaves the Summary.

   Share and Export were two buttons, two dialogs, and neither asked what the
   person on the other end should get. Export listed five machines (a summary,
   the summary and plans, the plans, the plans as images, the design file) and
   always printed the material picklist, so a customer's copy could not be made
   without it. Share made a link that showed whatever the sheet showed.

   Now the dialog asks three things, in the order they decide each other:
   WHERE it goes (paper or the customer's live link — each carries different
   parts, lib/studio/send.ts), WHO it is for (which fills in the ticks), and
   WHAT goes in, a tick per part. The preview beside it is the document
   itself, shrunk, so what you tick is what you see.

   The images and the design file are still here, as the two things under the
   preview: they are formats, not contents, and they never went to a customer.

   Server actions load LAZILY — a static import of a "use server" module pulls
   next/cache into the client graph and a jsdom suite dies on `Request is not
   defined` before its first assertion. The ShareLink type is erased. */

const orgActions = () => import("@/app/actions/org");
const shareActions = () => import("@/app/actions/studio-share");

const PNG_WIDTH_PX = 2600;

const PART_LABEL: Record<SendPart, string> = {
  figures: "Heat loads and design conditions",
  systems: "Systems and rooms",
  lines: "Pipe, electrical and components",
  plans: "Floor plans",
  picklist: "Material picklist",
  options: "Other options",
  sim: "Simulation",
};

const AUDIENCE_LABEL: Record<SendAudience, string> = {
  customer: "The customer",
  crew: "The install team",
};

type LinkState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "none" }
  | { kind: "busy" }
  | ({ kind: "active" } & ShareLink);

/* THE SHEET AT A DESK WIDTH, SHRUNK TO THE COLUMN. Laid out any narrower, its
   container queries pick the phone form (the rooms table stacks below 1024px),
   and the preview would show a document nobody receives. A transform does not
   change layout, so the box is given the shrunk height by hand. */
const DESK_PX = 1120;

function Shrunk({ children }: { children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; height: number } | null>(null);
  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const scale = o.clientWidth / DESK_PX;
      setFit({ scale, height: i.offsetHeight * scale });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="ds-send-mini" ref={outer} style={fit ? { height: fit.height } : undefined}>
      <div
        className="ds-send-mini-in"
        ref={inner}
        style={{ width: DESK_PX, transform: fit ? `scale(${fit.scale})` : undefined }}
      >
        {children}
      </div>
    </div>
  );
}

export interface SendCheck {
  title: string;
  detail: string;
}

export function SendCard({
  doc,
  pack,
  brand,
  model,
  snapshot,
  basis,
  preparedOn,
  planImages,
  empty,
  simOffered,
  checks,
  onExportJson,
  loadVariant,
  onClose,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  /** the business's letterhead, for the preview */
  brand: OrgBrand;
  model: SummaryModel;
  snapshot: DesignSnapshot;
  basis: DesignBasis;
  preparedOn: string;
  planImages: PlanImages;
  /** no systems yet — rooms and pipework have nothing to show */
  empty: boolean;
  /** the simulation is ticked as fit to show a customer (sim-approval.ts) */
  simOffered: boolean;
  /** what to look at before sending — the chrome's own list */
  checks: SendCheck[];
  onExportJson: () => void;
  /** sibling option docs load through the store (org-scoped) */
  loadVariant: (id: string) => Promise<DesignDocument | null>;
  /** scrim, the x and Escape all land here */
  onClose: () => void;
}) {
  const floors = [...doc.floors].sort((a, b) => a.level - b.level);
  const allFloorIds = floors.map((f) => f.id);
  const others = doc.variants.filter((v) => v.id !== doc.id);

  const [dest, setDest] = useState<SendDest>("pdf");
  const [parts, setParts] = useState<ReadonlySet<SendPart>>(
    () => new Set(AUDIENCE_PARTS.customer)
  );
  const [floorIds, setFloorIds] = useState<ReadonlySet<string>>(() => new Set(allFloorIds));
  const [otherIds, setOtherIds] = useState<ReadonlySet<string>>(
    () => new Set(doc.variants.filter((v) => v.id !== doc.id).map((v) => v.id))
  );
  const [opts, setOpts] = useState<ExportOptions>(() => defaultExportOptions(doc));
  const [setupOpen, setSetupOpen] = useState(false);
  const patch = (p: Partial<ExportOptions>) => setOpts((o) => ({ ...o, ...p }));

  /* ── what can go, and what will ── */
  const why = (p: SendPart): string | null => {
    const carried = notCarried(p, dest);
    if (carried) return carried;
    if ((p === "systems" || p === "lines") && empty) return "Nothing designed yet";
    if (p === "picklist" && model.picklist.length === 0) return "Nothing to pick yet";
    if (p === "sim" && !simOffered) return "Not ticked ready";
    return null;
  };
  /* a row the design has nothing for is absent, not greyed: one option has
     no others, a design with no floors has no plans */
  const rows = SEND_PARTS.filter(
    (p) => !(p === "options" && others.length === 0) && !(p === "plans" && floors.length === 0)
  );
  const open = (p: SendPart) => rows.includes(p) && why(p) === null;
  const on = (p: SendPart) => parts.has(p) && open(p);
  const floorsOn = on("plans") ? floors.filter((f) => floorIds.has(f.id)) : [];
  const othersOn = on("options") ? others.filter((v) => otherIds.has(v.id)) : [];
  const sheetParts = new Set(SEND_PARTS.filter(on));
  const sections = sectionsOf(sheetParts);
  const audience = audienceOf(parts, open);

  const toggle = (p: SendPart) =>
    setParts((cur) => {
      const next = new Set(cur);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  const choose = (a: SendAudience) => {
    setParts(new Set(AUDIENCE_PARTS[a]));
    if (AUDIENCE_PARTS[a].includes("options")) setOtherIds(new Set(others.map((v) => v.id)));
  };
  const toggleIn = (set: ReadonlySet<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  /* ── the other options, loaded as they are ticked ── */
  const [variantDocs, setVariantDocs] = useState<ReadonlyMap<string, DesignDocument | "error">>(
    new Map()
  );
  const othersKey = othersOn.map((v) => v.id).join();
  useEffect(() => {
    for (const id of othersKey ? othersKey.split(",") : []) {
      if (variantDocs.has(id)) continue;
      void loadVariant(id)
        .then((d) => d ?? ("error" as const))
        .catch(() => "error" as const)
        .then((d) => setVariantDocs((prev) => new Map(prev).set(id, d)));
    }
  }, [othersKey, variantDocs, loadVariant]);

  /* ── the live link ── */
  const [link, setLink] = useState<LinkState>({ kind: "loading" });
  const [copied, setCopied] = useState(false);
  const [armed, setArmed] = useState(false);
  const destRef = useRef(dest);
  useEffect(() => {
    destRef.current = dest;
  });

  /* the ticks show what the link shows when you turn to it — so pressing
     nothing means nothing changes for the customer */
  const adopt = (scope: LinkScope) => {
    setParts((cur) => {
      const next = new Set(cur);
      for (const p of ["figures", "systems", "lines", "plans", "sim"] as const) {
        if (scope.parts.includes(p)) next.add(p);
        else next.delete(p);
      }
      return next;
    });
    setFloorIds(new Set(allFloorIds.filter((f) => !scope.hiddenFloorIds.includes(f))));
  };
  /* read through a ref by the load below, which runs once per design and
     must not re-run (and re-fetch) because a callback's identity moved */
  const adoptRef = useRef(adopt);
  useEffect(() => {
    adoptRef.current = adopt;
  });

  useEffect(() => {
    let live = true;
    shareActions()
      .then((a) => a.getShareLink(doc.id))
      .then((l) => {
        if (!live) return;
        setLink(l ? { kind: "active", ...l } : { kind: "none" });
        if (l && destRef.current === "link") adoptRef.current(l.scope);
      })
      .catch(() => {
        if (live) setLink({ kind: "unavailable" });
      });
    return () => {
      live = false;
    };
  }, [doc.id]);

  const goTo = (d: SendDest) => {
    setDest(d);
    setArmed(false);
    if (d === "link" && link.kind === "active" && !link.expired) adopt(link.scope);
  };

  const scopeNow = linkScopeOf(sheetParts, floorIds, allFloorIds);
  const drift =
    link.kind === "active" && !link.expired && !sameLinkScope(scopeNow, link.scope);

  const makeLink = () => {
    setLink({ kind: "busy" });
    shareActions()
      .then((a) => a.createShareLink(doc.id, scopeNow))
      .then((l) => setLink({ kind: "active", ...l }))
      .catch(() => setLink({ kind: "unavailable" }));
  };
  const updateLink = () => {
    setLink({ kind: "busy" });
    shareActions()
      .then((a) => a.updateShareScope(doc.id, scopeNow))
      .then((l) => setLink({ kind: "active", ...l }))
      .catch(() => setLink({ kind: "unavailable" }));
  };
  const revoke = () => {
    setArmed(false);
    setLink({ kind: "busy" });
    shareActions()
      .then((a) => a.revokeShareLink(doc.id))
      .then(() => setLink({ kind: "none" }))
      .catch(() => setLink({ kind: "unavailable" }));
  };
  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  /* ── paper ── */
  const [printing, setPrinting] = useState<{
    model: PrintModel;
    urls: Record<string, string>;
    brand: OrgBrand;
  } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [pnging, setPnging] = useState(false);
  const cleanupArmed = useRef(false);

  /* afterprint = the print window closed (printed OR cancelled) — tear down */
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

  /* Plain, not a useCallback: it reads this render's ticks and loaded
     options, and a memoised copy would print a stale set. No `finally` and no
     loop inside the try — React Compiler 1.0 refuses the whole component over
     either (see the note that used to live in export-card.tsx). */
  const startPrint = async () => {
    if (preparing || printing) return;
    setPreparing(true);
    try {
      const docs: DesignDocument[] = [doc];
      othersOn.forEach((v) => {
        const d = variantDocs.get(v.id);
        if (d && d !== "error") docs.push(d);
      });
      const printModel = buildPrintModel(docs, pack, {
        ...opts,
        sections,
        floorIds: floorsOn.map((f) => f.id),
        variantIds: docs.map((d) => d.id),
      });
      const refs = collectSheetRefs(printModel);
      const urls: Record<string, string> = {};
      /* the letterhead is signed HERE, at print time: the logo's link lives
         an hour and this tab is open all afternoon. A document that prints
         without its logo is still the document. */
      let printBrand: OrgBrand = NO_BRAND;
      await Promise.all([
        ...refs.map(async (ref) => {
          try {
            urls[ref] = await planImages.url(ref);
          } catch {
            /* a missing raster prints as white — never blocks the print */
          }
        }),
        (async () => {
          try {
            printBrand = await (await orgActions()).getOrgBrand();
          } catch {
            /* prints under the platform eyebrow */
          }
        })(),
      ]);
      cleanupArmed.current = true;
      setPrinting({ model: printModel, urls, brand: printBrand });
    } catch (err) {
      console.error(`[send] print preparation failed: ${String(err)}`);
    }
    setPreparing(false);
  };

  /* the images: one PNG per ticked floor, whatever the plans row says — they
     are a format of the drawing, not a part of the document */
  const pngFloors = floors.filter((f) => floorIds.has(f.id));
  const exportPngs = async () => {
    if (pnging) return;
    setPnging(true);
    const run = async () => {
      for (const floor of pngFloors) {
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
      console.error(`[send] PNG export failed: ${String(err)}`);
    }
    setPnging(false);
  };

  /* ── the preview's plan rasters, signed once when the dialog opens ── */
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const refsKey = floors.flatMap((f) => f.plans.map((s) => s.imageRef)).filter(Boolean).join("|");
  useEffect(() => {
    let live = true;
    const refs = refsKey ? refsKey.split("|") : [];
    void Promise.all(
      refs.map((r) =>
        planImages.url(r).then(
          (u) => [r, u] as const,
          () => null
        )
      )
    ).then((pairs) => {
      if (!live) return;
      const out: Record<string, string> = {};
      for (const p of pairs) if (p) out[p[0]] = p[1];
      setPreviewUrls(out);
    });
    return () => {
      live = false;
    };
  }, [refsKey, planImages]);

  /* ── the footer: what the dialog exists to do spans the bar ── */
  const nothing =
    dest === "link" ? sheetParts.size === 0 : !hasSheet(sections) && floorsOn.length === 0;
  const busy = preparing || pnging;

  const foot = (() => {
    if (dest === "pdf")
      return (
        <button
          className="ds-tbbtn ds-act-go"
          onClick={() => void startPrint()}
          disabled={busy || nothing}
        >
          <Icon name="download" size={14} />
          {nothing ? "Tick something to send" : preparing ? "Preparing…" : "Print or save as PDF"}
        </button>
      );
    if (link.kind === "loading" || link.kind === "unavailable") return null;
    if (link.kind === "none" || link.kind === "busy")
      return (
        <button
          className="ds-tbbtn ds-act-go"
          onClick={makeLink}
          disabled={link.kind === "busy" || nothing}
        >
          {link.kind === "busy" ? "Working…" : nothing ? "Tick something to send" : "Create live link"}
        </button>
      );
    const active = link;
    const primary = active.expired ? (
      <button className="ds-tbbtn ds-act-go" onClick={makeLink} disabled={nothing}>
        Create a new link
      </button>
    ) : drift ? (
      <button className="ds-tbbtn ds-act-go" onClick={updateLink} disabled={nothing}>
        {nothing ? "Tick something to send" : "Update the link"}
      </button>
    ) : (
      <button className="ds-tbbtn ds-act-go" onClick={() => copy(active.url)}>
        <Icon name={copied ? "check" : "file"} size={14} />
        {copied ? "Copied" : "Copy link"}
      </button>
    );
    return (
      <>
        {armed ? (
          <>
            <button className="ds-tbbtn ds-share-kill" onClick={revoke}>
              Really revoke
            </button>
            <button className="ds-tbbtn" onClick={() => setArmed(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="ds-tbbtn" onClick={() => setArmed(true)}>
            <Icon name="x" size={13} />
            Revoke
          </button>
        )}
        {primary}
      </>
    );
  })();

  const pageLine = [
    opts.paper,
    opts.orientation,
    opts.grayscale ? "black and white" : "colour",
  ].join(", ");

  const seg = (label: string, active: boolean, onClick: () => void) => (
    <button key={label} className={`ds-export-seg${active ? " on" : ""}`} onClick={onClick} aria-pressed={active}>
      {label}
    </button>
  );

  const eyebrow = doc.meta.variantLabel
    ? `Design summary, ${doc.meta.variantLabel.toLowerCase()}`
    : "Design summary";

  return (
    <>
      <SummaryModal
        title="Share"
        icon="arrowUR"
        onClose={onClose}
        wide
        foot={foot}
        note={
          checks.length > 0 && (
            <p className="ds-send-chk" role="status">
              <span className="ds-send-dot" aria-hidden />
              <b>{checks.length} to check</b>
              <span>
                {checks[0].title}
                {checks.length > 1 ? `, and ${checks.length - 1} more` : ""}
              </span>
            </p>
          )
        }
      >
        <div className="ds-send-l">
          <div className="ds-export-grp">
            <span className="ds-export-cap" id="ds-send-where">Where it goes</span>
            <div className="ds-send-dests" role="radiogroup" aria-labelledby="ds-send-where">
              {(
                [
                  ["pdf", "PDF", "Print it or save it as a file"],
                  ["link", "Live link", "The customer's page, always the latest save"],
                ] as const
              ).map(([id, label, detail]) => (
                <button
                  key={id}
                  role="radio"
                  aria-checked={dest === id}
                  aria-labelledby={`ds-send-d-${id}`}
                  aria-describedby={`ds-send-ds-${id}`}
                  className={`ds-export-pick${dest === id ? " on" : ""}`}
                  onClick={() => goTo(id)}
                >
                  <span className="ds-export-pick-t" id={`ds-send-d-${id}`}>
                    {label}
                  </span>
                  <span className="ds-export-pick-s" id={`ds-send-ds-${id}`}>
                    {detail}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* the live link is always the customer's page — there is no one
              else to choose */}
          {dest === "pdf" && (
            <div className="ds-export-grp">
              <span className="ds-export-cap" id="ds-send-who">Who is it for?</span>
              <div className="ds-export-segs" role="group" aria-labelledby="ds-send-who">
                {(["customer", "crew"] as const).map((a) =>
                  seg(AUDIENCE_LABEL[a], audience === a, () => choose(a))
                )}
              </div>
            </div>
          )}

          <div className="ds-export-grp">
            <span className="ds-export-cap ds-send-caprow">
              What goes in
              <span>
                {rows.filter(on).length} of {rows.filter(open).length}
              </span>
            </span>
            <div className="ds-send-inc">
              {rows.map((p) => {
                const reason = why(p);
                return (
                  <div key={p} className="ds-send-part">
                    <label className="ds-export-row">
                      <input
                        type="checkbox"
                        checked={on(p)}
                        disabled={reason !== null}
                        onChange={() => toggle(p)}
                      />
                      {PART_LABEL[p]}
                      {reason ? (
                        <em>{reason}</em>
                      ) : p === "picklist" ? (
                        <em>Internal</em>
                      ) : null}
                    </label>
                    {p === "plans" && on("plans") && floors.length > 1 &&
                      floors.map((f) => (
                        <label key={f.id} className="ds-export-row sub">
                          <input
                            type="checkbox"
                            checked={floorIds.has(f.id)}
                            onChange={() => {
                              const next = toggleIn(floorIds, f.id);
                              setFloorIds(next);
                              if (next.size === 0) toggle("plans");
                            }}
                          />
                          {floorDisplayName(f)}
                        </label>
                      ))}
                    {p === "options" && on("options") &&
                      others.map((v) => (
                        <label key={v.id} className="ds-export-row sub">
                          <input
                            type="checkbox"
                            checked={otherIds.has(v.id)}
                            onChange={() => {
                              const next = toggleIn(otherIds, v.id);
                              setOtherIds(next);
                              if (next.size === 0) toggle("options");
                            }}
                          />
                          {v.label}
                          {variantDocs.get(v.id) === "error" && <em className="err">Couldn&apos;t load</em>}
                        </label>
                      ))}
                  </div>
                );
              })}
            </div>
            {on("picklist") && <span className="ds-act-s">Includes the material picklist.</span>}
          </div>
        </div>

        <div className="ds-send-r">
          {/* PINNED: what this is a preview of, and the page it will print on.
              The page setup used to sit under the preview and scroll away
              with it; it is a setting of the whole document, so it stays put
              above it (Isaac, 2026-09-28). */}
          <div className="ds-send-rhead">
            <span className="ds-export-cap">{dest === "link" ? "The customer opens" : "Preview"}</span>
            {dest === "pdf" && (
              <>
                <b>{pageLine}</b>
                <button
                  className="ds-send-lnk"
                  onClick={() => setSetupOpen((o) => !o)}
                  aria-expanded={setupOpen}
                >
                  {setupOpen ? "Done" : "Change"}
                </button>
              </>
            )}
          </div>

          {dest === "pdf" && setupOpen && (
            <div className="ds-send-setupx">
              <div className="ds-export-segs">
                {seg("A4", opts.paper === "A4", () => patch({ paper: "A4" }))}
                {seg("A3", opts.paper === "A3", () => patch({ paper: "A3" }))}
              </div>
              <div className="ds-export-segs">
                {seg("Portrait", opts.orientation === "portrait", () => patch({ orientation: "portrait" }))}
                {seg("Landscape", opts.orientation === "landscape", () =>
                  patch({ orientation: "landscape" })
                )}
              </div>
              <div className="ds-send-drawing">
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
                      onChange={() => patch({ layers: { ...opts.layers, [k]: !opts.layers[k] } })}
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
                  Black and white
                </label>
                <label className="ds-export-row">
                  <input type="checkbox" checked={opts.legend} onChange={() => patch({ legend: !opts.legend })} />
                  Legend
                </label>
              </div>
            </div>
          )}

          {dest === "link" && (
            <div className="ds-send-link">
              {link.kind === "loading" && <span className="ds-act-s">Checking for a live link…</span>}
              {link.kind === "unavailable" && (
                <span className="ds-act-s">
                  Sharing needs a signed-in session. Open the studio from your dashboard.
                </span>
              )}
              {(link.kind === "none" || link.kind === "busy") && (
                <span className="ds-act-s">
                  No link yet. A link shows the latest save of this design, and works for{" "}
                  {SHARE_TTL_DAYS} days.
                </span>
              )}
              {link.kind === "active" && (
                <>
                  <span className={`ds-share-url${link.expired ? " dead" : ""}`} title={link.url}>
                    {link.url.replace(/^https?:\/\//, "")}
                  </span>
                  {link.expired ? (
                    <span className="ds-share-meta dead">
                      Expired {new Date(link.expiresAt).toLocaleDateString()}. Anyone opening it now
                      sees nothing.
                    </span>
                  ) : (
                    <span className="ds-share-meta">
                      {drift ? "Shows what was ticked when you made it. " : "Always shows the latest save. "}
                      Expires in{" "}
                      <b>
                        {link.daysLeft} day{link.daysLeft === 1 ? "" : "s"}
                      </b>{" "}
                      ({new Date(link.expiresAt).toLocaleDateString()}).
                    </span>
                  )}
                </>
              )}
            </div>
          )}

          {/* THE DOCUMENT ITSELF, shrunk: the same SheetDoc and PlanFigure the
              customer and the paper get, with the same ticks, laid out at a
              desk width and scaled so every line keeps its printed weight.
              Only this scrolls. Inert — it is a picture. */}
          <div className="ds-send-rscroll">
            {nothing ? (
              <p className="ds-send-empty">Nothing ticked yet.</p>
            ) : (
              <div className="ds-send-pv" inert aria-hidden="true">
                {(hasSheet(sections) || dest === "link") && (
                  <Shrunk>
                    <SheetDoc
                      doc={doc}
                      model={model}
                      snapshot={snapshot}
                      basis={basis}
                      brand={brand}
                      eyebrow={eyebrow}
                      preparedOn={preparedOn}
                      sections={sections}
                    >
                      {sections.picklist && dest === "pdf" && <PicklistSection rows={model.picklist} />}
                      {dest === "link" && <SheetPlans doc={doc} floors={floorsOn} urls={previewUrls} />}
                    </SheetDoc>
                  </Shrunk>
                )}
                {dest === "pdf" &&
                  floorsOn.map((f) => (
                    <div key={f.id} className="ds-send-plan">
                      <Shrunk>
                        <div className="ds-send-plan-in">
                          <PlanFigure
                            doc={doc}
                            floor={f}
                            layers={opts.layers}
                            grayscale={opts.grayscale}
                            legend={opts.legend}
                            urls={previewUrls}
                          />
                        </div>
                      </Shrunk>
                      <span>{floorDisplayName(f)}</span>
                    </div>
                  ))}
                {othersOn.map((v) => (
                  <span key={v.id} className="ds-act-s">
                    Then {v.label}, with the same parts.
                  </span>
                ))}
              </div>
            )}
          </div>

          {dest === "pdf" && (
            <div className="ds-send-also">
              <span className="ds-export-cap">Also</span>
              <button
                className="ds-send-lnk"
                onClick={() => void exportPngs()}
                disabled={pnging || pngFloors.length === 0}
              >
                {pnging
                  ? "Drawing…"
                  : `Plans as ${pngFloors.length === 1 ? "an image" : `${pngFloors.length} images`}`}
              </button>
              <button className="ds-send-lnk" onClick={onExportJson}>
                Design file
              </button>
            </div>
          )}
        </div>
      </SummaryModal>

      {/* portals to <body> itself and is never on screen — a sibling here so
          it lives and dies with the dialog without being inside it */}
      {printing && (
        <PrintDoc
          model={printing.model}
          urls={printing.urls}
          brand={printing.brand}
          onReady={() => window.print()}
        />
      )}
    </>
  );
}
