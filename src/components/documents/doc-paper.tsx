import type { ReactNode } from "react";
import { brandContact, hasBrand, type OrgBrand } from "@/lib/org/brand";
import { BrandLogo } from "@/components/org/letterhead";
import { themeVars } from "@/lib/org/theme";
import "@/components/studio/summary/sheet-doc.css";
import "@/components/certs/certificate.css";

/* THE BUSINESS'S PAPER — the frame in its colour, the two-party masthead and
   the row of facts, worn by every document it sends that isn't a letter:
   the certificate, and the quote's template. The design sheet's own classes
   (`dsd-`, sheet-doc.css), so they all read as one business's paperwork.

   No "use client" and no hooks: a server page, a headless print and a
   template preview all render it. */

export type DocFigure = { label: string; value: string };

export function DocPaper({
  eyebrow,
  heading,
  brand,
  toName,
  toLines,
  jobNumber,
  licences = [],
  figures,
  children,
}: {
  eyebrow: string;
  heading: string;
  brand: OrgBrand;
  /** Who it's for, above the address. */
  toName: string | null;
  toLines: readonly string[];
  jobNumber: string | null;
  /** The business's licence lines, ahead of its contact details. */
  licences?: readonly string[];
  figures: readonly DocFigure[];
  children: ReactNode;
}) {
  const named = hasBrand(brand);
  const contact = [...licences, ...brandContact(brand)];
  /* the facts row's column count, as a custom property: built here, as a
     plain object, because React Compiler 1.0 can't lower a computed key */
  const figsStyle = { "--cer-n": figures.length } as React.CSSProperties;

  return (
    <article className="dsd cer" style={themeVars(brand.color)}>
      <div className="dsd-bband" aria-hidden="true" />
      <div className="dsd-bwell" aria-hidden="true" />
      {/* the design sheet's frame table: on paper it holds the frame's space
          open on every page; on screen it is blocks (sheet-doc.tsx says why) */}
      <table className="dsd-frame" role="presentation">
        <thead>
          <tr>
            <td className="dsd-fr-t" />
          </tr>
        </thead>
        <tfoot>
          <tr>
            <td className="dsd-fr-b" />
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td className="dsd-fr-c">
              <div className="dsd-fr-w">
                <div className="dsd-mast">
                  <div className="dsd-mast-job">
                    <p className="dsd-eyebrow">{eyebrow}</p>
                    <h1>{heading}</h1>
                    <div className="dsd-prep">
                      <span className="dsd-lab">Prepared by</span>
                      <span className="dsd-org">{named && brand.name ? brand.name : "HeyTiff"}</span>
                    </div>
                    <address className="dsd-to">
                      {toName && <span className="dsd-to-n">{toName}</span>}
                      {toLines.map((line) => (
                        <span key={line} className="dsd-to-l">
                          {line}
                        </span>
                      ))}
                      {jobNumber && (
                        <span className="dsd-job">
                          <em>Job</em>
                          <b>{jobNumber}</b>
                        </span>
                      )}
                    </address>
                  </div>
                  {named && (
                    <div className="dsd-ident">
                      <BrandLogo brand={brand} className="dsd-idlogo" />
                      {contact.length > 0 && (
                        <ul className="dsd-idc">
                          {contact.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>

                {figures.length > 0 && (
                  <dl className="dsd-figs cer-figs" style={figsStyle}>
                    {figures.map((f) => (
                      <div key={f.label}>
                        <dt>{f.label}</dt>
                        <dd>{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {children}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}
