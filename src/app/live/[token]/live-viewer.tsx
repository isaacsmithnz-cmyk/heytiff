"use client";

import { useEffect, useMemo, useState } from "react";
import type { DesignDocument } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import { floorDisplayName, type PlanImages } from "@/lib/studio/plans";
import { buildSimModel } from "@/lib/studio/sim";
import { SimRuntime } from "@/lib/studio/sim-runtime";
import { StudioCanvas, ALL_LAYERS_ON } from "@/components/studio/canvas";
import { SimControllerCard } from "@/components/studio/sim-controller";
import { SimHeaderStatus } from "@/components/studio/sim-info";
import { BrandMark } from "@/components/org/letterhead";
import type { OrgBrand } from "@/lib/org/brand";
import "@/components/studio/studio.css";

/* The customer-facing simulation — present mode as a whole page. Same canvas,
   same controller, same header status as the studio's presentation, minus
   every way in: onMutate is a noop and the PlanImages adapter can only READ
   the URLs the server signed. The customer can drive the simulation
   (setpoints, mode, outdoor temperature) — the model itself never changes, so
   there is nothing to break.

   IT IS NO LONGER THE DESTINATION. The link lands on the design sheet, and
   this opens from it — and only where the design has been ticked as fit to
   show (sim-approval.ts). So it has a way back, which it never used to need. */

const noop = () => {};
/* pipes stay hidden like present mode — the plan, tinted rooms and units
   are the show */
const LIVE_LAYERS = { ...ALL_LAYERS_ON, pipes: false };

/** resolves refs from the server-signed map; every write path rejects */
function staticPlanImages(map: Record<string, string>): PlanImages {
  const deny = () => Promise.reject(new Error("read-only viewer"));
  return {
    url: (ref: string) =>
      map[ref]
        ? Promise.resolve(map[ref])
        : Promise.reject(new Error("unknown plan ref")),
    upload: deny,
    uploadSource: deny,
    sourceFile: deny,
    remove: deny,
  };
}

export function LiveViewer({
  doc,
  pack,
  planUrls,
  brand,
  onExit,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  planUrls: Record<string, string>;
  /* WHO SENT THE LINK. This corner said "HeyTiff" — the name of the software,
     to a customer who is here because a particular business sent them a
     drawing of their own house. It is that business now, with HeyTiff as the
     fallback for a workspace that has set neither a name nor a logo, so
     nothing regresses for an org that has not filled the page in. */
  brand: OrgBrand;
  /** back to the sheet this opened from */
  onExit: () => void;
}) {
  /* open on the first floor that actually simulates; fall back to the first */
  const startFloorId = useMemo(() => {
    for (const f of doc.floors)
      if (buildSimModel(doc, pack, f.id).handlers.length > 0) return f.id;
    return doc.floors[0]?.id ?? null;
  }, [doc, pack]);
  const [floorId, setFloorId] = useState(startFloorId);
  const floor = doc.floors.find((f) => f.id === floorId) ?? null;

  const [runtime] = useState(() =>
    startFloorId ? new SimRuntime(doc, pack, startFloorId, 5) : null
  );
  /* floor switches re-derive in place — temps and settings carry by id */
  useEffect(() => {
    if (runtime && floorId) runtime.rebuild(doc, pack, floorId);
  }, [runtime, doc, pack, floorId]);

  const planImages = useMemo(() => staticPlanImages(planUrls), [planUrls]);
  const activeSystemId = doc.systems[0]?.id ?? null;

  /* Esc goes back, as it does in the studio's own present mode — the same
     gesture on the same screen should not mean two different things */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  if (!floor || !runtime)
    return (
      <div className="ds-live-404">
        <span className="ds-live-brand">
          <BrandMark brand={brand} fallback="HeyTiff" />
        </span>
        <h1>Nothing to show yet</h1>
        <p>This design has no floors — check back once it has been drawn.</p>
        <button className="ds-live-back" onClick={onExit}>
          Back to the design
        </button>
      </div>
    );

  return (
    <div
      className="fg dstudio ds-present ds-live"
      role="main"
      aria-label="Live design"
    >
      <div className="ds-present-bar">
        <div className="ds-present-title">
          <span className="ds-live-brand">
            <BrandMark brand={brand} fallback="HeyTiff" />
          </span>
          <span className="ds-present-name">{doc.meta.name || "Design"}</span>
        </div>
        <SimHeaderStatus runtime={runtime} activeSystemId={activeSystemId} />
        {doc.floors.length > 1 && (
          <div className="ds-live-floors" role="tablist" aria-label="Floors">
            {doc.floors.map((f) => (
              <button
                key={f.id}
                className={`ds-live-floor${f.id === floorId ? " on" : ""}`}
                onClick={() => setFloorId(f.id)}
                aria-pressed={f.id === floorId}
              >
                {floorDisplayName(f)}
              </button>
            ))}
          </div>
        )}
        {/* the way back sits where present mode's Exit does, and says where it
            goes: the customer came from the design, not from nowhere */}
        <button
          className="ds-present-exit"
          onClick={onExit}
          title="Back to the design (Esc)"
        >
          Back to the design
          <span aria-hidden>✕</span>
        </button>
      </div>

      <div className="ds-present-stage">
        <StudioCanvas
          key={`live-${floor.id}`}
          doc={doc}
          floor={floor}
          tool="select"
          selectedId={null}
          onSelect={noop}
          onMutate={noop}
          onToolDone={noop}
          planImages={planImages}
          activeSystemId={activeSystemId}
          layers={LIVE_LAYERS}
          sim={runtime}
          bare
        />
        {/* interactive controller. No exit ON THE CARD: the way back lives in
            the bar, where the customer's eye already is for the floor tabs. */}
        <SimControllerCard runtime={runtime} />
      </div>
    </div>
  );
}
