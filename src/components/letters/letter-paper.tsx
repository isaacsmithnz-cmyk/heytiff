import type { ReactNode } from "react";
import { DocFrame } from "@/components/documents/doc-paper";
import { BrandLogo } from "@/components/org/letterhead";
import { letterheadLines, type LetterheadFacts, type LetterSigner } from "@/lib/letters/letterhead";
import type { Letterhead } from "@/lib/templates/settings";
import "@/components/studio/summary/sheet-doc.css";
import "./letter.css";

/* A LETTER ON THE BUSINESS'S OWN PAPER — an employment confirmation for a
   visa, a letter for a car loan, anything somebody asks to have "on company
   letterhead". The frame is the business's paper (the certificate and the
   quote wear it too); the letterhead is the template (Admin → Templates →
   Letterhead); everything between is the letter.

   No "use client" and no hooks: the template's preview, the letter's page
   and the headless browser's print all render it. */

export type LetterView = {
  /** Printed as written: "8 October 2026". Empty leaves the line off. */
  date: string;
  /** Who it is to, a line each. Empty leaves the block off. */
  to: string[];
  /** The "Re:" line. Empty leaves it off. */
  subject: string;
  signer: LetterSigner | null;
};

export function LetterPaper({
  facts,
  letterhead,
  letter,
  children,
}: {
  facts: LetterheadFacts;
  letterhead: Letterhead;
  letter: LetterView;
  /** The body. */
  children: ReactNode;
}) {
  const brand = facts.brand;
  const lines = letterheadLines(facts, letterhead);
  const name = brand.name.trim();
  return (
    <DocFrame brand={brand} className={letterhead.footer ? "ltr has-foot" : "ltr"}>
      <header className={`ltr-head ${letterhead.layout}`}>
        <div className="ltr-mark">
          <BrandLogo brand={brand} className="ltr-logo" />
          {name && <b className="ltr-name">{name}</b>}
        </div>
        {lines.length > 0 && (
          <ul className="ltr-lines">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
      </header>

      {letter.date && <p className="ltr-date">{letter.date}</p>}
      {letter.to.length > 0 && (
        <address className="ltr-to">
          {letter.to.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </address>
      )}
      {letter.subject && <p className="ltr-re">{`Re: ${letter.subject}`}</p>}

      <div className="ltr-body">{children}</div>

      {letter.signer && (
        <div className="ltr-sign">
          <p>{letterhead.closing}</p>
          <div className="ltr-sig">
            {letter.signer.signatureSvg && (
              /* built server-side from a validated path (lib/swms/input signatureSvg) */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={`data:image/svg+xml;utf8,${encodeURIComponent(letter.signer.signatureSvg)}`} alt={`Signature of ${letter.signer.name}`} />
            )}
          </div>
          <b>{letter.signer.name}</b>
          {letter.signer.title && <span>{letter.signer.title}</span>}
          {name && <span>{name}</span>}
        </div>
      )}

      {letterhead.footer && <footer className="ltr-foot">{letterhead.footer}</footer>}
    </DocFrame>
  );
}
