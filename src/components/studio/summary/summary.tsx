"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/shell/icon";
import type { DesignDocument } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import type { PlanImages } from "@/lib/studio/plans";
import {
  buildDesignSnapshot,
  buildSummaryModel,
  designBasis,
} from "@/lib/studio/summary";
import type { SimReady } from "./sim-card";
import { fmt } from "./sheet-tables";
import { PicklistCard, SystemCard, UnservedCard } from "./system-card";
import { ShareCard } from "./share-card";
import { ContributorsCard } from "./contributors-card";
import { ExportCard } from "./export-card";
import { JobAttach } from "./job-attach";

/* Summary view (Design Studio step 2) — the design as a DOCUMENT.

   Everything that is not the document (the checks, Simulate/Share/Export)
   lives in a chrome bar above it and never prints. The sheet itself reads
   top to bottom: letterhead (what it's called, whose it is), the snapshot
   figures, one card per system (band → outdoor → rooms → materials), the
   rooms nothing serves, then the whole job's Material picklist.

   ONE derivation: buildSummaryModel carries coverage AND takeoff, and the
   print document renders the same model — this file renders, never computes. */

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
  const snapshot = useMemo(() => buildDesignSnapshot(doc), [doc]);
  const model = useMemo(() => buildSummaryModel(doc, pack), [doc, pack]);
  const basis = designBasis(doc);

  /* what to look at before you send this. Derived from the same model the
     cards render, so the count can never disagree with them. */
  const checks = useMemo(() => {
    const out: { title: string; detail: string }[] = [];
    for (const s of model.systems) {
      const short = s.rooms.filter((r) => r.status === "under" && r.pct != null);
      for (const r of short)
        out.push({
          title: `${r.name} is under-covered`,
          detail: `${fmt(r.capacityKw, "kW")} placed against a ${fmt(
            r.loadKw,
            "kW"
          )} load.`,
        });
    }
    if (snapshot.unmeasuredRoomCount > 0)
      out.push({
        title: `${snapshot.unmeasuredRoomCount} ${
          snapshot.unmeasuredRoomCount === 1 ? "room sits" : "rooms sit"
        } on an uncalibrated floor`,
        detail: "Area and load totals exclude them.",
      });
    if (model.unserved.length > 0)
      out.push({
        title: `${model.unserved.length} ${
          model.unserved.length === 1 ? "room has" : "rooms have"
        } no unit`,
        detail: "Listed under Not served yet.",
      });
    return out;
  }, [model, snapshot]);

  const setMeta = (k: "jobNumber" | "client" | "site", v: string) =>
    onMutate((d) => ({ ...d, meta: { ...d.meta, [k]: v } }));

  const empty = model.systems.length === 0;

  const [checkOpen, setCheckOpen] = useState(false);
  const [panel, setPanel] = useState<"share" | "export" | null>(null);

  return (
    <div className="ds-panel-card ds-summary">
      {/* ── chrome: everything that is NOT the document. Never prints. ── */}
      <div className="ds-chrome">
        {checks.length > 0 ? (
          <button
            className="ds-chrome-warn"
            onClick={() => setCheckOpen((o) => !o)}
            aria-expanded={checkOpen}
          >
            <b>{checks.length}</b>
            to check before you send this
            <Icon name={checkOpen ? "chevD" : "chevR"} size={11} />
          </button>
        ) : (
          <span className="ds-chrome-ok">
            <Icon name="check" size={12} />
            Nothing flagged
          </span>
        )}
        <div className="ds-chrome-acts">
          {simFlag && (
            <button
              className="ds-chrome-btn cta"
              onClick={onSimulate}
              disabled={!simReady.ok}
              title={simReady.ok ? undefined : simReady.reason}
            >
              <span aria-hidden>▶</span> Simulate
            </button>
          )}
          <button
            className={`ds-chrome-btn${panel === "share" ? " on" : ""}`}
            onClick={() => setPanel((p) => (p === "share" ? null : "share"))}
            aria-expanded={panel === "share"}
          >
            <Icon name="arrowUR" size={13} />
            Share
          </button>
          <button
            className={`ds-chrome-btn${panel === "export" ? " on" : ""}`}
            onClick={() => setPanel((p) => (p === "export" ? null : "export"))}
            aria-expanded={panel === "export"}
          >
            <Icon name="download" size={13} />
            Export
          </button>
        </div>
      </div>

      {checkOpen && checks.length > 0 && (
        <ul className="ds-chrome-list">
          {checks.map((c) => (
            <li key={c.title}>
              <b>{c.title}</b>
              <span>{c.detail}</span>
            </li>
          ))}
        </ul>
      )}

      {panel === "share" && <ShareCard key={doc.id} designId={doc.id} />}
      {panel === "export" && (
        <ExportCard
          doc={doc}
          pack={pack}
          planImages={planImages}
          empty={empty}
          onExportJson={onExportJson}
          loadVariant={loadVariant}
        />
      )}

      {/* ── the letterhead: what it's called, then whose it is ── */}
      <header className="ds-letter">
        <div className="ds-letter-lead">
          <div className="ds-letter-titlerow">
            <h2>{doc.meta.name || "Design"}</h2>
            <span className="ds-letter-job">
              Job{" "}
              <input
                className="ds-letter-inp jn"
                aria-label="Job number"
                autoComplete="off"
                value={doc.meta.jobNumber}
                onChange={(e) => setMeta("jobNumber", e.target.value)}
              />
            </span>
            {/* PROVENANCE, and the place to change it. The link is what the
                Material picklist pushes along, so a design that was never
                started from a job could not reach one at all until this
                existed — see the note on JobAttach. */}
            <JobAttach doc={doc} onMutate={onMutate} />
          </div>
          {doc.meta.variantLabel && (
            <span className="ds-letter-variant">{doc.meta.variantLabel}</span>
          )}
          {/* the loads were computed FROM these — edited in the studio menu */}
          <div
            className="ds-letter-chips"
            title="Set in the studio menu (top left) — changing them re-loads every room"
          >
            <span>
              Zone {basis.zone} · {basis.zoneCity}
            </span>
            <span>{basis.buildingLabel}</span>
            <span>{basis.basisLabel}</span>
          </div>
        </div>

        {/* the addressee: name, then the address a line at a time, ranged
            LEFT inside a block set to the right — a letterhead keeps its own
            left edge; right-ragged lines read as a caption */}
        <div className="ds-letter-to">
          <input
            className="ds-letter-inp name"
            aria-label="Client"
            autoComplete="off"
            value={doc.meta.client}
            onChange={(e) => setMeta("client", e.target.value)}
            placeholder="Client"
          />
          <textarea
            className="ds-letter-inp addr"
            rows={2}
            spellCheck={false}
            value={doc.meta.site}
            onChange={(e) => setMeta("site", e.target.value)}
            aria-label="Site"
            placeholder="Site address"
          />
        </div>
      </header>

      {/* ── the snapshot: the design load leads — it is the number the whole
            sheet is an argument about ── */}
      <dl className="ds-letter-snap" role="group" aria-label="Design snapshot">
        <div className="lead">
          <dt>Design load</dt>
          <dd>{fmt(snapshot.totalLoadKw, "kW")}</dd>
        </div>
        <div>
          <dt>{snapshot.roomCount === 1 ? "Room" : "Rooms"}</dt>
          <dd>{snapshot.roomCount}</dd>
        </div>
        <div>
          <dt>Floor area</dt>
          <dd>{fmt(snapshot.areaM2, "m²")}</dd>
        </div>
        <div>
          <dt>{snapshot.systemCount === 1 ? "System" : "Systems"}</dt>
          <dd>{snapshot.systemCount}</dd>
        </div>
      </dl>

      {model.systems.map((s) => (
        <SystemCard key={s.systemId} sys={s} />
      ))}
      {model.unserved.length > 0 && <UnservedCard rooms={model.unserved} />}
      {model.picklist.length > 0 && (
        <PicklistCard
          rows={model.picklist}
          designId={doc.id}
          jobLink={
            doc.jobLink
              ? {
                  remoteId: doc.jobLink.remoteId,
                  jobNumber: doc.jobLink.jobNumber,
                }
              : null
          }
        />
      )}

      {empty && (
        <div className="ds-empty">
          <span className="ds-empty-ic">
            <Icon name="receipt" size={22} />
          </span>
          <div className="ds-empty-t">An empty design is an empty sheet</div>
          <div className="ds-empty-s">
            Add a system and place its units on the Design step — the sheet
            builds itself from what you draw. Nothing here is ever typed in by
            hand.
          </div>
        </div>
      )}

      <ContributorsCard key={doc.id} designId={doc.id} />
    </div>
  );
}
