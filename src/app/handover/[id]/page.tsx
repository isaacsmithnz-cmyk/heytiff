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
import { themeVars } from "@/lib/org/theme";
import { PrintButton } from "./print-button";

/* The handover sheet — the generated deliverable the whole projects feature
   was pointed at: what was installed (with serials), what it was set to,
   what's in and out of the price, and the walkthrough sign-off. Lives
   OUTSIDE the dashboard shell so the print is the sheet and nothing else;
   the door is the same workboard gate, and a foreign id is a 404.

   Server-rendered from the project's own record — nothing here is typed
   twice. Print styles ride along in the page: one file, one deliverable. */

const CSS = `
  /* THE BUSINESS FRAME — the same construction and the same numbers as the
     design sheet (components/studio/summary/sheet-doc.css). One filled
     rectangle behind the sheet with a white well inset on ALL FOUR sides and
     rounded at the corners, which is '.fg .outlet' exactly. Carries nothing,
     so no contrast floor and no reversed artwork.

     It was a head and a foot only and it did not read - a band that stops at
     the left and right edges looks like two bars rather than a frame around a
     page. The sides cost: two strips the full height of the sheet, so the same
     8mm that inked 5.47% as a band inks 13.09% as a frame.

     EVERY NUMBER COMES FROM themeVars, which always returns a full set: a
     business that has chosen no colour gets the band in this sheet's own ink
     rather than no band. The fallbacks here are the values the sheet had
     before, so a missing variable degrades to the old document rather than to
     a broken one.

     The frame REPLACES the sheet's old margins rather than stacking on them -
     it is occupying that space, not sitting outside it. */
  .ho-band { position: absolute; inset: 0;
    background: var(--doc-ink, transparent); pointer-events: none;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ho-well { position: absolute; inset: var(--doc-gutter, 0px);
    background: #fff; border-radius: var(--doc-radius, 0px); pointer-events: none; }
  .ho-sheet { position: relative; min-height: 100vh; }
  /* scoped to the CONTENT: a '.ho-sheet > *' rule would also match the two
     layers above at equal specificity and strip their position:absolute */
  .ho-sheet > .ho { position: relative; }
  .ho { max-width: 780px; margin: 0 auto; padding: var(--doc-pad, 40px) calc(28px + var(--doc-side, 0px)) var(--doc-pad, 64px); color: #16181d;
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
  /* The letterhead band. A rule under it rather than a box around it: this is
     the top of a document, and the sheet already has enough frames. */
  .ho-head { display: flex; align-items: flex-end; justify-content: space-between;
    gap: 24px; flex-wrap: wrap; padding-bottom: 14px; margin-bottom: 22px;
    border-bottom: 2px solid #16181d; }
  /* The letterhead is the part that gives, and the kicker is the part that
     does not: a long contact line wraps inside the letterhead rather than
     pushing "Handover sheet" onto a line of its own, where it would sit at
     the wrong end of the band with nothing to align against.

     The basis is 0 and not auto, which is the whole trick. The band wraps,
     and a flex item measured at auto is sized to its MAX-CONTENT before
     wrapping is decided — so a long business name plus a full contact line
     was taken as one unbreakable lump and pushed onto its own line. At a zero
     basis the two always share the line, and min-width:0 is what lets the
     contact wrap inside the letterhead instead. */
  .ho-head .org-lh { flex: 1 1 0; min-width: 0; }
  .ho-head .ho-kicker { flex: 0 0 auto; text-align: right; }
  .ho-foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #e5e7eb; }
  @media print {
    .ho-print { display: none; }
    /* the band must not be orphaned at the foot of a page from its own sheet */
    .ho-head { break-after: avoid; }
    .ho { padding: var(--doc-pad, 0px) var(--doc-side, 0px); max-width: none; }
    /* fixed, so the band repeats on every printed sheet rather than only the
       first and last. UNVERIFIED against a real printer - see the PR. */
    .ho-band, .ho-well { position: fixed; }
    .ho-sheet { min-height: 0; }
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
    <div className="ho-sheet" style={themeVars(brand.color)}>
      <style>{CSS}</style>
      {/* THE BUSINESS'S BAND. Carries nothing and is announced to nobody: it is
          decoration, and a screen reader reading out a coloured rectangle is
          reading out something that is not there. */}
      <div className="ho-band" aria-hidden="true" />
      <div className="ho-well" aria-hidden="true" />
      <main className="ho">
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
    </main>
    </div>
  );
}
