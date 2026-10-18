/* SETTINGS, the index (v2; it was Admin). A settings landing is a menu, and
   a menu is rows (2026-09-20, kept): the settings grouped by area, each
   group's name on the left and its rows on the right, each row the door to
   today's page for it (rule 39: the name in bold, a grey line under it, a
   state word on the right where there is one). No icon chips: a colour
   only where it means something (law 31).

   Data-driven from SECTIONS so adding a setting is one entry, not a block
   of markup. No "use client": these are links.

   Gating mirrors docs/roles-and-permissions.md, unchanged. The SECTION is
   admin+ (the route redirects staff); the ROWS gate one by one:
   organisation settings and integrations are owner-INTRINSIC, the rate
   calculator, quoting, the price book and tax need `financials` (owner by
   default, grantable to an admin), and the Reports settings need
   `workboard_money`, Reports' own grant. */

import { RowList, Row } from "@/components/parts/row";
import { StateWord } from "@/components/parts/state";
import { ScreenPanel } from "@/components/shell/screen-band";
import { SettingsHead } from "./settings-head";

export type SettingsViewer = {
  /** owner-intrinsic: organisation settings, plus the owner-only tools */
  isOwner: boolean;
  /** grantable capability: the charge-out rate calculator, and the money settings */
  canFinancials: boolean;
  /** grantable capability: job money, which the Reports settings count */
  canJobMoney?: boolean;
  /** field-learned KB entries nobody has looked over: "4 new" on its row */
  kbQueueCount: number;
};

type SettingsRow = {
  title: string;
  sub: string;
  href: string;
  show: (v: SettingsViewer) => boolean;
  /** "N new" on the row's right, in orange: something to look over */
  badge?: (v: SettingsViewer) => number;
};

type SettingsGroup = { label: string; rows: SettingsRow[] };

const anyone = () => true;
const owner = (v: SettingsViewer) => v.isOwner;
const financials = (v: SettingsViewer) => v.canFinancials;

export const SECTIONS: SettingsGroup[] = [
  {
    label: "The business",
    rows: [
      { title: "Organisation", sub: "Company details, licences and insurance", href: "/dashboard/admin/organization", show: owner },
      {
        /* Owner, not `financials`: connecting the accounting system hands over
           one grant that reaches wages, bills and the P&L at once. Owner-
           intrinsic like organisation settings; the route and both OAuth
           handlers agree. */
        title: "Integrations",
        sub: "ServiceM8, Xero and the other apps this workspace reads",
        href: "/dashboard/admin/integrations",
        show: owner,
      },
    ],
  },
  {
    label: "What you send",
    rows: [
      {
        /* every document and message the business sends from fixed wording */
        title: "Templates",
        sub: "Quotes, certificates, SWMS, emails and checklists",
        href: "/dashboard/admin/templates",
        show: anyone,
      },
      {
        /* anything somebody asks to have on company letterhead; each admin
           sees the letters they wrote or sign, the owner all of them */
        title: "Letters",
        sub: "Employment, references and anything else on your letterhead",
        href: "/dashboard/admin/letters",
        show: anyone,
      },
    ],
  },
  {
    label: "Quoting and money",
    rows: [
      /* `financials`, like the calculator: markup and buy prices are the business's money */
      { title: "Quoting", sub: "Rate, markup and allowances", href: "/dashboard/admin/quoting", show: financials },
      { title: "Price book", sub: "Suppliers, prices and preferred items", href: "/dashboard/admin/price-book", show: financials },
      { title: "Rate Calculator", sub: "What to charge per hour", href: "/dashboard/admin/rate-calculator", show: financials },
      { title: "Tax & EOFY", sub: "Receipts and spend by financial year", href: "/dashboard/admin/tax", show: financials },
      {
        /* `workboard_money`, Reports' own grant: every setting moves a figure of job money */
        title: "Reports",
        sub: "How jobs and quotes are counted",
        href: "/dashboard/admin/analytics",
        show: (v) => !!v.canJobMoney,
      },
    ],
  },
  {
    label: "Tiff",
    rows: [
      {
        /* Any admin, NOT `financials`: curating what the crew teaches Tiff is
           editorial, and the actions behind it re-check the role themselves.
           Entries are live the moment they're ticked; this queue is where
           someone agrees after the fact or takes one down. */
        title: "Knowledge from the field",
        sub: "What the crew taught Tiff, live now, to look over",
        href: "/dashboard/admin/knowledge",
        show: anyone,
        badge: (v) => v.kbQueueCount,
      },
    ],
  },
];

/** The groups and rows this viewer holds, empty groups dropped. */
export function settingsFor(viewer: SettingsViewer): SettingsGroup[] {
  return SECTIONS.map((g) => ({ label: g.label, rows: g.rows.filter((r) => r.show(viewer)) })).filter((g) => g.rows.length > 0);
}

export function SettingsIndex(viewer: SettingsViewer) {
  /* No empty state: Templates, Letters and the knowledge queue are any
     admin's, so every viewer who reaches this page has a row. */
  const groups = settingsFor(viewer);
  const count = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="page in full">
      <div className="wrap">
        <div className="stg">
          <SettingsHead heading="Settings" back={null} facts={`${count} ${count === 1 ? "setting" : "settings"}`} />
          <ScreenPanel>
            <div className="st2-groups">
              {groups.map((g) => {
                const id = `st2-g-${g.label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
                return (
                  <section className="st2-group" key={g.label} aria-labelledby={id}>
                    <h2 className="st2-gh" id={id}>
                      {g.label}
                    </h2>
                    <RowList label={g.label}>
                      {g.rows.map((r) => {
                        const n = r.badge?.(viewer) ?? 0;
                        return (
                          <Row
                            key={r.title}
                            name={r.title}
                            line={r.sub}
                            href={r.href}
                            end={n > 0 ? <StateWord tone="look">{`${n} new`}</StateWord> : undefined}
                          />
                        );
                      })}
                    </RowList>
                  </section>
                );
              })}
            </div>
          </ScreenPanel>
        </div>
      </div>
    </div>
  );
}
