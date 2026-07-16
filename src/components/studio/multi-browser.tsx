"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import type { DataPack, FormFactor, IndoorUnit, Phase } from "@/lib/studio/packs/schema";
import type { SizingBasis } from "@/lib/studio/loads";
import { FORM_FACTOR_LABELS } from "@/lib/studio/select";
import {
  proposeMultiIdus,
  proposeMultiOdus,
  MULTI_OVERSIZE_CAP,
  type MultiIduProposal,
  type MultiOduProposal,
} from "@/lib/studio/multi";

/* Multi-split pickers (Stage 5) — two LEAN portal dialogs sharing the unit
   browser's chrome (`.ds-ub` classes, `lean` size modifier):

   - MultiIduPicker: one indoor unit for ONE room. Multi-capable models only
     (derived from multi_rules — see multi.ts), gated by the room load with
     the same 150% oversize toggle as the big browser, form-factor tabs.
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

const dims = (u: IndoorUnit): string =>
  `${u.width_mm} × ${u.depth_mm} × ${u.height_mm} mm`;

/* ─────────────────────── indoor unit (per room) ─────────────────────── */

export function MultiIduPicker({
  pack,
  loadKw,
  basis,
  current,
  onChoose,
  onClose,
}: {
  pack: DataPack;
  /** the room's load — null (uncalibrated) shows the full capable catalogue */
  loadKw: number | null;
  basis: SizingBasis;
  /** the room's currently chosen model, ticked in the list */
  current?: string;
  onChoose: (idu: IndoorUnit) => void;
  onClose: () => void;
}) {
  const [includeOversized, setIncludeOversized] = useState(false);
  const [tab, setTab] = useState<FormFactor | null>(null);
  useEscape(onClose);

  const proposals = useMemo(
    () => proposeMultiIdus(pack, loadKw, basis, { includeOversized }),
    [pack, loadKw, basis, includeOversized]
  );

  /* form-factor tabs from what actually qualifies, browser order */
  const tabs = useMemo(() => {
    const counts = new Map<FormFactor, number>();
    for (const p of proposals)
      counts.set(p.idu.form_factor, (counts.get(p.idu.form_factor) ?? 0) + 1);
    return (Object.keys(FORM_FACTOR_LABELS) as FormFactor[])
      .filter((f) => counts.has(f))
      .map((f) => ({ formFactor: f, label: FORM_FACTOR_LABELS[f], count: counts.get(f)! }));
  }, [proposals]);

  const activeTab = tab && tabs.some((t) => t.formFactor === tab) ? tab : (tabs[0]?.formFactor ?? null);
  const rows = proposals.filter((p) => activeTab == null || p.idu.form_factor === activeTab);

  const body = (
    <div className="ds-ub-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ds-ub lean" role="dialog" aria-modal="true" aria-label="Choose an indoor unit">
        <header className="ds-ub-head">
          <div className="ds-ub-title">
            <b>Choose an indoor unit</b>
            {loadKw != null ? (
              <span>
                Room load ≈ <b>{loadKw.toFixed(1)} kW</b> · {basis} · showing up to{" "}
                {Math.round(MULTI_OVERSIZE_CAP * 100)}%
              </span>
            ) : (
              <span>Room load unknown — full multi-capable catalogue</span>
            )}
          </div>
          {loadKw != null && (
            <label className="ds-ub-oversize">
              <input
                type="checkbox"
                checked={includeOversized}
                onChange={(e) => setIncludeOversized(e.target.checked)}
              />
              Include oversized
            </label>
          )}
          <button className="ds-ub-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>

        {tabs.length > 1 && (
          <nav className="ds-ub-tabs">
            {tabs.map((t) => (
              <button
                key={t.formFactor}
                className={t.formFactor === activeTab ? "on" : ""}
                onClick={() => setTab(t.formFactor)}
              >
                {t.label}
                <span className="ds-ub-count">{t.count}</span>
              </button>
            ))}
          </nav>
        )}

        <div className="ds-ub-scroll">
          <table className="ds-ub-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Capacity</th>
                <th>W × D × H</th>
                <th aria-label="Choose" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p: MultiIduProposal) => (
                <tr
                  key={p.idu.model}
                  className={`${p.recommended ? "rec" : ""}${p.idu.model === current ? " sel" : ""}`}
                  onClick={() => onChoose(p.idu)}
                >
                  <td className="ds-ub-model">
                    {p.idu.model}
                    {p.recommended && <em>best fit</em>}
                  </td>
                  <td>{p.capacityKw.toFixed(1)} kW</td>
                  <td>{dims(p.idu)}</td>
                  <td className="ds-mp-choose">
                    {p.idu.model === current ? "Chosen" : "Choose"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="ds-ub-none">
                    Nothing covers this load — include oversized units, or check the
                    pack&apos;s multi rules.
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
