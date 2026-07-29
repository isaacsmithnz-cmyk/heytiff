/* ─────────────────────────────────────────────────────────────────────────
   THROWAWAY — DELETE THIS FILE WHEN SERVICEM8 GOES IN.

   Scaffolding, not a feature. It exists so the Workboard can be DESIGNED
   before there is any real data to design against: an empty command centre
   tells you nothing about whether the command centre works.

   To remove it completely: delete this file and the single `if (demo…)` block
   in page-data.ts that calls it. Nothing else imports it, no schema, no
   migration, no server action, and not one row is ever written.

   Rules it obeys so it can't quietly become load-bearing:
     · it returns the EXISTING query types, so the screen has no demo branch
       in its rendering logic — only a banner and inert rows;
     · every date is derived from the `today` passed in, never Date.now(), so
       the board looks the same on any day and the fixture never goes stale;
     · ids are prefixed `demo-`, which is what the screen keys off to refuse
       to link a row to a detail page that does not exist.
   ───────────────────────────────────────────────────────────────────────── */

import { plusDays } from "./dates";
import { bucketFor, readinessCount, readReadiness, type ReadinessKey } from "./visit-schedule";
import type { RadarItem } from "./maintenance-query";
import type { ProjectStripItem } from "./projects-query";

/** Demo rows carry this prefix and the screen refuses to link them. */
export const DEMO_PREFIX = "demo-";

export const isDemoId = (id: string) => id.startsWith(DEMO_PREFIX);

/* ── who is allowed to see it ──

   GATED TO ISAAC'S OWN ORGS. "No projects and no agreements" describes every
   brand-new customer on their first morning, and greeting them with three
   invented jobs from companies they've never heard of is worse than an empty
   board — they'd have to work out which rows are real. The fixture exists to
   judge a layout, so only the person judging it should ever meet it. */
const DEFAULT_DEMO_ORG_IDS = [
  "91e33ca2-4847-408d-8ec5-c7cc0fa7a576", // isaacsmithnz1@gmail.com — owner
  "6e1edc43-730f-48ea-bf9a-5de949c1954a", // isaacsmithnz@gmail.com — test staff
];

/** Comma-separated override. An org id is not a secret — it's the same id the
    URL-less server code already handles — so the default is baked in and the
    board works with no configuration. Setting the variable to an EMPTY string
    switches the fixture off everywhere without a deploy of this file; leaving
    it unset keeps the default. */
export function demoOrgIds(env = process.env.WORKBOARD_DEMO_ORG_IDS): string[] {
  return (env ?? DEFAULT_DEMO_ORG_IDS.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function demoAllowedFor(orgId: string | null | undefined, env?: string): boolean {
  if (!orgId) return false;
  return demoOrgIds(env).includes(orgId);
}

/* Three agreements, picked so every state the board can paint is on screen
   at once: a broken promise, a job that's nearly ready, and one fully prepped
   — plus enough visits ahead to give the load timeline a real shape. */
type Seed = {
  visitId: string;
  agreementId: string;
  label: string;
  clientName: string;
  siteLabel: string | null;
  /** Days from today; negative is overdue. */
  offset: number;
  /** The four real checks, so the pips name what's actually missing. */
  ready: Partial<Record<ReadinessKey, boolean>>;
  jobNumber: string | null;
};

const READY = {
  all: {
    access_confirmed: true,
    time_confirmed: true,
    parts_ready: true,
    customer_notified: true,
  },
  none: {},
} satisfies Record<string, Partial<Record<ReadinessKey, boolean>>>;

const SEEDS: Seed[] = [
  // ── Ardex — monthly rooftop package, and it has slipped
  {
    visitId: "demo-v1",
    agreementId: "demo-a1",
    label: "Rooftop package — monthly",
    clientName: "Ardex Logistics",
    siteLabel: "Bay 4, Truganina",
    offset: -9,
    // Nine days late and nobody has even got in the gate.
    ready: { access_confirmed: true },
    jobNumber: "1042",
  },
  {
    visitId: "demo-v2",
    agreementId: "demo-a1",
    label: "Rooftop package — monthly",
    clientName: "Ardex Logistics",
    siteLabel: "Bay 4, Truganina",
    offset: 21,
    ready: { access_confirmed: true, time_confirmed: true },
    jobNumber: null,
  },
  {
    visitId: "demo-v3",
    agreementId: "demo-a1",
    label: "Rooftop package — monthly",
    clientName: "Ardex Logistics",
    siteLabel: "Bay 4, Truganina",
    offset: 51,
    ready: READY.none,
    jobNumber: null,
  },
  // ── Meridian — monthly CRACs, next one this week and nearly prepped
  {
    visitId: "demo-v4",
    agreementId: "demo-a2",
    label: "Server room CRACs — monthly",
    clientName: "Meridian Data",
    siteLabel: "Level 2 comms room",
    offset: 3,
    // Everything sorted except the phone call — the classic.
    ready: { access_confirmed: true, time_confirmed: true, parts_ready: true },
    jobNumber: "1057",
  },
  {
    visitId: "demo-v5",
    agreementId: "demo-a2",
    label: "Server room CRACs — monthly",
    clientName: "Meridian Data",
    siteLabel: "Level 2 comms room",
    offset: 33,
    ready: READY.all,
    jobNumber: null,
  },
  // ── Northgate — quarterly split fleet, sorted and nothing to do yet
  {
    visitId: "demo-v6",
    agreementId: "demo-a3",
    label: "Retail split fleet — quarterly",
    clientName: "Northgate Retail Group",
    siteLabel: "4 stores",
    offset: 12,
    ready: READY.all,
    jobNumber: "1061",
  },
];

export function demoRadar(today: string): RadarItem[] {
  return SEEDS.map((s) => {
    const dueDate = plusDays(today, s.offset);
    // Counted by the same whitelist reader the real rows go through, so the
    // pips and the "n of 4" can't disagree with each other.
    const counts = readinessCount(s.ready);
    return {
      visitId: s.visitId,
      agreementId: s.agreementId,
      label: s.label,
      clientName: s.clientName,
      siteLabel: s.siteLabel,
      dueDate,
      // Bucketed by the same function the real radar uses, rather than
      // hand-labelled — a fixture that disagrees with the rules is a lie.
      bucket: bucketFor(dueDate, today),
      status: "upcoming",
      ready: counts.ready,
      readyTotal: counts.total,
      readiness: readReadiness(s.ready),
      jobNumber: s.jobNumber,
      bookedStart: null,
    };
  });
}

/* Three projects: one healthy, one going quiet, one properly stuck. The
   staleness offsets are chosen to straddle the thresholds in vitals.ts, so
   the fixture demonstrates the rules rather than restating them. */
export function demoProjects(today: string): ProjectStripItem[] {
  const movedDaysAgo = (n: number) => `${plusDays(today, -n)}T04:00:00.000Z`;
  return [
    {
      id: "demo-p1",
      name: "Harbour View Rd — ducted change-over",
      clientName: "K. Whitfield",
      siteLabel: "Single storey, roof space",
      stage: "Fit-off",
      status: "active",
      percent: 68,
      done: 11,
      total: 16,
      updatedAt: movedDaysAgo(1),
    },
    {
      id: "demo-p2",
      name: "Kingsford Medical — VRF fitout stage 2",
      clientName: "Kingsford Medical Centre",
      siteLabel: "Consult rooms 4–9",
      stage: "Commission",
      status: "active",
      percent: 82,
      done: 13,
      total: 16,
      updatedAt: movedDaysAgo(9), // → attention
    },
    {
      id: "demo-p3",
      name: "Belmont Café — split replacement",
      clientName: "Belmont Café",
      siteLabel: "Front of house",
      stage: "Approved",
      status: "on_hold",
      percent: 24,
      done: 4,
      total: 16,
      updatedAt: movedDaysAgo(16), // → urgent twice over
    },
  ];
}
