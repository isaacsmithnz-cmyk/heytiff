"use client";

import type { DesignDocument } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import type { MaterialsSchedule, RollupRow } from "@/lib/studio/materials";
import { systemBadge, type BadgeStatus } from "@/lib/studio/split";

/* The printable pack — hidden on screen (it repeats the takeoff); the print
   stylesheet shows only this. Moved verbatim from the old split-panel so the
   Summary rebuild changes nothing about printing; the Stage-4 export work
   replaces this with the options-driven print document (plans included). */

const BADGE_WORD: Record<BadgeStatus, string> = {
  green: "OK",
  amber: "Check",
  red: "Issues",
  empty: "Empty",
};

export function PrintDoc({
  doc,
  pack,
  schedule,
  rollup,
}: {
  doc: DesignDocument;
  pack: DataPack | null;
  schedule: MaterialsSchedule;
  rollup: RollupRow[];
}) {
  const empty = schedule.systems.length === 0;
  return (
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

          {rollup.length > 0 && (
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

          <footer className="ds-jobpack-foot">
            Verify all selections against manufacturer documentation. Loads are
            rule-of-thumb estimates.
          </footer>
        </>
      )}
    </div>
  );
}
