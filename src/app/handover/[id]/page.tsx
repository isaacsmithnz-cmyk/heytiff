import { notFound, redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { auth0 } from "@/lib/auth0";
import { getProjectDetail } from "@/lib/workboard/projects-query";
import { listProjectEntries } from "@/lib/workboard/notes-query";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { deriveProjectMoney, fmtAud } from "@/lib/workboard/project-money";
import { PrintButton } from "./print-button";

/* The handover sheet — the generated deliverable the whole projects feature
   was pointed at: what was installed (with serials), what it was set to,
   what's in and out of the price, and the walkthrough sign-off. Lives
   OUTSIDE the dashboard shell so the print is the sheet and nothing else;
   the door is the same workboard gate, and a foreign id is a 404.

   Server-rendered from the project's own record — nothing here is typed
   twice. Print styles ride along in the page: one file, one deliverable. */

const CSS = `
  .ho { max-width: 780px; margin: 0 auto; padding: 40px 28px 64px; color: #16181d;
    font-family: var(--font-jakarta, "Plus Jakarta Sans", sans-serif); font-size: 13.5px; line-height: 1.5; }
  .ho h1 { font-size: 30px; font-weight: 800; letter-spacing: -0.02em; margin: 2px 0 4px; }
  .ho h2 { font-size: 12px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;
    color: #6b7280; margin: 26px 0 8px; border-bottom: 2px solid #16181d; padding-bottom: 5px; }
  .ho-kicker { font-size: 11px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #6b7280; }
  .ho-sub { color: #4b5563; margin: 0; }
  .ho-meta { display: flex; gap: 26px; flex-wrap: wrap; margin-top: 14px; }
  .ho-meta div { min-width: 130px; }
  .ho-meta span { display: block; font-size: 10px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: #9ca3af; }
  .ho-meta b { font-size: 13px; }
  .ho table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  .ho th { text-align: left; font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase;
    color: #6b7280; padding: 6px 8px 6px 0; border-bottom: 1px solid #d1d5db; }
  .ho td { padding: 7px 8px 7px 0; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  .ho-two { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
  .ho ul { margin: 4px 0 0; padding-left: 18px; }
  .ho li { margin: 3px 0; }
  .ho-check { color: #00806b; font-weight: 800; }
  .ho-cross { color: #b31038; font-weight: 800; }
  .ho-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 30px; }
  .ho-sign div { border-top: 1.5px solid #16181d; padding-top: 6px; font-size: 11.5px; color: #4b5563; }
  .ho-print { position: fixed; top: 16px; right: 16px; border: 1px solid #d1d5db; background: #fff;
    border-radius: 10px; padding: 9px 14px; font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }
  .ho-note { color: #6b7280; font-size: 12px; }
  @media print {
    .ho-print { display: none; }
    .ho { padding: 0; max-width: none; }
    @page { margin: 16mm; }
  }
`;

export default async function HandoverSheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await can("workboard"))) redirect("/dashboard");
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const { id } = await params;
  const [project, entries] = await Promise.all([
    getProjectDetail(orgId, id),
    listProjectEntries(orgId, id),
  ]);
  if (!project) notFound();

  const commissioning = entries.filter((e) => e.kind === "commissioning");
  const handoverItems = project.checklist.filter((i) => i.section === "Handover");
  const inclusions = project.scope.filter((s) => s.kind === "inclusion");
  const exclusions = project.scope.filter((s) => s.kind === "exclusion");
  const approved = project.variations.filter((v) => v.status === "approved");
  const money = deriveProjectMoney({
    budgetCents: project.budgetCents,
    variations: project.variations,
    claims: project.claims,
  });

  return (
    <main className="ho">
      <style>{CSS}</style>
      <PrintButton />

      <p className="ho-kicker">Handover sheet</p>
      <h1>{project.name}</h1>
      <p className="ho-sub">
        {[project.clientName, project.siteLabel, project.siteAddress].filter(Boolean).join(" · ")}
      </p>
      <div className="ho-meta">
        <div>
          <span>Stage</span>
          <b>{project.stage}</b>
        </div>
        {project.promisedFinish && (
          <div>
            <span>Promised finish</span>
            <b>{fmtAuWeekdayDayMonth(project.promisedFinish)}</b>
          </div>
        )}
        {project.defectsEnd && (
          <div>
            <span>Defects period ends</span>
            <b>{fmtAuWeekdayDayMonth(project.defectsEnd)}</b>
          </div>
        )}
        {money.revisedTotalCents !== null && (
          <div>
            <span>Contract total</span>
            <b>{fmtAud(money.revisedTotalCents)}</b>
          </div>
        )}
      </div>

      <h2>Equipment installed</h2>
      {project.equipment.length === 0 ? (
        <p className="ho-note">No equipment recorded on this project.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Equipment</th>
              <th>Model</th>
              <th>Serial</th>
              <th>Where</th>
              <th>Manual</th>
            </tr>
          </thead>
          <tbody>
            {project.equipment.map((e) => (
              <tr key={e.id}>
                <td>{e.description}</td>
                <td>{e.model ?? "—"}</td>
                <td>{e.serial ?? "—"}</td>
                <td>{e.locationNote ?? "—"}</td>
                <td>{e.manualLeft ? <span className="ho-check">left ✓</span> : "not left"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(inclusions.length > 0 || exclusions.length > 0 || approved.length > 0) && (
        <>
          <h2>Scope of the installation</h2>
          <div className="ho-two">
            <div>
              {inclusions.length > 0 && (
                <ul>
                  {inclusions.map((s) => (
                    <li key={s.id}>
                      <span className="ho-check">✓</span> {s.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              {exclusions.length > 0 && (
                <ul>
                  {exclusions.map((s) => (
                    <li key={s.id}>
                      <span className="ho-cross">✗</span> {s.label} <em>(not included)</em>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {approved.length > 0 && (
            <ul>
              {approved.map((v) => (
                <li key={v.id}>
                  Variation — {v.title} ({v.amountCents > 0 ? "+" : ""}
                  {fmtAud(v.amountCents)}
                  {v.decidedBy ? `, approved by ${v.decidedBy}` : ""})
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <h2>Commissioning record</h2>
      {commissioning.length === 0 ? (
        <p className="ho-note">No commissioning readings recorded.</p>
      ) : (
        <table>
          <tbody>
            {commissioning.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: "nowrap", width: 110 }}>
                  {fmtAuWeekdayDayMonth(e.entryDate)}
                </td>
                <td>{e.body}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Handover checks</h2>
      <ul>
        {handoverItems.map((i) => (
          <li key={i.id}>
            <span className={i.done ? "ho-check" : "ho-cross"}>{i.done ? "✓" : "✗"}</span>{" "}
            {i.label}
            {i.done && i.doneAt ? ` — ${fmtAuWeekdayDayMonth(i.doneAt.slice(0, 10))}` : ""}
          </li>
        ))}
        {handoverItems.length === 0 && <li className="ho-note">No handover checklist on this project.</li>}
      </ul>

      <div className="ho-sign">
        <div>Handed over by — name, signature, date</div>
        <div>Received for the client — name, signature, date</div>
      </div>
    </main>
  );
}
