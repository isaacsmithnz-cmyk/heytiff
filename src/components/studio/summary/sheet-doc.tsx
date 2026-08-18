import type { DesignDocument } from "@/lib/studio/document";
import type {
  DesignBasis,
  DesignSnapshot,
  SheetLine,
  SummaryModel,
  SummaryRoomRow,
  SummarySystem,
} from "@/lib/studio/summary";
import { BrandLogo } from "@/components/org/letterhead";
import { brandContact, hasBrand, type OrgBrand } from "@/lib/org/brand";
import { fmt, pct, SHEET_GROUPS, tone } from "./sheet-tables";
import "./sheet-doc.css";

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
}: {
  doc: DesignDocument;
  brand: OrgBrand;
  eyebrow: string;
  /** already formatted by the caller — a date built during render is a
      hydration failure waiting for midnight */
  preparedOn: string;
}) {
  const address = doc.meta.site.split("\n").map((l) => l.trim()).filter(Boolean);
  /* THE IDENTITY IS IN THE DOCUMENT BODY, not the bar. Anything that lives
     only in the chrome vanishes from the PDF, and the PDF is what a builder
     puts in a folder — so the logo, the name and the contact line are all
     here, assembled rather than taken from `Letterhead`, whose own
     arrangement would print the name a second time under the 34px one. */
  const contact = brandContact(brand);
  const named = hasBrand(brand);
  return (
    <div className="dsd-mast">
      <div>
        <p className="dsd-eyebrow">{eyebrow}</p>
        <h1>{doc.meta.name || address[0] || "Design"}</h1>
        <div className="dsd-prep">
          <span className="dsd-lab">Prepared by</span>
          {named && <BrandLogo brand={brand} className="dsd-logo" />}
          {/* the business's own name, at the size a letterhead earns. A
              workspace that has set neither a name nor a logo falls back to
              the platform rather than printing an empty frame — and the
              fallback is the WORDMARK, not a repeat of the design's title. */}
          <span className="dsd-org">
            {named && brand.name ? brand.name : "HeyTiff Design Studio"}
          </span>
          {contact.length > 0 && (
            /* joined as ONE string, not spans with a separator between them:
               a separator that can wrap onto a line by itself is the classic
               way this row breaks */
            <span className="dsd-contact">{contact.join(" · ")}</span>
          )}
          <span className="dsd-date">{preparedOn}</span>
        </div>
      </div>

      {/* the addressee: name, then the address one line at a time, ranged
          LEFT inside a block set to the right — a letterhead keeps its own
          left edge; right-ragged lines read as a caption. The job number
          closes it, because it belongs with who and where rather than
          floating above the title. */}
      {(doc.meta.client || address.length > 0 || doc.meta.jobNumber) && (
        <address className="dsd-to">
          {doc.meta.client && <span className="dsd-to-n">{doc.meta.client}</span>}
          {address.map((line) => (
            <span key={line} className="dsd-to-l">
              {line}
            </span>
          ))}
          {doc.meta.jobNumber && (
            <span className="dsd-job">
              <em>Job</em>
              <b>{doc.meta.jobNumber}</b>
            </span>
          )}
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
            <dd className={`dsd-v ${tone(sys.status, sys.pct)}`}>
              {pct(sys.pct)}
              <em>
                {fmt(sys.capacityKw, "kW")} against {fmt(sys.loadKw, "kW")}
              </em>
            </dd>
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
            <td data-l="Outdoor">
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

/* ── the document ── */

export function SheetDoc({
  doc,
  model,
  snapshot,
  basis,
  brand,
  eyebrow,
  preparedOn,
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
  /** anything the CALLER puts at the foot of the document, above the close:
      the owner's copy hangs the whole-job picklist and contributors here, and
      the customer's copy hangs nothing. Absent, not hidden. */
  children?: React.ReactNode;
}) {
  return (
    <article className="dsd">
      <Masthead
        doc={doc}
        brand={brand}
        eyebrow={eyebrow}
        preparedOn={preparedOn}
      />
      <Figures snapshot={snapshot} model={model} basis={basis} />

      {model.systems.map((s) => (
        <section key={s.systemId} className="dsd-sys">
          <SystemBand sys={s} />
          <RoomsTable
            rooms={s.rooms}
            outdoorModel={s.outdoorModel}
            sharedOutdoor={s.sharedOutdoor}
          />
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
    </article>
  );
}
