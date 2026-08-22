import type { DesignDocument } from "@/lib/studio/document";
import type {
  DesignBasis,
  DesignSnapshot,
  PicklistRow,
  SheetLine,
  SummaryModel,
  SummaryRoomRow,
  SummarySystem,
} from "@/lib/studio/summary";
import { hasBrand, type OrgBrand } from "@/lib/org/brand";
import { fmt, pct, SHEET_GROUPS, tone } from "./sheet-tables";
import "./sheet-doc.css";
import { themeVars } from "@/lib/org/theme";

/* THE DESIGN AS A DOCUMENT — one artifact, rendered wherever it is needed.

   Everything here is presentation over a SummaryModel that summary.ts already
   derived. No figure is computed in this file; that rule is what stops the
   customer's copy of the sheet disagreeing with the owner's about a number
   they are both looking at.

   No "use client" and no hooks, deliberately: /live/[token] renders this on
   the server, against a design a session-less customer is allowed to read
   through their token. Chrome is the CALLER's job — the checks pill, Share and
   Export on one side; the live chip and Print on the other — so nothing that
   belongs to one audience can leak into the other's copy by being in here.

   Its own stylesheet rather than a block in studio.css, for the same reason
   letterhead.css exists: the live route is not the studio editor, and a
   9,000-line sheet is the wrong place to put the one document both of them
   render. Class prefix `dsd-`, grep-verified unique. */

/* ── masthead ──────────────────────────────────────────────────────────────
   The site address is the title, because that is what a customer calls this
   job. Under it, who prepared it — a deliberate exception to the app's type
   ramp, which tops out at 28px: this is the one place the business is shown
   off, so the name runs to 34px and nothing below the masthead leaves the
   ramp. */

function Masthead({
  doc,
  brand,
  eyebrow,
  preparedOn,
  fields,
  provenance,
}: {
  doc: DesignDocument;
  brand: OrgBrand;
  eyebrow: string;
  /** already formatted by the caller — a date built during render is a
      hydration failure waiting for midnight */
  preparedOn: string;
  fields?: LetterheadFields;
  provenance?: React.ReactNode;
}) {
  const address = doc.meta.site.split("\n").map((l) => l.trim()).filter(Boolean);
  /* WHO PREPARED IT, AND WHEN. That is the whole block.

     It carried the logo and a contact line — ABN, email, website — as well,
     on the reasoning that a letterhead states how to reach the business. On
     the page it read as a business card dropped into the middle of a
     document: four different weights and three sizes under a heading, before
     the reader had reached a single figure. The name is the identity and the
     date is what makes the figures mean anything; the logo is the mark, and a
     mark belongs in the corner, not in a paragraph. */
  const named = hasBrand(brand);
  return (
    <div className="dsd-mast">
      <div>
        <p className="dsd-eyebrow">{eyebrow}</p>
        <h1>{doc.meta.name || address[0] || "Design"}</h1>
        <div className="dsd-prep">
          <span className="dsd-lab">Prepared by</span>
          {/* a workspace that has set neither a name nor a logo falls back to
              the platform rather than printing an empty frame — and the
              fallback is the WORDMARK, not a repeat of the design's title */}
          <span className="dsd-org">
            {named && brand.name ? brand.name : "HeyTiff Design Studio"}
          </span>
          <span className="dsd-date">{preparedOn}</span>
        </div>
      </div>

      {/* the addressee: name, then the address one line at a time, ranged
          LEFT inside a block set to the right — a letterhead keeps its own
          left edge; right-ragged lines read as a caption. The job number
          closes it, because it belongs with who and where rather than
          floating above the title.

          ONE FRAME, two fillings. The owner types straight into it and the
          customer reads it; both use the classes below, so the two can never
          drift into different letterheads. The owner's copy always renders —
          an empty letterhead is where you go to fill one in — while the
          customer's appears only once there is something in it. */}
      {(fields ||
        doc.meta.client ||
        address.length > 0 ||
        doc.meta.jobNumber) && (
        <address className="dsd-to">
          {fields ? (
            fields.client
          ) : (
            doc.meta.client && <span className="dsd-to-n">{doc.meta.client}</span>
          )}
          {fields
            ? fields.site
            : address.map((line) => (
                <span key={line} className="dsd-to-l">
                  {line}
                </span>
              ))}
          {fields ? (
            <span className="dsd-job">
              <em>Job</em>
              {fields.jobNumber}
            </span>
          ) : (
            doc.meta.jobNumber && (
              <span className="dsd-job">
                <em>Job</em>
                <b>{doc.meta.jobNumber}</b>
              </span>
            )
          )}
          {/* WHICH ROW this design came from, and the only control that acts
              on it. Owner-only: a customer has no use for our provenance and
              no business unlinking anything. */}
          {provenance && <span className="dsd-src">{provenance}</span>}
        </address>
      )}
    </div>
  );
}

/* ── the row of six ────────────────────────────────────────────────────────
   Three measurements, then the three assumptions every one of them rests on.
   Equal columns and one gap, and the value sits at the BOTTOM of its box, so a
   two-line label cannot drop its figure out of the row. */

function Figures({
  snapshot,
  model,
  basis,
}: {
  snapshot: DesignSnapshot;
  model: SummaryModel;
  basis: DesignBasis;
}) {
  /* placed capacity across every system — reduced, never re-derived: each
     system's own figure is what its block prints. */
  const capacityKw = model.systems.reduce<number | null>(
    (a, s) => (s.capacityKw == null ? a : (a ?? 0) + s.capacityKw),
    null
  );
  const cells: { label: string; value: string; hot?: boolean }[] = [
    {
      label: "Calculated heat load",
      value: fmt(snapshot.totalLoadKw, "kW"),
      hot: true,
    },
    {
      label: "Design cooling capacity",
      value: fmt(
        capacityKw == null ? null : Math.round(capacityKw * 10) / 10,
        "kW"
      ),
    },
    { label: "Number of systems", value: String(snapshot.systemCount) },
    { label: "Climate zone", value: `Zone ${basis.zone}` },
    { label: "Building type", value: basis.buildingLabel },
    { label: "Sized on", value: basis.basisShort },
  ];
  return (
    <dl className="dsd-figs">
      {cells.map((c) => (
        <div key={c.label}>
          <dt>{c.label}</dt>
          <dd className={c.hot ? "hot" : undefined}>{c.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ── one block per system ──────────────────────────────────────────────────
   Opening on a band tinted in that system's own colour — the .ds-band recipe,
   a 12% wash with a 26% edge.

   THE OUTDOOR IS PLACED BY SYSTEM TYPE. On a multi or VRF the single outdoor
   is shared by every head, so it belongs in the header band and each room row
   reads "Shared". On a split there is one outdoor for one head, so the header
   carries no outdoor block at all and the Outdoor column names the model
   directly. */

function SystemBand({ sys }: { sys: SummarySystem }) {
  const characteristics = [
    sys.outdoorCapacityKw != null ? fmt(sys.outdoorCapacityKw, "kW") : null,
    sys.refrigerant,
    sys.prechargedKg != null ? `${sys.prechargedKg} kg pre-charged` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <header
      className={`dsd-band${sys.sharedOutdoor ? "" : " solo"}`}
      style={{ ["--sys" as string]: sys.colour }}
    >
      <div className="dsd-band-id">
        <h2>{sys.name}</h2>
        <dl className="dsd-spec">
          <div>
            <dt>System type</dt>
            <dd>{sys.kindLabel}</dd>
          </div>
          <div>
            <dt>Covered</dt>
            {/* NOTHING TO DIVIDE READS AS ENGLISH, NOT AS THREE DASHES.

                A system with no units placed has no percentage and neither
                figure behind it, and this printed the em dash for all three:
                "— — against —", on the sheet a customer is sent, for most of
                the time somebody is mid-design. A dash in a table cell is a
                blank; a dash inside a sentence is a broken sentence. */}
            {sys.pct == null ? (
              <dd className="dsd-v na">Not sized yet</dd>
            ) : (
              <dd className={`dsd-v ${tone(sys.status, sys.pct)}`}>
                {pct(sys.pct)}
                <em>
                  {fmt(sys.capacityKw, "kW")} against {fmt(sys.loadKw, "kW")}
                </em>
              </dd>
            )}
          </div>
        </dl>
      </div>
      {sys.sharedOutdoor && (
        <div className="dsd-odu">
          <dt>Shared outdoor unit</dt>
          {/* brand first, model underneath: the brand is the reassurance, the
              model is the thing you look up */}
          <p className="dsd-odu-b">{sys.brandLabel}</p>
          {sys.outdoorModel ? (
            <p className="dsd-odu-m">{sys.outdoorModel}</p>
          ) : (
            <p className="dsd-odu-m none">Not chosen yet</p>
          )}
          {characteristics && <p className="dsd-odu-c">{characteristics}</p>}
        </div>
      )}
    </header>
  );
}

/** The rooms table. Nine columns, which is two more than the studio's own
    RoomsTable carries — Style and Outdoor are what a customer reads this for
    ("what is going in my living room, and where does the box outside go"),
    and neither belongs on the cockpit's compact table. Same model underneath;
    only the row renderer differs. */
function RoomsTable({
  rooms,
  outdoorModel,
  sharedOutdoor,
}: {
  rooms: SummaryRoomRow[];
  outdoorModel: string | null;
  sharedOutdoor: boolean;
}) {
  return (
    <table className="dsd-rt">
      <colgroup>
        <col className="c-room" />
        <col className="c-floor" />
        <col className="c-area" />
        <col className="c-load" />
        <col className="c-cap" />
        <col className="c-mdl" />
        <col className="c-style" />
        <col className="c-odu" />
        <col className="c-cov" />
      </colgroup>
      <thead>
        <tr>
          <th>Room</th>
          <th>Floor</th>
          <th className="num">Area</th>
          <th className="num">Load</th>
          <th className="num">Capacity</th>
          <th>Unit model</th>
          <th>Style</th>
          <th>Outdoor</th>
          <th className="num">Coverage</th>
        </tr>
      </thead>
      <tbody>
        {rooms.map((r) => (
          <tr key={r.roomId}>
            {/* every cell carries its column name for the sub-768 layout,
                where the table stops being a table and each row becomes a
                block — see sheet-doc.css */}
            <td className="rm" data-l="Room">
              {r.name}
            </td>
            <td data-l="Floor">{r.level}</td>
            <td className="num" data-l="Area">
              {fmt(r.areaM2, "m²")}
            </td>
            <td className="num" data-l="Load">
              {fmt(r.loadKw, "kW")}
            </td>
            <td className="num" data-l="Capacity">
              {fmt(r.capacityKw, "kW")}
            </td>
            <td
              className={`mdl${r.indoorModel ? "" : " none"}`}
              data-l="Unit model"
            >
              {r.indoorModel ?? "No unit placed"}
            </td>
            <td className={`sty${r.styleLabel ? "" : " none"}`} data-l="Style">
              {r.styleLabel ?? "—"}
            </td>
            <td className="odu" data-l="Outdoor">
              {sharedOutdoor ? (
                /* a fact about the system, not a model number — a quiet pill
                   so it does not compete with the real models beside it */
                <span className="dsd-shared">Shared</span>
              ) : (
                outdoorModel ?? "—"
              )}
            </td>
            <td className="num" data-l="Coverage">
              <span className={`dsd-cv ${tone(r.status, r.pct)}`}>
                <b>{pct(r.pct)}</b>
                {/* a bar as well as a colour, so the short row is not
                    distinguished by hue alone. Nothing served is nothing
                    drawn: the bar has a 4% floor so a nearly-covered room
                    still shows something, and that floor under a literal 0%
                    would draw a mark the figure beside it denies. */}
                {r.pct != null && r.pct > 0 && <i style={barWidth(r.pct)} />}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** the coverage bar, clamped both ends: 340% of a tiny load would otherwise
    draw the same full bar as 100% and read as the same verdict, and a 2% run
    would draw nothing at all. */
function barWidth(value: number): { width: string } {
  return { width: `${Math.max(4, Math.min(100, value))}%` };
}

/** Consumables split by shelf. Empty shelves render nothing — "Electrical —
    nothing" is not a fact about this job. */
function Consumables({ lines }: { lines: SheetLine[] }) {
  const groups = SHEET_GROUPS.map((g) => ({
    ...g,
    rows: lines.filter((l) => l.group === g.key),
  })).filter((g) => g.rows.length > 0);
  if (groups.length === 0) return null;
  return (
    <div className="dsd-consum">
      {groups.map((g) => (
        <div key={g.key} className="dsd-grp">
          <h3>{g.label}</h3>
          <ul>
            {g.rows.map((l) => (
              <li key={`${l.name}-${l.sub}`}>
                <span>
                  {l.name}
                  {l.sub && <i>{l.sub}</i>}
                </span>
                <b>{l.qty}</b>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The owner types straight INTO the letterhead — three fields wearing the
    document's own type, revealing themselves on hover rather than sitting in
    a form. The customer's copy passes none of this and gets plain text, which
    is why an input cannot reach it: absence, not a hidden attribute. */
export interface LetterheadFields {
  client: React.ReactNode;
  site: React.ReactNode;
  jobNumber: React.ReactNode;
}

/* ── the Material picklist ──────────────────────────────────────────────────
   The whole job combined, units included, in the same shelves the per-system
   consumables use plus one of their own.

   NO CHECKBOXES, deliberately. It becomes tickable when it is pushed to the
   ServiceM8 job card — one checklist item per line, ticked by whoever is
   standing in the warehouse. The sheet states the list; it is not the list. */

const PICK_GROUPS: { key: PicklistRow["group"]; label: string }[] = [
  { key: "units", label: "Units" },
  { key: "pipe", label: "Pipe" },
  { key: "electrical", label: "Electrical" },
  { key: "components", label: "Components" },
];

export function PicklistSection({
  rows,
  action,
}: {
  rows: PicklistRow[];
  /** the owner's "Add to job" — absent on paper, which cannot press it */
  action?: React.ReactNode;
}) {
  const groups = PICK_GROUPS.map((g) => ({
    ...g,
    rows: rows.filter((r) => r.group === g.key),
  })).filter((g) => g.rows.length > 0);
  if (groups.length === 0) return null;
  return (
    <section className="dsd-pick">
      <div className="dsd-pick-h">
        <h2>Material picklist</h2>
        <span className="dsd-pick-ct">
          {rows.length} {rows.length === 1 ? "line" : "lines"} for the whole job
        </span>
        {action}
      </div>
      <div className="dsd-pick-g">
        {groups.map((g) => (
          <div key={g.key} className="dsd-grp card">
            <h3>{g.label}</h3>
            <ul>
              {g.rows.map((l) => (
                <li key={`${l.name}-${l.sub}`}>
                  <span>
                    {l.name}
                    {l.sub && <i>{l.sub}</i>}
                  </span>
                  <b>{l.qty}</b>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── the document ── */

export function SheetDoc({
  doc,
  model,
  snapshot,
  basis,
  brand,
  eyebrow,
  preparedOn,
  mark,
  fields,
  provenance,
  children,
}: {
  doc: DesignDocument;
  model: SummaryModel;
  snapshot: DesignSnapshot;
  basis: DesignBasis;
  brand: OrgBrand;
  /** the line above the title, e.g. "Design summary" or "Design summary,
      option B" — the caller knows whether this is one of several */
  eyebrow: string;
  preparedOn: string;
  /* THE MARK GOES TOP LEFT, and each chrome puts it where its own top left
     is: the two screen chromes carry it in their bar, and PAPER HAS NO BAR,
     so the print document renders it at the head of the page instead.

     This is why it is a slot rather than part of the masthead. Anything that
     lives only in a bar vanishes from the PDF, and a document a builder
     files without the installer's mark is the thing #440 existed to fix. */
  mark?: React.ReactNode;
  /** the owner's editable letterhead — see LetterheadFields */
  fields?: LetterheadFields;
  /** the owner's "Added from ServiceM8 …" line, with its Unlink */
  provenance?: React.ReactNode;
  /** anything the CALLER puts at the foot of the document, above the close:
      the owner's copy hangs the whole-job picklist and contributors here, and
      the customer's copy hangs nothing. Absent, not hidden. */
  children?: React.ReactNode;
}) {
  return (
    <article className="dsd" style={themeVars(brand.color)}>
      {/* THE BUSINESS'S FRAME, around the whole sheet.

          One filled rectangle behind the document with a white well inset on
          all four sides, which is `.fg .outlet` exactly: the colour survives as
          a frame around the page.

          It carries NOTHING — no logo, no contact line, no page number — and
          that is the whole reason it is the treatment we shipped. A band with
          text on it needs a reversed logo the business may not own and a
          contrast floor on every word; this needs one colour and nothing else.

          Rendered unconditionally: with no brand colour `--doc-ink` is unset,
          the fallback is `transparent`, and the sheet is byte-for-byte the one
          it is today.

          SCREEN ONLY. On paper these two are hidden and the frame is drawn by
          the table below instead — see the note on it. */}
      <div className="dsd-bband" aria-hidden="true" />
      <div className="dsd-bwell" aria-hidden="true" />

      {/* THE FRAME HAS TO CLOSE ON EVERY PAGE, AND ONLY A TABLE CAN DO THAT.

          The two layers above are one rectangle behind the whole document, so
          a browser fragments them across pages the obvious way: a top band on
          page one, a bottom band on the last page, and on every page in
          between two bare strips down the sides. That is a frame around the
          DOCUMENT. What a reader holds is a PAGE, and page two of it looked
          like the head-and-foot band this treatment replaced precisely because
          two bars are not a frame.

          Every cheaper fix was tried and measured against a rendered PDF:

          - `position: fixed` under `@media print` is the running-header trick
            and repeats per page correctly — but a fixed box is CLIPPED to the
            page box, so it cannot reach out into the page margin. Pushed out
            with a negative inset it disappears entirely; kept at inset 0 it
            sits exactly where the text starts on page two.
          - per-page padding does not exist: horizontal padding applies to
            every fragment, vertical padding only to the first and last.
          - `@page` margin boxes can paint on the margin, and Chrome does not
            support a fill in one.

          What DOES repeat, in every engine, is a table's header and footer
          row group. So the document rides in a single cell: `thead` paints the
          top band, `tfoot` the bottom, and the cell itself paints the sides —
          its ink-coloured background showing through its side padding. The
          well is the block inside (`dsd-fr-w`): the paper, white and rounded,
          laid over the cell's ink exactly the way `.dsd-bwell` lies over
          `.dsd-bband` on screen.

          AND THE FRAME OWNS THE PAGE EDGE. Inside the default page margin the
          same shape read as a border drawn on the paper — a certificate, not
          a frame. A frame is a GROUND the page is carved out of, and a ground
          does not float: the themed page prints with no margin at all
          (`@page cover`, injected by the print chrome), the frame's own
          thickness is the margin, and the corners are square at the paper's
          corner because paper is. The rounding belongs to the well.

          It is a table only on paper. On screen every part of it is
          `display: block`, the head and foot are hidden, and the layers above
          draw the frame — a scrolling document has no pages to close. */}
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
      {mark && <div className="dsd-mark-head">{mark}</div>}
      <Masthead
        doc={doc}
        brand={brand}
        eyebrow={eyebrow}
        preparedOn={preparedOn}
        fields={fields}
        provenance={provenance}
      />
      <Figures snapshot={snapshot} model={model} basis={basis} />

      {model.systems.map((s) => (
        <section key={s.systemId} className="dsd-sys">
          <SystemBand sys={s} />
          {/* A SYSTEM THAT SERVES NO ROOMS SAYS SO.

              It used to render the table anyway: nine column headings with
              nothing underneath, a row of labels floating above the
              consumables. A system reaches this the moment its outdoor is
              chosen and its indoor is not yet placed, which is most of the
              time somebody is mid-design — and the customer's copy of the
              sheet drew the same hole. */}
          {s.rooms.length > 0 ? (
            <RoomsTable
              rooms={s.rooms}
              outdoorModel={s.outdoorModel}
              sharedOutdoor={s.sharedOutdoor}
            />
          ) : (
            <p className="dsd-none">
              No rooms are on this system yet.
            </p>
          )}
          <Consumables lines={s.lines} />
        </section>
      ))}

      {model.unserved.length > 0 && (
        <section className="dsd-sys">
          <header className="dsd-band solo none">
            <div className="dsd-band-id">
              <h2>Not served yet</h2>
              <dl className="dsd-spec">
                <div>
                  <dt>Rooms</dt>
                  <dd>{model.unserved.length}</dd>
                </div>
              </dl>
            </div>
          </header>
          <RoomsTable rooms={model.unserved} outdoorModel={null} sharedOutdoor={false} />
        </section>
      )}

      {model.systems.length === 0 && model.unserved.length === 0 && (
        <p className="dsd-empty">Nothing has been designed yet.</p>
      )}

      {children}

      <footer className="dsd-close">
        Prepared with <b>HeyTiff Design Studio</b>
      </footer>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}
