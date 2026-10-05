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

/** A version issued before rows carried a make has none to print. */
const makeOfRow = (r: AcRow | FanRow): string => (r.make ?? "").trim();

/* THE MAKE AND THE MODEL, NOT THE KILOWATTS. A model number fixes a unit's
   capacity and is what an inspector reads off its plate, and the make is
   what tells a certifier whose plate it is ("PEFY-P63VMX-A" names nothing to
   someone who doesn't know Mitsubishi's codes). Capacity is still typed, for
   checking the quote's own total, and kept on the version; it isn't printed.

   EACH ROW SAYS WHAT IT IS — outdoor unit or indoor unit — in a column of
   its own, and the location prints as it was typed. An outdoor unit opens
   each system, and a heavier rule sets a second system apart. */
function AcTable({ content }: { content: CertContent }) {
  const serials = content.showSerials;
  const makes = content.systems.some((s) => [s.outdoor, ...s.indoors].some((r) => makeOfRow(r) !== ""));
  return (
    <section className="cer-sec">
      <h2 className="cer-h">Air conditioning</h2>
      <table className="cer-rt">
        <colgroup>
          <col className="cer-c-unit" />
          <col className="cer-c-loc" />
          {makes && <col className="cer-c-make" />}
          <col />
          {serials && <col className="cer-c-ser" />}
        </colgroup>
        <thead>
          <tr>
            <th>Unit</th>
            <th>Location</th>
            {makes && <th>Make</th>}
            <th>Model</th>
            {serials && <th>Serial</th>}
          </tr>
        </thead>
        <tbody>
          {content.systems.flatMap((s, i) => [
            <tr key={`o${i}`} className={i > 0 ? "cer-next" : undefined}>
              <td className="cer-unit">Outdoor unit</td>
              <td className="cer-loc">{s.outdoor.location}</td>
              {makes && <td>{makeOfRow(s.outdoor)}</td>}
              <td>{modelCell(s.outdoor)}</td>
              {serials && <td>{s.outdoor.serial}</td>}
            </tr>,
            ...s.indoors.map((r, j) => (
              <tr key={`i${i}-${j}`}>
                <td className="cer-unit">{r.qty > 1 ? "Indoor units" : "Indoor unit"}</td>
                <td className="cer-loc">{r.location}</td>
                {makes && <td>{makeOfRow(r)}</td>}
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
  const makes = content.fans.some((f) => makeOfRow(f) !== "");
  return (
    <section className="cer-sec">
      <h2 className="cer-h">Ventilation</h2>
      <table className="cer-rt">
        <colgroup>
          <col className="cer-c-loc" />
          {makes && <col className="cer-c-make" />}
          <col />
          {serials && <col className="cer-c-ser" />}
          {airflow && <col className="cer-c-num" />}
        </colgroup>
        <thead>
          <tr>
            <th>Location</th>
            {makes && <th>Make</th>}
            <th>Model</th>
            {serials && <th>Serial</th>}
            {airflow && <th className="num">Airflow</th>}
          </tr>
        </thead>
        <tbody>
          {content.fans.map((f, i) => (
            <tr key={i}>
              <td className="cer-loc">{f.location}</td>
              {makes && <td>{makeOfRow(f)}</td>}
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

  /* the class leads the building ("Class 1a dwelling"); a version issued
     before it did printed the wizard's own choice, with the class after */
  const figures: { label: string; value: string }[] = [
    ...(content.building
      ? [{ label: "Building", value: content.building.cls ? `${content.building.label} (${content.building.cls})` : content.building.label }]
      : []),
    { label: "Completed", value: blank ? "[Date]" : fmtDay(content.completedOn) },
  ];

  return (
    /* THE DOCUMENT IS THE HEADING, the site is under the client: the street
       was the heading and then printed again in the address below it */
    <DocPaper
      eyebrow=""
      heading={content.title || CERT_TITLE}
      plain
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
