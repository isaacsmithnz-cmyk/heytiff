"use client";

import { useState } from "react";
import { TemplateSteps } from "@/components/swms/template-steps";
import { ApproveTemplate } from "@/components/swms/approve-template";
import { ApproveWording } from "@/components/certs/approve-wording";
import { CERT_LEDE, CLAUSE_NAME, NOT_APPLICABLE, SHOWN, WORDING_GROUPS, shownParts, type ClauseKey } from "@/lib/certs/mechanical";
import "@/components/swms/swms.css";
import "./templates.css";

/* THE TWO TEMPLATES THE OWNER APPROVES — the SWMS and the Mechanical
   Compliance Certificate. Their wording is a fixed, reviewed library
   (lib/swms/library, lib/certs/mechanical) checked against the standards; a
   new version comes with the app and waits for the owner. What changed since
   the last approval is marked, so a new version is read in seconds. */

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

/** One shown line: the words, what is typed in brackets, and what depends on
    the job in the quiet colour. */
function Line({ line }: { line: string }) {
  return (
    <p className="sw-text">
      {shownParts(line).map((p, i) =>
        p.kind === "text" ? (
          <span key={i}>{p.text}</span>
        ) : p.kind === "typed" ? (
          <span key={i} className="pw-typed">{`[${p.text}]`}</span>
        ) : (
          <span key={i} className="pw-choice">
            {p.options.filter(Boolean).join(" / ")}
          </span>
        )
      )}
    </p>
  );
}

/** A part of the certificate the job fills in: its heading, and what goes
    there in brackets. */
function Part({ title, lines }: { title: string; lines: readonly string[] }) {
  return (
    <div className="sws-grp">
      <div className="sw-gh">
        <b>{title}</b>
      </div>
      {lines.map((line) => (
        <Line key={line} line={line} />
      ))}
    </div>
  );
}

/** The certificate as it reads, top to bottom, with the statements in place. */
export function CertificateTemplate({ wording, isOwner, ownerName }: ApprovalProps) {
  const changed = new Map((wording.changed ?? []).map((c) => [c.clause, c.isNew]));
  const [onlyChanged, setOnlyChanged] = useState(changed.size > 0);
  const shows = (k: ClauseKey) => !onlyChanged || changed.has(k);
  const lede = wording.approved
    ? `Approved by ${wording.approved.by} on ${wording.approved.on}. Every certificate is written from these statements.`
    : !isOwner
      ? `${waiting(ownerName)}. No certificate can be issued until then.`
      : changed.size > 0 && wording.lastApprovedOn
        ? `${changed.size} ${changed.size === 1 ? "statement has" : "statements have"} changed since you approved the wording on ${wording.lastApprovedOn}. Read them, then approve.`
        : "Read the statements, then approve them. No certificate can be issued until you do.";
  return (
    <div className="sws">
      <p className="sws-lede">{lede}</p>
      {changed.size > 0 && !wording.approved && (
        <label className="pw-only">
          <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
          Show only what changed
        </label>
      )}
      {!onlyChanged && (
        <>
          <Part title="The job" lines={["[Site address], for [the builder], job [number]", "Building [class]. Completed [date]."]} />
          <Part
            title="The equipment"
            lines={["Air conditioning: [each outdoor unit with its indoor units, refrigerant and charge]", "Ventilation: [each fan by room and model, and its airflow when added]"]}
          />
          <div className="sw-gh">
            <b>Certification</b>
          </div>
          <p className="sw-text">{CERT_LEDE}</p>
        </>
      )}
      {WORDING_GROUPS.map((g) => {
        const items = g.clauses.filter((c) => shows(c.clause));
        if (items.length === 0) return null;
        return (
          <div key={g.title} className="sws-grp">
            <div className="sw-gh">
              <b>{g.title}</b>
            </div>
            {items.map((c) => (
              <div key={c.clause} className="pw-st" aria-label={CLAUSE_NAME[c.clause]}>
                {(c.note || changed.has(c.clause)) && (
                  <span className="pw-when">
                    {changed.has(c.clause) && <span className="sw-state warn">{changed.get(c.clause) ? "New" : "Changed"}</span>}
                    {c.note}
                  </span>
                )}
                {SHOWN[c.clause].map((line) => (
                  <Line key={line} line={line} />
                ))}
              </div>
            ))}
          </div>
        );
      })}
      {!onlyChanged && (
        <>
          <Part title="Not applicable" lines={[`${NOT_APPLICABLE} [what was asked for, and why it doesn't apply]`]} />
          <Part title="Signed" lines={["[Signature], [name], [date]", "ARC licence [number]. Contractor licence [number]."]} />
        </>
      )}
      {!wording.approved && isOwner && (
        <div className="sws-actions">
          <ApproveWording />
        </div>
      )}
      {wording.earlier.length > 0 && (
        <p className="sw-note">{`Approved before: ${wording.earlier.map((e) => `${e.on} by ${e.by}`).join("; ")}.`}</p>
      )}
    </div>
  );
}

export function SwmsTemplate({ approved, isOwner, ownerName }: { approved: PaperApproval; isOwner: boolean; ownerName: string | null }) {
  return (
    <div className="sws">
      <p className="sws-lede">
        {approved
          ? `Approved by ${approved.by} on ${approved.on}. Every SWMS is written from these steps.`
          : isOwner
            ? "Read the steps and controls, then approve them at the end. No SWMS can be issued until you do."
            : `${waiting(ownerName)}. No SWMS can be issued until then.`}
      </p>
      <div className="sws-grp">
        <TemplateSteps />
      </div>
      {!approved && isOwner && (
        <div className="sws-actions">
          <ApproveTemplate />
        </div>
      )}
    </div>
  );
}
