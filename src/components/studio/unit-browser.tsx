"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import type { DataPack, FormFactor } from "@/lib/studio/packs/schema";
import type { SizingBasis } from "@/lib/studio/loads";
import {
  unitOptions,
  formFactorSummary,
  OVERSIZE_CAP,
  type SelectFilters,
  type SelectSort,
  type UnitOption,
} from "@/lib/studio/select";
import type { PairProposal } from "@/lib/studio/split";
import type { PlacingUnit } from "./canvas";

/* Unit browser (Stage 4 selector overhaul) — model-first selection: form
   factor tabs, capacity as a gate (load → 150%, toggleable), then fit filters
   (W×D×H, airflow) and sortable columns. Rendered through a PORTAL to body:
   the dashboard shell's .page transform breaks position:fixed for anything
   rendered inside it (see project modal rule). */

export function UnitBrowser({
  pack,
  loadKw,
  basis,
  nextRole,
  onChoose,
  onClose,
}: {
  pack: DataPack;
  loadKw: number | null;
  basis: SizingBasis;
  /** which unit the next canvas click will place */
  nextRole: "idu" | "odu";
  /** commit the chosen pairing and arm placement */
  onChoose: (pair: PairProposal, placing: PlacingUnit) => void;
  onClose: () => void;
}) {
  const [includeOversized, setIncludeOversized] = useState(false);
  const [filters, setFilters] = useState<SelectFilters>({});
  const [sort, setSort] = useState<SelectSort>("capacity");
  /** per-IDU chosen outdoor (index into option.pairs) */
  const [oduPick, setOduPick] = useState<Record<string, number>>({});

  const tabs = useMemo(
    () => formFactorSummary(pack, loadKw, basis, includeOversized),
    [pack, loadKw, basis, includeOversized]
  );

  /** default tab: the recommended option's form factor, else the first tab */
  const [tab, setTab] = useState<FormFactor | null>(null);
  const activeTab = useMemo(() => {
    if (tab && tabs.some((t) => t.formFactor === tab && t.count > 0)) return tab;
    if (loadKw != null) {
      const all = unitOptions(pack, { loadKw, basis, formFactor: null, includeOversized });
      const rec = all.find((o) => o.recommended);
      if (rec) return rec.idu.form_factor;
    }
    return tabs[0]?.formFactor ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, tabs, pack, loadKw, basis, includeOversized]);

  const options = useMemo(
    () =>
      unitOptions(pack, {
        loadKw,
        basis,
        formFactor: activeTab,
        filters,
        sort,
        includeOversized,
      }),
    [pack, loadKw, basis, activeTab, filters, sort, includeOversized]
  );

  const isDucted = activeTab === "ducted";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const numInput = (key: keyof SelectFilters, placeholder: string) => (
    <input
      inputMode="numeric"
      placeholder={placeholder}
      value={filters[key] ?? ""}
      onChange={(e) => {
        const v = parseInt(e.target.value, 10);
        setFilters((f) => ({ ...f, [key]: Number.isFinite(v) ? v : undefined }));
      }}
    />
  );

  const sortHeader = (key: SelectSort, label: string) => (
    <th
      className={`sortable${sort === key ? " on" : ""}`}
      onClick={() => setSort(key)}
      title={`Sort by ${label.toLowerCase()}`}
    >
      {label}
      {sort === key && <span className="ds-ub-sortmark">{key === "airflow" ? "↓" : "↑"}</span>}
    </th>
  );

  const choose = (o: UnitOption) => {
    const pair = o.pairs[oduPick[o.idu.model] ?? 0] ?? o.defaultPair;
    const unit = nextRole === "idu" ? pair.idu : pair.odu;
    onChoose(pair, {
      role: nextRole,
      model: unit.model,
      widthMm: unit.width_mm ?? 800,
      depthMm: unit.depth_mm ?? 300,
    });
  };

  const body = (
    <div className="ds-ub-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ds-ub" role="dialog" aria-modal="true" aria-label="Choose a unit">
        <header className="ds-ub-head">
          <div className="ds-ub-title">
            <b>Choose a unit</b>
            {loadKw != null ? (
              <span>
                Room load ≈ <b>{loadKw.toFixed(1)} kW</b> · {basis} · showing up to{" "}
                {Math.round(OVERSIZE_CAP * 100)}%
              </span>
            ) : (
              <span>No room selected — full catalogue</span>
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

        <nav className="ds-ub-tabs">
          {tabs.map((t) => (
            <button
              key={t.formFactor}
              className={t.formFactor === activeTab ? "on" : ""}
              disabled={t.count === 0}
              onClick={() => setTab(t.formFactor)}
            >
              {t.label}
              <span className="ds-ub-count">{t.count}</span>
            </button>
          ))}
        </nav>

        <div className="ds-ub-filters">
          <span className="ds-ub-flabel">Fits within</span>
          <label>W ≤ {numInput("maxWidthMm", "mm")}</label>
          <label>D ≤ {numInput("maxDepthMm", "mm")}</label>
          <label>H ≤ {numInput("maxHeightMm", "mm")}</label>
          {isDucted && <label>Airflow ≥ {numInput("minAirflowLs", "L/s")}</label>}
          {Object.values(filters).some((v) => v != null) && (
            <button className="ds-ub-reset" onClick={() => setFilters({})}>
              Reset
            </button>
          )}
        </div>

        <div className="ds-ub-scroll">
          <table className="ds-ub-table">
            <thead>
              <tr>
                <th>Model</th>
                {sortHeader("capacity", "Cool / Heat")}
                {sortHeader("width", "W mm")}
                {sortHeader("depth", "D mm")}
                {sortHeader("height", "H mm")}
                {isDucted && sortHeader("airflow", "Airflow")}
                <th>Outdoor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {options.map((o) => {
                const pick = oduPick[o.idu.model] ?? 0;
                const pair = o.pairs[pick] ?? o.defaultPair;
                return (
                  <tr key={o.idu.model} className={o.recommended ? "rec" : ""}>
                    <td className="ds-ub-model">
                      {o.idu.model}
                      {o.recommended && <em>best fit</em>}
                    </td>
                    <td>
                      {pair.coolKw} / {pair.heatKw} kW
                    </td>
                    <td>{o.idu.width_mm}</td>
                    <td>{o.idu.depth_mm}</td>
                    <td>{o.idu.height_mm}</td>
                    {isDucted && <td>{o.idu.airflow_ls ?? "—"} L/s</td>}
                    <td>
                      {o.pairs.length > 1 ? (
                        <select
                          value={pick}
                          aria-label={`Outdoor unit for ${o.idu.model}`}
                          onChange={(e) =>
                            setOduPick((m) => ({
                              ...m,
                              [o.idu.model]: parseInt(e.target.value, 10),
                            }))
                          }
                        >
                          {o.pairs.map((p, i) => (
                            <option key={p.odu.model} value={i}>
                              {p.odu.model} · max {p.pair.max_length_m} m
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="ds-ub-odu">{pair.odu.model}</span>
                      )}
                    </td>
                    <td>
                      <button className="ds-ub-place" onClick={() => choose(o)}>
                        Place
                      </button>
                    </td>
                  </tr>
                );
              })}
              {options.length === 0 && (
                <tr>
                  <td colSpan={isDucted ? 8 : 7} className="ds-ub-none">
                    Nothing matches these filters — loosen a limit or include
                    oversized units.
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
