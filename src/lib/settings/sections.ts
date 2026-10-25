/* SETTINGS, the sections (v2, 25 October 2026; the mock
   BRjnFN2dsMPoruBt32rs6P, Isaac: "Build Settings as the mock shows: the six
   sections"). One page: these down the left, the section you're on to the
   right. Data, so the side list, the index's redirect and the tests read one
   list.

   Each keeps today's address, so a link, a bookmark and every
   revalidatePath still land. `under` are the pages a section owns past its
   own (ServiceM8's and Xero's are Integrations', the rate calculator is
   Quoting's), so the side list lights the section while you're on one.

   Gating mirrors docs/roles-and-permissions.md, unchanged. Settings itself
   is admin+ (the routes redirect staff); each section gates on its own:
   the business's details and its integrations are owner-INTRINSIC, the
   money (quoting, the price book) needs `financials`, Reports' settings need
   `workboard_money`, Reports' own grant, and Pay and holidays and Templates
   are any admin's: the public-holiday calendar is (its pay controls ask
   `financials` themselves), and so are the templates, which only the owner
   approves. Templates came seventh on 26 October (Isaac: "Yes, Templates is
   a seventh section in Settings, after Reports"). */

export type SettingsViewer = {
  /** admin+: Settings itself, and the sections every admin holds */
  isAdmin: boolean;
  /** owner-intrinsic: the business's details and its integrations */
  isOwner: boolean;
  /** grantable: quoting, the price book, and the pay rules */
  canFinancials: boolean;
  /** grantable: job money, which Reports' settings count */
  canJobMoney: boolean;
};

export type SettingsSection = {
  key: "business" | "integrations" | "quoting" | "price-book" | "pay" | "reports" | "templates";
  label: string;
  href: string;
  under?: readonly string[];
  show: (v: SettingsViewer) => boolean;
};

const admin = (v: SettingsViewer) => v.isAdmin;
const owner = (v: SettingsViewer) => v.isOwner;
const financials = (v: SettingsViewer) => v.canFinancials;

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { key: "business", label: "Business", href: "/dashboard/admin/organization", show: owner },
  {
    /* Owner, not `financials`: connecting the accounting system hands over
       one grant that reaches wages, bills and the P&L at once. */
    key: "integrations",
    label: "Integrations",
    href: "/dashboard/admin/integrations",
    show: owner,
  },
  {
    key: "quoting",
    label: "Quoting",
    href: "/dashboard/admin/quoting",
    under: ["/dashboard/admin/rate-calculator"],
    show: financials,
  },
  { key: "price-book", label: "Price book", href: "/dashboard/admin/price-book", show: financials },
  { key: "pay", label: "Pay and holidays", href: "/dashboard/admin/pay", show: admin },
  { key: "reports", label: "Reports", href: "/dashboard/admin/analytics", show: (v) => v.canJobMoney },
  { key: "templates", label: "Templates", href: "/dashboard/admin/templates", show: admin },
];

/** The sections this viewer holds, in their order. */
export function sectionsFor(viewer: SettingsViewer): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => s.show(viewer));
}

const within = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

/** Which section a page belongs to, or null for one that's no section's. */
export function sectionAt(path: string, sections: readonly Pick<SettingsSection, "key" | "href" | "under">[] = SETTINGS_SECTIONS) {
  return sections.find((s) => within(path, s.href) || (s.under ?? []).some((u) => within(path, u)))?.key ?? null;
}
