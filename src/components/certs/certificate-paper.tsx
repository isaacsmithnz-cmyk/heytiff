import type { ReactNode } from "react";
import type { OrgBrand } from "@/lib/org/brand";
import { DocPaper } from "@/components/documents/doc-paper";
import { fmtDay } from "@/lib/format/day";
import {
  CERT_LEDE,
  CERT_TITLE,
  NOT_APPLICABLE,
  addressLines,
  fmtNum,
  longDay,
  type AcRow,
  type CertContent,
  type FanRow,
  type Statement,
} from "@/lib/certs/mechanical";
import type { BusinessPapers, HeldLicence } from "@/lib/certs/query";

/* THE CERTIFICATE AS PAPER — one version, as it was issued.

   DRESSED AS THE DESIGN SHEET, by wearing its own classes: the frame in the
   business's colour, the two-party masthead and the row of facts are the
   business's paper (components/documents/doc-paper), the design sheet's
   `dsd-` rules, so a certificate and a design summary read as one business's
   paperwork. The tables are the certificate's own (certificate.css): the
   design sheet's rooms table is built for nine columns and turns into a list
   below 1024px, which these few columns never need.

   No "use client" and no hooks: the session's page and the headless
   browser's print page both render it on the server, from the frozen version.
   Nothing on it is computed from anything live except the business's own
   letterhead, which is the business's face today. */

export type PaperJob = {
  number: string | null;
  builder: string | null;
  address: string | null;
};

export type PaperSignOff = {
  name: string;
  /** yyyy-mm-dd */
  signedOn: string;
  signatureSvg: string;
  arc: HeldLicence | null;
  contractor: HeldLicence | null;
};

function modelCell(r: AcRow | FanRow): string {
  const model = r.model.trim();
  return r.qty > 1 ? `${r.qty} × ${model}` : model;
}

/* THE MODEL, NOT THE KILOWATTS. A model number fixes a unit's capacity and
   is what an inspector reads off its plate; the certifier never checks kW.
   Capacity is still typed, for checking the quote's own total, and kept on
   the version; it just isn't printed. */
function AcTable({ content }: { content: CertContent }) {
  const serials = content.showSerials;
  return (
    <section className="cer-sec">
      <h2 className="cer-h">Air conditioning</h2>
      <table className="cer-rt">
        <colgroup>
          <col className="cer-c-loc" />
          <col />
          {serials && <col className="cer-c-ser" />}
        </colgroup>
        <thead>
          <tr>
            <th>Location</th>
            <th>Model</th>
            {serials && <th>Serial</th>}
          </tr>
        </thead>
        <tbody>
          {content.systems.flatMap((s, i) => [
            <tr key={`o${i}`}>
              <td className="cer-loc">
                {s.outdoor.location ? `Outdoor unit, ${s.outdoor.location.toLowerCase()}` : "Outdoor unit"}
              </td>
              <td>{modelCell(s.outdoor)}</td>
              {serials && <td>{s.outdoor.serial}</td>}
            </tr>,
            ...s.indoors.map((r, j) => (
              <tr key={`i${i}-${j}`}>
                <td className="cer-loc">
                  {r.location}
                </td>
                <td>{modelCell(r)}</td>
                {serials && <td>{r.serial}</td>}
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </section>
  );
}

function FanTable({ content }: { content: CertContent }) {
  const serials = content.showSerials;
  /* airflow is printed only for the fans someone gave a figure */
  const airflow = content.fans.some((f) => f.airflowLps !== null);
  return (
    <section className="cer-sec">
      <h2 className="cer-h">Ventilation</h2>
      <table className="cer-rt">
        <colgroup>
          <col className="cer-c-loc" />
          <col />
          {serials && <col className="cer-c-ser" />}
          {airflow && <col className="cer-c-num" />}
        </colgroup>
        <thead>
          <tr>
            <th>Location</th>
            <th>Model</th>
            {serials && <th>Serial</th>}
            {airflow && <th className="num">Airflow</th>}
          </tr>
        </thead>
        <tbody>
          {content.fans.map((f, i) => (
            <tr key={i}>
              <td className="cer-loc">
                {f.location}
              </td>
              <td>{modelCell(f)}</td>
              {serials && <td>{f.serial}</td>}
              {airflow && (
                <td className="num">
                  {f.airflowLps !== null && (
                    <>
                      {fmtNum(f.airflowLps)} L/s
                      <span className="cer-kind">{f.airflowKind === "measured" ? "measured" : "rated"}</span>
                    </>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Drawn as its template rather than one job's certificate: the job's facts
    and the signature are named in brackets, and each statement is drawn by
    the caller, with when it prints and whether it changed. */
export type CertificateBlank = { statement: (s: Statement, i: number) => ReactNode };

export function CertificatePaper({
  content,
  brand,
  papers,
  job,
  signOff,
  version,
  blank,
}: {
  content: CertContent;
  brand: OrgBrand;
  papers: BusinessPapers;
  job: PaperJob;
  signOff: PaperSignOff;
  version: number;
  blank?: CertificateBlank;
}) {
  const address = addressLines(job.address);
  const site = address[0] ?? "";

  const figures: { label: string; value: string }[] = [
    ...(content.building
      ? [{ label: "Building", value: content.building.cls ? `${content.building.label} (${content.building.cls})` : content.building.label }]
      : []),
    { label: "Completed", value: blank ? "[Date]" : fmtDay(content.completedOn) },
  ];

  return (
    <DocPaper
      eyebrow={content.title}
      heading={site || CERT_TITLE}
      brand={brand}
      toName={job.builder}
      toLines={address}
      jobNumber={job.number}
      licences={papers.licences}
      figures={figures}
    >
      {content.covers.ac && content.systems.length > 0 && <AcTable content={content} />}
      {content.covers.vent && content.fans.length > 0 && <FanTable content={content} />}

      <section className="cer-sec">
        <h2 className="cer-h">Certification</h2>
        <p className="cer-lede">{CERT_LEDE}</p>
        <ol className="cer-st">
          {content.statements.map((s, i) => (
            <li key={i}>{blank ? blank.statement(s, i) : s.text}</li>
          ))}
        </ol>
        {content.notApplicable.map((s, i) => (
          <p key={i} className="cer-note">
            {`${NOT_APPLICABLE} ${s.text}`}
          </p>
        ))}
        {content.notCovered && <p className="cer-note">{content.notCovered}</p>}
      </section>

      <dl className="cer-sign">
        <div>
          <dt>Signed</dt>
          <dd className="cer-sig">
            {!blank && (
              /* built server-side from a validated path (lib/swms/input signatureSvg) */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={`data:image/svg+xml;utf8,${encodeURIComponent(signOff.signatureSvg)}`} alt={`Signature of ${signOff.name}`} />
            )}
          </dd>
          <dd className="cer-who">
            {signOff.name}
            <span>{blank ? "[Date]" : longDay(signOff.signedOn)}</span>
          </dd>
        </div>
        <div>
          <dt>ARC licence</dt>
          <dd className="cer-who">{signOff.arc?.number ?? ""}</dd>
        </div>
        <div>
          <dt>Contractor licence</dt>
          <dd className="cer-who">{signOff.contractor?.number ?? ""}</dd>
        </div>
      </dl>

      {version > 1 && <p className="cer-foot">Version {version}</p>}
    </DocPaper>
  );
}
