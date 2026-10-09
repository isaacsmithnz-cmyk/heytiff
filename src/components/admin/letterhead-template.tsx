"use client";

import { useState } from "react";
import { Seg } from "@/components/swms/controls";
import { LetterPaper } from "@/components/letters/letter-paper";
import { letterheadLines, type LetterheadFacts, type LetterSigner } from "@/lib/letters/letterhead";
import {
  LETTERHEAD_DETAILS,
  MAX_CLOSING,
  MAX_FOOTER,
  type Letterhead,
  type LetterheadDetail,
  type LetterheadLayout,
} from "@/lib/templates/settings";
import { Foot, useTemplate } from "./template-editors";
import { TemplateFrame } from "./templates-list";
import { templateFor } from "./templates-catalogue";
import "./templates.css";

/* THE LETTERHEAD — the business's own paper, set once, that every letter in
   Admin → Letters is written on. The page draws a letter on it as the
   choices change; Save keeps them for every letter after. The facts are the
   business's own (Admin → Organisation), so a detail with nothing on file
   says where it is set rather than offering a box to type it twice. */

const LAYOUTS: readonly (readonly [LetterheadLayout, string])[] = [
  ["left", "Logo left"],
  ["centre", "Centred"],
  ["right", "Logo right"],
];

const DETAIL_LABEL: Record<LetterheadDetail, string> = {
  legalName: "Legal name",
  abn: "ABN",
  acn: "ACN",
  address: "Address",
  phone: "Phone",
  email: "Email",
  website: "Website",
  licences: "Licences",
};

/** Whether the business has this detail on file, and what it is. */
function detailOf(f: LetterheadFacts, k: LetterheadDetail): string | null {
  const b = f.brand;
  const v: Record<LetterheadDetail, string | null> = {
    legalName: f.legalName,
    abn: b.abn,
    acn: f.acn,
    address: f.address.join(", ") || null,
    phone: b.phone,
    email: b.email,
    website: b.website,
    licences: f.licences.join(", ") || null,
  };
  return v[k]?.trim() || null;
}

/** A letter to show the paper with: what most of them are, a staff
    member's employment for a visa or a loan. */
function SampleBody() {
  return (
    <>
      <p>To whom it may concern,</p>
      <p>
        This letter confirms that [Name] has been employed by us as a [Position] since [Start date]. [Name] is employed full time, working 38
        hours a week.
      </p>
      <p>Please contact me on the details above if you need anything further.</p>
    </>
  );
}

export function LetterheadTemplate({
  facts,
  letterhead,
  changed,
  isOwner,
  signer,
  today,
}: {
  facts: LetterheadFacts;
  letterhead: Letterhead;
  changed: boolean;
  isOwner: boolean;
  /** The person looking, as a letter's signer. */
  signer: LetterSigner | null;
  /** "8 October 2026" */
  today: string;
}) {
  const t = templateFor("letterhead")!;
  const save = useTemplate("letterhead");
  const [lh, setLh] = useState(letterhead);
  const dirty = JSON.stringify(lh) !== JSON.stringify(letterhead);
  const show = (k: LetterheadDetail, on: boolean) => setLh({ ...lh, show: { ...lh.show, [k]: on } });
  const sample = {
    date: today,
    to: [],
    subject: "Employment confirmation",
    signer: signer ? { ...signer, signatureSvg: lh.signature ? signer.signatureSvg : null } : { name: "[Your name]", title: "[Your position]", signatureSvg: null },
  };

  return (
    <TemplateFrame
      title={t.title}
      who={t.who}
      doc={
        <LetterPaper facts={facts} letterhead={lh} letter={sample}>
          <SampleBody />
        </LetterPaper>
      }
      side={
        isOwner ? (
          <>
            <div className="tpl-card">
              <h2>The letterhead</h2>
              <Seg label="Where the logo sits" value={lh.layout} options={LAYOUTS} onChange={(layout) => setLh({ ...lh, layout })} />
              <div className="tpl-rows">
                {LETTERHEAD_DETAILS.map((k) => {
                  const value = detailOf(facts, k);
                  return (
                    <label key={k} className="tpl-row tpl-tick">
                      <input type="checkbox" checked={lh.show[k] && !!value} disabled={!value} onChange={(e) => show(k, e.target.checked)} />
                      <span>
                        <em>{DETAIL_LABEL[k]}</em>
                        {value ?? "Not set in Organisation"}
                      </span>
                    </label>
                  );
                })}
              </div>
              <label className="tpl-field">
                Line along the foot of every page
                <input
                  className="wb2-fi"
                  value={lh.footer}
                  maxLength={MAX_FOOTER}
                  placeholder="For example, your legal name and ABN"
                  onChange={(e) => setLh({ ...lh, footer: e.target.value })}
                />
              </label>
            </div>
            <div className="tpl-card">
              <h2>Signing off</h2>
              <label className="tpl-field">
                Closing
                <input className="wb2-fi" value={lh.closing} maxLength={MAX_CLOSING} onChange={(e) => setLh({ ...lh, closing: e.target.value })} />
              </label>
              <label className="tpl-row tpl-tick">
                <input type="checkbox" checked={lh.signature} onChange={(e) => setLh({ ...lh, signature: e.target.checked })} />
                <span>Add the signer&apos;s drawn signature</span>
              </label>
              <Foot
                busy={save.busy}
                note={save.note}
                dirty={dirty}
                changed={changed}
                onSave={() => save.save(lh)}
                onReset={() => save.reset()}
              />
            </div>
          </>
        ) : (
          <div className="tpl-card">
            <h2>The letterhead</h2>
            <p className="tpl-quiet">Every letter the business writes goes out on this. Only the owner can change it.</p>
            <div className="tpl-rows">
              {letterheadLines(facts, letterhead).map((l) => (
                <div key={l} className="tpl-row">
                  <span>{l}</span>
                </div>
              ))}
            </div>
          </div>
        )
      }
    />
  );
}
