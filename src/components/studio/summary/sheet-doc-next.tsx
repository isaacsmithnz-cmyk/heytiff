import type { CSSProperties, ReactNode } from "react";
import type { DesignDocument } from "@/lib/studio/document";
import type { SheetSections } from "@/lib/studio/export";
import type { SummaryModel } from "@/lib/studio/summary";
import { MATERIAL_GROUPS, type MaterialRow, type PaperFigures, type PaperRoom, type PaperSystem, type PaperTone } from "@/lib/studio/summary-paper";
import { brandContact, hasBrand, type OrgBrand } from "@/lib/org/brand";
import { documentTheme } from "@/lib/org/theme";
import { BrandLogo } from "@/components/org/letterhead";
import { fmt1, pct } from "./sheet-tables";
import type { LetterheadFields } from "./sheet-doc";
import "./sheet-doc.css";

/* THE NEXT FLOW'S DOCUMENT (boards Summary-1 and Summary-2): a page of figures
   and a block per system, then Materials and the notes on the plans. The plans
   follow on pages of their own (print-doc.tsx).

   Beside SheetDoc rather than inside it, so the Summary, the customer's link
   and the paper of the current flow stay exactly as they are; when the next
   flow is approved, SheetDoc goes and this takes its name.

   Same discipline as SheetDoc: no "use client" and no hooks, a caller's chrome
   comes in by prop, and no figure is worked out here. Everything shown comes
   off `model.paper` (lib/studio/summary-paper.ts), which buildSummaryModel
   derives. The business's colour is its own, on the document only: its letterhead
   and the rule under it, and nothing on the app's chrome. */

/** A PAGE ON PAPER, A BLOCK ON A SCREEN. The paper has no margin, so a browser
    has nowhere to stamp its date and URL (print-doc.tsx). A table's head and
    foot are the only boxes a print engine repeats on every page, so they hold
    the top of each page and its footer clear; on a screen they are not there. */
function Page({ className, children }: { className: string; children: ReactNode }) {
  return (
    <section className={`dsn-page ${className}`}>
      <table className="dsn-pg" role="presentation">
        <thead>
          <tr>
            <td className="dsn-pg-t" />
          </tr>
        </thead>
        <tfoot>
          <tr>
            <td className="dsn-pg-b" />
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td className="dsn-pg-c">{children}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

/** a screen has no pages, so no numbers. Paper prints this from its page box */
function ScreenFoot({ note }: { note?: string }) {
  return (
    <footer className="dsn-foot">
      <span>{note}</span>
      <span>Prepared with HeyTiff</span>
    </footer>
  );
}

function State({ tone, children }: { tone: PaperTone; children: ReactNode }) {
  return <span className={`dsn-st dsn-${tone}`}>{children}</span>;
}

function Masthead({
  doc,
  brand,
  preparedOn,
  fields,
  provenance,
}: {
  doc: DesignDocument;
  brand: OrgBrand;
  preparedOn: string;
  fields?: LetterheadFields;
  provenance?: ReactNode;
}) {
  const address = doc.meta.site.split("\n").map((l) => l.trim()).filter(Boolean);
  const option = doc.meta.variantLabel ? `, ${doc.meta.variantLabel.toLowerCase()}` : "";
  const named = hasBrand(brand);
  const contact = brandContact(brand);
  return (
    <header className="dsn-mast">
      <div className="dsn-job">
        <h1>{doc.meta.name || address[0] || "Design"}</h1>
        {fields ? (
          <>
            <p className="dsn-sub">
              Air conditioning design for {fields.client}, job {fields.jobNumber}
              {option}
            </p>
            <div className="dsn-sub dsn-where">
              {fields.site}
              <span>{preparedOn}</span>
            </div>
          </>
        ) : (
          <>
            <p className="dsn-sub">
              Air conditioning design
              {doc.meta.client && ` for ${doc.meta.client}`}
              {doc.meta.jobNumber && `, job ${doc.meta.jobNumber}`}
              {option}
            </p>
            <p className="dsn-sub">
              {address.length > 0 && `${address.join(", ")}. `}
              {preparedOn}
            </p>
          </>
        )}
        {provenance && <div className="dsn-src">{provenance}</div>}
      </div>
      {named && (
        <div className="dsn-ident">
          {brand.logoUrl && <BrandLogo brand={brand} className="dsn-logo" />}
          {brand.name && <b>{brand.name}</b>}
          {contact.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      )}
    </header>
  );
}

function Figures({ f }: { f: PaperFigures }) {
  return (
    <dl className="dsn-figs">
      <div className="dsn-big">
        <dt>Heat load</dt>
        <dd>{fmt1(f.loadKw, "kW")}</dd>
        <dd className="dsn-q">{f.loadLine}</dd>
      </div>
      <div>
        <dt>{f.installedLabel}</dt>
        <dd>{fmt1(f.installedKw, "kW")}</dd>
        <dd className="dsn-q">{f.installedLine}</dd>
      </div>
      <div>
        <dt>Climate</dt>
        <dd>{f.climate}</dd>
        <dd className="dsn-q">{f.climateLine}</dd>
      </div>
      <div>
        <dt>Sized on</dt>
        <dd>{f.sizedOn}</dd>
        <dd className="dsn-q">{f.sizedOnLine}</dd>
      </div>
    </dl>
  );
}

function Cover({ r }: { r: PaperRoom }) {
  return r.pct == null ? <>—</> : <State tone={r.coverTone}>{pct(r.pct)}</State>;
}

/** Room, Floor, Area, Load, then the system's own way of serving it, then Cover */
function RoomsTable({ s }: { s: PaperSystem }) {
  const air = s.form === "air";
  return (
    <div className="dsn-tw">
      <table className="dsn-t">
        <thead>
          <tr>
            <th>Room</th>
            <th>Floor</th>
            <th className="dsn-n">Area</th>
            <th className="dsn-n">Load</th>
            <th>{air ? "Grilles" : "Indoor unit"}</th>
            <th className="dsn-n">{air ? "Air" : "Capacity"}</th>
            <th className="dsn-n">Cover</th>
          </tr>
        </thead>
        <tbody>
          {s.rooms.map((r) => (
            <tr key={r.roomId}>
              <td>{r.name}</td>
              <td>{r.level}</td>
              <td className="dsn-n">{fmt1(r.areaM2, "m²")}</td>
              <td className="dsn-n">{fmt1(r.loadKw, "kW")}</td>
              {air ? (
                <>
                  <td>{r.grilles ?? <span className="dsn-q">None placed</span>}</td>
                  <td className="dsn-n">{r.airLs == null ? "—" : `${r.airLs} L/s`}</td>
                </>
              ) : (
                <>
                  <td>{r.indoor ?? <span className="dsn-q">No unit placed</span>}</td>
                  <td className="dsn-n">{fmt1(r.capacityKw, "kW")}</td>
                </>
              )}
              <td className="dsn-n">
                <Cover r={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SystemBlock({ s }: { s: PaperSystem }) {
  return (
    <section className="dsn-sys">
      <header className="dsn-sysh">
        <i className="dsn-dot" style={{ background: s.colour }} aria-hidden="true" />
        <b>{s.heading}</b>
        <span className="dsn-q">{s.description}</span>
        <State tone={s.stateTone}>{s.stateWord}</State>
      </header>
      {s.rooms.length > 0 ? <RoomsTable s={s} /> : <p className="dsn-q">No rooms are on this system yet.</p>}
      {s.zoning && <p className="dsn-q">{s.zoning}</p>}
    </section>
  );
}

function Unserved({ rooms }: { rooms: PaperRoom[] }) {
  return (
    <section className="dsn-sys">
      <header className="dsn-sysh">
        <b>Not served yet</b>
        <span className="dsn-q">
          {rooms.length} {rooms.length === 1 ? "room" : "rooms"}
        </span>
      </header>
      <div className="dsn-tw">
        <table className="dsn-t">
          <thead>
            <tr>
              <th>Room</th>
              <th>Floor</th>
              <th className="dsn-n">Area</th>
              <th className="dsn-n">Load</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.roomId}>
                <td>{r.name}</td>
                <td>{r.level}</td>
                <td className="dsn-n">{fmt1(r.areaM2, "m²")}</td>
                <td className="dsn-n">{fmt1(r.loadKw, "kW")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MaterialsTable({ rows }: { rows: MaterialRow[] }) {
  const groups = MATERIAL_GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => r.group === g.key) })).filter(
    (g) => g.rows.length > 0
  );
  return (
    <div className="dsn-tw">
      <table className="dsn-t dsn-mat-t">
        <thead>
          <tr>
            <th>Item</th>
            <th>For</th>
            <th className="dsn-n">Quantity</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.key}>
            <tr className="dsn-g">
              <td colSpan={3}>{g.label}</td>
            </tr>
            {g.rows.map((r, i) => (
              <tr key={`${r.item}-${r.forWhat}-${i}`}>
                <td>{r.item}</td>
                <td>{r.forWhat}</td>
                <td className="dsn-n">{r.pending ? <State tone="info">{r.qty}</State> : r.qty}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

export function SheetDocNext({
  doc,
  model,
  brand,
  preparedOn,
  fields,
  provenance,
  sections,
  plansFollow = false,
  materialsAction,
  children,
}: {
  doc: DesignDocument;
  model: SummaryModel;
  brand: OrgBrand;
  preparedOn: string;
  /** the owner's editable letterhead */
  fields?: LetterheadFields;
  /** the owner's "Added from ServiceM8", with its Unlink */
  provenance?: ReactNode;
  /** the Send dialog's ticks; everything when absent. Materials goes in on
      either of the two ticks that were each half of it */
  sections?: SheetSections;
  /** plan pages come after this copy, so the first page says so */
  plansFollow?: boolean;
  /** the owner's Add to job, at the head of Materials. Absent on paper */
  materialsAction?: ReactNode;
  /** what the caller hangs at the foot of the copy */
  children?: ReactNode;
}) {
  const paper = model.paper;
  if (!paper) return null;
  const show = sections ?? { figures: true, systems: true, lines: true, picklist: true };
  const materialsOn = (show.lines || show.picklist) && paper.materials.length > 0;
  const notesOn = (show.lines || show.picklist) && paper.notes.length > 0;
  const second = materialsOn || notesOn;
  const lead = plansFollow && second;
  const ink = brand.color ? documentTheme(brand.color)?.ink : null;
  const label = [doc.meta.name, doc.meta.jobNumber && `job ${doc.meta.jobNumber}`].filter(Boolean).join(", ");
  const nothing = paper.systems.length === 0 && paper.unserved.length === 0;
  return (
    <article className="dsn" style={ink ? ({ "--dsn-brand": ink } as CSSProperties) : undefined}>
      <Page className={lead ? "dsn-lead" : "dsn-sheet"}>
        <Masthead doc={doc} brand={brand} preparedOn={preparedOn} fields={fields} provenance={provenance} />
        <div className="dsn-rule" />
        {show.figures && <Figures f={paper.figures} />}
        {show.systems && paper.systems.map((s) => <SystemBlock key={s.systemId} s={s} />)}
        {show.systems && paper.unserved.length > 0 && <Unserved rooms={paper.unserved} />}
        {show.systems && nothing && <p className="dsn-q">Nothing has been designed yet.</p>}
        <ScreenFoot note={lead ? "The plans follow the materials." : undefined} />
      </Page>

      {second && (
        <Page className="dsn-sheet dsn-second">
          <header className="dsn-math">
            <h2>Materials</h2>
            <span className="dsn-q">{label}</span>
            {materialsAction}
          </header>
          {materialsOn && <MaterialsTable rows={paper.materials} />}
          {notesOn && (
            <section className="dsn-notes">
              <h3>Notes on the plans</h3>
              {paper.notes.map((n, i) => (
                <p key={`${n}-${i}`}>{n}</p>
              ))}
            </section>
          )}
          <ScreenFoot />
        </Page>
      )}
      {children}
    </article>
  );
}
