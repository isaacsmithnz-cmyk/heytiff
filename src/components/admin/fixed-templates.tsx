/* THE BUSINESS'S OWN TEMPLATES — each drawn as the document it is, on the
   business's own letterhead, from the same data and the same components the
   real one is drawn from (lib/templates), so this page can't say one thing
   while a quote or a handover sheet says another. Words in brackets are
   filled in from the job.

   The owner changes them in the editors beside the document
   (template-editors); everyone else reads the same panel as words. */

import { DocPaper } from "@/components/documents/doc-paper";
import { HandoverChrome } from "@/app/handover/[id]/sheet-chrome";
import { Letterhead } from "@/components/org/letterhead";
import { hasBrand, type OrgBrand } from "@/lib/org/brand";
import { PAYMENT_PRESET_KEYS } from "@/lib/quotes/payment";
import { CHECKLIST_KEYS, GROUP_ORDER } from "@/lib/quotes/checklist";
import type { ChecklistSeed } from "@/lib/workboard/stages";
import { documentsLetter } from "@/lib/email/documents-letter";
import { fillEmail, type OrgTemplates } from "@/lib/templates/settings";
import { ChecklistEditor, EmailEditor, PaymentTermsEditor, QuoteNotesEditor } from "./template-editors";
import { TemplateFrame } from "./templates-list";
import { templateFor } from "./templates-catalogue";
import "./templates.css";

const pct = (p: number | null) => (p === null ? "" : `${p}%`);

export type TemplateProps = { brand: OrgBrand; templates: OrgTemplates; isOwner: boolean };

/** The checklist's sections, in the order they're first named. */
function sections(items: readonly ChecklistSeed[]): { section: string; labels: string[] }[] {
  const out: { section: string; labels: string[] }[] = [];
  for (const item of items) {
    const at = out.find((s) => s.section === item.section);
    if (at) at.labels.push(item.label);
    else out.push({ section: item.section, labels: [item.label] });
  }
  return out;
}
const handoverOf = (items: readonly ChecklistSeed[]) => items.filter((i) => i.section === "Handover").map((i) => i.label);
const NOT_OWNER = "Only the owner can change these.";

function Ph({ children }: { children: string }) {
  return <span className="tpl-ph">{`[${children}]`}</span>;
}

/* ── the quote ─────────────────────────────────────────────────────────── */

export function QuoteTemplate({ brand, templates, isOwner }: TemplateProps) {
  const t = templateFor("quote")!;
  const home = templates.paymentTerms.domestic_small;
  const always = templates.quoteNotes.filter((n) => n.always);
  return (
    <TemplateFrame
      title={t.title}
      who={t.who}
      doc={
        <DocPaper eyebrow="Air Conditioning Scope" heading="[Site address]" brand={brand} toName="[Customer]" toLines={[]} jobNumber="[Job number]" figures={[]}>
          <section className="cer-sec">
            <p className="cer-lede">
              Hi <Ph>first name</Ph>,
            </p>
            <p className="cer-lede">
              <Ph>{"Why they're getting this, and the options to choose from"}</Ph>
            </p>
          </section>
          <section className="cer-sec">
            <h2 className="cer-h">
              Option 1: <Ph>what it is</Ph>
            </h2>
            <ul className="cer-st">
              <li>
                <Ph>{"What's installed, one line each, in the order the work happens"}</Ph>
              </li>
              <li>
                <Ph>Where the pipes, drain and power run</Ph>
              </li>
            </ul>
            <p className="cer-note">
              Pros and cons: <Ph>when the options differ</Ph>. Price: <Ph>from your price book</Ph>
            </p>
          </section>
          <section className="cer-sec">
            <h2 className="cer-h">Notes</h2>
            {always.map((n) => (
              <div key={n.key} className="cer-note">
                <b>{n.heading}</b>
                {n.lines.map((l) => (
                  <span key={l} style={{ display: "block" }}>
                    {l}
                  </span>
                ))}
              </div>
            ))}
            <p className="cer-note">
              <Ph>The notes this job needs, from the list beside</Ph>
            </p>
          </section>
          <section className="cer-sec">
            <h2 className="cer-h">Payment terms</h2>
            <table className="cer-rt">
              <tbody>
                {home.stages.map((s) => (
                  <tr key={s.when}>
                    <td>{s.when}</td>
                    <td className="num">{pct(s.percent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="cer-note">
              <Ph>The terms for this kind of job</Ph>
            </p>
          </section>
        </DocPaper>
      }
      side={
        <>
          {isOwner ? (
            <>
              <QuoteNotesEditor notes={templates.quoteNotes} changed={!!templates.changed.quote_notes} />
              <PaymentTermsEditor terms={templates.paymentTerms} changed={!!templates.changed.payment_terms} />
            </>
          ) : (
            <>
              <div className="tpl-card">
                <h2>Notes</h2>
                <p className="tpl-quiet">{`Tiff adds the ones a job needs. ${NOT_OWNER}`}</p>
                <div className="tpl-rows">
                  {templates.quoteNotes.map((n) => (
                    <div key={n.key} className="tpl-row">
                      <span>
                        <b>{n.always ? `${n.heading} (on every quote)` : n.heading}</b>
                        <em>{n.lines.join(" ")}</em>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="tpl-card">
                <h2>Payment terms</h2>
                {PAYMENT_PRESET_KEYS.map((k) => (
                  <div key={k} className="tpl-rows">
                    <div className="tpl-row">
                      <span>
                        <b>{templates.paymentTerms[k].label}</b>
                      </span>
                    </div>
                    {templates.paymentTerms[k].stages.map((s) => (
                      <div key={s.when} className="tpl-row">
                        <span>
                          <em>{s.when}</em>
                        </span>
                        <span className="tpl-num">{pct(s.percent)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="tpl-card">
            <h2>Before it goes out</h2>
            <p className="tpl-quiet">{`Tiff checks ${CHECKLIST_KEYS.length} things before a quote is ready: ${GROUP_ORDER.join(", ").toLowerCase()}.`}</p>
          </div>
        </>
      }
    />
  );
}

/* ── the handover sheet ────────────────────────────────────────────────── */

export function HandoverTemplate({ brand, templates, isOwner }: TemplateProps) {
  const t = templateFor("handover")!;
  const checks = handoverOf(templates.projectChecklist);
  return (
    <TemplateFrame
      title={t.title}
      who={t.who}
      doc={
        <HandoverChrome brand={brand}>
          <div className="ho-head">
            <Letterhead brand={brand} />
            <p className="ho-kicker">Handover sheet</p>
          </div>
          <h1>[Project name]</h1>
          <p className="ho-sub">[Customer], [site address]</p>
          <div className="ho-meta">
            {["Stage", "Promised finish", "Defects period ends", "Contract total"].map((m) => (
              <div key={m}>
                <span>{m}</span>
                <b>[{m.toLowerCase()}]</b>
              </div>
            ))}
          </div>
          <h2>Equipment installed</h2>
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
              <tr>
                <td>[Unit]</td>
                <td>[Model]</td>
                <td>[Serial]</td>
                <td>[Room]</td>
                <td>[Left or not]</td>
              </tr>
            </tbody>
          </table>
          <h2>Scope of the installation</h2>
          <p className="ho-note">[The project&apos;s scope: what&apos;s included, what isn&apos;t, and approved variations]</p>
          <h2>Commissioning record</h2>
          <p className="ho-note">[The readings taken at commissioning]</p>
          <h2>Handover checks</h2>
          <ul>
            {checks.map((label) => (
              <li key={label}>{label}</li>
            ))}
            {checks.length === 0 && <li className="ho-note">No handover checklist on this project.</li>}
          </ul>
          <div className="ho-sign">
            <div>Handed over by — name, signature, date</div>
            <div>Received for the client — name, signature, date</div>
          </div>
          {hasBrand(brand) && <p className="ho-note ho-foot">{`Installed by ${brand.name || "us"}${brand.phone ? ` — ${brand.phone}` : ""}`}</p>}
        </HandoverChrome>
      }
      side={
        <>
          {isOwner ? (
            <ChecklistEditor items={templates.projectChecklist} changed={!!templates.changed.project_checklist} only="Handover" />
          ) : (
            <div className="tpl-card">
              <h2>Handover checks</h2>
              <p className="tpl-quiet">{`The Handover section of the project checklist. ${NOT_OWNER}`}</p>
              <div className="tpl-rows">
                {checks.map((label) => (
                  <div key={label} className="tpl-row">
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="tpl-card">
            <h2>The rest of the sheet</h2>
            <p className="tpl-quiet">The equipment, scope and commissioning record come from the project. The headings and signature lines are the same on every sheet.</p>
          </div>
        </>
      }
    />
  );
}

/* ── the documents email ───────────────────────────────────────────────── */

export function DocumentsEmailTemplate({ brand, templates, isOwner }: TemplateProps) {
  const t = templateFor("documents-email")!;
  const business = brand.name.trim() || null;
  /* the template's own brackets stay as they are; only the business is known */
  const facts = { jobNumber: "[job number]", siteAddress: "[site address]", yourName: "[your name]", business: business ?? "[your business]" };
  const subject = fillEmail(templates.documentsEmail.subject, facts);
  const message = fillEmail(templates.documentsEmail.message, facts);
  /* the letter as it is sent, drawn from the same function; its images are
     the app's own, so a relative origin finds them */
  const html = documentsLetter({ baseUrl: "", business, sender: "[your name]", message, files: ["[Each file picked]"] });
  return (
    <TemplateFrame
      title={t.title}
      who={t.who}
      doc={
        <div className="tpl-mail">
          <dl className="tpl-env">
            <dt>From</dt>
            <dd>{`${business ?? "[Your business]"} via HeyTiff`}</dd>
            <dt>To</dt>
            <dd>[Who you pick]</dd>
            <dt>Subject</dt>
            <dd>
              <b>{subject}</b>
            </dd>
          </dl>
          <iframe className="tpl-letter" title="The email as it arrives" srcDoc={html} sandbox="" />
        </div>
      }
      side={
        isOwner ? (
          <EmailEditor email={templates.documentsEmail} changed={!!templates.changed.documents_email} />
        ) : (
          <div className="tpl-card">
            <h2>What it starts as</h2>
            <p className="tpl-quiet">{`Whoever sends it can change the subject and message on the job card before it goes. ${NOT_OWNER}`}</p>
            <div className="tpl-rows">
              <div className="tpl-row">
                <span>
                  <em>Subject</em>
                  {templates.documentsEmail.subject}
                </span>
              </div>
              <div className="tpl-row">
                <span>
                  <em>Message</em>
                  <span style={{ whiteSpace: "pre-line" }}>{templates.documentsEmail.message}</span>
                </span>
              </div>
            </div>
          </div>
        )
      }
    />
  );
}

/* ── every new project's checklist ─────────────────────────────────────── */

export function ProjectChecklistTemplate({ templates, isOwner }: Omit<TemplateProps, "brand">) {
  const t = templateFor("project-checklist")!;
  return (
    <TemplateFrame
      title={t.title}
      who={t.who}
      doc={
        <div className="tpl-sheet">
          {sections(templates.projectChecklist).map((s) => (
            <div key={s.section}>
              <h3>{s.section}</h3>
              <ul>
                {s.labels.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      }
      side={
        isOwner ? (
          <ChecklistEditor items={templates.projectChecklist} changed={!!templates.changed.project_checklist} />
        ) : (
          <div className="tpl-card">
            <h2>On the project</h2>
            <p className="tpl-quiet">{`Each section unlocks with its stage. The Handover items print on the handover sheet. ${NOT_OWNER}`}</p>
          </div>
        )
      }
    />
  );
}
