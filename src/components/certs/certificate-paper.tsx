import { brandContact, hasBrand, type OrgBrand } from "@/lib/org/brand";
import { BrandLogo } from "@/components/org/letterhead";
import { themeVars } from "@/lib/org/theme";
import { fmtKw, fmtNum, type AcRow, type CertContent, type FanRow } from "@/lib/certs/mechanical";
import type { BusinessPapers, HeldLicence } from "@/lib/certs/query";
import "@/components/studio/summary/sheet-doc.css";
import "./certificate.css";

/* THE CERTIFICATE AS PAPER — one version, as it was issued.

   DRESSED AS THE DESIGN SHEET, by wearing its own classes: the frame in the
   business's colour, the two-party masthead, the row of figures and the
   figures are `dsd-` rules from sheet-doc.css, which Isaac has already
   approved, so a certificate and a design summary read as one business's
   paperwork. The tables are the certificate's own (certificate.css): the
   design sheet's rooms table is built for nine columns and turns into a list
   below 1024px, which three columns never need.

   No "use client" and no hooks: the session's page and the headless
   browser's print page both render it on the server, from the frozen version.
   Nothing on it is computed from anything live except the business's own
   letterhead, which is the business's face today. */

export type PaperJob = {
  number: string | null;
  builder: string | null;
  contact: string | null;
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

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "1 October 2026" — paper outlives the year. */
export function longDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "4 Aug 2026", for the figures row. */
function shortDay(iso: string): string {
  const d = longDay(iso);
  return d ? d.replace(/ (\w{3})\w* /, " $1 ") : "";
}

/** The site as lines: as written when it has lines, else split at its first
    comma, so the title is the street and not the whole address. */
export function addressLines(address: string | null): string[] {
  const lines = (address ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length !== 1) return lines;
  const at = lines[0].indexOf(",");
  return at > 0 ? [lines[0].slice(0, at).trim(), lines[0].slice(at + 1).trim()].filter(Boolean) : lines;
}

function coversLabel(c: CertContent["covers"]): string {
  if (c.ac && c.vent) return "Air conditioning, ventilation";
  return c.vent ? "Ventilation" : "Air conditioning";
}

function modelCell(r: AcRow | FanRow): string {
  const model = r.model.trim();
  return r.qty > 1 ? `${r.qty} × ${model}` : model;
}

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
          <col className="cer-c-num" />
        </colgroup>
        <thead>
          <tr>
            <th>Location</th>
            <th>Model</th>
            {serials && <th>Serial</th>}
            <th className="num">Capacity</th>
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
              <td className="num">
                {s.outdoor.capacityKw !== null ? fmtKw(s.outdoor.capacityKw * Math.max(1, s.outdoor.qty)) : ""}
              </td>
            </tr>,
            ...s.indoors.map((r, j) => (
              <tr key={`i${i}-${j}`}>
                <td className="cer-loc">
                  {r.location}
                </td>
                <td>{modelCell(r)}</td>
                {serials && <td>{r.serial}</td>}
                <td className="num">
                  {r.capacityKw !== null ? fmtKw(r.capacityKw * Math.max(1, r.qty)) : ""}
                </td>
              </tr>
            )),
          ])}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={serials ? 3 : 2}>Total indoor capacity</td>
            <td className="num">{fmtKw(content.indoorKw)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

function FanTable({ content }: { content: CertContent }) {
  const serials = content.showSerials;
  return (
    <section className="cer-sec">
      <h2 className="cer-h">Ventilation</h2>
      <table className="cer-rt">
        <colgroup>
          <col className="cer-c-loc" />
          <col />
          {serials && <col className="cer-c-ser" />}
          <col className="cer-c-num" />
        </colgroup>
        <thead>
          <tr>
            <th>Location</th>
            <th>Model</th>
            {serials && <th>Serial</th>}
            <th className="num">Airflow</th>
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
              <td className="num">
                {f.airflowLps !== null ? `${fmtNum(f.airflowLps)} L/s` : ""}
                <span className="cer-kind">{f.airflowKind === "measured" ? "measured" : "rated"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function CertificatePaper({
  content,
  brand,
  papers,
  job,
  signOff,
  version,
}: {
  content: CertContent;
  brand: OrgBrand;
  papers: BusinessPapers;
  job: PaperJob;
  signOff: PaperSignOff;
  version: number;
}) {
  const address = addressLines(job.address);
  const site = address[0] ?? "";
  const named = hasBrand(brand);
  const contact = [...papers.licences, ...brandContact(brand)];

  const figures: { label: string; value: string }[] = [
    { label: "Certifying", value: coversLabel(content.covers) },
    ...(content.building
      ? [{ label: "Building", value: content.building.cls ? `${content.building.label} (${content.building.cls})` : content.building.label }]
      : []),
    { label: "Completed", value: shortDay(content.completedOn) },
    ...(content.covers.ac ? [{ label: "Outdoor capacity", value: fmtKw(content.outdoorKw) }] : []),
    ...(content.covers.vent ? [{ label: "Fans", value: String(content.fanCount) }] : []),
    ...(content.certifier
      ? [
          { label: "Certifier", value: content.certifier.name },
          ...(content.certifier.projectNumber ? [{ label: "Project no.", value: content.certifier.projectNumber }] : []),
        ]
      : []),
  ];

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
                    <p className="dsd-eyebrow">{content.title}</p>
                    <h1>{site || "Compliance certificate"}</h1>
                    <div className="dsd-prep">
                      <span className="dsd-lab">Prepared by</span>
                      <span className="dsd-org">{named && brand.name ? brand.name : "HeyTiff"}</span>
                      <span className="dsd-date">{longDay(signOff.signedOn)}</span>
                    </div>
                    <address className="dsd-to">
                      {job.builder && <span className="dsd-to-n">{job.builder}</span>}
                      {job.contact && <span className="dsd-to-l">Attention {job.contact}</span>}
                      {address.map((line) => (
                        <span key={line} className="dsd-to-l">
                          {line}
                        </span>
                      ))}
                      {job.number && (
                        <span className="dsd-job">
                          <em>Job</em>
                          <b>{job.number}</b>
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

                <dl className="dsd-figs cer-figs" style={{ ["--cer-n" as string]: figures.length }}>
                  {figures.map((f) => (
                    <div key={f.label}>
                      <dt>{f.label}</dt>
                      <dd>{f.value}</dd>
                    </div>
                  ))}
                </dl>

                {content.covers.ac && content.systems.length > 0 && <AcTable content={content} />}
                {content.covers.vent && content.fans.length > 0 && <FanTable content={content} />}

                <section className="cer-sec">
                  <h2 className="cer-h">Certification</h2>
                  <p className="cer-lede">I certify that the works on this certificate:</p>
                  <ol className="cer-st">
                    {content.statements.map((s, i) => (
                      <li key={i}>{s.text}</li>
                    ))}
                  </ol>
                  {content.notApplicable.map((s, i) => (
                    <p key={i} className="cer-note">
                      Not applicable: {s.text}
                    </p>
                  ))}
                  <p className="cer-note">{content.notCovered}</p>
                </section>

                <dl className="cer-sign">
                  <div>
                    <dt>Signed</dt>
                    <dd className="cer-sig">
                      {/* built server-side from a validated path (lib/swms/input signatureSvg) */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`data:image/svg+xml;utf8,${encodeURIComponent(signOff.signatureSvg)}`} alt={`Signature of ${signOff.name}`} />
                    </dd>
                    <dd className="cer-who">
                      {signOff.name}
                      <span>{longDay(signOff.signedOn)}</span>
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

                <p className="cer-foot">
                  {papers.insurance.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                  {version > 1 && <span>Version {version}</span>}
                </p>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}
