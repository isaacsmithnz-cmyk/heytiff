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
import "@/components/studio/studio.css";

/* The customer-facing viewer — present mode as a whole page. Same canvas,
   same controller, same header status as the studio's presentation, minus
   every way out or in: onMutate is a noop, the controller has no exit, and
   the PlanImages adapter can only READ the URLs the server signed. The
   customer can drive the simulation (setpoints, mode, outdoor temperature) —
   the model itself never changes, so there is nothing to break. */

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
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  planUrls: Record<string, string>;
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

  if (!floor || !runtime)
    return (
      <div className="ds-live-404">
        <span className="ds-live-brand">HeyTiff</span>
        <h1>Nothing to show yet</h1>
        <p>This design has no floors — check back once it has been drawn.</p>
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
          <span className="ds-live-brand">HeyTiff</span>
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
        {/* interactive controller, no exit — this page IS the destination */}
        <SimControllerCard runtime={runtime} />
      </div>
    </div>
  );
}
