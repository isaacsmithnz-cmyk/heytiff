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
import { brandContact, hasBrand, type OrgBrand } from "@/lib/org/brand";
import { BrandLogo } from "@/components/org/letterhead";
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
   TWO PARTIES, ONE TO A SIDE — the arrangement every quote and invoice a
   builder handles already uses, and the one this sheet is read against.

   LEFT is the job and the people it concerns: what it is, who prepared it,
   when, and then who it is FOR — the client and the site, under the date,
   because that is the order a reader assembles them in.

   RIGHT is the business itself: the mark, and under it the details a document
   gets checked against — ABN first, then how to make contact.

   THE MARK MOVED INTO THE DOCUMENT, out of the chrome bar each surface used to
   carry it in. That is what makes the arrangement possible: a bar is not part
   of the sheet, so a logo in one cannot sit opposite anything on the page, and
   it vanishes from the PDF entirely. In the masthead it is on every copy —
   screen, live link and paper — in the same place, and the bars that used to
   hold it no longer say the same thing twice.

   The identity block is ranged LEFT inside a column set to the right, which is
   the rule the addressee block already followed: right-ragged lines read as a
   caption, and a wordmark logo whose width nobody controls needs a stable edge
   to start from. */

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
  const named = hasBrand(brand);
  /* the fine print the document gets checked against — ABN first, because it
     is the one somebody actually verifies, then how to reach the business */
  const contact = brandContact(brand);
  return (
    <div className="dsd-mast">
      <div className="dsd-mast-job">
        <p className="dsd-eyebrow">{eyebrow}</p>
        <h1>{doc.meta.name || address[0] || "Design"}</h1>
        {/* WHO PREPARED IT, AND WHEN — the byline. The mark and the fine print
            sit opposite in the identity block; this is the name at reading
            size, which is what a byline is. */}
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

      {/* WHO IT IS FOR, under the date: name, then the address one line at a
          time, then the job number, which belongs with who and where rather
          than floating above the title.

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

      {/* THE BUSINESS, opposite the job. Rendered from `brand` rather than
          taken as a slot: it belongs to the document now, so every chrome gets
          it without being asked and none of them can forget.

          A workspace with neither a name nor a logo renders NOTHING here —
          not an empty box, and not our wordmark, which already stands in as
          the byline on the left. */}
      {named && (
        <div className="dsd-ident">
          <BrandLogo brand={brand} className="dsd-idlogo" />
          {contact.length > 0 && (
            /* ONE PER LINE, not a middot-joined string. The joined form is
               right for the handover sheet's letterhead, which is a wide
               horizontal band; this is a narrow column, and there the same
               string wraps every second part and leaves a separator dangling
               at the end of each line. A list has no separators to strand. */
            <ul className="dsd-idc">
              {contact.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
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

          ON PAPER THESE SAME TWO LAYERS GO `position: fixed`, which a print
          engine stamps onto every page — full height, page after page,
          including the tail of a last page whose content stops early. The
          table below holds the space; these paint it. */}
      <div className="dsd-bband" aria-hidden="true" />
      <div className="dsd-bwell" aria-hidden="true" />

      {/* THE TABLE HOLDS THE FRAME'S SPACE OPEN ON EVERY PRINTED PAGE.

          The layers above paint the frame per page, but they are paint only —
          fixed boxes do not displace content, and vertical padding does not
          repeat across page fragments, so something has to keep the CONTENT
          out of the frame's way at the top and foot of every page. The only
          boxes a print engine repeats per page are a table's header and
          footer row groups: `thead` and `tfoot` hold the band's height open,
          the cell's side padding holds the sides, and the well block inside
          (`dsd-fr-w`) holds the clear, cloned onto every fragment.

          THE FRAME OWNS THE PAGE EDGE. Inside the default page margin the
          same shape read as a border drawn on the paper — a certificate, not
          a frame. A frame is a GROUND the page is carved out of, and a ground
          does not float: the themed page prints with no margin at all
          (`@page cover`, injected by the print chrome), which is also what
          lets the fixed layers reach the paper — a fixed box is clipped to
          the page box, and with no margin the page box IS the paper. That
          clipping is why fixed alone failed while the margin existed, and a
          table alone could not frame the tail of a last page whose content
          stops early: a table ends where its rows end. The two halves are a
          mechanism each; neither works alone.

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
