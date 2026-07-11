"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  UNIT_SPECS,
  loadColumnIds,
  saveColumnIds,
  type UnitSpec,
} from "@/lib/studio/unit-specs";
import type { PairProposal } from "@/lib/studio/split";
import type { PlacingUnit } from "./canvas";

/* one unit staged for comparison — self-contained (brand + option + chosen
   pair) so the comparison survives brand switches and never re-reads a pack */
type CompareEntry = { key: string; brand: string; option: UnitOption; pair: PairProposal };

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
  /** group the table by product series (e.g. AP, EF) — an aid, toggleable off */
  const [groupBySeries, setGroupBySeries] = useState(true);
  /** the installer's chosen spec columns (persisted per-device) */
  const [columnIds, setColumnIds] = useState<string[]>(() => loadColumnIds());
  const toggleColumn = (id: string) =>
    setColumnIds((ids) => {
      const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      saveColumnIds(next);
      return next;
    });

  /* comparison set — up to 3 units, captured with their brand + chosen pair so
     the side-by-side survives switching the browser to another brand (each
     entry is self-contained; the overlay never re-reads a pack) */
  const [compare, setCompare] = useState<CompareEntry[]>([]);
  const [comparing, setComparing] = useState(false);
  const brandName =
    pack.brands.find((b) => b.id === pack.meta.brand)?.name ??
    pack.meta.name ??
    pack.meta.brand;
  const compareKey = (model: string) => `${brandName}::${model}`;
  const inCompare = (model: string) => compare.some((c) => c.key === compareKey(model));
  const COMPARE_MAX = 3;
  const toggleCompare = (o: UnitOption, pair: PairProposal) =>
    setCompare((cur) => {
      const key = compareKey(o.idu.model);
      if (cur.some((c) => c.key === key)) return cur.filter((c) => c.key !== key);
      if (cur.length >= COMPARE_MAX) return cur; // capped
      return [...cur, { key, brand: brandName, option: o, pair }];
    });

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
  /* spec columns to show: the enabled set, in registry order, minus any that
     don't apply to this form factor (e.g. airflow off the ducted tab) */
  const activeSpecs = UNIT_SPECS.filter(
    (s) => columnIds.includes(s.id) && (!s.only || s.only === activeTab)
  );
  /* the specs offered in the Columns menu for THIS tab (hide inapplicable ones) */
  const menuSpecs = UNIT_SPECS.filter((s) => !s.only || s.only === activeTab);
  // compare + Model + spec columns + Outdoor + Add
  const colSpan = 1 + 1 + activeSpecs.length + 2;

  /* group same-series rows adjacently, preserving the sorted order within each
     group and ordering groups by first appearance (keeps the recommended unit's
     series near the top). Headers only make sense with 2+ series. */
  const groups = useMemo(() => {
    const order: string[] = [];
    const bySeries = new Map<string, UnitOption[]>();
    for (const o of options) {
      const s = o.idu.series || "Other";
      if (!bySeries.has(s)) {
        bySeries.set(s, []);
        order.push(s);
      }
      bySeries.get(s)!.push(o);
    }
    return order.map((series) => ({ series, items: bySeries.get(series)! }));
  }, [options]);
  const showGroups = groupBySeries && groups.length > 1;

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

  /* Add straight from a comparison column (uses that entry's captured pair) */
  const chooseEntry = (e: CompareEntry) => {
    const unit = nextRole === "idu" ? e.pair.idu : e.pair.odu;
    onChoose(e.pair, {
      role: nextRole,
      model: unit.model,
      widthMm: unit.width_mm ?? 800,
      depthMm: unit.depth_mm ?? 300,
    });
  };

  const renderRow = (o: UnitOption) => {
    const pick = oduPick[o.idu.model] ?? 0;
    const pair = o.pairs[pick] ?? o.defaultPair;
    const checked = inCompare(o.idu.model);
    return (
      <tr key={o.idu.model} className={o.recommended ? "rec" : ""}>
        <td className="ds-ub-cmpcell">
          <input
            type="checkbox"
            checked={checked}
            disabled={!checked && compare.length >= COMPARE_MAX}
            onChange={() => toggleCompare(o, pair)}
            aria-label={`Compare ${o.idu.model}`}
            title={
              !checked && compare.length >= COMPARE_MAX
                ? `Comparing ${COMPARE_MAX} — remove one first`
                : "Add to comparison"
            }
          />
        </td>
        <td className="ds-ub-model">
          {o.idu.model}
          {o.recommended && <em>best fit</em>}
        </td>
        {activeSpecs.map((s) => (
          <td key={s.id}>{s.cell(o, pair)}</td>
        ))}
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
            Add
          </button>
        </td>
      </tr>
    );
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
          <div className="ds-ub-fright">
            {groups.length > 1 && (
              <label className="ds-ub-groupby">
                <input
                  type="checkbox"
                  checked={groupBySeries}
                  onChange={(e) => setGroupBySeries(e.target.checked)}
                />
                Group by series
              </label>
            )}
            <ColumnsMenu
              specs={menuSpecs}
              enabled={columnIds}
              onToggle={toggleColumn}
            />
          </div>
        </div>

        <div className="ds-ub-scroll">
          <table className="ds-ub-table">
            <thead>
              <tr>
                <th className="ds-ub-cmpcol" aria-label="Compare" />
                <th>Model</th>
                {activeSpecs.map((s) =>
                  s.sortKey ? (
                    <th
                      key={s.id}
                      className={`sortable${sort === s.sortKey ? " on" : ""}`}
                      onClick={() => setSort(s.sortKey!)}
                      title={`Sort by ${s.label.toLowerCase()}`}
                    >
                      {s.header}
                      {sort === s.sortKey && (
                        <span className="ds-ub-sortmark">
                          {s.sortKey === "airflow" ? "↓" : "↑"}
                        </span>
                      )}
                    </th>
                  ) : (
                    <th key={s.id}>{s.header}</th>
                  )
                )}
                <th>Outdoor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {showGroups
                ? groups.flatMap((g) => [
                    <tr key={`grp-${g.series}`} className="ds-ub-group">
                      <td colSpan={colSpan}>
                        {g.series}
                        <span className="ds-ub-count">{g.items.length}</span>
                      </td>
                    </tr>,
                    ...g.items.map(renderRow),
                  ])
                : options.map(renderRow)}
              {options.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="ds-ub-none">
                    Nothing matches these filters — loosen a limit or include
                    oversized units.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {compare.length > 0 && (
          <div className="ds-ub-cmpbar">
            <div className="ds-ub-cmpchips">
              <span className="ds-ub-cmplabel">Compare</span>
              {compare.map((c) => (
                <span key={c.key} className="ds-ub-cmpchip">
                  {c.option.idu.model}
                  <button
                    aria-label={`Remove ${c.option.idu.model} from comparison`}
                    onClick={() =>
                      setCompare((cur) => cur.filter((x) => x.key !== c.key))
                    }
                  >
                    <Icon name="x" size={11} />
                  </button>
                </span>
              ))}
            </div>
            <button className="ds-ub-cmpclear" onClick={() => setCompare([])}>
              Clear
            </button>
            <button
              className="ds-ub-cmpgo"
              disabled={compare.length < 2}
              onClick={() => setComparing(true)}
            >
              Compare {compare.length}
            </button>
          </div>
        )}
      </div>

      {comparing && (
        <CompareOverlay
          entries={compare}
          onAdd={chooseEntry}
          onRemove={(key) => setCompare((cur) => cur.filter((x) => x.key !== key))}
          onClose={() => setComparing(false)}
        />
      )}
    </div>
  );

  return createPortal(body, document.body);
}

/* Comparison overlay — up to 3 units side by side, every spec as a row (the
   full superset, not just the visible columns), best-in-row highlighted. Units
   can come from different brands. Portalled over the browser. */
function CompareOverlay({
  entries,
  onAdd,
  onRemove,
  onClose,
}: {
  entries: CompareEntry[];
  onAdd: (e: CompareEntry) => void;
  onRemove: (key: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="ds-cmp-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="ds-cmp" role="dialog" aria-modal="true" aria-label="Compare units">
        <header className="ds-cmp-head">
          <b>Compare units</b>
          <button className="ds-ub-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="ds-cmp-scroll">
          <table className="ds-cmp-table">
            <thead>
              <tr>
                <th />
                {entries.map((e) => (
                  <th key={e.key}>
                    <div className="ds-cmp-model">{e.option.idu.model}</div>
                    <div className="ds-cmp-brand">{e.brand}</div>
                    <button
                      className="ds-cmp-rm"
                      onClick={() => onRemove(e.key)}
                      aria-label={`Remove ${e.option.idu.model}`}
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {UNIT_SPECS.map((s) => {
                const vals = entries.map((e) =>
                  s.numeric ? s.numeric(e.option, e.pair) : null
                );
                const nums = vals.filter((v): v is number => v != null);
                const best =
                  s.better && nums.length > 1
                    ? s.better === "higher"
                      ? Math.max(...nums)
                      : Math.min(...nums)
                    : null;
                return (
                  <tr key={s.id}>
                    <th className="ds-cmp-rowh">
                      {s.label}
                      {s.unit && <span className="ds-cmp-unit"> {s.unit}</span>}
                    </th>
                    {entries.map((e, i) => (
                      <td
                        key={e.key}
                        className={best != null && vals[i] === best ? "best" : ""}
                      >
                        {s.cell(e.option, e.pair)}
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr>
                <th className="ds-cmp-rowh">Outdoor</th>
                {entries.map((e) => (
                  <td key={e.key}>{e.pair.odu.model}</td>
                ))}
              </tr>
              <tr className="ds-cmp-addrow">
                <th />
                {entries.map((e) => (
                  <td key={e.key}>
                    <button className="ds-ub-place" onClick={() => onAdd(e)}>
                      Add
                    </button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* Columns menu — the installer picks which spec columns they want in front of
   them; the choice persists per-device (see unit-specs.ts). */
function ColumnsMenu({
  specs,
  enabled,
  onToggle,
}: {
  specs: UnitSpec[];
  enabled: string[];
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="ds-ub-cols" ref={boxRef}>
      <button
        className="ds-ub-colsbtn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Choose which spec columns to show"
      >
        <Icon name="settings2" size={14} />
        Columns
        <Icon name="chevD" size={12} />
      </button>
      {open && (
        <div className="ds-ub-colsmenu" role="menu">
          <div className="ds-ub-colshead">Show columns</div>
          {specs.map((s) => (
            <label key={s.id} className="ds-ub-colsitem">
              <input
                type="checkbox"
                checked={enabled.includes(s.id)}
                onChange={() => onToggle(s.id)}
              />
              <span className="ds-ub-colsname">{s.label}</span>
              {s.unit && <span className="ds-ub-colsunit">{s.unit}</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
