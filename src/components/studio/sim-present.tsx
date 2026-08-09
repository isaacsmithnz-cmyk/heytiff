"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { DesignDocument, Floor } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import type { PlanImages } from "@/lib/studio/plans";
import type { SimRuntime } from "@/lib/studio/sim-runtime";
import { StudioCanvas, ALL_LAYERS_ON } from "./canvas";
import { SimControllerCard } from "./sim-controller";
import { SimHeaderStatus } from "./sim-info";

/* Present mode — a near-full-screen, PowerPoint-style takeover that runs the
   simulation on just the plan, with none of the editing chrome. Portalled to
   body (the shell's `.page` transform breaks position:fixed inside it — the
   dashboard modal rule), and given `.fg .dstudio` so both the shell tokens and
   the studio `ds-*` classes resolve out here. The canvas is the SAME
   StudioCanvas the editor uses, in read-only sim mode (`sim` set, `bare` on to
   drop the dot grid) — so the plan, room tints and airflow render identically,
   just full-bleed. Nothing here mutates the document. */

const noop = () => {};

/* pipes + the editing grid are hidden; the plan, its rooms (sim-tinted) and
   the air handlers (which the plumes emit from) are the presentation. */
const PRESENT_LAYERS = { ...ALL_LAYERS_ON, pipes: false };

export function SimPresentMode({
  doc,
  floor,
  planImages,
  activeSystemId,
  runtime,
  onExit,
}: {
  doc: DesignDocument;
  floor: Floor;
  pack: DataPack | null;
  planImages?: PlanImages;
  activeSystemId: string | null;
  runtime: SimRuntime;
  onExit: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  if (typeof document === "undefined") return null;

  const activeSystem = doc.systems.find((s) => s.id === activeSystemId) ?? null;

  return createPortal(
    <div className="fg dstudio ds-present" role="dialog" aria-label="Simulation presentation">
      <div className="ds-present-bar">
        <div className="ds-present-title">
          <span className="ds-present-name">{doc.meta.name || "Design"}</span>
          {activeSystem && (
            <span className="ds-present-sys">
              <span className="ds-present-dot" style={{ background: activeSystem.colour }} />
              {activeSystem.name}
            </span>
          )}
        </div>
        {/* operation status lives in the header, in line with the design/system */}
        <SimHeaderStatus runtime={runtime} activeSystemId={activeSystemId} />
        <button className="ds-present-exit" onClick={onExit} title="Exit presentation (Esc)">
          Exit
          <span aria-hidden>✕</span>
        </button>
      </div>

      <div className="ds-present-stage">
        <StudioCanvas
          key={`present-${floor.id}`}
          doc={doc}
          floor={floor}
          tool="select"
          selectedId={null}
          onSelect={noop}
          onMutate={noop}
          onToolDone={noop}
          planImages={planImages}
          activeSystemId={activeSystemId}
          layers={PRESENT_LAYERS}
          sim={runtime}
          bare
        />
        {/* the movable control panel (draggable by its header) */}
        <SimControllerCard runtime={runtime} onExit={onExit} />
      </div>
    </div>,
    document.body
  );
}
