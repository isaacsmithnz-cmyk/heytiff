"use client";

/* SCALE AND NORTH, ONCE FOR THE SET (the next flow, board 2 of the Studio
   rework mocks). It sits in the right column beside the plan, never over it,
   and replaces the per-floor "Calibrate the plan" and "Set north direction"
   prompts. The scale comes from the title block when the page prints one;
   measuring two points stays one press away, and either answer reaches every
   floor of the set (plan-set.ts). Works the same with Tiff off: nothing here
   asks her anything. */

import type { DesignDocument } from "@/lib/studio/document";
import { applyNorthToSet, applyScaleToSet, proposedScale, setOf, sheetTitleOf, wordsOfFloor } from "@/lib/studio/plan-set";

const mm = (v: number) => `${(Math.round(v * 100) / 100).toFixed(2)} mm`;

export function SetupPanel({
  doc,
  floorId,
  onMutate,
  onMeasure,
  onTurnNorth,
  onDone,
}: {
  doc: DesignDocument;
  floorId: string;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  /** arm the two-point measure on the plan */
  onMeasure: () => void;
  /** arm north, to drop or turn the arrow on the plan */
  onTurnNorth: () => void;
  onDone: () => void;
}) {
  const floor = doc.floors.find((f) => f.id === floorId);
  if (!floor) return null;
  const set = setOf(doc, floorId).map((id) => doc.floors.find((f) => f.id === id)!).filter(Boolean);
  const proposal = proposedScale(doc, floorId);
  const title = sheetTitleOf(wordsOfFloor(doc, floorId));
  const scaled = floor.scaleMmPerUnit != null;
  const fromBlock = scaled && proposal && Math.abs(floor.scaleMmPerUnit! - proposal.mmPerUnit) < 1e-6;
  const faced = floor.northDeg != null;
  const ready = set.every((f) => f.scaleMmPerUnit != null && f.northDeg != null);

  return (
    <section className="ds-su" aria-label="Scale and north">
      <div className="ds-su-head">
        <h2>Scale and north</h2>
      </div>
      <p className="ds-su-sub">
        {set.length > 1 ? `For the whole set: ${set.map((f) => f.name).join(" and ")}` : `For ${floor.name}`}
      </p>

      <div className="ds-su-grp">
        <div className="ds-su-row">
          <span className="k">Scale</span>
          <span className="v">
            {scaled ? (
              <>
                <b>{mm(floor.scaleMmPerUnit!)}</b> a pixel
              </>
            ) : proposal ? (
              <>
                <b>{`1:${proposal.scale.ratio} at ${proposal.scale.paper}`}</b>
              </>
            ) : (
              "Not set"
            )}
          </span>
        </div>
        {scaled ? (
          <div className="ds-su-row">
            <span className="k">From</span>
            <span className="v">
              {fromBlock
                ? `${proposal!.scale.text}, ${title ? `${title.number}'s` : "the"} title block`
                : "Measured on the plan"}
            </span>
          </div>
        ) : proposal ? (
          <div className="ds-su-row">
            <span className="k">From</span>
            <span className="v">
              {title ? `${title.number}'s` : "The"} title block, {mm(proposal.mmPerUnit)} a pixel
            </span>
          </div>
        ) : null}
        <div className="ds-su-acts">
          {!scaled && proposal && (
            <button
              type="button"
              className="ds-su-main"
              onClick={() => onMutate((d) => applyScaleToSet(d, floorId, proposal.mmPerUnit))}
            >
              Use {`1:${proposal.scale.ratio} at ${proposal.scale.paper}`}
            </button>
          )}
          <button type="button" className={!scaled && !proposal ? "ds-su-main" : "ds-su-second"} onClick={onMeasure}>
            {scaled ? "Measure again" : "Measure two points"}
          </button>
        </div>
      </div>

      <div className="ds-su-grp">
        <div className="ds-su-row">
          <span className="k">North</span>
          <span className="v">
            {faced ? (floor.northDeg === 0 ? <b>Up the page</b> : <b>{Math.round(floor.northDeg!)}° from up the page</b>) : "Not set"}
          </span>
        </div>
        <div className="ds-su-acts">
          {!faced && (
            <button
              type="button"
              className={scaled ? "ds-su-main" : "ds-su-second"}
              onClick={() => onMutate((d) => applyNorthToSet(d, floorId, 0))}
            >
              North is up the page
            </button>
          )}
          <button type="button" className="ds-su-second" onClick={onTurnNorth}>
            Turn north on the plan
          </button>
        </div>
      </div>

      <div className="ds-su-fill" />
      {ready && (
        <button type="button" className="ds-su-main" onClick={onDone}>
          Done
        </button>
      )}
    </section>
  );
}
