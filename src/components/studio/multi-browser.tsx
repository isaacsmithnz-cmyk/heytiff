"use client";

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import type { DataPack, IndoorUnit, Phase } from "@/lib/studio/packs/schema";
import type { SizingBasis } from "@/lib/studio/loads";
import { proposeMultiOdus, type MultiOduProposal } from "@/lib/studio/multi";

/* Multi-split pickers (Stage 5) — two LEAN portal dialogs sharing the unit
   browser's chrome (`.ds-ub` classes, `lean` size modifier):

   The per-room indoor picker used to live here too. It could only ever see
   ONE room, so assigning a whole system meant opening it once per room; the
   main unit browser now does that job in per-room mode, listing every room
   down its right-hand column. Its eligibility rules did not go with it —
   they were always multi.ts's (multiCapableIdus / multiUnitOptions).

   - MultiOduPicker: the SHARED outdoor. Every multi-ready outdoor judged
     against the currently chosen indoor set — ports, whitelist, per-port
     limits — fitting units first; a unit that doesn't fit stays choosable
     (the cockpit surfaces the findings) but wears a "won't fit" tag.

   Rendered through a PORTAL to body — the dashboard shell's .page transform
   breaks position:fixed inside it (project modal rule). */

function PhasePill({ phase }: { phase: Phase }) {
  return (
    <span
      className={`ds-ub-phase${phase === "3" ? " p3" : ""}`}
      title={phase === "3" ? "Three phase" : "Single phase"}
    >
      {phase === "3" ? "3φ" : "1φ"}
    </span>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/* ─────────────────────── indoor unit (per room) ─────────────────────── */

/* ─────────────────────── shared outdoor unit ─────────────────────── */

export function MultiOduPicker({
  pack,
  idus,
  basis,
  requiredKw,
  current,
  onChoose,
  onClose,
}: {
  pack: DataPack;
  /** the currently chosen indoor set — each proposal is judged against it */
  idus: IndoorUnit[];
  basis: SizingBasis;
  /** Σ served-room loads — picks the recommendation; null degrades gracefully */
  requiredKw: number | null;
  current?: string;
  onChoose: (proposal: MultiOduProposal) => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  const proposals = useMemo(
    () => proposeMultiOdus(pack, idus, basis, { requiredKw }),
    [pack, idus, basis, requiredKw]
  );

  const body = (
    <div className="ds-ub-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ds-ub lean" role="dialog" aria-modal="true" aria-label="Choose the shared outdoor unit">
        <header className="ds-ub-head">
          <div className="ds-ub-title">
            <b>Choose the shared outdoor</b>
            <span>
              {idus.length > 0
                ? `${idus.length} indoor unit${idus.length === 1 ? "" : "s"} to connect`
                : "No indoor units chosen yet"}
              {requiredKw != null && (
                <>
                  {" "}
                  · rooms need ≈ <b>{requiredKw.toFixed(1)} kW</b> · {basis}
                </>
              )}
            </span>
          </div>
          <button className="ds-ub-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="ds-ub-scroll">
          <table className="ds-ub-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Ports</th>
                <th>Capacity</th>
                <th>Power</th>
                <th aria-label="Choose" />
              </tr>
            </thead>
            <tbody>
              {proposals.map((p) => (
                <tr
                  key={p.odu.model}
                  className={`${p.recommended ? "rec" : ""}${p.odu.model === current ? " sel" : ""}`}
                  onClick={() => onChoose(p)}
                  title={
                    p.fits
                      ? undefined
                      : p.findings
                          .filter((f) => f.severity === "red")
                          .map((f) => f.message)
                          .join(" · ")
                  }
                >
                  <td className="ds-ub-model">
                    {p.odu.model}
                    {p.recommended && <em>suggested</em>}
                    {!p.fits && <em className="ds-mp-nofit">won&apos;t fit</em>}
                  </td>
                  <td>{p.ports}</td>
                  <td>{p.capacityKw.toFixed(1)} kW</td>
                  <td>
                    <PhasePill phase={p.odu.phase} />
                  </td>
                  <td className="ds-mp-choose">
                    {p.odu.model === current ? "Chosen" : "Choose"}
                  </td>
                </tr>
              ))}
              {proposals.length === 0 && (
                <tr>
                  <td colSpan={5} className="ds-ub-none">
                    No multi-ready outdoor units in this pack.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
