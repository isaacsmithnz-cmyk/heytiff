"use client";

import { useMemo } from "react";
import { Icon } from "@/components/shell/icon";
import type { DesignDocument } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import { designBasis } from "@/lib/studio/summary";
import { systemBadge, type BadgeStatus } from "@/lib/studio/split";
import { buildMaterials } from "@/lib/studio/materials";

/* Summary view (Design Studio step 2) — the old Materials and Job steps merged
   onto one scrollable screen: job details + load settings up top, the
   per-system takeoff beneath, a whole-job rollup at the bottom, and the
   printable pack last (print-only — on screen it would just repeat the
   tables). All numbers come from the engines (materials/split) — this file
   renders, never computes. */

const BADGE_WORD: Record<BadgeStatus, string> = {
  green: "OK",
  amber: "Check",
  red: "Issues",
  empty: "Empty",
};

export function SummaryView({
  doc,
  pack,
  onMutate,
  onExport,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  /** download the .heytiff-design.json backup — sits with Print, since both
      are ways of getting something out of the design */
  onExport: () => void;
}) {
  const schedule = useMemo(() => buildMaterials(doc, pack), [doc, pack]);

  const setMeta = (k: "jobNumber" | "client" | "site", v: string) =>
    onMutate((d) => ({ ...d, meta: { ...d.meta, [k]: v } }));

  const basis = designBasis(doc);

  /* whole-job unit rollup across systems (common-consumables style) */
  const rollup = new Map<string, { qty: number; description: string }>();
  for (const s of schedule.systems)
    for (const u of s.units) {
      const cur = rollup.get(u.model) ?? { qty: 0, description: u.description };
      cur.qty += u.qty;
      rollup.set(u.model, cur);
    }

  const empty = schedule.systems.length === 0;

  return (
    <div className="ds-panel-card ds-job ds-summary">
      <div className="ds-sum-screen">
        <div className="ds-job-form">
          <span className="ds-cardt">Job details</span>
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

          <div className="ds-job-actions">
            <button
              className="ds-tbbtn ds-job-print"
              onClick={() => window.print()}
              disabled={empty}
            >
              <Icon name="download" size={14} />
              Print / Save PDF
            </button>
            {/* stays enabled when empty — a backup of an empty design is
                still a valid backup */}
            <button
              className="ds-tbbtn ds-job-export"
              onClick={onExport}
              title="Download this design as a .heytiff-design.json backup — re-open it with Import on the studio home"
            >
              <Icon name="arrowUp" size={14} />
              Export design file
            </button>
          </div>
          {empty && (
            <div className="ds-insp-hint">
              The job pack fills in once a system has units placed.
            </div>
          )}
        </div>

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

        {!empty && rollup.size > 0 && (
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
                {[...rollup.entries()]
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([model, r]) => (
                    <tr key={model}>
                      <td className="ds-mat-model">{model}</td>
                      <td>{r.description}</td>
                      <td>{r.qty}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {/* the printable pack — hidden on screen (it repeats the takeoff), and
         the print stylesheet shows only this */}
      <div className="ds-jobpack" id="ds-jobpack">
        <header className="ds-jobpack-head">
          <div>
            <h1>{doc.meta.name || "Design"}</h1>
            <div className="ds-jobpack-meta">
              {doc.meta.jobNumber && <span>Job {doc.meta.jobNumber}</span>}
              {doc.meta.client && <span>{doc.meta.client}</span>}
              {doc.meta.site && <span>{doc.meta.site}</span>}
            </div>
          </div>
          <div className="ds-jobpack-brand">HeyTiff Design Studio</div>
        </header>

        {empty ? (
          <p className="ds-insp-hint">Nothing designed yet.</p>
        ) : (
          <>
            <section className="ds-jobpack-sec">
              <h2>Systems overview</h2>
              <table className="ds-mat-table">
                <thead>
                  <tr>
                    <th>System</th>
                    <th>Type</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.systems.map((s) => {
                    const v = systemBadge(doc, pack, s);
                    return (
                      <tr key={s.id}>
                        <td className="ds-mat-model">{s.name}</td>
                        <td>{s.type}</td>
                        <td>{BADGE_WORD[v.status]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            {schedule.systems.map((s) => (
              <section key={s.systemId} className="ds-jobpack-sec">
                <h2>{s.name} — materials</h2>
                {s.units.length > 0 && (
                  <table className="ds-mat-table">
                    <thead>
                      <tr>
                        <th>Model</th>
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
                      {s.pipe.map((p, i) => (
                        <tr key={`p${i}`}>
                          <td className="ds-mat-model">
                            ø{p.liquid_mm} / ø{p.gas_mm} pair coil
                          </td>
                          <td>liquid / gas mm</td>
                          <td>{p.lengthM} m</td>
                        </tr>
                      ))}
                      {s.charge && s.charge.grams > 0 && (
                        <tr>
                          <td className="ds-mat-model">Additional refrigerant</td>
                          <td>{s.charge.note}</td>
                          <td>{s.charge.grams} g</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
                {s.notes.map((n, i) => (
                  <div key={i} className="ds-mat-note">
                    {n}
                  </div>
                ))}
              </section>
            ))}

            {rollup.size > 0 && (
              <section className="ds-jobpack-sec">
                <h2>Whole-job unit schedule</h2>
                <table className="ds-mat-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th></th>
                      <th>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...rollup.entries()]
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([model, r]) => (
                        <tr key={model}>
                          <td className="ds-mat-model">{model}</td>
                          <td>{r.description}</td>
                          <td>{r.qty}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </section>
            )}

            <footer className="ds-jobpack-foot">
              Verify all selections against manufacturer documentation. Loads are
              rule-of-thumb estimates.
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
