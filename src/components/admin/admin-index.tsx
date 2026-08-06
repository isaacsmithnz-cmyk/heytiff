/* Admin — the settings index.

   This was three big marketing-ish cards; a settings landing is a MENU, and a
   menu is rows. Grouped rows read as a formal index (one card per group,
   hairline-separated rows inside it), stay legible as the section grows past
   the two live items, and let the page state what is COMING without pretending
   it is here: a planned row is quiet, tagged, and not a link.

   Data-driven from SECTIONS so adding a tool is one entry, not a block of
   markup — the same shape the nav (components/shell/nav.ts) and the toolbox
   registry already use. No "use client": these are links.

   Gating mirrors docs/roles-and-permissions.md. The SECTION is admin+ (the
   route redirects staff); the ITEMS gate individually — organisation settings
   and the owner tools are owner-INTRINSIC, the rate calculator needs
   `financials` (owner by default, grantable to an admin). */

import Link from "next/link";
import { Icon } from "@/components/shell/icon";

export type AdminViewer = {
  /** owner-intrinsic: organisation settings, plus the owner-only tools */
  isOwner: boolean;
  /** grantable capability: the charge-out rate calculator */
  canFinancials: boolean;
  /** field-learned KB entries nobody has looked over — the queue's badge.
      A COUNT rather than a flag so the row can say "4 new". */
  kbQueueCount: number;
};

type AdminRow = {
  title: string;
  sub: string;
  icon: string;
  /** icon-chip accent; planned rows carry the neutral so they stay quiet */
  accent: string;
  /** live rows link — a planned row has nowhere to go yet */
  href?: string;
  show: (v: AdminViewer) => boolean;
  /** "N new" on the row's right edge — the only number this index shows. */
  badge?: (v: AdminViewer) => number;
};

type AdminGroup = { label: string; rows: AdminRow[] };

/* Planned rows share one muted chip rather than each claiming a colour: the
   accents are how a live row says "open me", and a row you cannot open should
   not shout it. */
const SOON = "#9ca3af";

const anyone = () => true;
const owner = (v: AdminViewer) => v.isOwner;

export const SECTIONS: AdminGroup[] = [
  {
    label: "Business",
    rows: [
      {
        title: "Organisation",
        sub: "Company identity, licences & insurance",
        icon: "hexagon",
        accent: "#8A2BE2",
        href: "/dashboard/admin/organization",
        show: owner,
      },
      {
        /* Owner, not `financials`: connecting the accounting system hands over
           one grant that reaches wages, bills and the P&L at once, which is a
           bigger decision than the calculator it feeds. Owner-intrinsic like
           organisation settings — the route and both OAuth handlers agree. */
        title: "Integrations",
        sub: "Connect Xero & other apps to this workspace",
        icon: "plug",
        accent: "#13B5EA",
        href: "/dashboard/admin/integrations",
        show: owner,
      },
      {
        title: "Compliance",
        sub: "Incidents, corrective actions & QA",
        icon: "shield",
        accent: SOON,
        show: anyone,
      },
      {
        title: "Documents",
        sub: "Store, verify & share company files",
        icon: "folder",
        accent: SOON,
        show: anyone,
      },
      {
        title: "Licences & insurances",
        sub: "Expiry tracking across the business",
        icon: "file",
        accent: SOON,
        show: anyone,
      },
      {
        title: "Training & apprentices",
        sub: "Courses, sign-offs & apprentice progress",
        icon: "library",
        accent: SOON,
        show: anyone,
      },
    ],
  },
  {
    label: "Tools",
    rows: [
      {
        /* Any admin, NOT `financials`: curating what the crew teaches Tiff is
           editorial, not monetary, and the actions behind it re-check the
           role themselves. Entries are live the moment they're ticked — this
           queue is where someone agrees after the fact or takes one down. */
        title: "Knowledge from the field",
        sub: "What the crew taught Tiff — live now, look it over",
        icon: "sparkles",
        accent: "#007FA8",
        href: "/dashboard/admin/knowledge",
        show: anyone,
        badge: (v) => v.kbQueueCount,
      },
      {
        title: "Rate Calculator",
        sub: "What to charge per hour",
        icon: "calc",
        accent: "#2E68FF",
        href: "/dashboard/admin/rate-calculator",
        show: (v) => v.canFinancials,
      },
      {
        /* `financials`, alongside the calculator: this is the business's
           money, and the same grant is what lets an owner hand a bookkeeper
           the export without handing over the workspace. */
        title: "Tax & EOFY",
        sub: "Receipts & spend by financial year",
        icon: "receipt",
        accent: "#00A389",
        href: "/dashboard/admin/tax",
        show: (v) => v.canFinancials,
      },
    ],
  },
  {
    /* Owner-only, and only shown to owners — an admin should not be told about
       doors that will never open for them. */
    label: "Owner",
    rows: [
      {
        title: "Password vault",
        sub: "Shared logins, held once and properly",
        icon: "fingerprint",
        accent: SOON,
        show: owner,
      },
      {
        title: "Billing",
        sub: "Your HeyTiff plan, invoices & payment",
        icon: "receipt",
        accent: SOON,
        show: owner,
      },
      {
        title: "Usage analytics",
        sub: "What the workspace actually gets used for",
        icon: "activity",
        accent: SOON,
        show: owner,
      },
    ],
  },
];

function RowBody({ row, badge = 0 }: { row: AdminRow; badge?: number }) {
  return (
    <>
      <span className="adm-ic" style={{ background: row.accent + "1a", color: row.accent }}>
        <Icon name={row.icon} size={19} />
      </span>
      <span className="adm-main">
        <b>{row.title}</b>
        <em>{row.sub}</em>
      </span>
      {badge > 0 && (
        <span className="adm-badge">
          {badge} new
        </span>
      )}
      {row.href ? (
        <span className="adm-ch">
          <Icon name="chevR" size={17} />
        </span>
      ) : (
        <span className="adm-soon">Planned</span>
      )}
    </>
  );
}

function Row({ row, viewer }: { row: AdminRow; viewer: AdminViewer }) {
  const badge = row.badge?.(viewer) ?? 0;
  if (!row.href) {
    return (
      <div className="adm-row soon">
        <RowBody row={row} badge={badge} />
      </div>
    );
  }
  return (
    <Link className="adm-row" href={row.href}>
      <RowBody row={row} badge={badge} />
    </Link>
  );
}

export function AdminIndex(viewer: AdminViewer) {
  const groups = SECTIONS.map((g) => ({
    label: g.label,
    rows: g.rows.filter((r) => r.show(viewer)),
  })).filter((g) => g.rows.length > 0);

  /* The empty state hangs off the LIVE rows, not off row count: an admin with
     neither gated item can only ever see "Planned" placeholders, and a page of
     things you cannot open is a worse answer than saying so plainly — the
     empty-state copy names those same coming tools anyway. */
  const anyLive = groups.some((g) => g.rows.some((r) => r.href));

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg adm-stg">
          <div className="v2head" style={{ marginBottom: 32 }}>
            <div>
              <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
                Admin
              </h1>
            </div>
          </div>

          {anyLive ? (
            groups.map((g) => (
              <div className="adm-group" key={g.label}>
                <div className="adm-glabel">{g.label}</div>
                <div className="adm-card">
                  {g.rows.map((r) => (
                    <Row row={r} viewer={viewer} key={r.title} />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="adm-empty">
              <b>Nothing here for you yet</b>
              <em>
                Compliance, documents, licences &amp; insurances and training will appear here.
                Financial tools are owner-only.
              </em>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
