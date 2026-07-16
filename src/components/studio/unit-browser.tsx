"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import type { DataPack, FormFactor, Phase } from "@/lib/studio/packs/schema";
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
  COLUMN_SPECS,
  SPEC_GROUP_LABELS,
  specsInGroup,
  loadColumnIds,
  saveColumnIds,
  type SpecGroup,
  type UnitSpec,
} from "@/lib/studio/unit-specs";
import type { PairProposal } from "@/lib/studio/split";

/* one unit staged for comparison — self-contained (brand + option + chosen
   pair) so the comparison survives brand switches and never re-reads a pack */
type CompareEntry = { key: string; brand: string; option: UnitOption; pair: PairProposal };

/* Unit browser (Stage 5 overhaul) — model-first selection: form factor tabs,
   capacity as a gate (load → 150%, toggleable), a supply-phase filter, then
   fit filters (W×D×H, airflow) and sortable columns. Two panes: a lean table
   of indoor models on the left, and a detail panel on the right showing the
   highlighted option's full spec sheet — Indoor unit / Outdoor unit / Pairing
   — with the outdoor pairing picked there (phase badges), not in the row.
   Rendered through a PORTAL to body: the dashboard shell's .page transform
   breaks position:fixed for anything rendered inside it (see project modal
   rule). */

/** Required-capacity band (ducted AHU flow): a pair reads "in range" from the
    required figure up to ~135% of it — the same oversize spirit as the
    browser's 150% gate, tighter so the badge stays meaningful. */
export const REQUIRED_BAND_CAP = 1.35;

export function UnitBrowser({
  pack,
  loadKw,
  basis,
  onChoose,
  onClose,
  initialFormFactor,
  requiredKw,
}: {
  pack: DataPack;
  loadKw: number | null;
  basis: SizingBasis;
  /** commit the chosen pairing (the host arms placement via its drag cards) */
  onChoose: (pair: PairProposal) => void;
  onClose: () => void;
  /** open on this form-factor tab while it has options (ducted AHU flow) */
  initialFormFactor?: FormFactor | null;
  /** highlight — never filter — pairs sized within REQUIRED_BAND_CAP of this */
  requiredKw?: number | null;
}) {
  const [includeOversized, setIncludeOversized] = useState(false);
  const [filters, setFilters] = useState<SelectFilters>({});
  const [sort, setSort] = useState<SelectSort>("capacity");
  /** outdoor supply phase filter — null = any */
  const [phase, setPhase] = useState<Phase | null>(null);
  /** per-IDU chosen outdoor, keyed by ODU MODEL (indices shift when the phase
      filter narrows the pairs array — a model key can never silently swap) */
  const [oduPick, setOduPick] = useState<Record<string, string>>({});
  /** the highlighted row — the detail panel's subject */
  const [selected, setSelected] = useState<string | null>(null);
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
    () => formFactorSummary(pack, loadKw, basis, includeOversized, phase),
    [pack, loadKw, basis, includeOversized, phase]
  );

  /** default tab: the caller's requested form factor, else the recommended
      option's, else the first tab */
  const [tab, setTab] = useState<FormFactor | null>(initialFormFactor ?? null);
  const activeTab = useMemo(() => {
    if (tab && tabs.some((t) => t.formFactor === tab && t.count > 0)) return tab;
    if (loadKw != null) {
      const all = unitOptions(pack, {
        loadKw,
        basis,
        formFactor: null,
        phase,
        includeOversized,
      });
      const rec = all.find((o) => o.recommended);
      if (rec) return rec.idu.form_factor;
    }
    return tabs[0]?.formFactor ?? null;
  }, [tab, tabs, pack, loadKw, basis, phase, includeOversized]);

  const options = useMemo(
    () =>
      unitOptions(pack, {
        loadKw,
        basis,
        formFactor: activeTab,
        phase,
        filters,
        sort,
        includeOversized,
      }),
    [pack, loadKw, basis, activeTab, phase, filters, sort, includeOversized]
  );

  const isDucted = activeTab === "ducted";
  /* spec columns to show: the enabled set, in registry order, minus any that
     don't apply to this form factor (e.g. airflow off the ducted tab) */
  const activeSpecs = COLUMN_SPECS.filter(
    (s) => columnIds.includes(s.id) && (!s.only || s.only === activeTab)
  );
  /* the specs offered in the Columns menu for THIS tab (hide inapplicable ones) */
  const menuSpecs = COLUMN_SPECS.filter((s) => !s.only || s.only === activeTab);
  // compare + Model + spec columns + Outdoor
  const colSpan = 1 + 1 + activeSpecs.length + 1;

  /** the option's outdoor pairing: the picked model if it still qualifies
      under the current filters, else the first surviving pairing */
  const pairFor = (o: UnitOption): PairProposal =>
    o.pairs.find((p) => p.odu.model === oduPick[o.idu.model]) ?? o.defaultPair;

  const inRequiredBand = (p: PairProposal): boolean =>
    requiredKw != null &&
    p.capacityKw >= requiredKw &&
    p.capacityKw <= requiredKw * REQUIRED_BAND_CAP;

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

  /* rows in on-screen order (series grouping reorders) — keyboard nav + the
     selection fallback both follow what the installer actually sees */
  const visibleOptions = useMemo(
    () => (showGroups ? groups.flatMap((g) => g.items) : options),
    [showGroups, groups, options]
  );

  /** the row the detail panel shows: the clicked one while it survives the
      current filters, else the recommended row, else the first row */
  const selectedOption = useMemo(() => {
    return (
      visibleOptions.find((o) => o.idu.model === selected) ??
      visibleOptions.find((o) => o.recommended) ??
      visibleOptions[0] ??
      null
    );
  }, [visibleOptions, selected]);

  const choose = (o: UnitOption) => onChoose(pairFor(o));

  /* Add straight from a comparison column (uses that entry's captured pair) */
  const chooseEntry = (e: CompareEntry) => onChoose(e.pair);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (comparing) return; // the compare overlay owns the keys while open
      if (e.key === "Escape") return onClose();
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((cur) => {
          const list = visibleOptions;
          if (!list.length) return cur;
          const curModel =
            cur && list.some((o) => o.idu.model === cur)
              ? cur
              : (list.find((o) => o.recommended) ?? list[0]).idu.model;
          const idx = list.findIndex((o) => o.idu.model === curModel);
          const next =
            list[Math.min(list.length - 1, Math.max(0, idx + (e.key === "ArrowDown" ? 1 : -1)))];
          return next.idu.model;
        });
      } else if (e.key === "Enter" && selectedOption) {
        e.preventDefault();
        choose(selectedOption);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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

  const renderRow = (o: UnitOption) => {
    const pair = pairFor(o);
    const checked = inCompare(o.idu.model);
    const isSel = selectedOption?.idu.model === o.idu.model;
    const band = inRequiredBand(pair);
    return (
      <tr
        key={o.idu.model}
        className={`${o.recommended ? "rec" : ""}${isSel ? " sel" : ""}${band ? " band" : ""}`}
        aria-selected={isSel}
        onClick={() => setSelected(o.idu.model)}
      >
        <td className="ds-ub-cmpcell" onClick={(e) => e.stopPropagation()}>
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
          {band && !o.recommended && (
            <em className="ds-ub-inband" title="Within the required capacity band">
              in range
            </em>
          )}
        </td>
        {activeSpecs.map((s) => (
          <td key={s.id}>{s.cell(o, pair)}</td>
        ))}
        <td className="ds-ub-oducell">
          <span className="ds-ub-odu">{pair.odu.model}</span>
          <PhaseBadge phase={pair.odu.phase} />
          {o.pairs.length > 1 && (
            <span
              className="ds-ub-morepairs"
              title={`${o.pairs.length - 1} more outdoor pairing${o.pairs.length > 2 ? "s" : ""} — pick in the panel`}
            >
              +{o.pairs.length - 1}
            </span>
          )}
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
                {requiredKw != null ? "Requires" : "Room load"} ≈ <b>{loadKw.toFixed(1)} kW</b>{" "}
                · {basis} · showing up to {Math.round(OVERSIZE_CAP * 100)}%
              </span>
            ) : (
              <span>No room selected — full catalogue</span>
            )}
          </div>
          <div className="ds-ub-powerseg" role="group" aria-label="Power">
            <span className="ds-ub-seglabel">Power</span>
            <button
              className={phase === null ? "on" : ""}
              onClick={() => setPhase(null)}
              title="Any supply phase"
            >
              Any
            </button>
            <button
              className={phase === "1" ? "on" : ""}
              onClick={() => setPhase("1")}
              title="Single phase outdoor units only"
            >
              1φ
            </button>
            <button
              className={phase === "3" ? "on" : ""}
              onClick={() => setPhase("3")}
              title="Three phase outdoor units only"
            >
              3φ
            </button>
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
            <ColumnsMenu specs={menuSpecs} enabled={columnIds} onToggle={toggleColumn} />
          </div>
        </div>

        <div className="ds-ub-body">
          <div className="ds-ub-main">
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
                        {phase != null
                          ? `No ${phase === "3" ? "three" : "single"}-phase pairings match — set Power to Any or loosen a filter.`
                          : "Nothing matches these filters — loosen a limit or include oversized units."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="ds-ub-detail">
            {selectedOption ? (
              <DetailPanel
                option={selectedOption}
                pair={pairFor(selectedOption)}
                onPickOdu={(oduModel) =>
                  setOduPick((m) => ({ ...m, [selectedOption.idu.model]: oduModel }))
                }
                onAdd={() => choose(selectedOption)}
              />
            ) : (
              <div className="ds-ub-dempty">Select a unit to see its full spec sheet.</div>
            )}
          </aside>
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

/* supply-phase pill — 1φ neutral, 3φ amber so a three-phase unit is never
   mistaken for the common single-phase case */
function PhaseBadge({ phase }: { phase: Phase }) {
  return (
    <span
      className={`ds-ub-phase${phase === "3" ? " p3" : ""}`}
      title={phase === "3" ? "Three phase" : "Single phase"}
    >
      {phase === "3" ? "3φ" : "1φ"}
    </span>
  );
}

/* outdoor pairing picker — the qualifying outdoor units for one indoor model,
   radio semantics, each with its phase badge, capacity and max run */
function OduPicker({
  option,
  pickedModel,
  onPick,
}: {
  option: UnitOption;
  pickedModel: string;
  onPick: (oduModel: string) => void;
}) {
  return (
    <div
      className="ds-ub-odupick"
      role="radiogroup"
      aria-label={`Outdoor unit for ${option.idu.model}`}
    >
      {option.pairs.map((p) => {
        const on = p.odu.model === pickedModel;
        return (
          <button
            key={p.odu.model}
            role="radio"
            aria-checked={on}
            className={`ds-ub-oduopt${on ? " on" : ""}`}
            onClick={() => onPick(p.odu.model)}
          >
            <span className="ds-ub-oduname">
              <b>{p.odu.model}</b>
              <PhaseBadge phase={p.odu.phase} />
            </span>
            <span className="ds-ub-odumeta">
              {p.coolKw} / {p.heatKw} kW · max {p.pair.max_length_m} m
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* detail panel — the highlighted option's full spec sheet, every value
   attributed: Indoor unit / Outdoor unit / Pairing sections straight from the
   spec registry (single source of truth with the table + comparer) */
function DetailPanel({
  option,
  pair,
  onPickOdu,
  onAdd,
}: {
  option: UnitOption;
  pair: PairProposal;
  onPickOdu: (oduModel: string) => void;
  onAdd: () => void;
}) {
  const rows = (group: SpecGroup) =>
    specsInGroup(group).map((s) => (
      <div key={s.id} className="ds-ub-drow">
        <span className="ds-ub-dlabel">{s.label}</span>
        <span className="ds-ub-dval">{s.cell(option, pair)}</span>
      </div>
    ));

  return (
    <div className="ds-ub-dwrap">
      <div className="ds-ub-dscroll">
        <div className="ds-ub-dhead">
          <b>{option.idu.model}</b>
          {option.recommended && <em>best fit</em>}
          <span className="ds-ub-dseries">{option.idu.series}</span>
        </div>

        <section className="ds-ub-dsec">
          <h4 className="ds-ub-dsech">{SPEC_GROUP_LABELS.idu}</h4>
          {rows("idu")}
        </section>

        <section className="ds-ub-dsec">
          <h4 className="ds-ub-dsech">
            {SPEC_GROUP_LABELS.odu}
            <PhaseBadge phase={pair.odu.phase} />
          </h4>
          <OduPicker option={option} pickedModel={pair.odu.model} onPick={onPickOdu} />
          {rows("odu")}
        </section>

        <section className="ds-ub-dsec">
          <h4 className="ds-ub-dsech">{SPEC_GROUP_LABELS.pair}</h4>
          {rows("pair")}
        </section>
      </div>

      <div className="ds-ub-addbar">
        <button
          className="ds-ub-addbtn"
          onClick={onAdd}
          title={`Add ${option.idu.model} + ${pair.odu.model}`}
        >
          Add to plan
        </button>
      </div>
    </div>
  );
}

/* Comparison overlay — up to 3 units side by side, every spec as a row (the
   full superset, not just the visible columns) partitioned into Indoor unit /
   Outdoor unit / Pairing sections, best-in-row highlighted. Units can come
   from different brands. Portalled over the browser. */
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

  const specRow = (s: UnitSpec) => {
    const vals = entries.map((e) => (s.numeric ? s.numeric(e.option, e.pair) : null));
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
          <td key={e.key} className={best != null && vals[i] === best ? "best" : ""}>
            {s.cell(e.option, e.pair)}
          </td>
        ))}
      </tr>
    );
  };

  const groupBand = (label: string) => (
    <tr className="ds-cmp-group">
      <td colSpan={entries.length + 1}>{label}</td>
    </tr>
  );

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
              {groupBand(SPEC_GROUP_LABELS.idu)}
              {specsInGroup("idu").map(specRow)}

              {groupBand(SPEC_GROUP_LABELS.odu)}
              <tr>
                <th className="ds-cmp-rowh">Model</th>
                {entries.map((e) => (
                  <td key={e.key}>
                    <span className="ds-cmp-odumodel">{e.pair.odu.model}</span>{" "}
                    <PhaseBadge phase={e.pair.odu.phase} />
                  </td>
                ))}
              </tr>
              {specsInGroup("odu").map(specRow)}

              {groupBand(SPEC_GROUP_LABELS.pair)}
              {specsInGroup("pair").map(specRow)}

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
   them, grouped by what the value describes (indoor / outdoor / pairing); the
   choice persists per-device (see unit-specs.ts). */
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
          {(Object.keys(SPEC_GROUP_LABELS) as SpecGroup[]).map((g) => {
            const inGroup = specs.filter((s) => s.group === g);
            if (!inGroup.length) return null;
            return (
              <div key={g} className="ds-ub-colsgroup" role="group" aria-label={SPEC_GROUP_LABELS[g]}>
                <div className="ds-ub-colsghead">{SPEC_GROUP_LABELS[g]}</div>
                {inGroup.map((s) => (
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
            );
          })}
        </div>
      )}
    </div>
  );
}
