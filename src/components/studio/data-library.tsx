"use client";

import { useState } from "react";
import "./data-library.css";
import type { DataPack, PackMeta } from "@/lib/studio/packs/schema";
import type { ValidationResult } from "@/lib/studio/packs/validate";
import type { RangeCompleteness } from "@/lib/studio/packs/ready";
import { indoorReadiness, outdoorReadiness } from "@/lib/studio/packs/ready";

/* Design Studio — Data Library: the read-only window onto the universal table
   (universal-table-schema.md). Shows what packs are installed, each section's
   rows, and — the useful part — engine-ready completeness per range with the
   gaps that block readiness. Editing / PDF-upload is a later, admin-gated
   feature; this is visibility only. All data arrives pre-loaded + pre-validated
   from the server (packs/server.ts); the pure ready.ts fns score rows here. */

export interface PackView {
  meta: PackMeta;
  pack: DataPack;
  validation: ValidationResult;
  completeness: RangeCompleteness[];
}

type SectionKey = "overview" | "outdoor_units" | "indoor_units" | "parts" | "vrf_pipe_tables";

const SECTION_TABS: { key: SectionKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "outdoor_units", label: "Outdoor units" },
  { key: "indoor_units", label: "Indoor units" },
  { key: "parts", label: "Parts" },
  { key: "vrf_pipe_tables", label: "Pipe tables" },
];

function Dot({ ready }: { ready: boolean }) {
  return (
    <span
      className={`dl-dot ${ready ? "on" : "off"}`}
      title={ready ? "Engine-ready" : "Not engine-ready"}
    />
  );
}

export function DataLibrary({
  packs,
  failed,
}: {
  packs: PackView[];
  failed: { brand: string; version: string; message: string }[];
}) {
  return (
    <div className="dl-root">
      <header className="dl-head">
        <h1>Data Library</h1>
        <p>
          The universal product table the Design Studio reads from — read-only.
          Every unit is offered to a design only once its required fields are
          complete (“engine-ready”), so partial data is always safe.
        </p>
      </header>

      {failed.map((f) => (
        <div className="dl-fail" key={`${f.brand}@${f.version}`}>
          Couldn’t load <code>{f.brand}@{f.version}</code>: {f.message}
        </div>
      ))}

      {packs.length === 0 && failed.length === 0 && (
        <div className="dl-empty">No data packs installed yet.</div>
      )}

      {packs.map((p) => (
        <PackCard key={`${p.meta.brand}@${p.meta.version}`} view={p} />
      ))}
    </div>
  );
}

function PackCard({ view }: { view: PackView }) {
  const { meta, pack, validation } = view;
  const [tab, setTab] = useState<SectionKey>("overview");

  const counts = {
    outdoor_units: pack.outdoor_units.length,
    indoor_units: pack.indoor_units.length,
    parts: pack.parts.length,
    vrf_pipe_tables: pack.vrf_pipe_tables.length,
  };

  return (
    <section className="dl-pack">
      <div className="dl-pack-head">
        <div>
          <h2>{meta.name}</h2>
          <div className="dl-sub">
            <code>
              {meta.brand}@{meta.version}
            </code>
            {meta.sources?.map((s) => (
              <span className="dl-src" key={s.title}>
                {s.title}
                {s.edition ? ` · ${s.edition}` : ""}
              </span>
            ))}
          </div>
        </div>
        <div
          className={`dl-valid ${validation.ok ? "ok" : "bad"}`}
          title={validation.ok ? "Passes validation" : `${validation.errors.length} errors`}
        >
          {validation.ok
            ? "✓ Valid"
            : `${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"}`}
          {validation.warnings.length > 0 && (
            <span className="dl-warn"> · {validation.warnings.length} warn</span>
          )}
        </div>
      </div>

      <nav className="dl-tabs">
        {SECTION_TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "active" : ""}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key !== "overview" && (
              <span className="dl-count">{counts[t.key as keyof typeof counts]}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="dl-body">
        {tab === "overview" && <Overview view={view} />}
        {tab === "outdoor_units" && <OutdoorTable pack={pack} />}
        {tab === "indoor_units" && <IndoorTable pack={pack} />}
        {tab === "parts" && <PartsTable pack={pack} />}
        {tab === "vrf_pipe_tables" && <PipeTables pack={pack} />}
      </div>
    </section>
  );
}

function Overview({ view }: { view: PackView }) {
  const { completeness, validation } = view;
  if (completeness.length === 0)
    return <p className="dl-note">No units yet — nothing to score.</p>;

  // group by role for readable sections
  const byRole = new Map<string, RangeCompleteness[]>();
  for (const c of completeness) {
    const arr = byRole.get(c.role) ?? [];
    arr.push(c);
    byRole.set(c.role, arr);
  }
  const ROLE_LABEL: Record<string, string> = {
    placeable: "Placeable",
    "vrf-odu": "VRF outdoor-ready",
    "vrf-idu": "VRF indoor-ready",
    multi: "Multi-ready",
    split: "Split-ready",
    ducted: "Ducted-ready",
  };

  return (
    <div className="dl-overview">
      {!validation.ok && (
        <div className="dl-errs">
          {validation.errors.slice(0, 8).map((e, i) => (
            <div key={i}>
              <code>{e.section}</code> · {e.row} — {e.message}
            </div>
          ))}
          {validation.errors.length > 8 && (
            <div>…and {validation.errors.length - 8} more</div>
          )}
        </div>
      )}
      {[...byRole.entries()].map(([role, rows]) => (
        <div className="dl-role" key={role}>
          <h3>{ROLE_LABEL[role] ?? role}</h3>
          <div className="dl-ranges">
            {rows
              .sort((a, b) => a.series.localeCompare(b.series))
              .map((r) => {
                const pct = r.total ? Math.round((r.ready / r.total) * 100) : 0;
                return (
                  <div className="dl-range" key={`${r.brand}:${r.series}`}>
                    <div className="dl-range-top">
                      <span className="dl-range-name">{r.series}</span>
                      <span className="dl-range-count">
                        {r.ready}/{r.total}
                      </span>
                    </div>
                    <div className="dl-bar">
                      <div
                        className={`dl-bar-fill ${pct === 100 ? "full" : ""}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {r.gaps.length > 0 && (
                      <div className="dl-gaps">
                        {r.gaps.map((g) => (
                          <span className="dl-gap" key={g}>
                            {g}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

function OutdoorTable({ pack }: { pack: DataPack }) {
  if (pack.outdoor_units.length === 0) return <p className="dl-note">None.</p>;
  return (
    <div className="dl-scroll">
      <table className="dl-table">
        <thead>
          <tr>
            <th></th>
            <th>Model</th>
            <th>Type</th>
            <th>Cool kW</th>
            <th>Heat kW</th>
            <th>Index</th>
            <th>ø Liq</th>
            <th>ø Gas</th>
            <th>Ph</th>
            <th>Ratio %</th>
          </tr>
        </thead>
        <tbody>
          {pack.outdoor_units.map((o) => {
            const r = outdoorReadiness(pack, o);
            const ready = o.system_type === "vrf" ? r.roles["vrf-odu"] : r.roles.multi;
            return (
              <tr key={o.model}>
                <td>
                  <Dot ready={ready} />
                </td>
                <td className="dl-mono">{o.model}</td>
                <td>{o.system_type}</td>
                <td>{o.capacity_cool_kw}</td>
                <td>{o.capacity_heat_kw}</td>
                <td>{o.capacity_index ?? "—"}</td>
                <td>{o.conn_liquid_mm}</td>
                <td>{o.conn_gas_mm}</td>
                <td>{o.phase}</td>
                <td>
                  {o.ratio_min_pct && o.ratio_max_pct
                    ? `${o.ratio_min_pct}–${o.ratio_max_pct}`
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function IndoorTable({ pack }: { pack: DataPack }) {
  if (pack.indoor_units.length === 0)
    return <p className="dl-note">No indoor units yet (extraction in progress).</p>;
  return (
    <div className="dl-scroll">
      <table className="dl-table">
        <thead>
          <tr>
            <th></th>
            <th>Model</th>
            <th>Form</th>
            <th>Cool kW</th>
            <th>Heat kW</th>
            <th>Index</th>
            <th>Airflow L/s</th>
            <th>ø Liq</th>
            <th>ø Gas</th>
          </tr>
        </thead>
        <tbody>
          {pack.indoor_units.map((u) => {
            const r = indoorReadiness(pack, u);
            return (
              <tr key={u.model}>
                <td>
                  <Dot ready={r.roles["vrf-idu"] || r.roles.multi || r.roles.split} />
                </td>
                <td className="dl-mono">{u.model}</td>
                <td>{u.form_factor}</td>
                <td>{u.capacity_cool_kw}</td>
                <td>{u.capacity_heat_kw}</td>
                <td>{u.capacity_index ?? "—"}</td>
                <td>{u.airflow_ls ?? "—"}</td>
                <td>{u.conn_liquid_mm}</td>
                <td>{u.conn_gas_mm}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PartsTable({ pack }: { pack: DataPack }) {
  if (pack.parts.length === 0) return <p className="dl-note">None.</p>;
  return (
    <div className="dl-scroll">
      <table className="dl-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Type</th>
            <th>Index ≤</th>
            <th>Branches</th>
            <th>Ports</th>
          </tr>
        </thead>
        <tbody>
          {pack.parts.map((p) => (
            <tr key={p.model}>
              <td className="dl-mono">{p.model}</td>
              <td>{p.part_type}</td>
              <td>{p.index_max ?? "—"}</td>
              <td>{p.branches ?? "—"}</td>
              <td>{p.ports ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PipeTables({ pack }: { pack: DataPack }) {
  if (pack.vrf_pipe_tables.length === 0) return <p className="dl-note">None.</p>;
  return (
    <div className="dl-pipe">
      {pack.vrf_pipe_tables.map((t) => (
        <div className="dl-pipe-card" key={t.series}>
          <h3>{t.series}</h3>
          <div className="dl-pipe-meta">
            <span>{t.pipe_sizing.steps.length} main sizes</span>
            <span>{t.joint_selection.steps.length} joint steps</span>
            <span>{t.header_selection?.steps.length ?? 0} header steps</span>
            <span>max {t.limits.max_total_m} m total</span>
            <span>farthest {t.limits.max_farthest_actual_m} m</span>
            <span>lift +{t.limits.max_lift_odu_above_m}/−{t.limits.max_lift_odu_below_m} m</span>
          </div>
        </div>
      ))}
    </div>
  );
}
