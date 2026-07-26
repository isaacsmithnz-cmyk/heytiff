/* System map registry — the single source of truth for the /hq/map "family
   tree" of the platform. Pure data + pure helpers so it stays trivially
   testable and cheap to extend.

   HOW TO ADD TO THE MAP (the whole point — this grows with the product):
   1. Add a node: pick the layer via `kind` (feature/surface → column 1,
      engine → column 2, store/external → column 3), give it a `group` so it
      clusters with its family, and set `status` if it isn't live yet.
   2. Add edges: `from` is always the thing that USES/READS/WRITES, `to` is
      what it draws on. `label` says what actually flows ("wages & hours",
      "pack JSON"), because the label is what makes the map a reference.
   3. Not wired up yet but intended? Ship the edge with status "planned" —
      the map draws it dashed. Flip to "live" when the wiring lands.
   4. `paths` lists the real source files behind a node; the integrity test
      checks they exist, so the map can't silently rot. Only list paths that
      exist on main.
   5. Run the system-map tests — they catch typo'd ids, empty labels and
      stale paths, and they pin the expected standalone set so going
      standalone/connected is always a conscious decision. */

export type NodeKind = "surface" | "feature" | "engine" | "store" | "external";
export type NodeStatus = "live" | "building" | "planned";
export type EdgeStatus = "live" | "planned";

export type MapNode = {
  id: string;
  name: string;
  kind: NodeKind;
  /** Family cluster the node renders under, e.g. "Design Studio". */
  group: string;
  /** One-liner shown on the card. */
  blurb: string;
  /** Longer story for the inspector panel. */
  detail?: string;
  status?: NodeStatus; // default "live"
  /** Deep link to the real page, when the node is a page. */
  href?: string;
  /** Real source files behind the node (repo-relative, existence-tested). */
  paths?: string[];
};

export type MapEdge = {
  /** The consumer — the thing that uses, reads or writes. */
  from: string;
  /** What it draws on or writes to. */
  to: string;
  /** What actually flows across this connection. */
  label: string;
  status?: EdgeStatus; // default "live"
};

/* ── layers (render columns, left → right) ── */

export const LAYERS: { title: string; kinds: NodeKind[] }[] = [
  { title: "Features & surfaces", kinds: ["surface", "feature"] },
  { title: "Engines & shared logic", kinds: ["engine"] },
  { title: "Data & services", kinds: ["store", "external"] },
];

export function layerOf(node: MapNode): number {
  return LAYERS.findIndex((l) => l.kinds.includes(node.kind));
}

/* ── the map ── */

export const NODES: MapNode[] = [
  /* — customer dashboard — */
  {
    id: "shell",
    name: "Dashboard shell",
    kind: "surface",
    group: "Customer dashboard",
    blurb: "The animated v3 shell every customer page lives in — nav, org switcher, screens.",
    detail:
      "Org-scoped: switching org re-reads the membership and reloads the workspace. Every page under /dashboard renders inside it. The nav itself is capability-driven, so flipping a permission reshapes it on the next request.",
    href: "/dashboard",
    paths: ["src/components/shell", "src/app/dashboard/layout.tsx"],
  },
  {
    id: "home",
    name: "Dashboard home",
    kind: "feature",
    group: "Customer dashboard",
    blurb: "Action chips, hero band, tasks, notice digest, roster today and payroll state.",
    detail:
      "Everything on it is derived per request — licence/work-rights/rego/insurance/service expiries become worst-first chips, scoped by capability (own things intrinsic, people on `team`, fleet on `assets_all`, money on `financials`). Nothing here has its own storage except tasks.",
    href: "/dashboard",
    paths: ["src/lib/dashboard", "src/components/dashboard"],
  },
  {
    id: "notices",
    name: "Noticeboard",
    kind: "feature",
    group: "Customer dashboard",
    blurb: "Notice/chat: kinds + expiry, polls, events + RSVP, reactions, comments with mentions.",
    detail:
      "Reading is passive — opening the board marks notices read. Acknowledgements are versioned (notices.revision vs notice_reads.revision), so a reworded notice's read-count dips and recovers as people re-read.",
    href: "/dashboard/notices",
    paths: ["src/app/dashboard/notices", "src/components/dashboard/notices-board.tsx"],
  },

  /* — design studio — */
  {
    id: "studio",
    name: "Design Studio",
    kind: "feature",
    group: "Design Studio",
    blurb: "Floor-plan canvas → rooms → heat loads → unit selection → system design.",
    detail:
      "The flagship tool. Plans, calibration, rooms, unit placement and the cockpit panel all hang off one schema-versioned design document that autosaves to Supabase.",
    href: "/dashboard/studio",
    paths: ["src/components/studio", "src/lib/studio"],
  },
  {
    id: "sim",
    name: "Simulation mode",
    kind: "feature",
    group: "Design Studio",
    blurb: "Present-mode playback: airflow, compressor ramp, live header status.",
    detail:
      "Stage-12 layer on top of the Studio canvas, behind the studio.sim flag. Runs the sim engine against the current design document.",
    paths: ["src/components/studio/sim-overlay.tsx", "src/lib/studio/sim.ts"],
  },
  {
    id: "live",
    name: "Live share",
    kind: "surface",
    group: "Design Studio",
    blurb: "Public read-only design page behind an unguessable share token.",
    detail:
      "The one unauthenticated surface: /live/[token] resolves a share token to a single design and renders it read-only, including its plan raster from storage.",
    paths: ["src/app/live", "src/app/actions/studio-share.ts"],
  },

  /* — toolbox — */
  {
    id: "tb-heat",
    name: "Heat Load",
    kind: "feature",
    group: "Toolbox",
    blurb: "Quick room heat-load calculator — same engine as the Studio.",
    detail:
      "Reuses the Studio loads engine verbatim, so a number here always matches the Studio for the same room.",
    href: "/dashboard/toolbox/heat-load",
    paths: ["src/app/dashboard/toolbox/heat-load"],
  },
  {
    id: "tb-press",
    name: "Running Pressures",
    kind: "feature",
    group: "Toolbox",
    blurb: "Expected gauge pressures by ambient, plus pressure fault-finding.",
    detail:
      "Estimate view predicts both sides from refrigerant, duty and ambient temperature; Troubleshoot view takes measured pressures and returns the likely cause with a checklist. Self-contained: published PT data, no pack data, no backend. A deeper ambient-estimate/diagnose rebuild is in flight.",
    href: "/dashboard/toolbox/running-pressures",
    paths: ["src/app/dashboard/toolbox/running-pressures", "src/lib/toolbox/refrigerant.ts"],
  },
  {
    id: "tb-fault",
    name: "Fault Finder",
    kind: "feature",
    group: "Toolbox",
    blurb: "Guided one-question-at-a-time troubleshooting across 15 symptoms.",
    detail:
      "Symptom-first triage (no cooling, icing, water, noise, trips, multi/VRF, three-phase, zoning…) as guided decision trees. Deliberately pack-free: fault codes stay out of the universal table, so the flows are hand-authored and fully standalone.",
    href: "/dashboard/toolbox/troubleshooting",
    paths: ["src/app/dashboard/toolbox/troubleshooting", "src/lib/toolbox/guided.ts"],
  },
  {
    id: "tb-outdoor",
    name: "Outdoor Unit Placement",
    kind: "feature",
    group: "Toolbox",
    blurb: "Placement rules and airflow-clearance guidance for outdoor units.",
    detail: "Hand-authored lesson content — no pack data, no backend, fully standalone.",
    href: "/dashboard/toolbox/outdoor-unit",
    paths: ["src/app/dashboard/toolbox/outdoor-unit", "src/lib/toolbox/outdoor-unit.ts"],
  },

  /* — business tools — */
  {
    id: "rate",
    name: "Rate Calculator",
    kind: "feature",
    group: "Business tools",
    blurb: "Cost build-up → true charge-out rates, with insights and EOFY view.",
    detail:
      "Admin-gated onboarding-style calculator. State persists per org so owners can revisit and tune — but wages come from the Team roster read-only and are never persisted in calculator state. FY2026-27 tax constants live in the engine and need a yearly refresh.",
    href: "/dashboard/admin/rate-calculator",
    paths: ["src/components/rate-calculator", "src/app/actions/rate-calc.ts"],
  },
  {
    id: "timepay",
    name: "Time & Pay",
    kind: "feature",
    group: "Business tools",
    blurb: "Timesheets, approvals and pay settings for the crew — on real tables.",
    detail:
      "Hours are entered per day on My timesheet and reviewed on the team screen; submissions and approvals flip timesheets rows; the period model (weekly / fortnight / month, weekend + OT rules) lives in pay_settings. Wage columns are financials-gated at the query boundary, so they're absent from the payload without the capability.",
    href: "/dashboard/timepay",
    paths: ["src/components/timepay", "src/lib/timepay", "src/app/actions/timepay.ts"],
  },
  {
    id: "leave",
    name: "Leave",
    kind: "feature",
    group: "Business tools",
    blurb: "Requests, approvals, balances and the team leave calendar.",
    detail:
      "Balances are externally owned — the app never mutates one on approval, it counts bookings against it. Review needs the approvals capability and refuses your own request. No dollars anywhere on leave screens.",
    href: "/dashboard/my-leave",
    paths: ["src/lib/timepay/leave.ts", "src/app/actions/leave.ts"],
  },
  {
    id: "fleet",
    name: "Fleet & vehicles",
    kind: "feature",
    group: "Business tools",
    blurb: "Vehicle register, logs and assignment, plus every staffer's own-vehicle screen.",
    detail:
      "Register writes need assets_all; logging fuel/service on a vehicle you drive is intrinsic. Dates are stored, day-counts derived on the AU day. Tiff's valuation and receipt scan call the Claude API server-side.",
    href: "/dashboard/assets",
    paths: ["src/lib/fleet", "src/components/fleet", "src/app/actions/fleet.ts", "src/app/actions/fleet-ai.ts"],
  },
  {
    id: "org",
    name: "Organisation settings",
    kind: "feature",
    group: "Business tools",
    blurb: "Trading profile, logo, and org credentials — licence & insurance rows.",
    detail:
      "Owner-gated. Credentials moved from flat org columns to org_credentials rows; the dashboard's org-insurance chip reads those rows.",
    href: "/dashboard/admin/organization",
    paths: ["src/components/org", "src/app/actions/org.ts", "src/app/actions/org-credentials.ts"],
  },
  {
    /* No screen yet — it was deferred out of the operations build to the
       documents/storage track, and it is the third thing the Xero grant is
       for. On the map as a planned node so the edges that will feed it have
       somewhere honest to land. */
    id: "expenses",
    name: "Expenses",
    kind: "feature",
    group: "Business tools",
    blurb: "Receipts and spend, reconciled against the books.",
    status: "planned",
  },
  {
    id: "integrations",
    name: "Integrations",
    kind: "feature",
    group: "Business tools",
    blurb: "Connected apps — the Xero OAuth grant this workspace holds.",
    detail:
      "Owner-only, and owner-INTRINSIC rather than a capability: one grant reaches wages, bills and the P&L at once. Tokens are AES-256-GCM sealed with INTEGRATIONS_TOKEN_KEY before they hit the table, so the service-role key alone can't spend the grant. Read-only scopes today — Time & Pay, expenses and the Rate Calculator each read through it as they land.",
    href: "/dashboard/admin/integrations",
    paths: [
      "src/lib/integrations",
      "src/components/integrations",
      "src/app/api/integrations",
      "src/app/actions/integrations.ts",
    ],
  },

  /* — people & AI — */
  {
    id: "team",
    name: "Team directory",
    kind: "feature",
    group: "People & AI",
    blurb: "Staff directory, admin staff cards, roles and the invite flow.",
    detail:
      "The directory reads real staff_profiles; invites write the invitations table and accepting creates a membership + staff card. Admin edits go through their own allowlist (ADMIN_SECTIONS), separate from self-edit.",
    href: "/dashboard/team",
    paths: ["src/components/team", "src/app/actions/invite.ts", "src/app/actions/staff.ts"],
  },
  {
    id: "profile",
    name: "My profile",
    kind: "feature",
    group: "People & AI",
    blurb: "The staff card you edit yourself — personal, emergency, work rights, licences, My Pay.",
    detail:
      "Per-card section saves through SELF_EDITABLE_SECTIONS (never merged with the admin allowlist). Licences persist as staff_licences rows with expiry tracking; My Pay shows your own base/×1.5/×2/super read-only.",
    href: "/dashboard/profile",
    paths: ["src/components/profile", "src/app/actions/profile.ts", "src/lib/staff"],
  },
  {
    id: "tiff",
    name: "Tiff AI",
    kind: "feature",
    group: "People & AI",
    blurb: "The assistant + its four-category knowledge library.",
    detail:
      "Install procedures, fault codes, specs and SOPs drive the sidebar. The documents/storage track is live now, but the knowledge screen isn't wired to it yet — the library still renders empty.",
    href: "/dashboard/tiff",
    paths: ["src/components/tiff"],
  },

  /* — HQ portal — */
  {
    id: "hq-overview",
    name: "Platform overview",
    kind: "feature",
    group: "HQ portal",
    blurb: "Org-first KPIs: signups, activity, catalog readiness, env health.",
    detail:
      "The HQ landing page. The whole /hq surface sits behind the HQ_EMAILS allowlist — signed-out → login, non-staff → 404 so the route stays invisible.",
    href: "/hq",
    paths: ["src/app/hq/page.tsx", "src/lib/hq/overview.ts"],
  },
  {
    id: "hq-data",
    name: "Universal table editor",
    kind: "feature",
    group: "HQ portal",
    blurb: "Brand → system → series curation of every unit field.",
    detail:
      "Field pills show extracted values, manual overrides (amber) and engine-blocking gaps (red). Edits never touch the pack — they write overrides that merge at load time.",
    href: "/hq/data",
    paths: ["src/app/hq/data", "src/app/actions/hq-overrides.ts"],
  },
  {
    id: "hq-changes",
    name: "Change log",
    kind: "feature",
    group: "HQ portal",
    blurb: "Who set or cleared which field, when — grouped by day.",
    href: "/hq/changes",
    paths: ["src/app/hq/changes/page.tsx"],
  },
  {
    id: "hq-watch",
    name: "Extraction watch-list",
    kind: "feature",
    group: "HQ portal",
    blurb: "Fields the next pack extraction must chase down.",
    detail:
      "Unknowns found during curation go here instead of into guesswork — the hard no-internet rule for pack data.",
    paths: ["src/components/hq/watchlist-panel.tsx", "src/app/actions/hq-watchlist.ts"],
  },
  {
    id: "hq-map",
    name: "System map",
    kind: "feature",
    group: "HQ portal",
    blurb: "This page — the family tree of how everything connects.",
    detail:
      "Rendered straight from a declarative registry (nodes + labelled edges, live or planned). Adding to the platform means adding a node and its edges there.",
    href: "/hq/map",
    paths: ["src/lib/hq/system-map.ts", "src/components/hq/system-map.tsx"],
  },

  /* — engines & shared logic — */
  {
    id: "eng-loads",
    name: "Heat-load engine",
    kind: "engine",
    group: "Shared engines",
    blurb: "Room geometry + construction → design heat load (kW).",
    detail: "One implementation, used everywhere a load number appears — that's why figures always agree.",
    paths: ["src/lib/studio/loads.ts", "src/lib/studio/loads-room.ts"],
  },
  {
    id: "eng-packs",
    name: "Pack engine",
    kind: "engine",
    group: "Shared engines",
    blurb: "Schema, loader, override merge and engine-readiness for unit data.",
    detail:
      "Everything that needs manufacturer unit data goes through here, so HQ overrides and readiness rules apply platform-wide by construction.",
    paths: ["src/lib/studio/packs"],
  },
  {
    id: "eng-sim",
    name: "Sim engine",
    kind: "engine",
    group: "Shared engines",
    blurb: "Deterministic airflow / compressor-ramp model over a design document.",
    paths: ["src/lib/studio/sim.ts", "src/lib/studio/sim-runtime.ts"],
  },
  {
    id: "eng-rate",
    name: "Rate engine",
    kind: "engine",
    group: "Shared engines",
    blurb: "Pure cost-model math: overheads, utilisation, payroll tax → rates.",
    paths: ["src/components/rate-calculator/engine.ts"],
  },
  {
    id: "eng-auth",
    name: "Auth & capabilities",
    kind: "engine",
    group: "Shared engines",
    blurb: "Auth0 sessions + the 10-capability permission model, read fresh every request.",
    detail:
      "Role is a default, not a verdict: enforcement is can(capability), read from memberships per request so a toggle applies with no re-login. Login also keeps the profiles row current and ensures a staff card exists. HQ has its own email allowlist on top.",
    paths: [
      "src/lib/auth0.ts",
      "src/lib/permissions.ts",
      "src/lib/permissions-server.ts",
      "src/lib/hq/guard.ts",
    ],
  },
  {
    id: "eng-holiday",
    name: "Holiday engine",
    kind: "engine",
    group: "Shared engines",
    blurb: "Statutory public-holiday rules for all 8 states + lazy insert-only sync.",
    detail:
      "Weekend rule per holiday, gazetted one-offs never extrapolated. Loaders call ensure-on-read, which tops each org's calendar up ~24 months ahead; removals are suppressed tombstones, never deletes.",
    paths: ["src/lib/timepay/holiday-rules.ts", "src/lib/timepay/holiday-sync.ts"],
  },

  /* — data & services — */
  {
    id: "db-accounts",
    name: "Accounts & orgs",
    kind: "store",
    group: "Supabase",
    blurb: "organizations · profiles · memberships · invitations · org_credentials",
    detail:
      "The identity spine: who exists, which org they belong to, what role and permissions they hold, who's been invited — plus the org's own credential rows.",
  },
  {
    id: "db-staff",
    name: "People",
    kind: "store",
    group: "Supabase",
    blurb: "staff_profiles · staff_licences · permission_audit",
    detail:
      "The staff card is the single home for personal data; licences are rows with expiry dates; every permission change writes an audit row.",
  },
  {
    id: "db-timepay",
    name: "Time, pay & leave",
    kind: "store",
    group: "Supabase",
    blurb: "time_entries · timesheets · pay_settings · leave_requests · leave_balances · public_holidays",
  },
  {
    id: "db-fleet",
    name: "Fleet",
    kind: "store",
    group: "Supabase",
    blurb: "vehicles · vehicle_logs",
    detail:
      "Composite FKs carry org_id, so a vehicle can't be assigned to another org's staff nor a log point at another org's vehicle.",
  },
  {
    id: "db-board",
    name: "Tasks & notices",
    kind: "store",
    group: "Supabase",
    blurb: "tasks · notices · notice_reads · comments · reactions · polls · RSVPs",
  },
  {
    id: "db-docs",
    name: "Documents & storage",
    kind: "store",
    group: "Supabase",
    blurb: "documents table + private buckets (documents, studio-plans), signed-URL only.",
    detail:
      "One org-scoped documents table over one private bucket, with server-side size and MIME enforcement; the studio-plans bucket holds plan rasters. Nothing is ever publicly readable.",
    paths: ["src/lib/documents"],
  },
  {
    id: "db-designs",
    name: "studio_designs",
    kind: "store",
    group: "Supabase",
    blurb: "Schema-versioned Studio design documents, one row per design.",
  },
  {
    id: "db-integrations",
    name: "Connected apps",
    kind: "store",
    group: "Supabase",
    blurb: "integration_connections · integration_links — the grant, and who is who across it.",
    detail:
      "Access and refresh tokens are stored AES-256-GCM sealed, never in plaintext, so the service-role key alone doesn't unlock a connected accounting system. integration_links holds the staff↔Xero-employee correspondence — scoped to a tenant, with unique indexes both ways so one remote record can never be claimed by two people. Deny-all RLS like every table here.",
  },
  {
    id: "db-universal",
    name: "Universal table",
    kind: "store",
    group: "Supabase",
    blurb: "pack_overrides · pack_override_log · pack_watchlist",
    detail: "HQ curation lives here — overrides on top of packs, a full audit log, and the extraction watch-list.",
  },
  {
    id: "db-rate",
    name: "rate_calc_state",
    kind: "store",
    group: "Supabase",
    blurb: "Per-org Rate Calculator inputs and progress.",
  },
  {
    id: "packs",
    name: "Manufacturer data packs",
    kind: "store",
    group: "Files & local",
    blurb: "Repo-seeded pack JSON — mitsubishi-electric@2026.1 today.",
    detail:
      "Extracted from uploaded documents only (hard rule: never web-sourced). Read from data/packs at request time.",
    paths: ["data/packs"],
  },
  {
    id: "auth0",
    name: "Auth0",
    kind: "external",
    group: "External services",
    blurb: "Login, sessions and the org-role claim.",
  },
  {
    id: "anthropic",
    name: "Claude API",
    kind: "external",
    group: "External services",
    blurb: "Vehicle valuations and receipt reading for the fleet, server-side.",
  },
  {
    id: "xero",
    name: "Xero",
    kind: "external",
    group: "External services",
    blurb: "The business's accounting & payroll, over OAuth 2.0.",
    detail:
      "Connected once per org by the owner. Read-only GRANULAR scopes (broad ones are refused outright for any Web app created since March 2026): payroll employees, settings and timesheets; invoices, bank transactions, contacts, the P&L report and accounting settings. Nothing here writes to Xero.",
  },
  {
    id: "gmaps",
    name: "Google Places",
    kind: "external",
    group: "External services",
    blurb: "Address autocomplete through the authed server-key proxy route.",
    detail:
      "The API key lives server-side only and is read in exactly one place, after the auth gate. Without the key every address field falls back to a plain input.",
  },
];

export const EDGES: MapEdge[] = [
  /* shell + auth */
  { from: "shell", to: "eng-auth", label: "session + org role gate every page" },
  { from: "eng-auth", to: "auth0", label: "login, session cookie, org-role claim" },
  { from: "eng-auth", to: "db-accounts", label: "memberships resolve orgs & roles" },
  { from: "eng-auth", to: "db-staff", label: "login ensures a staff card exists" },

  /* dashboard home */
  { from: "home", to: "db-board", label: "tasks + notices + read receipts" },
  { from: "home", to: "db-staff", label: "licence & work-rights expiry chips" },
  { from: "home", to: "db-fleet", label: "rego / insurance / service chips" },
  { from: "home", to: "db-timepay", label: "roster today + payroll state" },
  { from: "home", to: "db-accounts", label: "org-insurance chip from credential rows" },
  { from: "notices", to: "db-board", label: "posts, polls, RSVPs, reactions, comments" },
  { from: "notices", to: "db-docs", label: "attachments upload via signed URLs" },

  /* studio family */
  { from: "studio", to: "eng-loads", label: "room-by-room design heat loads" },
  { from: "studio", to: "eng-packs", label: "unit catalog, capacities, readiness" },
  { from: "studio", to: "db-designs", label: "autosaves the design document" },
  { from: "studio", to: "db-docs", label: "plan rasters in the studio-plans bucket" },
  { from: "sim", to: "eng-sim", label: "playback of the open design" },
  { from: "eng-sim", to: "eng-packs", label: "unit specs shape ramp behaviour" },
  { from: "eng-sim", to: "eng-loads", label: "room areas & loads drive the model" },
  { from: "live", to: "db-designs", label: "share token resolves one design, read-only" },
  { from: "live", to: "db-docs", label: "plan raster for the shared page" },

  /* toolbox */
  { from: "tb-heat", to: "eng-loads", label: "same loads engine, verbatim" },

  /* business tools */
  { from: "rate", to: "eng-rate", label: "cost build-up → charge-out rates" },
  { from: "rate", to: "db-rate", label: "saves calculator state per org" },
  { from: "rate", to: "db-staff", label: "roster wages & employment types, read-only" },
  { from: "rate", to: "timepay", label: "pull real wages & hours into rate inputs", status: "planned" },
  { from: "timepay", to: "db-timepay", label: "days, sheets, approvals, pay settings" },
  { from: "timepay", to: "db-staff", label: "wages & names (financials-gated columns)" },
  { from: "timepay", to: "eng-holiday", label: "ensure-on-read keeps holidays current" },
  { from: "leave", to: "db-timepay", label: "requests + balances, booked against holidays" },
  { from: "leave", to: "eng-holiday", label: "business-day maths skips gazetted days" },
  { from: "eng-holiday", to: "db-timepay", label: "tops up public_holidays ~24 months ahead" },
  { from: "fleet", to: "db-fleet", label: "register, logs, assignment" },
  { from: "fleet", to: "db-staff", label: "assignments & log names resolve to staff rows" },
  { from: "fleet", to: "anthropic", label: "Tiff values the van + reads receipts" },
  { from: "org", to: "db-accounts", label: "trading profile, logo ref + credential rows" },
  { from: "org", to: "gmaps", label: "address autocomplete (server-key proxy)" },
  { from: "integrations", to: "db-integrations", label: "stores the sealed OAuth grant" },
  { from: "integrations", to: "xero", label: "consent, code exchange, token refresh, payroll reads" },
  { from: "timepay", to: "db-integrations", label: "staff↔Xero employee links", status: "planned" },
  /* The three reasons the grant exists. Dashed until each one actually reads
     through it — flip to live as the syncs land. */
  { from: "timepay", to: "xero", label: "payroll employees, calendars & timesheets", status: "planned" },
  { from: "rate", to: "xero", label: "profit & loss totals behind business costs", status: "planned" },
  { from: "expenses", to: "xero", label: "bills & spend-money behind expenses", status: "planned" },
  { from: "expenses", to: "db-docs", label: "receipt scans in the documents bucket", status: "planned" },

  /* people */
  { from: "team", to: "db-accounts", label: "invites written; accepting creates membership" },
  { from: "team", to: "db-staff", label: "directory & admin cards read the people spine" },
  { from: "profile", to: "db-staff", label: "per-card section saves; licences as rows" },
  { from: "profile", to: "db-rate", label: "My Pay's super % read from calculator state" },
  { from: "profile", to: "gmaps", label: "address autocomplete (server-key proxy)" },

  /* HQ portal */
  { from: "hq-overview", to: "eng-auth", label: "HQ_EMAILS allowlist guards all of /hq" },
  { from: "hq-overview", to: "db-accounts", label: "live org / user / invite counts" },
  { from: "hq-overview", to: "db-designs", label: "designs per org, last activity" },
  { from: "hq-overview", to: "eng-packs", label: "catalog size + engine-ready share" },
  { from: "hq-data", to: "eng-packs", label: "packs grouped brand → system → series" },
  { from: "hq-data", to: "db-universal", label: "writes overrides + audit entries" },
  { from: "hq-changes", to: "db-universal", label: "reads the override audit log" },
  { from: "hq-watch", to: "db-universal", label: "watch-list rows for the next extraction" },

  /* pack engine sources */
  { from: "eng-packs", to: "packs", label: "installed pack JSON from the repo" },
  { from: "eng-packs", to: "db-universal", label: "merges HQ overrides at load time" },
];

/* ── helpers ── */

const nodeIndex = new Map(NODES.map((n) => [n.id, n]));

export function nodeById(id: string): MapNode | undefined {
  return nodeIndex.get(id);
}

/** Edges where the node is the consumer — what it draws from. */
export function drawsFrom(id: string): MapEdge[] {
  return EDGES.filter((e) => e.from === id);
}

/** Edges where the node is the source — what feeds on it. */
export function feeds(id: string): MapEdge[] {
  return EDGES.filter((e) => e.to === id);
}

/** Node ids with no edges at all — genuinely self-contained pieces. */
export function standaloneIds(): string[] {
  return NODES.filter((n) => drawsFrom(n.id).length === 0 && feeds(n.id).length === 0).map(
    (n) => n.id
  );
}

/** Ids connected to `id` by any edge, plus `id` itself. */
export function neighbourhood(id: string): Set<string> {
  const out = new Set<string>([id]);
  for (const e of EDGES) {
    if (e.from === id) out.add(e.to);
    if (e.to === id) out.add(e.from);
  }
  return out;
}

/** Structural integrity — returns human-readable problems (empty = healthy). */
export function validateSystemMap(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const n of NODES) {
    if (seen.has(n.id)) problems.push(`duplicate node id "${n.id}"`);
    seen.add(n.id);
    if (!n.name.trim()) problems.push(`node "${n.id}" has an empty name`);
    if (!n.blurb.trim()) problems.push(`node "${n.id}" has an empty blurb`);
    if (layerOf(n) === -1) problems.push(`node "${n.id}" has kind "${n.kind}" outside LAYERS`);
    if (n.href && !n.href.startsWith("/")) problems.push(`node "${n.id}" href must be app-relative`);
  }
  EDGES.forEach((e, i) => {
    if (!seen.has(e.from)) problems.push(`edge #${i} from unknown node "${e.from}"`);
    if (!seen.has(e.to)) problems.push(`edge #${i} to unknown node "${e.to}"`);
    if (e.from === e.to) problems.push(`edge #${i} loops "${e.from}" onto itself`);
    if (!e.label.trim()) problems.push(`edge #${i} (${e.from} → ${e.to}) has an empty label`);
  });
  const pair = new Set<string>();
  for (const e of EDGES) {
    const k = `${e.from}→${e.to}`;
    if (pair.has(k)) problems.push(`duplicate edge ${k}`);
    pair.add(k);
  }
  return problems;
}
