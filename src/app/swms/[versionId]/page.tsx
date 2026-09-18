import { notFound, redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { orgBrand } from "@/lib/org/query";
import { brandContact, hasBrand } from "@/lib/org/brand";
import { Letterhead } from "@/components/org/letterhead";
import { todayInAu } from "@/lib/au-dates";
import { loadSwmsDocument, loadSwmsTeam } from "@/lib/swms/query";
import { CONSEQUENCE, HRCW, LEVEL_LABEL, LIKELIHOOD, riskLevel, type Rating } from "@/lib/swms/library";
import { siteDay, siteWhen } from "@/lib/swms/when";
import { PrintButton } from "./print-button";
import "./swms-doc.css";

/* THE SWMS AS PAPER — one version, as it was issued.

   Lives OUTSIDE the dashboard shell, like the handover sheet, so what prints
   is the document and nothing else. Everything on it comes from the frozen
   version: the library's words as they were when it was issued, the answers
   from site, and who signed on. The tickets are the one live read — a
   licence renewed since issue is still the licence held.

   THE SAME DOOR AS THE SIGN-ON: someone the SWMS covers, or the Workboard. */

const REGULATION = {
  NSW: "Work Health and Safety Regulation 2025 (NSW)",
  QLD: "Work Health and Safety Regulation 2011 (Qld)",
} as const;

const score = (r: Rating) => `${r.likelihood} × ${r.consequence} = ${r.likelihood * r.consequence}, ${riskLevel(r)}`;

export default async function SwmsDocumentPage({ params }: { params: Promise<{ versionId: string }> }) {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) redirect("/dashboard");

  const { versionId } = await params;
  const [doc, me] = await Promise.all([loadSwmsDocument(orgId, versionId.slice(0, 80)), staffIdFor(orgId, userId)]);
  if (!doc) notFound();
  const onIt = !!me && doc.people.some((p) => p.staffProfileId === me);
  if (!onIt && !(await can("workboard"))) redirect("/dashboard");

  const [brand, team] = await Promise.all([orgBrand(orgId), doc.job ? loadSwmsTeam(orgId, doc.job.uuid, todayInAu()) : Promise.resolve([])]);
  const c = doc.content;
  const a = doc.answers;
  /* the site's clock, in the app's words, with the year paper outlives */
  const fmtDay = (iso: string) => siteDay(iso, c.jurisdiction, { year: true });
  const fmtWhen = (iso: string) => siteWhen(iso, c.jurisdiction, { year: true });
  const on = new Map(c.categories.map((k) => [k.n, k.reason]));
  const id = `SWMS-${doc.job?.number ?? doc.swmsId.slice(0, 8)}-${doc.version}`;
  const business = [brand.name || null, brandContact(brand)[0] ?? null].filter(Boolean).join(", ");
  const responsible = doc.responsible;

  const foot = (
    <p className="swd-foot">
      {`${id}, version ${doc.version}. Keep with the job until the work is finished, and for 2 years after any notifiable incident.`}
    </p>
  );

  return (
    <div className="swd-sheet">
      <PrintButton />
      <main className="swd">
        <header className="swd-head">
          {hasBrand(brand) ? <Letterhead brand={brand} /> : <span />}
          <p className="swd-id">
            <b>{id}</b>
            {`Version ${doc.version}, issued ${fmtDay(doc.issuedAt)}`}
            {!doc.latest && <span className="swd-replaced">Replaced by a later version</span>}
          </p>
        </header>

        <h1>Safe Work Method Statement</h1>

        <h2>The work</h2>
        <table className="swd-kv">
          <tbody>
            <tr>
              <th scope="row">Business carrying out the work</th>
              <td>{business || "—"}</td>
            </tr>
            <tr>
              <th scope="row">Job</th>
              <td>{[doc.job?.number ? `#${doc.job.number}` : null, doc.job?.clientName].filter(Boolean).join(", ") || "—"}</td>
            </tr>
            <tr>
              <th scope="row">Workplace</th>
              <td>{doc.job?.address ?? "—"}</td>
            </tr>
            <tr>
              <th scope="row">Work activity</th>
              <td>{c.work}</td>
            </tr>
            <tr>
              <th scope="row">Principal contractor</th>
              <td>{a.site.builder ? `${a.builderName?.trim() || "A builder"} runs the site and is given a copy before work starts` : "None"}</td>
            </tr>
            <tr>
              <th scope="row">Responsible for compliance on site</th>
              <td>{responsible}</td>
            </tr>
            <tr>
              <th scope="row">Prepared</th>
              <td>{`${fmtDay(doc.issuedAt)}, in consultation with the workers below. Checked against the site by ${doc.siteCheckedBy}, ${fmtWhen(doc.siteCheckedAt)}.`}</td>
            </tr>
            <tr>
              <th scope="row">Rules applied</th>
              <td>{REGULATION[c.jurisdiction]}</td>
            </tr>
          </tbody>
        </table>

        <h2>High-risk construction work in this job</h2>
        <ul className="swd-hrcw">
          {HRCW.map((h) => (
            <li key={h.n} className={on.has(h.n) ? "on" : undefined}>
              <span className="swd-box" aria-hidden="true">{on.has(h.n) ? "✓" : ""}</span>
              <span className="swd-n">{h.n}</span>
              <span>
                {h.label}
                {on.has(h.n) && <em>{on.get(h.n)}</em>}
              </span>
            </li>
          ))}
        </ul>

        {c.siteNotes.length > 0 && (
          <>
            <h2>Site conditions taken into account</h2>
            <ul className="swd-list">
              {c.siteNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </>
        )}

        <h2>Compliance and review</h2>
        <table className="swd-kv">
          <tbody>
            <tr>
              <th scope="row">Ensures this SWMS is followed</th>
              <td>{`${responsible}: briefs every worker before work starts, and checks each step's controls are in place before that step begins`}</td>
            </tr>
            <tr>
              <th scope="row">Workers consulted</th>
              <td>At the briefing before work starts; any issue a worker raises is recorded at their sign-on</td>
            </tr>
            <tr>
              <th scope="row">Review</th>
              <td>
                Reviewed and issued as a new version when the work method or the site changes, a control isn&apos;t working, a
                new hazard is found, after any incident, or when a worker or health and safety representative asks
              </td>
            </tr>
          </tbody>
        </table>
        <p className="swd-stop">
          If a control in this SWMS isn&apos;t in place, or can&apos;t be followed, stop the work. Restart only when the control is
          back in place, or once this SWMS has been reviewed and issued again.
        </p>

        <section className="swd-page">
          <h2>Steps, hazards and controls</h2>
          <table className="swd-steps">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Step</th>
                <th scope="col">Hazards and risks</th>
                <th scope="col">Control measures</th>
                <th scope="col">Who</th>
              </tr>
            </thead>
            <tbody>
              {c.steps.map((s, i) => (
                <tr key={s.key}>
                  <td className="swd-num">{i + 1}</td>
                  <td>
                    <b>{s.title}</b>
                    {(s.categories.length > 0 || s.silica) && (
                      <em>{[s.categories.length ? `High-risk work ${s.categories.join(", ")}` : null, s.silica ? "Silica" : null].filter(Boolean).join("; ")}</em>
                    )}
                    {s.site && <em className="swd-site">Written for this site</em>}
                  </td>
                  <td>{s.hazards}</td>
                  <td>
                    <ul className="swd-controls">
                      {s.controls.map((k) => (
                        <li key={k.text}>
                          <span>{LEVEL_LABEL[k.level]}</span>
                          {k.text}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>{s.who}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="swd-page">
          <h2>Plant and equipment</h2>
          <ul className="swd-list swd-cols">
            {c.plant.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>

          <h2>Protective equipment</h2>
          <p>{`${c.ppe.join("; ")}.`}</p>

          <h2>Licences and competencies</h2>
          <p>{c.licenceNote}</p>
          <table className="swd-grid">
            <thead>
              <tr>
                <th scope="col">Worker</th>
                <th scope="col">Licences and tickets on file</th>
              </tr>
            </thead>
            <tbody>
              {doc.people.map((p) => {
                const t = p.staffProfileId ? team.find((m) => m.id === p.staffProfileId) : null;
                const held = t?.tickets.filter((k) => k.current).map((k) => k.name) ?? [];
                return (
                  <tr key={p.id}>
                    <td>
                      <b>{p.name}</b>
                      {p.role && <em>{p.role}</em>}
                    </td>
                    <td>{p.team ? (held.length ? held.join("; ") : "None on file") : "From outside the business, so none on file"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h2>Emergency</h2>
          <table className="swd-kv">
            <tbody>
              <tr>
                <th scope="row">Emergency services</th>
                <td>000</td>
              </tr>
              <tr>
                <th scope="row">First aider</th>
                <td>{c.emergency.firstAider}</td>
              </tr>
              <tr>
                <th scope="row">Nearest hospital</th>
                <td>{c.emergency.hospital || "—"}</td>
              </tr>
              <tr>
                <th scope="row">Fire extinguisher</th>
                <td>{c.emergency.extinguisher}</td>
              </tr>
            </tbody>
          </table>

          <h2>Versions</h2>
          <table className="swd-grid">
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Issued</th>
                <th scope="col">Reason and what changed</th>
                <th scope="col">Everyone signed on again</th>
                <th scope="col">Issued by</th>
              </tr>
            </thead>
            <tbody>
              {doc.versions.map((v) => (
                <tr key={v.id}>
                  <td className="swd-num">{v.version}</td>
                  <td>{fmtDay(v.issuedAt)}</td>
                  <td>{v.reason}</td>
                  <td>{v.version === 1 ? "—" : v.material ? "Yes" : "No, a correction"}</td>
                  <td>{v.issuedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Worker sign-on</h2>
          <p>
            {`By signing, each worker confirms they were consulted and briefed on this SWMS, understand it, and will follow it. If a control can't be followed they stop work and tell ${responsible}. ${responsible} signs to brief everyone it covers before work starts, and to stop the work if a control can't be followed.`}
          </p>
          <table className="swd-grid swd-signons">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Briefed by</th>
                <th scope="col">Signed on</th>
                <th scope="col">Signature</th>
                <th scope="col">Issue raised</th>
              </tr>
            </thead>
            <tbody>
              {doc.people.map((p) => (
                <tr key={p.id}>
                  <td>
                    <b>{p.name}</b>
                    {p.role && <em>{p.role}</em>}
                  </td>
                  {/* the person in charge gives the briefing; nobody briefs them */}
                  <td>{p.signon ? p.signon.briefedBy ?? (p.staffProfileId === doc.responsibleStaffId ? "Gives the briefing" : "") : ""}</td>
                  <td>
                    {p.signon
                      ? `${fmtWhen(p.signon.at)}${p.signon.version < doc.version ? `, on version ${p.signon.version}` : ""}${
                          p.signon.onPhoneOf ? `, on ${p.signon.onPhoneOf}'s phone` : ""
                        }`
                      : ""}
                  </td>
                  <td className="swd-sig">
                    {p.signon && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt={`Signature of ${p.name}`} src={`data:image/svg+xml;utf8,${encodeURIComponent(p.signon.svg)}`} />
                    )}
                  </td>
                  <td>
                    {p.signon ? (
                      p.signon.issue ? (
                        <>
                          {p.signon.issue}
                          {p.signon.issueCleared && <em>{`Sorted on site by ${p.signon.issueCleared.by}, ${fmtWhen(p.signon.issueCleared.at)}`}</em>}
                        </>
                      ) : (
                        "None"
                      )
                    ) : (
                      ""
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {foot}
        </section>

        {c.riskScores && (
          <section className="swd-page">
            <h2>Appendix: risk scores</h2>
            <p>
              Each step&apos;s risk, before and after its controls: likelihood times consequence, each rated 1 to 5. The controls
              above are what the crew follows; these scores don&apos;t change them.
            </p>
            <table className="swd-grid">
              <thead>
                <tr>
                  <th scope="col">Step</th>
                  <th scope="col">Before controls</th>
                  <th scope="col">After controls</th>
                </tr>
              </thead>
              <tbody>
                {c.riskScores.map((r) => (
                  <tr key={r.key}>
                    <td>{r.title}</td>
                    <td className="swd-num">{score(r.before)}</td>
                    <td className="swd-num">{score(r.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="swd-grid swd-key">
              <thead>
                <tr>
                  <th scope="col">Rating</th>
                  <th scope="col">Likelihood</th>
                  <th scope="col">Consequence</th>
                </tr>
              </thead>
              <tbody>
                {LIKELIHOOD.map((l, i) => (
                  <tr key={l}>
                    <td className="swd-num">{i + 1}</td>
                    <td>{l}</td>
                    <td>{CONSEQUENCE[i]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>Score 1 to 4 is Low, 5 to 9 Medium, 10 to 19 High, and 20 to 25 Extreme.</p>
            {foot}
          </section>
        )}
      </main>
    </div>
  );
}
