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
      "Org-scoped: switching org re-reads the membership and reloads the workspace. Every page under /dashboard renders inside it.",
    href: "/dashboard",
    paths: ["src/components/shell", "src/app/dashboard/layout.tsx"],
  },
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

  /* — toolbox (building on its own branch, not yet merged) — */
  {
    id: "tb-heat",
    name: "Heat Load",
    kind: "feature",
    group: "Toolbox",
    status: "building",
    blurb: "Quick room heat-load calculator — same engine as the Studio.",
    detail:
      "Being built on the toolbox branch. Reuses the Studio loads engine verbatim, so a number here always matches the Studio for the same room.",
  },
  {
    id: "tb-press",
    name: "Running Pressures",
    kind: "feature",
    group: "Toolbox",
    status: "building",
    blurb: "Refrigerant pressure–temperature reference for on-site checks.",
    detail:
      "Being built on the toolbox branch. Self-contained PT tables — no pack data, no backend.",
  },
  {
    id: "tb-fault",
    name: "Fault Finder",
    kind: "feature",
    group: "Toolbox",
    status: "building",
    blurb: "Guided symptom-based troubleshooting flows.",
    detail:
      "Being built on the toolbox branch. Deliberately pack-free: fault codes stay out of the universal table, so the flows are hand-authored and fully standalone.",
  },

  /* — business tools — */
  {
    id: "rate",
    name: "Rate Calculator",
    kind: "feature",
    group: "Business tools",
    blurb: "Cost build-up → true charge-out rates, with insights and EOFY view.",
    detail:
      "Admin-gated onboarding-style calculator. State persists per org so owners can revisit and tune. FY2026-27 tax constants live in the engine and need a yearly refresh.",
    href: "/dashboard/admin/rate-calculator",
    paths: ["src/components/rate-calculator", "src/app/actions/rate-calc.ts"],
  },
  {
    id: "timepay",
    name: "Time & Pay",
    kind: "feature",
    group: "Business tools",
    blurb: "Timesheets, approvals and pay runs for the crew.",
    detail:
      "Approvals and pay settings currently persist in localStorage as a stand-in backend; real tables are the obvious next step — and the planned feed into the Rate Calculator.",
    href: "/dashboard/timepay",
    paths: ["src/components/timepay"],
  },

  /* — people & AI — */
  {
    id: "team",
    name: "Team directory",
    kind: "feature",
    group: "People & AI",
    blurb: "Staff profiles, roles and the invite flow.",
    detail:
      "The directory itself still reads demo staff records, but invites are real: sending one writes the invitations table, accepting creates a membership.",
    href: "/dashboard/team",
    paths: ["src/components/team", "src/app/actions/invite.ts"],
  },
  {
    id: "tiff",
    name: "Tiff AI",
    kind: "feature",
    group: "People & AI",
    blurb: "The assistant + its four-category knowledge library.",
    detail:
      "Install procedures, fault codes, specs and SOPs drive the sidebar. Documents are demo content until uploads land.",
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
    name: "Auth & roles",
    kind: "engine",
    group: "Shared engines",
    blurb: "Auth0 sessions, owner/admin/staff hierarchy, HQ allowlist guards.",
    paths: ["src/lib/auth0.ts", "src/lib/roles.ts", "src/lib/hq/guard.ts"],
  },

  /* — data & services — */
  {
    id: "db-accounts",
    name: "Accounts & orgs",
    kind: "store",
    group: "Supabase",
    blurb: "organizations · profiles · memberships · invitations",
    detail: "The identity spine: who exists, which org they belong to, what role they hold, who's been invited.",
  },
  {
    id: "db-designs",
    name: "studio_designs",
    kind: "store",
    group: "Supabase",
    blurb: "Schema-versioned Studio design documents, one row per design.",
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
    id: "demo",
    name: "Demo & local data",
    kind: "store",
    group: "Files & local",
    blurb: "mock/demo.ts records + localStorage stand-in backends.",
    detail:
      "What Team, Tiff's library and Time & Pay run on today. Each edge into this node is a future migration to a real table.",
    paths: ["src/mock/demo.ts"],
  },
  {
    id: "auth0",
    name: "Auth0",
    kind: "external",
    group: "External services",
    blurb: "Login, sessions and the org-role claim.",
  },
];

export const EDGES: MapEdge[] = [
  /* shell + auth */
  { from: "shell", to: "eng-auth", label: "session + org role gate every page" },
  { from: "eng-auth", to: "auth0", label: "login, session cookie, org-role claim" },
  { from: "eng-auth", to: "db-accounts", label: "memberships resolve orgs & roles" },

  /* studio family */
  { from: "studio", to: "eng-loads", label: "room-by-room design heat loads" },
  { from: "studio", to: "eng-packs", label: "unit catalog, capacities, readiness" },
  { from: "studio", to: "db-designs", label: "autosaves the design document" },
  { from: "sim", to: "eng-sim", label: "playback of the open design" },
  { from: "eng-sim", to: "eng-packs", label: "unit specs shape ramp behaviour" },
  { from: "eng-sim", to: "eng-loads", label: "room areas & loads drive the model" },

  /* toolbox */
  { from: "tb-heat", to: "eng-loads", label: "same loads engine, verbatim" },

  /* business tools */
  { from: "rate", to: "eng-rate", label: "cost build-up → charge-out rates" },
  { from: "rate", to: "db-rate", label: "saves calculator state per org" },
  { from: "rate", to: "timepay", label: "pull real wages & hours into rate inputs", status: "planned" },
  { from: "timepay", to: "demo", label: "timesheets & pay settings in localStorage" },

  /* people & AI */
  { from: "team", to: "demo", label: "directory reads demo staff records" },
  { from: "team", to: "db-accounts", label: "invites written; accepting creates membership" },
  { from: "tiff", to: "demo", label: "knowledge docs are demo content for now" },

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
