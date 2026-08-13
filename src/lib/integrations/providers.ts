/* The connected-app registry — pure data, no server imports, so the screens,
   the routes and the tests all read the SAME list.

   Adding an app is one entry here plus its own lib module, the way the toolbox
   registry (components/toolbox/tools.ts) and the admin index already work.

   Xero is first because it is where a trade business's money already lives.
   The three things it is here to power are named in `powers` and repeated on
   the screen — an integrations page that says "connect Xero" without saying
   what for is asking for a grant on trust. */

export type ProviderId = "xero" | "servicem8";

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

/* Each provider's own blue. Used the way every other accent here is — as a
   ~10% chip tint behind an in-house stroke glyph — not as a reproduction of
   their marks. */
const XERO_BLUE = "#13B5EA";
const SM8_BLUE = "#00A8E0";

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
  {
    id: "servicem8",
    name: "ServiceM8",
    blurb: "Jobs, clients & schedules — where the day's work already lives",
    icon: "servicem8",
    accent: SM8_BLUE,
    status: "live",
    uses: [
      {
        area: "Workboard",
        detail:
          "Projects and maintenance link straight to real jobs — job numbers, clients, addresses, booked times — instead of anyone retyping them.",
      },
      {
        area: "Maintenance radar",
        detail:
          "Upcoming and overdue services show against the client and site ServiceM8 already knows, and a linked job completing marks the visit done here.",
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

/* ── ServiceM8 scopes ──────────────────────────────────────────────────────

   Same charter as Xero, same shape: every scope with the sentence a business
   owner would accept, rendered verbatim on the screen the consent URL is built
   from. READ-ONLY, DELIBERATELY — ServiceM8's scopes are granular read_* /
   manage_* / create_* / publish_* families, and nothing here takes a writing
   one. Still true and worth naming:

     manage_badges   the ONLY scope over job badges is a write scope, so badges
                     stay out entirely — Workboard readiness tags are
                     HeyTiff-owned anyway

   THE 2026-08-13 EXPANSION, and its one deliberate exception. The job-media
   track adopts five more read scopes in a single ask: attachments and photos
   (the metadata mirror lands with this change), and notes, materials and
   payments (their mirrors land in the next PRs of the same track). The
   join-with-feature rule bends for those three ON PURPOSE: the connected
   account is a LIVE business and re-consent is a ceremony its owner performs
   once, not once per PR — the owner chose one ask over three. Nothing reads
   what it hasn't shipped a surface for; a granted-but-unwalked scope pulls
   nothing.

   A NAMING TRAP, and its resolution — both halves observed live 2026-08-13,
   pinned in the tests. ServiceM8's endpoint reference says attachment.json
   wants `read_attachments`; their authentication doc's scope table doesn't
   list that name and offers `read_job_attachments` instead. We asked for the
   scope-table names, the OAuth server granted them (token response named all
   fifteen), and attachment.json refused anyway:

     insufficient_scope: "read_attachments" scope required to complete this request

   Their API and their consent docs disagree, so the ask carries BOTH names
   (plus read_job_photos) — one more re-consent ceremony beats a third. Once
   the mirror is filling, whichever name proves dead can be dropped with its
   own PR.

   THE JOB'S OWN TOTAL NEEDS NO EXTRA SCOPE. total_invoice_amount and the
   invoice/quote/payment flags are fields ON the Job object, covered by
   read_jobs — verified against developer.servicem8.com/reference/listjobs.md
   on 2026-08-12. That is why read_jobs' sentence below says so out loud:
   the consent screen must describe what actually arrives, and it always did
   arrive. Per-PAYMENT records are what read_job_payments buys.

   Verified against developer.servicem8.com/docs/authentication on 2026-07-28
   and again 2026-08-13 — check the doc before adding a scope rather than
   going from memory. */

/** One scope with its public justification — the same shape for every
    provider. `XeroScope` above predates this alias and stays for its callers. */
export type ScopeEntry = XeroScope;

export const SM8_SCOPES: ScopeEntry[] = [
  {
    scope: "vendor",
    area: null,
    why: "Identifies the ServiceM8 account that's connected — its name and timezone — so this screen can say whose jobs these are, and due dates can follow that account's clock.",
  },
  {
    scope: "read_jobs",
    area: "Workboard",
    why: "Reads jobs — numbers, status, addresses, and each job's own invoice total and paid status — so the board links to the real thing and can say where the money on it stands. Job values are shown only to people you've given money access.",
  },
  {
    scope: "read_customers",
    area: "Workboard",
    why: "Reads clients and their sites, so work on the board shows who and where it's for.",
  },
  {
    scope: "read_customer_contacts",
    area: "Workboard",
    why: "Reads client contact people, for who to ring about access and bookings.",
  },
  {
    scope: "read_job_contacts",
    area: "Workboard",
    why: "Reads the contacts attached to each job, for the same reason.",
  },
  {
    scope: "read_schedule",
    area: "Workboard",
    why: "Reads booked times, so the board can say when a job is actually scheduled — and that a visit's time is truly confirmed.",
  },
  {
    scope: "read_job_checklists",
    area: "Workboard",
    why: "Reads job checklists, so progress ticked off in ServiceM8 counts here too.",
  },
  {
    scope: "read_job_categories",
    area: "Workboard",
    why: "Reads job categories, so jobs display with the type the business gave them.",
  },
  {
    scope: "read_job_queues",
    area: "Workboard",
    why: "Reads job queues, so a job's place in the workflow shows here.",
  },
  {
    scope: "read_staff",
    area: "Workboard",
    why: "Reads staff names, so a scheduled job can say who's going. Names only — nothing here reads staff locations.",
  },
  {
    scope: "read_job_attachments",
    area: "Workboard",
    why: "Reads the files on each job — what they're called and which job they belong to, including the quote and invoice PDFs — so a job here can show the paperwork ServiceM8 holds.",
  },
  {
    scope: "read_attachments",
    area: "Workboard",
    why: "Reads the attachment list itself — ServiceM8's API asks for this permission by a second name before it will hand over the same job files.",
  },
  {
    scope: "read_job_photos",
    area: "Workboard",
    why: "Reads job photos, so the pictures taken on site can appear on the job here.",
  },
  {
    scope: "read_job_notes",
    area: "Workboard",
    why: "Reads job notes, so what's written on a job's diary in ServiceM8 shows on the job here.",
  },
  {
    scope: "read_job_materials",
    area: "Workboard",
    why: "Reads each job's materials and line items, so a job's billing breakdown can show here. Like job values, shown only to people you've given money access.",
  },
  {
    scope: "read_job_payments",
    area: "Workboard",
    why: "Reads payments recorded against jobs, so paid and owing can be exact here. Like job values, shown only to people you've given money access.",
  },
];

/** What we ask ServiceM8 for, space-separated in the consent URL. */
export const SM8_SCOPE_LIST: string[] = SM8_SCOPES.map((s) => s.scope);

export function sm8MissingScopes(granted: string | null | undefined): string[] {
  const have = new Set((granted ?? "").split(/\s+/).filter(Boolean));
  return SM8_SCOPE_LIST.filter((s) => !have.has(s));
}

/** The per-provider form, for code that holds a connection row and needs the
    row's own yardstick — a ServiceM8 grant judged against Xero's list would
    read as permanently incomplete. Unknown providers miss nothing rather than
    everything, for the same degrade-don't-crash reason parseTenants has. */
export function missingScopesFor(
  provider: string,
  granted: string | null | undefined
): string[] {
  if (provider === "xero") return missingScopes(granted);
  if (provider === "servicem8") return sm8MissingScopes(granted);
  return [];
}
