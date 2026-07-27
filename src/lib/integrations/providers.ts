/* The connected-app registry — pure data, no server imports, so the screens,
   the routes and the tests all read the SAME list.

   Adding an app is one entry here plus its own lib module, the way the toolbox
   registry (components/toolbox/tools.ts) and the admin index already work.

   Xero is first because it is where a trade business's money already lives.
   The three things it is here to power are named in `powers` and repeated on
   the screen — an integrations page that says "connect Xero" without saying
   what for is asking for a grant on trust. */

export type ProviderId = "xero";

export type ProviderStatus = "live" | "planned";

/** What a connected app is here to feed, in the order we intend to wire it. */
export type ProviderUse = {
  /** The HeyTiff surface it lands in. */
  area: string;
  /** What flows, in one line. */
  detail: string;
};

export type Provider = {
  id: ProviderId;
  name: string;
  /** One line for the index row. */
  blurb: string;
  icon: string;
  /** Icon-chip accent, the way the admin index and nav tint theirs. */
  accent: string;
  status: ProviderStatus;
  uses: ProviderUse[];
};

/* Xero's own blue. It is used the way every other accent here is — as a ~10%
   chip tint behind an in-house stroke glyph — not as a reproduction of their
   mark. */
const XERO_BLUE = "#13B5EA";

export const PROVIDERS: Provider[] = [
  {
    id: "xero",
    name: "Xero",
    blurb: "Accounting, payroll & bills — the books this business already keeps",
    icon: "xero",
    accent: XERO_BLUE,
    status: "live",
    uses: [
      {
        area: "Time & Pay",
        detail:
          "Match staff here to their Xero payroll employees, read the pay calendar the business actually runs on, and notice when a pay rate changes in Xero.",
      },
      {
        area: "Rate Calculator",
        detail:
          "Real overhead totals from the profit & loss, instead of the business costs being typed in from memory once a year.",
      },
    ],
  },
];

export function providerById(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/* ── Xero scopes ───────────────────────────────────────────────────────────

   Every scope is here WITH the reason it is asked for, and the screen renders
   this list verbatim before anyone clicks Connect. If a scope can't be given a
   sentence a business owner would accept, it doesn't belong in the list.

   READ-ONLY, DELIBERATELY. Nothing in HeyTiff writes to Xero yet, and asking
   for write access before the write exists is asking for permission we cannot
   justify. When the timesheet push lands it takes `payroll.timesheets` (the
   read/write form) and Xero re-prompts for consent — one Reconnect, which the
   screen already offers, and `missingScopes()` is what notices.

   GRANULAR SCOPES, NOT BROAD ONES. Xero split the wide accounting scopes into
   narrow ones, and since March 2026 every new Web app is assigned granular
   scopes only — asking for a deprecated broad name gets the whole consent
   request refused with `invalid_scope` before the user sees anything. Two were
   wrong here on the first attempt and this is what they became:

     accounting.transactions.read → accounting.invoices.read
                                    + accounting.banktransactions.read
     accounting.reports.read      → accounting.reports.profitandloss.read

   That is a straight improvement, not a workaround: the old pair carried every
   transaction type and every report in the org, where these name the four
   things expenses and the Rate Calculator actually read.

   Verified against developer.xero.com/documentation/guides/oauth2/scopes —
   check it before adding a scope rather than going from memory. Note that
   Receipts and ExpenseClaims lived under the deprecated accounting.transactions
   and appear under NO granular scope; if expenses ends up needing them, that
   question has to be answered from the docs, not assumed.

   ONLY WHAT IS READ. The audit found six scopes consented for nothing: the
   name behind `profile`/`email` was computed and thrown away, and the
   timesheet and expenses reads they promised were never built. A consent
   screen that asks for reads no code performs is over-asking on trust — so a
   scope joins this list WITH its feature, not ahead of it. Adding one later
   costs a single "Reconnect to finish" (missingScopes notices, the screen
   already offers it). The trimmed six, for when their features land:

     payroll.timesheets.read          reading hours already in Xero
     accounting.invoices.read         bills, for expense matching
     accounting.banktransactions.read spend-money lines, same
     accounting.contacts.read         supplier names, same
     profile + email                  only if something shows the Xero user */

export type XeroScope = {
  scope: string;
  /** null for the identity/lifecycle scopes, which power no one feature. */
  area: string | null;
  why: string;
};

export const XERO_SCOPES: XeroScope[] = [
  {
    scope: "openid",
    area: null,
    why: "Identifies the Xero user who authorised the connection.",
  },
  {
    scope: "offline_access",
    area: null,
    why: "Keeps the connection alive in the background, so nobody has to sign in to Xero again every half hour.",
  },
  {
    scope: "payroll.employees.read",
    area: "Time & Pay",
    why: "Reads the employee list, to match each person here to their payroll record.",
  },
  {
    scope: "payroll.settings.read",
    area: "Time & Pay",
    why: "Reads pay calendars and earnings rates — the pay period Xero actually runs on.",
  },
  {
    scope: "accounting.reports.profitandloss.read",
    area: "Rate Calculator",
    why: "Reads the profit & loss — and only that report — so business costs come from the books rather than memory.",
  },
  {
    scope: "accounting.settings.read",
    area: "Rate Calculator",
    why: "Reads the chart of accounts, tax rates and financial year, so those totals land in the right buckets.",
  },
];

/** What we ask Xero for, in the shape the SDK wants. */
export const XERO_SCOPE_LIST: string[] = XERO_SCOPES.map((s) => s.scope);

/** Scopes we asked for that a stored grant does not carry — the trigger for
    the screen's "reconnect to finish" prompt. Compared as a set: Xero returns
    them in its own order and the ordering means nothing. */
export function missingScopes(granted: string | null | undefined): string[] {
  const have = new Set((granted ?? "").split(/\s+/).filter(Boolean));
  return XERO_SCOPE_LIST.filter((s) => !have.has(s));
}
