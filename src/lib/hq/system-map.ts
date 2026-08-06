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
    blurb: "Staff reimbursement claims — scan a receipt, get your money back.",
    detail:
      "Money a person spent from their own pocket, NOT the business's own bills (those reach the Rate Calculator from Xero as overheads). Submitting is intrinsic; deciding needs `approvals` and never on your own claim; recording that it was PAID needs `financials`, because approving a spend and moving money are different acts. Receipts live in the documents bucket and can't be deleted out from under a live claim.",
    href: "/dashboard/my-expenses",
    paths: [
      "src/lib/expenses",
      "src/components/expenses",
      "src/app/actions/expenses.ts",
      "src/app/actions/expense-ai.ts",
    ],
  },
  {
    id: "integrations",
    name: "Integrations",
    kind: "feature",
    group: "Business tools",
    blurb: "Connected apps — the Xero and ServiceM8 OAuth grants this workspace holds.",
    detail:
      "Owner-only, and owner-INTRINSIC rather than a capability: one grant reaches wages, bills and the P&L (Xero) or the whole client book and schedule (ServiceM8) at once. Tokens are AES-256-GCM sealed with INTEGRATIONS_TOKEN_KEY before they hit the table, so the service-role key alone can't spend a grant. Read-only scopes on both — ServiceM8's writing scope families are banned by shape in the pinned tests.",
    href: "/dashboard/admin/integrations",
    paths: [
      "src/lib/integrations",
      "src/components/integrations",
      "src/app/api/integrations",
      "src/app/actions/integrations.ts",
    ],
  },
  {
    id: "workboard",
    name: "Workboard",
    kind: "feature",
    group: "Business tools",
    blurb: "The projects & maintenance board — what's on, what's booked, what's overdue.",
    detail:
      "Staff-default by design (capability `workboard`): the board is FOR the people on the tools. Managing it is a second grantable capability (`workboard_manage`, admin default). Standalone-first: everything works on typed job numbers and client names; a ServiceM8 connection enriches rows via the mirrors and never owns them. Display mode fills the screen with the same board minus the app frame, for a big monitor or a wall. Notes are dictated, not typed twice — the Smart Notes engine routes them into tasks, records and questions.",
    href: "/dashboard/workboard",
    paths: ["src/app/dashboard/workboard", "src/lib/workboard", "src/components/workboard"],
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
    blurb: "The assistant, and the four-category library it answers out of.",
    detail:
      "Two surfaces on one substrate. The library ingests PDFs a batch of pages at a time — extract, chunk, keyword-tag, embed, bookmark, repeat — driven from the open page rather than a queue, so a document that runs out of the month's page allowance parks at its bookmark and resumes there. Asking runs both legs of retrieval (full-text and, once VOYAGE_API_KEY exists, vector) and fuses them, then answers with the chunks as document blocks and native citations, so a source chip is the model's own reference and not a parsed [n]. Reading is `tiff` (staff default); uploading and editing is `tiff_manage`; deleting is the owner. Threads live in the browser, not the database.",
    href: "/dashboard/tiff",
    paths: [
      "src/app/dashboard/tiff",
      "src/components/tiff",
      "src/lib/tiff",
      "src/app/api/tiff",
      "src/app/actions/kb.ts",
    ],
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
  {
    id: "eng-xero-read",
    name: "Xero read layer",
    kind: "engine",
    group: "Shared engines",
    blurb: "Every read from a connected Xero organisation, shaped at the boundary.",
    detail:
      "One fresh SDK client per call (a XeroClient carries its token on the instance). Nothing upstream is forwarded verbatim — failures collapse to our own sentence, and a 401 marks the grant needs_reauth. Responses are shaped before they leave, so a generated Employee model carrying a date of birth and bank accounts never reaches a screen. Reads are user-initiated apart from the weekly drift sweep.",
    paths: [
      "src/lib/integrations/xero-read.ts",
      "src/lib/integrations/xero-shape.ts",
      "src/lib/integrations/xero-pl.ts",
    ],
  },
  {
    id: "eng-wage-drift",
    name: "Wage drift sweep",
    kind: "engine",
    group: "Shared engines",
    blurb: "Weekly cron that notices a pay rate changing in Xero — because Xero won't tell us.",
    detail:
      "Xero publishes no payroll webhook, so nothing announces a wage change. The sweep asks If-Modified-Since and stops when nothing moved, so a quiet week costs ONE call per organisation; a change triggers a full recompute of everyone linked, because a drift nobody adopted wouldn't reappear in a later window. Stores a COUNT and a timestamp, never the rates — those stay behind the financials-gated live read. Runs as nobody behind CRON_SECRET, which fails closed when unset. Also resolves what Xero pays: a rate on the template, a rate inherited from the org, or a salary ÷ 52 ÷ weekly hours.",
    paths: [
      "src/lib/integrations/drift.ts",
      "src/lib/integrations/drift-sweep.ts",
      "src/lib/integrations/wage.ts",
      "src/app/api/cron/xero-drift/route.ts",
    ],
  },
  {
    id: "eng-sm8-sync",
    name: "ServiceM8 sync engine",
    kind: "engine",
    group: "Shared engines",
    blurb: "Pulls each ServiceM8 object's changes into the sm8_* mirrors, resumably, under a lease.",
    detail:
      "Cursors are max-edit_date strings that advance only on COMPLETED walks; the gt-only filter forces a one-second overlap that idempotent upserts absorb. Every run is bounded twice (a page budget per invocation, a self-imposed daily call budget per org) and serialised by a conditional-write lease, because cron, Sync-now and the page-load kick land on different instances. Freshness is the page-load after() kick first, the hourly cron second. The shaping layer is the privacy boundary: no money, no badges, staff names only.",
    paths: [
      "src/lib/integrations/sm8-sync.ts",
      "src/lib/integrations/sm8-sync-plan.ts",
      "src/lib/integrations/sm8-read.ts",
      "src/app/api/cron/sm8-sync/route.ts",
    ],
  },
  {
    id: "eng-voice-notes",
    name: "Smart Notes engine",
    kind: "engine",
    group: "Shared engines",
    blurb: "Turns a spoken site note into tasks, records and questions — never into a notepad entry.",
    detail:
      "Three lanes out of one dictation: ACTION (a task through the existing tasks table, bring-items, a flag that pulses on the board), DATA (progress bullets, commissioning readings, the recurring-issue log) and ASK — when it can't tell, it asks on the review card instead of guessing. Review-before-save is the safety model: the apply takes what the human CONFIRMED, never the model's proposal, so a misheard word costs a tick rather than work assigned to the wrong person. Two lines nothing crosses: an assignee is re-proved against this org server-side because a Server Function is reachable by direct POST, and a repeat fault BUMPS the issue it matches rather than logging a second row — two rows is how a pattern stops being visible. Audio takes a route handler, not an action (actions cap bodies at 1MB); the recording is transcribed and dropped, the transcript kept as the evidence for what was applied.",
    paths: [
      "src/lib/voice/transcribe.ts",
      "src/lib/workboard/note-brain.ts",
      "src/app/api/workboard/transcribe/route.ts",
      "src/app/actions/workboard-notes.ts",
    ],
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
    blurb: "time_entries · timesheets · pay_settings · leave_requests · leave_balances · public_holidays · expense_claims",
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
    id: "db-workboard",
    name: "Workboard",
    kind: "store",
    group: "Supabase",
    blurb:
      "projects · checklists · equipment · maintenance_agreements · visits · notes · flags · the issue log.",
    detail:
      "The board's own truth, and the reason it works with nothing connected. A remote reference is a provider-shaped pair (provider + remote_id, null = typed by hand) sitting NEXT TO the human fields — job number, client, address — so a row never depends on a mirror existing and a future CRM could adopt the same shape. Overdue is derived at read from the vendor's timezone, never stored, because a stored status goes stale overnight. Composite FKs carry org_id; the set-null ones name their column, or clearing a design would null the org_id beside it and the delete would fail.",
  },
  {
    id: "db-sm8",
    name: "ServiceM8 mirror",
    kind: "store",
    group: "Supabase",
    blurb: "sm8_jobs · sm8_companies · schedule, checklists, contacts — a disposable local copy.",
    detail:
      "Every ServiceM8-native column is TEXT (their timestamps are naive local strings with a '0000-00-00' null sentinel — timestamptz would shift schedules and reject the sentinel). Nothing FKs into a mirror, overlays never depend on one existing, and disconnect wipes the lot: a client book has no business outliving its grant. Deny-all RLS like every table here.",
  },
  {
    id: "db-kb",
    name: "Library",
    kind: "store",
    group: "Supabase",
    blurb: "kb_documents · kb_chunks · kb_usage + the private kb bucket, signed-URL only.",
    detail:
      "Its own bucket rather than the documents one: that bucket caps at 10 MB around notice photos, and a manufacturer's install manual is routinely 30. A chunk carries its page range, its keywords and a pgvector embedding that is allowed to be NULL — without an embeddings key the full-text leg carries search alone and a later re-run backfills. The search vector is a generated column, weighted keywords over heading over body, so nothing can insert a row whose index disagrees with its text. kb_usage counts pages and questions per org per Australian month and survives the deletion of the document that spent them. Deny-all RLS like every table here.",
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
    blurb:
      "Vehicle valuations, receipt reading, note routing and every Tiff answer — all server-side.",
    detail:
      "Every call is validated on the way back: a JSON schema fixes the SHAPE, and our own pure code fixes the SEMANTICS — that a name is a real person, that a severity is one we render. A refusal is a content outcome, not an error, and is handled before anything reads the response. The key never leaves the server.",
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs Scribe",
    kind: "external",
    group: "External services",
    blurb: "Speech to text for dictated site notes.",
    detail:
      "Chosen on accuracy, not price — at this volume the whole bill is a few dollars a month, so cost isn't a selection input. What decided it was keyterm capacity: the roster, the client book, street names and model strings all go in per request, because \"tell Luke\" only becomes a task for Luke if the transcriber heard Luke. Speech is transcribed in whatever language it was spoken and never translated here — that's the brain's job. ONE vendor, no runtime failover: the adapter exists so the vendor can be SWAPPED, and a failed transcription falls through to the paste box, which always works.",
  },
  {
    id: "voyage",
    name: "Voyage AI",
    kind: "external",
    group: "External services",
    blurb: "Embeddings — the meaning half of knowledge-base search.",
    detail:
      "Called over plain REST, not an SDK: one endpoint, one request shape, nothing to keep up to date. A document is embedded with a different input type from a question, because asking with the wrong one measurably costs recall. THE FEATURE DEGRADES RATHER THAN BREAKS — with no key the chunks store a null embedding, keyword search answers on its own, and a re-run fills them in later; \"not configured\" is a success, not an error. Every returned vector is re-seated by the index it carries and measured against the column's dimension before anything is stored, because a vector on the wrong chunk is a citation to the wrong page.",
  },
  {
    id: "xero",
    name: "Xero",
    kind: "external",
    group: "External services",
    blurb: "The business's accounting & payroll, over OAuth 2.0.",
    detail:
      "Connected once per org by the owner. Read-only GRANULAR scopes (broad ones are refused outright for any Web app created since March 2026), and only for reads that exist: payroll employees and settings, the P&L report and accounting settings. A scope joins the consent WITH its feature — the expenses and timesheet reads ask for theirs when they land. Nothing here writes to Xero.",
  },
  {
    id: "servicem8",
    name: "ServiceM8",
    kind: "external",
    group: "External services",
    blurb: "The business's job management — jobs, clients, schedules — over OAuth 2.0.",
    detail:
      "Connected once per org by the owner. Ten read-only scopes, pinned by test with the writing families (manage_*, create_*, publish_*) banned by shape — badges stay out entirely because their only scope writes. The refresh token rotates on every refresh, so the store's single-flight + conditional-write guard is load-bearing. No revocation endpoint exists: disconnect deletes our sealed tokens and tells the owner to remove the add-on in ServiceM8 itself.",
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
  { from: "integrations", to: "xero", label: "consent, code exchange, token refresh, revoke" },
  { from: "integrations", to: "eng-xero-read", label: "proves the grant reads — employee count" },
  /* Time & Pay owns the staff↔Xero matching screen: it writes the links and
     reads through them. Live since the linking PR. */
  { from: "timepay", to: "db-integrations", label: "staff↔Xero employee links, tenant-scoped" },
  /* The three reasons the grant exists. Dashed until each one actually reads
     through it — flip to live as the syncs land. */
  /* Both live now — the labels name what is ACTUALLY read, and since the
     scope trim the consent asks for nothing more than these reads. */
  { from: "timepay", to: "eng-xero-read", label: "payroll employees, pay calendars & rates" },
  { from: "timepay", to: "eng-wage-drift", label: "the weekly drift count, and the live compare" },
  { from: "rate", to: "eng-xero-read", label: "profit & loss → business costs, on demand" },
  { from: "eng-xero-read", to: "xero", label: "every read; shaped, and never forwarded verbatim" },
  { from: "eng-wage-drift", to: "eng-xero-read", label: "If-Modified-Since gate, then per-employee rates" },
  { from: "eng-wage-drift", to: "db-integrations", label: "stores the count + the polling cursor" },
  { from: "eng-wage-drift", to: "db-staff", label: "compares against hourly_wage (financials only)" },

  /* workboard + servicem8 family */
  { from: "integrations", to: "servicem8", label: "consent, code exchange, rotating token refresh" },
  /* The board's own tables come FIRST on purpose: ServiceM8 enriches rows, it
     never owns them, and every edge below it is optional. */
  { from: "workboard", to: "db-workboard", label: "projects, agreements, visits & the issue log" },
  { from: "workboard", to: "db-sm8", label: "jobs, schedules & clients read from the mirror" },
  { from: "workboard", to: "eng-sm8-sync", label: "staleness kick — top up behind the response" },
  { from: "workboard", to: "eng-voice-notes", label: "a dictated note, routed before anyone saves it" },
  { from: "eng-voice-notes", to: "elevenlabs", label: "audio out, transcript back; the recording is dropped" },
  { from: "eng-voice-notes", to: "anthropic", label: "transcript + job context → a proposal in three lanes" },
  { from: "eng-voice-notes", to: "db-workboard", label: "writes ONLY what the review card confirmed" },
  { from: "eng-voice-notes", to: "db-board", label: "tasks land in the existing tasks table, assigned" },
  { from: "eng-voice-notes", to: "db-staff", label: "first names as keyterms, and to prove an assignee" },
  { from: "eng-sm8-sync", to: "servicem8", label: "paged object reads, under both call budgets" },
  { from: "eng-sm8-sync", to: "db-sm8", label: "upserts mirrors; cursors move on completed walks only" },
  { from: "eng-sm8-sync", to: "db-integrations", label: "spends the sealed grant via sm8Access()" },
  { from: "expenses", to: "db-timepay", label: "claims, decisions & reimbursements" },
  { from: "expenses", to: "db-docs", label: "receipts in the documents bucket, signed per render" },
  { from: "expenses", to: "db-staff", label: "who claimed it — names only, never wages" },
  { from: "expenses", to: "anthropic", label: "Tiff reads the receipt into a draft claim" },
  // Pushing a reimbursement into Xero is a WRITE, so it waits on the KMS
  // migration (issue #167) along with every other write scope.
  { from: "expenses", to: "xero", label: "push reimbursements to payroll or bills", status: "planned" },

  /* people */
  { from: "team", to: "db-accounts", label: "invites written; accepting creates membership" },
  { from: "team", to: "db-staff", label: "directory & admin cards read the people spine" },
  { from: "profile", to: "db-staff", label: "per-card section saves; licences as rows" },
  { from: "profile", to: "db-rate", label: "My Pay's super % read from calculator state" },
  { from: "profile", to: "gmaps", label: "address autocomplete (server-key proxy)" },
  /* Tiff's own three. The store comes first because it is the substrate — an
     answer that can't be traced to a chunk in it isn't a Tiff answer. */
  { from: "tiff", to: "db-kb", label: "documents, chunks, the page ledger + the kb bucket" },
  { from: "tiff", to: "anthropic", label: "keyword tags, query prep, and the cited answer" },
  { from: "tiff", to: "voyage", label: "chunk & question embeddings — skipped without a key" },

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
