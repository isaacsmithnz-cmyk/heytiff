"use client";

import { useMemo } from "react";
import { Icon } from "@/components/shell/icon";
import type { DesignDocument } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import { floorDisplayName, type PlanImages } from "@/lib/studio/plans";
import {
  buildDesignSnapshot,
  designBasis,
  roomsByFloor,
} from "@/lib/studio/summary";
import { buildMaterials, rollupUnits } from "@/lib/studio/materials";
import { SimCard, type SimReady } from "./sim-card";
import { ShareCard } from "./share-card";
import { ContributorsCard } from "./contributors-card";
import { ExportCard } from "./export-card";

/* Summary view (Design Studio step 2) — the whole design on one scrollable
   sheet: job details and the design basis up top beside the action cards
   (Simulate / Export), then the snapshot stat strip, the per-floor rooms &
   loads, the per-system takeoff and the whole-job rollup. Everything is
   derived (summary.ts / materials.ts) — this file renders, never computes. */

const fmt = (n: number | null, unit: string, dash = "—"): string =>
  n == null ? dash : `${n % 1 === 0 ? n : n.toFixed(1)} ${unit}`;

export function SummaryView({
  doc,
  pack,
  onMutate,
  onExportJson,
  simFlag,
  simReady,
  onSimulate,
  planImages,
  loadVariant,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  /** the .heytiff-design.json backup download */
  onExportJson: () => void;
  simFlag: boolean;
  simReady: SimReady;
  onSimulate: () => void;
  /** resolves plan-sheet refs for the print/PNG export */
  planImages: PlanImages;
  /** loads a sibling variant's document for multi-option export */
  loadVariant: (id: string) => Promise<DesignDocument | null>;
}) {
  const schedule = useMemo(() => buildMaterials(doc, pack), [doc, pack]);
  const rollup = useMemo(() => rollupUnits(schedule), [schedule]);
  const snapshot = useMemo(() => buildDesignSnapshot(doc), [doc]);
  const floors = useMemo(() => roomsByFloor(doc, pack), [doc, pack]);
  const basis = designBasis(doc);

  const setMeta = (k: "jobNumber" | "client" | "site", v: string) =>
    onMutate((d) => ({ ...d, meta: { ...d.meta, [k]: v } }));

  const empty = schedule.systems.length === 0;
  const anyRooms = snapshot.roomCount > 0;

  return (
    <div className="ds-panel-card ds-summary">
      <div className="ds-sum-screen ds-summary2">
        {/* ── job card + action cards ── */}
        <div className="ds-sum-top">
          <div className="ds-job-form">
            <div className="ds-sum-title">
              <h2>{doc.meta.name || "Design"}</h2>
              {doc.meta.variantLabel && (
                <span className="ds-sum-variant">{doc.meta.variantLabel}</span>
              )}
            </div>
            <div className="ds-job-fields">
              <label>
                <span>Job number</span>
                <input
                  autoComplete="off"
                  value={doc.meta.jobNumber}
                  onChange={(e) => setMeta("jobNumber", e.target.value)}
                  placeholder="e.g. 2026-014"
                />
              </label>
              <label>
                <span>Client</span>
                <input
                  autoComplete="off"
                  value={doc.meta.client}
                  onChange={(e) => setMeta("client", e.target.value)}
                  placeholder="Client name"
                />
              </label>
              <label>
                <span>Site</span>
                <input
                  autoComplete="off"
                  value={doc.meta.site}
                  onChange={(e) => setMeta("site", e.target.value)}
                  placeholder="Site address"
                />
              </label>
            </div>
            {/* PROVENANCE, not a fourth field. The three above are free text
                and stay editable; this says where they came from, and it is
                the only thing here that still means something after somebody
                retypes the number. */}
            {doc.jobLink && (
              <p className="ds-job-from">
                <Icon name="tag" size={13} />
                Started from ServiceM8{" "}
                {doc.jobLink.jobNumber ? (
                  <b>job {doc.jobLink.jobNumber}</b>
                ) : (
                  <b>job</b>
                )}
              </p>
            )}
            {/* the loads were computed FROM these — edited in the studio menu
                (they re-load every room), echoed here for the record */}
            <span className="ds-cardt ds-job-settingst">Design basis</span>
            <div
              className="ds-sum-chips"
              title="Set in the studio menu (top left) — changing them re-loads every room"
            >
              <span className="ds-sum-chip">
                Zone {basis.zone} · {basis.zoneCity}
              </span>
              <span className="ds-sum-chip">{basis.buildingLabel}</span>
              <span className="ds-sum-chip">{basis.basisLabel}</span>
            </div>
            {/* who has worked on this — history, not ownership: the design
                belongs to the business (see contributors-card) */}
            <ContributorsCard key={doc.id} designId={doc.id} />
          </div>

          <div className="ds-sum-actions">
            {simFlag && <SimCard ready={simReady} onSimulate={onSimulate} />}
            <ShareCard key={doc.id} designId={doc.id} />
            <ExportCard
              doc={doc}
              pack={pack}
              planImages={planImages}
              empty={empty}
              onExportJson={onExportJson}
              loadVariant={loadVariant}
            />
          </div>
        </div>

        {/* ── design snapshot ── */}
        <div className="ds-sum-stats" role="group" aria-label="Design snapshot">
          <div className="ds-stat">
            <b>{snapshot.floorCount}</b>
            <span>{snapshot.floorCount === 1 ? "Floor" : "Floors"}</span>
          </div>
          <div className="ds-stat">
            <b>{snapshot.roomCount}</b>
            <span>{snapshot.roomCount === 1 ? "Room" : "Rooms"}</span>
          </div>
          <div className="ds-stat">
            <b>{fmt(snapshot.areaM2, "m²")}</b>
            <span>Floor area</span>
          </div>
          <div className="ds-stat">
            <b>{fmt(snapshot.totalLoadKw, "kW")}</b>
            <span>Design load</span>
          </div>
          <div className="ds-stat">
            <b>{snapshot.systemCount}</b>
            <span>{snapshot.systemCount === 1 ? "System" : "Systems"}</span>
          </div>
          <div className="ds-stat">
            <b>{snapshot.iduCount}</b>
            <span>Indoor units</span>
          </div>
          <div className="ds-stat">
            <b>{snapshot.oduCount}</b>
            <span>Outdoor units</span>
          </div>
        </div>
        {snapshot.unmeasuredRoomCount > 0 && (
          <div className="ds-sum-note">
            <Icon name="ruler" size={12} />
            {snapshot.unmeasuredRoomCount}{" "}
            {snapshot.unmeasuredRoomCount === 1 ? "room sits" : "rooms sit"} on
            an uncalibrated floor — area and load totals exclude
            {snapshot.unmeasuredRoomCount === 1 ? " it" : " them"}.
          </div>
        )}

        {/* ── rooms & loads ── */}
        {anyRooms && (
          <section className="ds-sum-rooms">
            <span className="ds-cardt">Rooms &amp; loads</span>
            {floors
              .filter((f) => f.rooms.length > 0)
              .map((f) => (
                <div key={f.floorId} className="ds-sum-floor">
                  <div className="ds-sum-floor-h">
                    {floorDisplayName(f)}
                    {!f.calibrated && <em>uncalibrated — no areas</em>}
                  </div>
                  <table className="ds-mat-table">
                    <thead>
                      <tr>
                        <th>Room</th>
                        <th>Area</th>
                        <th>Load</th>
                        <th>Served by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.rooms.map((r) => (
                        <tr key={r.roomId}>
                          <td className="ds-mat-model">{r.name}</td>
                          <td>{fmt(r.areaM2, "m²")}</td>
                          <td>{fmt(r.loadKw, "kW")}</td>
                          <td>
                            {r.serving.length === 0 ? (
                              "—"
                            ) : (
                              <span className="ds-serv">
                                {r.serving.map((s, i) => (
                                  <span
                                    key={`${s.model}${i}`}
                                    className="ds-serv-chip"
                                    title={s.systemName}
                                  >
                                    <span
                                      className="ds-serv-dot"
                                      style={{ background: s.colour }}
                                    />
                                    {s.model || s.systemName}
                                  </span>
                                ))}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </section>
        )}

        {/* ── per-system takeoff ── */}
        {empty ? (
          <div className="ds-empty">
            <span className="ds-empty-ic">
              <Icon name="receipt" size={22} />
            </span>
            <div className="ds-empty-t">An empty design is an empty schedule</div>
            <div className="ds-empty-s">
              Add a system and place its units on the Design step — the takeoff
              builds itself from what you draw. Nothing here is ever typed in by
              hand.
            </div>
          </div>
        ) : (
          schedule.systems.map((s) => (
            <section key={s.systemId} className="ds-mat-sys">
              <header>
                <span className="ds-sysdot" style={{ background: s.colour }} />
                <h3>{s.name}</h3>
                <span className="ds-mat-type">
                  {s.type} · {s.brand}
                </span>
              </header>
              {s.units.length > 0 && (
                <table className="ds-mat-table">
                  <thead>
                    <tr>
                      <th>Unit</th>
                      <th></th>
                      <th>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.units.map((u) => (
                      <tr key={u.model}>
                        <td className="ds-mat-model">{u.model}</td>
                        <td>{u.description}</td>
                        <td>{u.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {s.pipe.length > 0 && (
                <table className="ds-mat-table">
                  <thead>
                    <tr>
                      <th>Pipe (pair coil)</th>
                      <th></th>
                      <th>Length</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.pipe.map((p, i) => (
                      <tr key={i}>
                        <td className="ds-mat-model">
                          ø{p.liquid_mm} / ø{p.gas_mm}
                        </td>
                        <td>liquid / gas mm</td>
                        <td>{p.lengthM} m</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {s.charge && (
                <div className="ds-mat-charge">
                  Additional refrigerant: <b>{s.charge.grams} g</b>
                  <span> — {s.charge.note}</span>
                </div>
              )}
              {s.notes.map((n, i) => (
                <div key={i} className="ds-mat-note">
                  <Icon name="ruler" size={12} />
                  {n}
                </div>
              ))}
              {s.units.length === 0 && s.pipe.length === 0 && (
                <div className="ds-mat-note">
                  Nothing placed for this system yet.
                </div>
              )}
            </section>
          ))
        )}

        {/* ── whole-job rollup ── */}
        {!empty && rollup.length > 0 && (
          <section className="ds-mat-sys">
            <header>
              <h3>Whole job</h3>
              <span className="ds-mat-type">all systems rolled up</span>
            </header>
            <table className="ds-mat-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th></th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {rollup.map((r) => (
                  <tr key={r.model}>
                    <td className="ds-mat-model">{r.model}</td>
                    <td>{r.description}</td>
                    <td>{r.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  );
}
