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
import type { SimApprovalState } from "@/lib/studio/sim-approval";
import type { SimReady } from "./sim-card";
import { fmt } from "./sheet-tables";
import { PicklistSection, SheetDoc } from "./sheet-doc";
import { PicklistPush } from "./picklist-push";
import { useOrgBrand } from "./use-org-brand";
import { BrandLogo } from "@/components/org/letterhead";
import { ShareCard } from "./share-card";
import { ContributorsCard } from "./contributors-card";
import { ExportCard } from "./export-card";
import { JobAttach } from "./job-attach";

/* Summary view (Design Studio step 2) — the design as a DOCUMENT.

   THE SAME DOCUMENT the customer's live link and the printed pack render.
   `SheetDoc` is the artifact — masthead, letterhead, the row of six, a block
   per system, the picklist — and this file is one of its three chromes. What
   is owner-only is passed IN rather than living in the shared component, and
   what is owner-only is therefore ABSENT from the other two rather than
   hidden in them: the checks, Simulate/Share/Export, the editable letterhead,
   the ServiceM8 provenance, Add to job, and Contributors.

   The chrome bar never prints. ONE derivation: buildSummaryModel carries
   coverage AND takeoff — this file renders, never computes. */

/** "Ground floor", "Ground floor and First floor", "A, B and C" — floors read
    as a sentence, because the checks list is sentences. */
function listFloors(floors: { name: string }[]): string {
  const names = floors.map((f) => f.name);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function SummaryView({
  doc,
  pack,
  onMutate,
  onExportJson,
  simFlag,
  simReady,
  simApproval,
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
  /** whether the simulation has been ticked as fit to show a customer, and
      what is holding it back if not — see sim-approval.ts */
  simApproval: SimApprovalState;
  onSimulate: () => void;
  /** resolves plan-sheet refs for the print/PNG export */
  planImages: PlanImages;
  /** loads a sibling variant's document for multi-option export */
  loadVariant: (id: string) => Promise<DesignDocument | null>;
}) {
  const snapshot = useMemo(() => buildDesignSnapshot(doc), [doc]);
  const model = useMemo(() => buildSummaryModel(doc, pack), [doc, pack]);
  const basis = designBasis(doc);
  const brand = useOrgBrand();

  /* "prepared" is when the design was last saved — the same date the
     customer's copy carries, from the same field, formatted the same way.
     en-AU explicitly rather than the reader's locale: the sheet is a document
     with one date on it, not a localised view of one. */
  const preparedOn = useMemo(
    () =>
      new Date(doc.meta.updatedAt).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    [doc.meta.updatedAt]
  );

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
    /* THE SIMULATION WENT AWAY, AND YOU ARE THE ONLY ONE WHO CAN BE TOLD.
       An approved simulation pins to the design it was approved against, so
       editing the design withdraws it — including from a link a customer is
       already holding, where the option simply disappears. That is correct,
       but it must not be something you discover later. */
    if (simApproval.lapsed.length > 0)
      out.push({
        title: `The simulation is no longer offered on the share link`,
        detail: `${listFloors(simApproval.lapsed)} ${
          simApproval.lapsed.length === 1 ? "was" : "were"
        } ticked as ready to share, then the design changed. Run the simulation again and re-tick to put it back.`,
      });
    /* PART-APPROVED READS AS A BUG. The option is all-or-nothing: a customer
       cannot tell which floors they are missing, so an unticked floor hides
       the simulation entirely. If some floors ARE ticked, the absence needs a
       name or it looks broken. */
    else if (simApproval.approved.length > 0 && simApproval.pending.length > 0)
      out.push({
        title: `${listFloors(simApproval.pending)} ${
          simApproval.pending.length === 1 ? "is" : "are"
        } holding the simulation back`,
        detail:
          "The share link offers the simulation only once every floor that can run one is ticked as ready to share.",
      });
    return out;
  }, [model, snapshot, simApproval]);

  const setMeta = (k: "jobNumber" | "client" | "site", v: string) =>
    onMutate((d) => ({ ...d, meta: { ...d.meta, [k]: v } }));

  const empty = model.systems.length === 0;

  const [checkOpen, setCheckOpen] = useState(false);
  const [panel, setPanel] = useState<"share" | "export" | null>(null);

  /* THE OWNER TYPES INTO THE LETTERHEAD. Same frame the customer reads, same
     classes — these are the FILLING, and the customer's copy passes none of
     them, so an input cannot reach a client by being hidden badly. */
  const fields = {
    client: (
      <input
        className="dsd-f n"
        aria-label="Client"
        autoComplete="off"
        value={doc.meta.client}
        onChange={(e) => setMeta("client", e.target.value)}
        placeholder="Client"
      />
    ),
    site: (
      <textarea
        className="dsd-f a"
        rows={2}
        spellCheck={false}
        value={doc.meta.site}
        onChange={(e) => setMeta("site", e.target.value)}
        aria-label="Site"
        placeholder="Site address"
      />
    ),
    jobNumber: (
      <input
        className="dsd-f j"
        aria-label="Job number"
        autoComplete="off"
        value={doc.meta.jobNumber}
        onChange={(e) => setMeta("jobNumber", e.target.value)}
      />
    ),
  };

  return (
    <div className="ds-panel-card ds-summary">
      {/* ── chrome: everything that is NOT the document. Never prints. ── */}
      <div className="ds-chrome">
        {/* THE MARK GOES TOP LEFT, with the checks pill beside it. It used to
            sit in the masthead above a contact line; a mark belongs in the
            corner, and the document below is the letterhead. */}
        <BrandLogo brand={brand} className="dsd-logo" />
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
          {/* ABSENT, not disabled. The sheet must never advertise a
              simulation the person reading it cannot open — and once the
              simulation is a thing you SEND, "cannot open" includes "has not
              been ticked as fit to show anyone". The way IN to tick it is the
              Simulate pill on the Design step, which is not this sheet. */}
          {simFlag && simApproval.offered && (
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

      {/* ── the document. The SAME component the customer's live link and the
            printed pack render; what differs is the chrome above and what
            hangs off the foot. ── */}
      <SheetDoc
        doc={doc}
        model={model}
        snapshot={snapshot}
        basis={basis}
        brand={brand}
        eyebrow={
          doc.meta.variantLabel
            ? `Design summary, ${doc.meta.variantLabel.toLowerCase()}`
            : "Design summary"
        }
        preparedOn={preparedOn}
        fields={fields}
        provenance={<JobAttach doc={doc} onMutate={onMutate} />}
      >
        <PicklistSection
          rows={model.picklist}
          action={
            <PicklistPush
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
          }
        />
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
        {/* who has worked on it. Staff names and "last worked 3 days ago" are
            internal, so this is one of the things the customer's copy does
            not have rather than one it hides. */}
        <ContributorsCard key={doc.id} designId={doc.id} />
      </SheetDoc>
    </div>
  );
}
