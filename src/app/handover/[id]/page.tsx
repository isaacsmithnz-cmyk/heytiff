import { notFound, redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { auth0 } from "@/lib/auth0";
import { getProjectDetail } from "@/lib/workboard/projects-query";
import { listProjectEntries } from "@/lib/workboard/notes-query";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { deriveProjectMoney, fmtAud } from "@/lib/workboard/project-money";
import { orgBrand } from "@/lib/org/query";
import { hasBrand } from "@/lib/org/brand";
import { Letterhead } from "@/components/org/letterhead";
import { HandoverChrome } from "./sheet-chrome";
import { PrintButton } from "./print-button";

/* The handover sheet — the generated deliverable the whole projects feature
   was pointed at: what was installed (with serials), what it was set to,
   what's in and out of the price, and the walkthrough sign-off. Lives
   OUTSIDE the dashboard shell so the print is the sheet and nothing else;
   the door is the same workboard gate, and a foreign id is a 404.

   Server-rendered from the project's own record — nothing here is typed
   twice. The paper it prints on — the business frame, the print machinery
   and the stylesheet — is HandoverChrome (sheet-chrome.tsx), split out so a
   harness can render the real sheet without this page's auth gate. */


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
  const [project, entries, brand] = await Promise.all([
    getProjectDetail(orgId, id),
    listProjectEntries(orgId, id),
    orgBrand(orgId),
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
    <HandoverChrome brand={brand}>
      <PrintButton />

      {/* WHO SENT THIS. The sheet is the deliverable a customer is handed at
          the end of a job, and until now it carried no business name at all —
          not the installer's, not anyone's. The kicker moves to the other end
          of the same band so the letterhead gets the corner a letterhead
          gets; with no brand set the band collapses to the kicker alone,
          exactly as the sheet read before. */}
      <div className="ho-head">
        <Letterhead brand={brand} />
        <p className="ho-kicker">Handover sheet</p>
      </div>

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

      {/* The sheet outlives the visit — it goes in a drawer and comes back out
          when something stops working. The name at the top says who did the
          work; this says who to ring about it, at the end, where a reader
          looks for it. Only when there is a business to name. */}
      {hasBrand(brand) && (
        <p className="ho-note ho-foot">
          Installed by {brand.name || "us"}
          {brand.phone ? ` — ${brand.phone}` : ""}
          {brand.email ? ` · ${brand.email}` : ""}
        </p>
      )}
    </HandoverChrome>
  );
}
