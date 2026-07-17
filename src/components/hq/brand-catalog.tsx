"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { HqRow } from "@/lib/hq/catalog";
import type { HqBrandGroups, HqSeriesGroup, HqSystemGroup } from "@/lib/hq/grouping";
import {
  fieldSpec,
  parseFieldInput,
  validateFieldValue,
  type EditableSection,
} from "@/lib/studio/packs/fields";
import type { SaveInput, ClearInput, SaveResult } from "./edit-types";

/** system_roles values ↔ human labels for the tag editor */
const ROLE_OPTIONS = [
  { role: "split-pair", label: "Split (1:1)" },
  { role: "multi", label: "Multi-split" },
  { role: "vrf", label: "VRF" },
] as const;

const ROLE_LABEL = new Map<string, string>(ROLE_OPTIONS.map((o) => [o.role, o.label]));

/* HQ universal-table drill-down: system-type tabs → form-factor groups →
   collapsible series groups → unit rows.

   Unit rows keep the smart-gap treatment: filled fields show values (manual
   overrides highlighted), missing fields show as pills coloured by tier — red
   "blocks the engine" (with the roles blocked) vs grey "nice to know";
   structural gaps render as non-clickable warning chips. Multi-role units carry
   a cross-role badge (fan-out membership means the same row appears under every
   system type it claims).

   All display labels arrive baked into the grouped VM (grouping.ts is
   server-only; this file type-imports from it, which is erased at compile).
   Editing is enabled only when save/clear actions are injected. */

interface Editing {
  section: EditableSection;
  rowKey: string;
  field: string;
  title: string;
  value: string;
  packValue: number | string | string[] | null;
  overridden: boolean;
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
    setError(null);
    setEditing({
      section: row.section,
      rowKey: row.rowKey,
      field,
      title: `${row.title} · ${spec.label}`,
      value: cur == null ? "" : String(cur),
      packValue: mark ? mark.packValue : null,
      overridden: !!mark,
    });
  }

  async function save() {
    if (!editing || !onSave) return;
    const spec = fieldSpec(editing.section, editing.field)!;
    const parsed = parseFieldInput(spec, editing.value);
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
            {editingSpec.type === "enum" ? (
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
            {editingSpec.unit ? <span className="hq-pop-unit">{editingSpec.unit}</span> : null}

            {editing.overridden ? (
              <div className="hq-pop-note">
                Manual override. Pack value:{" "}
                <b>{editing.packValue == null ? "—" : String(editing.packValue)}</b>
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
  const shownChips = group.blockingFields.slice(0, 3);
  const extra = group.blockingFields.length - shownChips.length;

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
            {group.total} unit{group.total === 1 ? "" : "s"}
          </span>
          <span className={`hq-series-ready${group.ready === group.total ? " all" : ""}`}>
            {group.ready}/{group.total} ready
          </span>
          <span className="hq-series-chips">
            {shownChips.map((f) => (
              <span key={f} className="hq-gapchip">
                {f}
              </span>
            ))}
            {extra > 0 ? <span className="hq-gapchip more">+{extra}</span> : null}
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
        <div className="hq-series-body hq-units">
          {group.rows.map((row) => (
            <UnitRow
              key={row.rowKey}
              row={row}
              editable={editable}
              onPick={(field) => onPick(row, field)}
              onTags={onTags ? () => onTags([row], `${row.title} · system tags`) : undefined}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function UnitRow({
  row,
  editable,
  onPick,
  onTags,
}: {
  row: HqRow;
  editable: boolean;
  onPick: (field: string) => void;
  /** opens the tag editor for this row (indoor units only) */
  onTags?: () => void;
}) {
  const gapByField = new Map(row.gaps.map((g) => [g.field, g]));
  const structural = row.gaps.filter((g) => !g.fillable);
  const tagsEdited = !!row.overridden.system_roles;

  return (
    <div className="hq-unit">
      <div className="hq-unit-head">
        <div className="hq-unit-id">
          <span className={`hq-rd ${row.engineReady ? "ok" : "gap"}`} />
          <span className="hq-unit-title">{row.title}</span>
          <span className="hq-unit-sub">{row.subtitle}</span>
          {row.roles ? (
            <button
              className={`hq-xrole${tagsEdited ? " edited" : ""}`}
              disabled={!editable || !onTags}
              onClick={onTags}
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
          ) : null}
          {row.derived?.length ? (
            <span
              className="hq-xrole derived"
              title="Derived from outdoor compatibility rules in the pack — computed, never hand-set"
            >
              + multi · rules
            </span>
          ) : null}
        </div>
        <div className="hq-unit-stat">
          {row.engineReady ? (
            <span className="hq-stat-ok">Engine-ready</span>
          ) : (
            <span className="hq-stat-gap">{row.blockingCount} blocking</span>
          )}
        </div>
      </div>

      <div className="hq-fields">
        {Object.entries(row.values).map(([field, value]) => {
          const spec = fieldSpec(row.section, field)!;
          const gap = gapByField.get(field);
          const edited = !!row.overridden[field];
          if (value != null) {
            return (
              <button
                key={field}
                className={`hq-fpill filled${edited ? " edited" : ""}`}
                onClick={() => onPick(field)}
                disabled={!editable}
                title={edited ? "Manually entered — click to edit" : "Click to edit"}
              >
                <span className="hq-fp-label">{spec.label}</span>
                <span className="hq-fp-val">
                  {value}
                  {spec.unit ? <span className="hq-fp-unit">{spec.unit}</span> : null}
                </span>
                {edited ? <span className="hq-fp-dot" aria-label="manual override" /> : null}
              </button>
            );
          }
          // missing — colour by tier
          const tier = gap?.blocks ? "block" : "nice";
          return (
            <button
              key={field}
              className={`hq-fpill missing ${tier}`}
              onClick={() => onPick(field)}
              disabled={!editable}
              title={
                gap?.blocks
                  ? `Blocks: ${gap.roles.join(", ")}`
                  : "Nice to know — not required by the engine"
              }
            >
              <span className="hq-fp-label">{spec.label}</span>
              <span className="hq-fp-add">＋</span>
            </button>
          );
        })}

        {structural.map((g) => (
          <span
            key={g.field}
            className="hq-fpill struct"
            title={g.blocks ? `Blocks: ${g.roles.join(", ")} — not fixable here yet` : g.field}
          >
            ⚠ {g.field}
          </span>
        ))}
      </div>
    </div>
  );
}
