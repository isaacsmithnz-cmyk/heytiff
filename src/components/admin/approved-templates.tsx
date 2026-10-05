"use client";

import { useState } from "react";
import { TemplateSteps } from "@/components/swms/template-steps";
import { ApproveTemplate } from "@/components/swms/approve-template";
import { ApproveWording } from "@/components/certs/approve-wording";
import { CertificatePaper } from "@/components/certs/certificate-paper";
import type { OrgBrand } from "@/lib/org/brand";
import type { BusinessPapers, HeldLicence } from "@/lib/certs/query";
import {
  CERT_LIBRARY_VERSION,
  CERT_TITLE,
  CLAUSE_NAME,
  EMPTY_FAN,
  EMPTY_ROW,
  EMPTY_TEST,
  SHOWN,
  WORDING_GROUPS,
  shownParts,
  type CertContent,
  type ClauseKey,
  type Statement,
} from "@/lib/certs/mechanical";
import { TemplateFrame, type TemplateStatus } from "./templates-list";
import { templateFor } from "./templates-catalogue";
import "./templates.css";

/* THE TWO TEMPLATES THE OWNER APPROVES — the SWMS and the Mechanical
   Compliance Certificate. Their wording is a fixed, reviewed library
   (lib/swms/library, lib/certs/mechanical) checked against the standards; a
   new version comes with the app and waits for the owner.

   The certificate is drawn as the certificate: the real paper, on the
   business's own letterhead, with the job's facts in brackets, each
   statement saying when it prints, and what changed since the last approval
   marked where it sits. */

export type PaperApproval = { by: string; on: string } | null;

export type ApprovalProps = {
  isOwner: boolean;
  ownerName: string | null;
  wording: {
    approved: PaperApproval;
    /** Statements changed since the last approval, when this version isn't
        approved yet and that approval kept its wording. */
    changed: { clause: ClauseKey; isNew: boolean }[] | null;
    /** When the last approval was, for "since you approved it on …". */
    lastApprovedOn: string | null;
    earlier: { by: string; on: string }[];
  };
};

const waiting = (owner: string | null) => `Waiting for ${owner ?? "the owner"} to approve it`;

/* when a statement prints, said once per group; a group's own note wins */
const GROUP_WHEN: Record<string, string> = {
  "Every air conditioning certificate": "On every air conditioning certificate",
  "Every ventilation certificate": "On every ventilation certificate",
  "What was installed": "When it was installed",
  "What was asked for": "When the builder or certifier asks for it",
};
const WHEN = new Map<ClauseKey, string>(
  WORDING_GROUPS.flatMap((g) => g.clauses.map((c) => [c.clause, c.note ?? GROUP_WHEN[g.title] ?? ""] as const))
);
const BLANK_LICENCE: HeldLicence = { name: "", number: "[Number]", expires: null, current: true };
const ORDER: ClauseKey[] = WORDING_GROUPS.flatMap((g) => g.clauses.map((c) => c.clause));

/** The certificate with nothing filled in: one row of each table, and every
    statement it can make. */
function blankContent(clauses: readonly ClauseKey[]): CertContent {
  return {
    libraryVersion: CERT_LIBRARY_VERSION,
    title: CERT_TITLE,
    covers: { ac: true, vent: true },
    building: { label: "[Class of building]", cls: null },
    completedOn: "",
    systems: [
      {
        outdoor: { ...EMPTY_ROW, location: "[Location]", make: "[Make]", model: "[Model]" },
        indoors: [{ ...EMPTY_ROW, location: "[Room]", make: "[Make]", model: "[Model]" }],
        test: EMPTY_TEST,
      },
    ],
    fans: [{ ...EMPTY_FAN, location: "[Room]", make: "[Make]", model: "[Model]" }],
    showSerials: false,
    statements: clauses.map((clause): Statement => ({ clause, text: CLAUSE_NAME[clause], requirement: null })),
    notApplicable: [{ clause: null, text: "[What was asked for, and why it doesn't apply.]", requirement: null }],
    notCovered: "",
  };
}

/** One shown line: the words, what is typed in brackets, and the choices. */
function Line({ line }: { line: string }) {
  return (
    <>
      {shownParts(line).map((p, i) =>
        p.kind === "text" ? (
          <span key={i}>{p.text}</span>
        ) : p.kind === "typed" ? (
          <span key={i} className="tpl-ph">{`[${p.text}]`}</span>
        ) : (
          <span key={i} className="tpl-ph">
            {p.options.filter(Boolean).join(" / ")}
          </span>
        )
      )}
    </>
  );
}

export function CertificateTemplate({
  wording,
  isOwner,
  ownerName,
  brand,
  papers,
  status,
}: ApprovalProps & { brand: OrgBrand; papers: BusinessPapers; status: TemplateStatus }) {
  const t = templateFor("certificate")!;
  const changed = new Map((wording.changed ?? []).map((c) => [c.clause, c.isNew]));
  const [onlyChanged, setOnlyChanged] = useState(false);
  const clauses = onlyChanged ? ORDER.filter((k) => changed.has(k)) : ORDER;

  const statement = (s: Statement) => {
    const k = s.clause as ClauseKey;
    const mark = changed.get(k);
    return (
      <span className={mark !== undefined ? "tpl-st tpl-changed" : "tpl-st"} aria-label={CLAUSE_NAME[k]}>
        {SHOWN[k].map((line, i) => (
          <span key={line} style={{ display: "block" }}>
            {i > 0 && <em>Or: </em>}
            <Line line={line} />
          </span>
        ))}
        <span className="tpl-when">
          {mark !== undefined && <span className="sw-state warn">{mark ? "New" : "Changed"}</span>}
          {WHEN.get(k)}
        </span>
      </span>
    );
  };

  const lede = wording.approved
    ? `Approved by ${wording.approved.by} on ${wording.approved.on}. Every certificate is written from these statements.`
    : !isOwner
      ? `${waiting(ownerName)}. No certificate can be issued until then.`
      : changed.size > 0 && wording.lastApprovedOn
        ? `${changed.size} ${changed.size === 1 ? "statement has" : "statements have"} changed since you approved the wording on ${wording.lastApprovedOn}. They're marked on the certificate.`
        : "Read the certificate, then approve its wording. No certificate can be issued until you do.";

  return (
    <TemplateFrame
      title={t.title}
      who={t.who}
      status={status}
      doc={
        <CertificatePaper
          content={blankContent(clauses)}
          brand={brand}
          papers={papers}
          job={{ number: "[Job number]", builder: "[Builder]", address: "[Site address]" }}
          signOff={{ name: "[Name]", signedOn: "", signatureSvg: "", arc: BLANK_LICENCE, contractor: BLANK_LICENCE }}
          version={1}
          blank={{ statement }}
        />
      }
      side={
        <>
          <div className="tpl-card">
            <h2>{wording.approved ? "Approved" : "Approve the wording"}</h2>
            <p>{lede}</p>
            {!wording.approved && isOwner && <ApproveWording />}
          </div>
          {changed.size > 0 && (
            <div className="tpl-card">
              <h2>Show</h2>
              <label className="tpl-only">
                <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
                Only what changed
              </label>
            </div>
          )}
          <div className="tpl-card">
            <h2>{"Why it can't be edited"}</h2>
            <p className="tpl-quiet">
              Each statement names the standard it certifies against and has been checked against it. New wording comes with HeyTiff and waits for your
              approval. A line under each statement says when it prints; words in brackets are filled in from the job.
            </p>
          </div>
          {wording.earlier.length > 0 && (
            <div className="tpl-card">
              <h2>Approved before</h2>
              <div className="tpl-rows">
                {wording.earlier.map((e) => (
                  <div key={`${e.on}${e.by}`} className="tpl-row">
                    <span>
                      <b>{e.on}</b>
                      <em>{`by ${e.by}`}</em>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      }
    />
  );
}

export function SwmsTemplate({ approved, isOwner, ownerName, status }: { approved: PaperApproval; isOwner: boolean; ownerName: string | null; status: TemplateStatus }) {
  const t = templateFor("swms")!;
  return (
    <TemplateFrame
      title={t.title}
      who={t.who}
      status={status}
      doc={
        <div className="tpl-sheet sws">
          <TemplateSteps />
        </div>
      }
      side={
        <>
          <div className="tpl-card">
            <h2>{approved ? "Approved" : "Approve the steps"}</h2>
            <p>
              {approved
                ? `Approved by ${approved.by} on ${approved.on}. Every SWMS is written from these steps and controls.`
                : isOwner
                  ? "Read the steps and controls, then approve them. No SWMS can be issued until you do."
                  : `${waiting(ownerName)}. No SWMS can be issued until then.`}
            </p>
            {!approved && isOwner && <ApproveTemplate />}
          </div>
          <div className="tpl-card">
            <h2>{"Why it can't be edited"}</h2>
            <p className="tpl-quiet">
              Every control is sourced from the WHS regulations and codes of practice. A control that depends on a choice on site says which choice; the
              site&apos;s own details are filled in on each SWMS.
            </p>
          </div>
        </>
      }
    />
  );
}
