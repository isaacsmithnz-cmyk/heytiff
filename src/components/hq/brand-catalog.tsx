"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { HqGap, HqRow } from "@/lib/hq/catalog";
import type { HqBrandGroups, HqSeriesGroup, HqSystemGroup } from "@/lib/hq/grouping";
import { seriesColumns, type HqSeriesColumns } from "@/lib/hq/table-groups";
import {
  fieldSpec,
  parseFieldInput,
  validateFieldValue,
  type EditableSection,
  type FieldValue,
  type ParseResult,
} from "@/lib/studio/packs/fields";
import { isSpigotOpening, spigotLabel } from "@/lib/studio/packs/schema";
import type { SaveInput, ClearInput, SaveResult } from "./edit-types";

/** system_roles values ↔ human labels for the tag editor */
const ROLE_OPTIONS = [
  { role: "split-pair", label: "Split (1:1)" },
  { role: "multi", label: "Multi-split" },
  { role: "vrf", label: "VRF" },
] as const;

const ROLE_LABEL = new Map<string, string>(ROLE_OPTIONS.map((o) => [o.role, o.label]));

/* HQ universal-table drill-down: system-type tabs → form-factor groups →
   collapsible series groups → per-series COMPARISON TABLE (rows = models,
   columns = spec fields in ordered groups à la table-groups.ts).

   The smart-gap treatment survives the table form: filled cells show values
   (manual overrides highlighted amber), missing cells render a "+" coloured by
   tier — red "blocks the engine" vs neutral dashed "nice to know". Fields no
   row in the series has yet collapse into a trailing amber "To add" column
   group; structural gaps surface as a ⚠ chip in the sticky Status column.
   Model (left) and Status (right) columns stay sticky over the horizontal
   scroll. Multi-role units carry a cross-role badge (fan-out membership means
   the same row appears under every system type it claims).

   All display labels arrive baked into the grouped VM (grouping.ts is
   server-only; this file type-imports from it, which is erased at compile).
   Editing is enabled only when save/clear actions are injected. */

/** airway-editor state: a W×H box (text inputs), a sized factory-spigot face
    (count × Ø — the size the book publishes instead of an opening), or one of
    the keyword answers. Leaving the spigot size blank saves the bare
    "spigots" answer: confirmed spigots, size not published. */
interface OpeningDraft {
  mode: "wh" | "built-in" | "spigots" | "open";
  w: string;
  h: string;
  /** spigot mode — how many takeoffs, and their diameter in mm */
  count: string;
  dia: string;
}

interface Editing {
  section: EditableSection;
  rowKey: string;
  field: string;
  title: string;
  /** text value for number/string/enum fields (unused for openings) */
  value: string;
  /** present only for type "opening" — drives the airway control */
  opening?: OpeningDraft;
  packValue: FieldValue | null;
  overridden: boolean;
}

/** human form of any pack/override value, for the popover provenance note */
function fmtFieldValue(v: FieldValue | null): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") {
    return isSpigotOpening(v) ? spigotLabel(v) : `${v.w_mm} × ${v.h_mm} mm`;
  }
  return String(v);
}

/** tag-editor popover state — one row, or a whole series (bulk) */
interface TagEditing {
  title: string;
  rowKeys: string[];
  selected: string[];
  overridden: boolean;
  packValue: string[] | null;
}

export function HqBrandCatalog({
  groups,
  onSave,
  onClear,
}: {
  groups: HqBrandGroups;
  onSave?: (input: SaveInput) => Promise<SaveResult>;
  onClear?: (input: ClearInput) => Promise<SaveResult>;
}) {
  const router = useRouter();
  const [tabKey, setTabKey] = useState(groups.systems[0]?.key ?? "split");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [tagEditing, setTagEditing] = useState<TagEditing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tab: HqSystemGroup =
    groups.systems.find((s) => s.key === tabKey) ?? groups.systems[0];
  const editable = !!onSave;

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openEditor(row: HqRow, field: string) {
    if (!editable) return;
    const spec = fieldSpec(row.section, field);
    if (!spec) return;
    const cur = row.values[field];
    const mark = row.overridden[field];
    const blank = { w: "", h: "", count: "", dia: "" };
    const opening: OpeningDraft | undefined =
      spec.type !== "opening"
        ? undefined
        : isSpigotOpening(cur)
          ? {
              ...blank,
              mode: "spigots",
              // the editor takes ONE group; multi-size faces are extraction-only
              count: cur.spigots[0] ? String(cur.spigots[0].count) : "",
              dia: cur.spigots[0] ? String(cur.spigots[0].dia_mm) : "",
            }
          : typeof cur === "object" && cur !== null
            ? { ...blank, mode: "wh", w: String(cur.w_mm), h: String(cur.h_mm) }
            : cur === "built-in" || cur === "spigots" || cur === "open"
              ? { ...blank, mode: cur }
              : { ...blank, mode: "wh" };
    setError(null);
    setEditing({
      section: row.section,
      rowKey: row.rowKey,
      field,
      title: `${row.title} · ${spec.label}`,
      value: cur == null || typeof cur === "object" ? "" : String(cur),
      opening,
      packValue: mark ? mark.packValue : null,
      overridden: !!mark,
    });
  }

  async function save() {
    if (!editing || !onSave) return;
    const spec = fieldSpec(editing.section, editing.field)!;
    let parsed: ParseResult;
    if (spec.type === "opening" && editing.opening) {
      const o = editing.opening;
      if (o.mode === "wh" && (!o.w.trim() || !o.h.trim())) {
        setError("Enter both width and height");
        return;
      }
      // spigot mode: both boxes filled → the sized answer; both empty → the
      // bare "spigots" (confirmed, size not published). Half-filled is a slip.
      const sized = o.mode === "spigots" && (o.count.trim() || o.dia.trim());
      if (sized && (!o.count.trim() || !o.dia.trim())) {
        setError("Enter both a spigot count and a diameter — or leave both blank");
        return;
      }
      parsed = validateFieldValue(
        spec,
        o.mode === "wh"
          ? { w_mm: Number(o.w), h_mm: Number(o.h) }
          : sized
            ? { spigots: [{ count: Number(o.count), dia_mm: Number(o.dia) }] }
            : o.mode
      );
    } else {
      parsed = parseFieldInput(spec, editing.value);
    }
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    const res = await onSave({
      section: editing.section,
      rowKey: editing.rowKey,
      field: editing.field,
      value: parsed.value,
    });
    setBusy(false);
    if (res.ok) {
      setEditing(null);
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  async function clear() {
    if (!editing || !onClear) return;
    setBusy(true);
    const res = await onClear({
      section: editing.section,
      rowKey: editing.rowKey,
      field: editing.field,
    });
    setBusy(false);
    if (res.ok) {
      setEditing(null);
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  function openTagEditor(rows: HqRow[], title: string) {
    if (!editable || rows.length === 0) return;
    const first = rows[0];
    setError(null);
    setTagEditing({
      title,
      rowKeys: rows.map((r) => r.rowKey),
      selected: first.roles ?? [],
      overridden: rows.length === 1 && !!first.overridden.system_roles,
      packValue:
        rows.length === 1
          ? ((first.overridden.system_roles?.packValue as string[] | null) ?? null)
          : null,
    });
  }

  async function saveTags() {
    if (!tagEditing || !onSave) return;
    const spec = fieldSpec("indoor_units", "system_roles")!;
    const valid = validateFieldValue(spec, tagEditing.selected);
    if (!valid.ok) {
      setError(valid.error);
      return;
    }
    setBusy(true);
    for (const rowKey of tagEditing.rowKeys) {
      const res = await onSave({
        section: "indoor_units",
        rowKey,
        field: "system_roles",
        value: valid.value,
      });
      if (!res.ok) {
        setBusy(false);
        setError(`${rowKey}: ${res.error}`);
        return;
      }
    }
    setBusy(false);
    setTagEditing(null);
    router.refresh();
  }

  async function clearTags() {
    if (!tagEditing || !onClear || tagEditing.rowKeys.length !== 1) return;
    setBusy(true);
    const res = await onClear({
      section: "indoor_units",
      rowKey: tagEditing.rowKeys[0],
      field: "system_roles",
    });
    setBusy(false);
    if (res.ok) {
      setTagEditing(null);
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  const editingSpec = editing ? fieldSpec(editing.section, editing.field) : null;
  const unitTotal = tab.counts.idu + tab.counts.odu;

  return (
    <div className="hq-dt">
      <div className="hq-tabs">
        {groups.systems.map((s) => (
          <button
            key={s.key}
            className={`hq-tab${tab.key === s.key ? " active" : ""}`}
            onClick={() => setTabKey(s.key)}
          >
            {s.label}{" "}
            <span className="hq-tab-n">{s.counts.idu + s.counts.odu + s.counts.pairs}</span>
          </button>
        ))}
      </div>

      <div className="hq-dt-summary">
        <b>{tab.counts.ready}</b> of {unitTotal} engine-ready
        {tab.counts.blocking > 0 ? (
          <>
            {" · "}
            <span className="hq-dt-block">
              {tab.counts.blocking} blocking gap{tab.counts.blocking === 1 ? "" : "s"}
            </span>
          </>
        ) : null}
      </div>

      {unitTotal === 0 && tab.counts.pairs === 0 ? (
        <div className="hq-empty">Nothing in this pack serves {tab.label} yet.</div>
      ) : null}

      {tab.counts.idu > 0 ? (
        <>
          <h3 className="hq-section-h">Indoor units</h3>
          {tab.iduForms.map((form) => (
            <div key={form.formFactor}>
              <div className="hq-form-h">
                {form.label}
                <span className="hq-form-n">
                  {form.seriesGroups.reduce((n, s) => n + s.total, 0)} units
                </span>
              </div>
              {form.seriesGroups.map((sg) => (
                <SeriesGroup
                  key={sg.series}
                  group={sg}
                  groupKey={`${tab.key}:idu:${form.formFactor}:${sg.series}`}
                  collapsed={collapsed}
                  onToggle={toggle}
                  editable={editable}
                  onPick={openEditor}
                  onTags={openTagEditor}
                />
              ))}
            </div>
          ))}
        </>
      ) : tab.counts.odu > 0 ? (
        <div className="hq-empty">
          {tab.key === "multi"
            ? "This pack has multi-split outdoor units only — no indoor units are tagged for multi yet."
            : "No indoor units in this system type yet."}
        </div>
      ) : null}

      {tab.counts.odu > 0 ? (
        <>
          <h3 className="hq-section-h" style={{ marginTop: 26 }}>
            Outdoor units
          </h3>
          {tab.oduSeries.map((sg) => (
            <SeriesGroup
              key={sg.series}
              group={sg}
              groupKey={`${tab.key}:odu:${sg.series}`}
              collapsed={collapsed}
              onToggle={toggle}
              editable={editable}
              onPick={openEditor}
            />
          ))}
        </>
      ) : null}

      {tab.key === "split" && tab.counts.pairs > 0 ? (
        <>
          <h3 className="hq-section-h" style={{ marginTop: 26 }}>
            Pair tables
          </h3>
          {tab.pairSeries.map((sg) => (
            <SeriesGroup
              key={sg.series}
              group={sg}
              groupKey={`${tab.key}:pair:${sg.series}`}
              collapsed={collapsed}
              onToggle={toggle}
              editable={editable}
              onPick={openEditor}
            />
          ))}
        </>
      ) : null}

      {editing && editingSpec ? (
        <div className="hq-pop-back" onClick={() => !busy && setEditing(null)}>
          <div className="hq-pop" onClick={(e) => e.stopPropagation()}>
            <div className="hq-pop-title">{editing.title}</div>
            {editingSpec.type === "opening" && editing.opening ? (
              <div className="hq-tagchecks">
                <label className="hq-tagcheck">
                  <input
                    type="radio"
                    name="hq-open-mode"
                    checked={editing.opening.mode === "wh"}
                    onChange={() =>
                      setEditing({ ...editing, opening: { ...editing.opening!, mode: "wh" } })
                    }
                  />
                  Opening size (W × H)
                </label>
                <div className="hq-pop-openwh">
                  <input
                    className="hq-pop-input"
                    inputMode="decimal"
                    placeholder="W"
                    aria-label="Width (mm)"
                    disabled={editing.opening.mode !== "wh"}
                    value={editing.opening.w}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        opening: { ...editing.opening!, mode: "wh", w: e.target.value },
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") save();
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                  <span className="hq-pop-openx">×</span>
                  <input
                    className="hq-pop-input"
                    inputMode="decimal"
                    placeholder="H"
                    aria-label="Height (mm)"
                    disabled={editing.opening.mode !== "wh"}
                    value={editing.opening.h}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        opening: { ...editing.opening!, mode: "wh", h: e.target.value },
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") save();
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                  <span className="hq-pop-unit">mm</span>
                </div>
                <label className="hq-tagcheck">
                  <input
                    type="radio"
                    name="hq-open-mode"
                    checked={editing.opening.mode === "built-in"}
                    onChange={() =>
                      setEditing({
                        ...editing,
                        opening: { ...editing.opening!, mode: "built-in" },
                      })
                    }
                  />
                  Built-in — integral return
                </label>
                <label className="hq-tagcheck">
                  <input
                    type="radio"
                    name="hq-open-mode"
                    checked={editing.opening.mode === "spigots"}
                    onChange={() =>
                      setEditing({
                        ...editing,
                        opening: { ...editing.opening!, mode: "spigots" },
                      })
                    }
                  />
                  Spigots — duct connects to the unit, no plenum
                </label>
                {/* the book publishes takeoff sizes instead of an opening
                    ("2 × Ø400"); blank = spigots confirmed, size not published */}
                <div className="hq-pop-openwh">
                  <input
                    className="hq-pop-input"
                    inputMode="numeric"
                    placeholder="Qty"
                    aria-label="Spigot count"
                    disabled={editing.opening.mode !== "spigots"}
                    value={editing.opening.count}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        opening: { ...editing.opening!, mode: "spigots", count: e.target.value },
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") save();
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                  <span className="hq-pop-openx">× Ø</span>
                  <input
                    className="hq-pop-input"
                    inputMode="decimal"
                    placeholder="Size"
                    aria-label="Spigot diameter (mm)"
                    disabled={editing.opening.mode !== "spigots"}
                    value={editing.opening.dia}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        opening: { ...editing.opening!, mode: "spigots", dia: e.target.value },
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") save();
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                  <span className="hq-pop-unit">mm</span>
                </div>
                <label className="hq-tagcheck">
                  <input
                    type="radio"
                    name="hq-open-mode"
                    checked={editing.opening.mode === "open"}
                    onChange={() =>
                      setEditing({ ...editing, opening: { ...editing.opening!, mode: "open" } })
                    }
                  />
                  Open — takes a duct, installer sizes the plenum
                </label>
              </div>
            ) : editingSpec.type === "enum" ? (
              <select
                className="hq-pop-input"
                value={editing.value}
                onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                aria-label={editingSpec.label}
              >
                <option value="">—</option>
                {editingSpec.enumValues?.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="hq-pop-input"
                autoFocus
                value={editing.value}
                onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                placeholder={editingSpec.unit ? editingSpec.unit : "value"}
                aria-label={editingSpec.label}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  if (e.key === "Escape") setEditing(null);
                }}
              />
            )}
            {editingSpec.unit && editingSpec.type !== "opening" ? (
              <span className="hq-pop-unit">{editingSpec.unit}</span>
            ) : null}

            {editing.overridden ? (
              <div className="hq-pop-note">
                Manual override. Pack value: <b>{fmtFieldValue(editing.packValue)}</b>
              </div>
            ) : null}
            {error ? <div className="hq-pop-error">{error}</div> : null}

            <div className="hq-pop-actions">
              <button className="hq-btn primary" onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
              {editing.overridden && onClear ? (
                <button className="hq-btn ghost" onClick={clear} disabled={busy}>
                  Revert to pack
                </button>
              ) : null}
              <button className="hq-btn ghost" onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tagEditing ? (
        <div className="hq-pop-back" onClick={() => !busy && setTagEditing(null)}>
          <div className="hq-pop" onClick={(e) => e.stopPropagation()}>
            <div className="hq-pop-title">{tagEditing.title}</div>
            <div className="hq-tagchecks">
              {ROLE_OPTIONS.map((o) => {
                const checked = tagEditing.selected.includes(o.role);
                return (
                  <label key={o.role} className="hq-tagcheck">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setTagEditing({
                          ...tagEditing,
                          selected: checked
                            ? tagEditing.selected.filter((r) => r !== o.role)
                            : [...tagEditing.selected, o.role],
                        })
                      }
                    />
                    {o.label}
                  </label>
                );
              })}
            </div>
            <div className="hq-pop-note">
              Tags declare which systems a unit can serve. A new tag puts the
              unit under that system with the data it still needs shown in red.
            </div>
            {tagEditing.rowKeys.length > 1 ? (
              <div className="hq-pop-note">
                Applies to <b>{tagEditing.rowKeys.length} units</b> in this series.
              </div>
            ) : null}
            {tagEditing.overridden ? (
              <div className="hq-pop-note">
                Manual override. Pack tags:{" "}
                <b>
                  {tagEditing.packValue?.length
                    ? tagEditing.packValue.map((r) => ROLE_LABEL.get(r) ?? r).join(", ")
                    : "—"}
                </b>
              </div>
            ) : null}
            {error ? <div className="hq-pop-error">{error}</div> : null}

            <div className="hq-pop-actions">
              <button className="hq-btn primary" onClick={saveTags} disabled={busy}>
                {busy ? "Saving…" : "Save tags"}
              </button>
              {tagEditing.overridden && onClear ? (
                <button className="hq-btn ghost" onClick={clearTags} disabled={busy}>
                  Revert to pack
                </button>
              ) : null}
              <button
                className="hq-btn ghost"
                onClick={() => setTagEditing(null)}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SeriesGroup({
  group,
  groupKey,
  collapsed,
  onToggle,
  editable,
  onPick,
  onTags,
}: {
  group: HqSeriesGroup;
  groupKey: string;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  editable: boolean;
  onPick: (row: HqRow, field: string) => void;
  /** present only for indoor-unit series (tags live on IDUs) */
  onTags?: (rows: HqRow[], title: string) => void;
}) {
  const open = !collapsed.has(groupKey);
  const cols = useMemo(
    () =>
      group.rows.length
        ? seriesColumns(group.rows[0].section, group.rows)
        : null,
    [group]
  );
  if (!cols) return null;

  return (
    <div className="hq-series">
      <div className="hq-series-row">
        <button
          className="hq-series-h"
          aria-expanded={open}
          onClick={() => onToggle(groupKey)}
        >
          <span className={`hq-series-chev${open ? " open" : ""}`}>›</span>
          <span className="hq-series-name">{group.series}</span>
          <span className="hq-series-meta">
            {group.total} model{group.total === 1 ? "" : "s"}
          </span>
          <span className={`hq-series-ready${group.ready === group.total ? " all" : ""}`}>
            {group.ready}/{group.total} ready
          </span>
          <span className="hq-series-side">
            <span className="hq-series-meta">
              {cols.mappedFields} of {cols.totalFields} specs mapped
            </span>
            {cols.mappedFields + cols.toAdd.length > 6 ? (
              <span className="hq-cmp-scrollhint">scroll for the rest →</span>
            ) : null}
          </span>
        </button>
        {editable && onTags ? (
          <button
            className="hq-series-tags"
            title="Set system tags for every unit in this series"
            onClick={() =>
              onTags(group.rows, `${group.series} series · system tags`)
            }
          >
            Tags…
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="hq-series-body cmp">
          <SeriesTable
            group={group}
            cols={cols}
            editable={editable}
            onPick={onPick}
            onTags={onTags}
          />
        </div>
      ) : null}
    </div>
  );
}

/** flat, render-ready column list: mapped groups then the To-add tail. gstart
    marks each group's first column (a full-height left border) — except the
    very first data column, which abuts the sticky model column. */
interface FlatCol {
  field: string;
  sub: string;
  gstart: boolean;
  toAdd: boolean;
  blocks?: boolean;
  roles?: string[];
}

function flatColumns(cols: HqSeriesColumns): FlatCol[] {
  const out: FlatCol[] = [];
  for (const g of cols.groups) {
    g.columns.forEach((c, i) =>
      out.push({ field: c.field, sub: c.sub, gstart: i === 0, toAdd: false })
    );
  }
  cols.toAdd.forEach((c, i) =>
    out.push({
      field: c.field,
      sub: c.sub,
      gstart: i === 0,
      toAdd: true,
      blocks: c.blocks,
      roles: c.roles,
    })
  );
  if (out.length) out[0].gstart = false;
  return out;
}

function SeriesTable({
  group,
  cols,
  editable,
  onPick,
  onTags,
}: {
  group: HqSeriesGroup;
  cols: HqSeriesColumns;
  editable: boolean;
  onPick: (row: HqRow, field: string) => void;
  /** present only for indoor-unit series (tags live on IDUs) */
  onTags?: (rows: HqRow[], title: string) => void;
}) {
  const flat = flatColumns(cols);

  return (
    <>
      <div className="hq-cmp-scroll">
        <table className="hq-cmp">
          <thead>
            <tr>
              <th className="hq-cmp-model-h" rowSpan={2}>
                Model
              </th>
              {cols.groups.map((g) => (
                <th key={g.key} className="hq-cmp-group" colSpan={g.columns.length}>
                  {g.label}
                  {g.unit ? <span className="hq-cmp-gunit"> · {g.unit}</span> : null}
                </th>
              ))}
              {cols.toAdd.length > 0 ? (
                <th className="hq-cmp-group toadd" colSpan={cols.toAdd.length}>
                  To add · {cols.toAdd.length} field{cols.toAdd.length === 1 ? "" : "s"}
                </th>
              ) : null}
              <th className="hq-cmp-status-h" rowSpan={2}>
                Status
              </th>
            </tr>
            <tr>
              {flat.map((c) => (
                <th
                  key={c.field}
                  className={`hq-cmp-sub${c.toAdd ? " toadd" : ""}${c.gstart ? " gstart" : ""}`}
                >
                  {c.sub}
                  {c.toAdd && c.blocks ? (
                    <span
                      className="hq-cmp-blockdot"
                      title={`Blocks: ${(c.roles ?? []).join(", ")}`}
                    />
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => (
              <SeriesTableRow
                key={row.rowKey}
                row={row}
                flat={flat}
                total={cols.totalFields}
                editable={editable}
                onPick={onPick}
                onTags={onTags}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="hq-cmp-legend">
        <span className="hq-cmp-lg">
          <span className="hq-rd ok" />
          Engine-ready
        </span>
        <span className="hq-cmp-lg">
          <span className="hq-cmp-sw cool" />
          Cooling
        </span>
        <span className="hq-cmp-lg">
          <span className="hq-cmp-sw heat" />
          Heating
        </span>
        <span className="hq-cmp-lg">
          <span className="hq-cmp-sw add" />
          Missing — click + to add
        </span>
      </div>
    </>
  );
}

function SeriesTableRow({
  row,
  flat,
  total,
  editable,
  onPick,
  onTags,
}: {
  row: HqRow;
  flat: FlatCol[];
  total: number;
  editable: boolean;
  onPick: (row: HqRow, field: string) => void;
  onTags?: (rows: HqRow[], title: string) => void;
}) {
  const gapByField = new Map(row.gaps.map((g) => [g.field, g]));
  const structural = row.gaps.filter((g) => !g.fillable);
  const tagsEdited = !!row.overridden.system_roles;
  const filled = Object.values(row.values).filter((v) => v != null).length;

  return (
    <tr>
      <th scope="row" className="hq-cmp-model">
        <div className="hq-cmp-model-row1">
          <span className={`hq-rd ${row.engineReady ? "ok" : "gap"}`} />
          <span className="hq-cmp-model-name">{row.title}</span>
        </div>
        <div className="hq-cmp-model-chips">
          {row.roles ? (
            <button
              className={`hq-xrole${tagsEdited ? " edited" : ""}`}
              disabled={!editable || !onTags}
              onClick={
                onTags ? () => onTags([row], `${row.title} · system tags`) : undefined
              }
              title={
                tagsEdited
                  ? "System tags (manually set) — click to edit"
                  : "System tags — click to edit"
              }
            >
              {row.roles.length
                ? row.roles.map((r) => ROLE_LABEL.get(r) ?? r).join(" · ")
                : "untagged"}
              {tagsEdited ? <span className="hq-fp-dot" /> : null}
            </button>
          ) : (
            // ODU system type is fixed; pairs are split-world by definition
            <span className="hq-xrole static">
              {row.section === "pair_tables" ? "split 1:1" : row.systemTypes[0]}
            </span>
          )}
          {row.derived?.length ? (
            <span
              className="hq-xrole derived"
              title="Derived from outdoor compatibility rules in the pack — computed, never hand-set"
            >
              + multi · rules
            </span>
          ) : null}
        </div>
      </th>
      {flat.map((c) => (
        <CmpCell
          key={c.field}
          row={row}
          col={c}
          gap={gapByField.get(c.field)}
          editable={editable}
          onPick={onPick}
        />
      ))}
      <td className="hq-cmp-status">
        {row.engineReady ? (
          <span className="hq-cmp-ready">✓ Ready</span>
        ) : (
          <span className="hq-cmp-blocking">{row.blockingCount} blocking</span>
        )}
        <span className="hq-cmp-count">
          {filled}/{total}
        </span>
        {structural.length ? (
          <span
            className="hq-cmp-struct"
            title={structural
              .map((g) => (g.blocks ? `${g.field} — blocks ${g.roles.join(", ")}` : g.field))
              .join("\n")}
          >
            ⚠ {structural.length}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function CmpCell({
  row,
  col,
  gap,
  editable,
  onPick,
}: {
  row: HqRow;
  col: FlatCol;
  gap: HqGap | undefined;
  editable: boolean;
  onPick: (row: HqRow, field: string) => void;
}) {
  const spec = fieldSpec(row.section, col.field)!;
  const value = row.values[col.field];
  const edited = !!row.overridden[col.field];
  const tdClass = col.gstart ? "gstart" : undefined;

  if (value == null) {
    return (
      <td className={tdClass}>
        <button
          className={`hq-cmp-add${gap?.blocks ? " block" : ""}`}
          disabled={!editable}
          onClick={() => onPick(row, col.field)}
          aria-label={`Add ${spec.label} — ${row.title}`}
          title={
            gap?.blocks
              ? `Blocks: ${gap.roles.join(", ")}`
              : "Nice to know — not required by the engine"
          }
        >
          ＋
        </button>
      </td>
    );
  }

  const chip =
    col.field === "capacity_cool_kw" || col.field === "rated_cool_kw"
      ? "cool"
      : col.field === "capacity_heat_kw" || col.field === "rated_heat_kw"
        ? "heat"
        : col.field === "refrigerant"
          ? "ref"
          : null;
  // airway boxes render like numerics ("595 × 195"), sized spigot faces as
  // "2 × Ø400"; "built-in"/"spigots"/"open" fall through the string path
  const isBox = typeof value === "object" && !isSpigotOpening(value);
  const display = isBox
    ? `${value.w_mm} × ${value.h_mm}`
    : isSpigotOpening(value)
      ? spigotLabel(value)
      : String(value);
  const numeric = spec.type === "number" || isBox;

  return (
    <td className={tdClass}>
      <button
        className={`hq-cmp-btn${!chip && !numeric ? " txt" : ""}`}
        disabled={!editable}
        onClick={() => onPick(row, col.field)}
        aria-label={`${spec.label} — ${row.title}: ${display}`}
        title={edited ? "Manually entered — click to edit" : "Click to edit"}
      >
        {chip ? (
          <span className={`hq-cmp-chip ${chip}${edited ? " edited" : ""}`}>{display}</span>
        ) : (
          <span className={`${numeric ? "hq-cmp-num" : "hq-cmp-txt"}${edited ? " edited" : ""}`}>
            {display}
          </span>
        )}
        {edited ? <span className="hq-fp-dot" aria-label="manual override" /> : null}
      </button>
    </td>
  );
}
