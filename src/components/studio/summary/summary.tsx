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
import { buildMaterials } from "@/lib/studio/materials";
import type { SimReady } from "./sim-card";
import { SystemCard, UnservedCard } from "./system-card";
import { ShareCard } from "./share-card";
import { ContributorsCard } from "./contributors-card";
import { ExportCard } from "./export-card";

/* Summary view (Design Studio step 2) — the whole design on one scrollable
   sheet: an opaque ink cover floating on the white page, then one soft-glass
   card per system, each carrying the rooms it serves.

   The room is the row because that is what the document stores: an indoor
   unit is stamped with `props.roomId`, while the outdoor, the pipe run and
   the components belong to the system. Everything shown here is derived in
   summary.ts / materials.ts — this file renders, never computes. */

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
  const snapshot = useMemo(() => buildDesignSnapshot(doc), [doc]);
  const model = useMemo(() => buildSummaryModel(doc, pack), [doc, pack]);
  const basis = designBasis(doc);

  /* what the sheet wants you to look at before you print it. Derived from the
     same model the cards render, so the count can never disagree with them. */
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

  const empty = schedule.systems.length === 0;

  const [checkOpen, setCheckOpen] = useState(false);
  const [panel, setPanel] = useState<"share" | "export" | null>(null);

  return (
    <div className="ds-panel-card ds-summary">
      {/* ── the cover: opaque ink, floating on the white page ── */}
      <header className="ds-cover">
        <div className="ds-cover-lead">
          <div className="ds-cover-job">
            <input
              className="ds-cover-jn"
              aria-label="Job number"
              autoComplete="off"
              value={doc.meta.jobNumber}
              onChange={(e) => setMeta("jobNumber", e.target.value)}
              placeholder="Job number"
            />
            {/* PROVENANCE, not a fourth field: it says where the number came
                from, and it is the only thing here that still means anything
                once somebody retypes it. */}
            {doc.jobLink && (
              <span className="ds-cover-src">
                <Icon name="tag" size={11} />
                Added from ServiceM8
                {doc.jobLink.jobNumber ? ` ${doc.jobLink.jobNumber}` : ""}
              </span>
            )}
          </div>

          <div className="ds-cover-title">
            <h2>{doc.meta.name || "Design"}</h2>
            {doc.meta.variantLabel && (
              <span className="ds-cover-variant">{doc.meta.variantLabel}</span>
            )}
          </div>

          {/* who it is for, then where — a letterhead, not four boxes */}
          <div className="ds-cover-letter">
            <span className="ds-cover-lab">Client</span>
            <input
              className="ds-cover-field"
              aria-label="Client"
              autoComplete="off"
              value={doc.meta.client}
              onChange={(e) => setMeta("client", e.target.value)}
              placeholder="Client name"
            />
            <textarea
              className="ds-cover-site"
              rows={2}
              spellCheck={false}
              value={doc.meta.site}
              onChange={(e) => setMeta("site", e.target.value)}
              placeholder="Site address"
              aria-label="Site"
            />
          </div>

          {/* the loads were computed FROM these — edited in the studio menu */}
          <span className="ds-cover-lab">Design basis</span>
          <div
            className="ds-cover-chips"
            title="Set in the studio menu (top left) — changing them re-loads every room"
          >
            <span className="ds-cover-chip">
              Zone {basis.zone} · {basis.zoneCity}
            </span>
            <span className="ds-cover-chip">{basis.buildingLabel}</span>
            <span className="ds-cover-chip">{basis.basisLabel}</span>
          </div>
        </div>

        <div className="ds-cover-side">
          <div className="ds-cover-figs" role="group" aria-label="Design snapshot">
            <div className="ds-cover-fig">
              <b>{snapshot.roomCount}</b>
              <span>{snapshot.roomCount === 1 ? "Room" : "Rooms"}</span>
            </div>
            <div className="ds-cover-fig">
              <b>{fmt(snapshot.areaM2, "m²")}</b>
              <span>Floor area</span>
            </div>
            <div className="ds-cover-fig load">
              <b>{fmt(snapshot.totalLoadKw, "kW")}</b>
              <span>Design load</span>
            </div>
            <div className="ds-cover-fig">
              <b>{snapshot.systemCount}</b>
              <span>{snapshot.systemCount === 1 ? "System" : "Systems"}</span>
            </div>
          </div>

          <div className="ds-cover-acts">
            {simFlag && (
              <button
                className="ds-hbtn cta"
                onClick={onSimulate}
                disabled={!simReady.ok}
                title={simReady.ok ? undefined : simReady.reason}
              >
                <span aria-hidden>▶</span> Simulate
              </button>
            )}
            <button
              className={`ds-hbtn${panel === "share" ? " on" : ""}`}
              onClick={() => setPanel((p) => (p === "share" ? null : "share"))}
              aria-expanded={panel === "share"}
            >
              <Icon name="arrowUR" size={13} />
              Share
            </button>
            <button
              className={`ds-hbtn${panel === "export" ? " on" : ""}`}
              onClick={() => setPanel((p) => (p === "export" ? null : "export"))}
              aria-expanded={panel === "export"}
            >
              <Icon name="download" size={13} />
              Export
            </button>
          </div>

          {checks.length > 0 && (
            <div className="ds-check">
              <button
                className="ds-check-h"
                onClick={() => setCheckOpen((o) => !o)}
                aria-expanded={checkOpen}
              >
                <Icon name="ruler" size={12} />
                Check
                <span className="ds-check-n">{checks.length}</span>
                <Icon name={checkOpen ? "chevD" : "chevR"} size={11} />
              </button>
              {checkOpen && (
                <ul className="ds-check-list">
                  {checks.map((c) => (
                    <li key={c.title}>
                      <b>{c.title}</b>
                      <span>{c.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </header>

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

      {/* ── one card per system ── */}
      {(model.systems.length > 0 || model.unserved.length > 0) && (
        <h3 className="ds-syshead">Systems</h3>
      )}
      {model.systems.map((s) => (
        <SystemCard key={s.systemId} sys={s} />
      ))}
      {model.unserved.length > 0 && (
        <UnservedCard rooms={model.unserved} />
      )}

      {empty && model.systems.length === 0 && (
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
      )}

      <ContributorsCard key={doc.id} designId={doc.id} />
    </div>
  );
}
