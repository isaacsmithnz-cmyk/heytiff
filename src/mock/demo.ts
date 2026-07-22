// DEMO DATA — remove before production. Every export here is placeholder.
//
// Team, Fleet and Time & Pay no longer read from here — they come from
// staff_profiles, vehicles / vehicle_logs and time_entries / timesheets
// respectively. All that remains is the Tiff knowledge-base placeholder
// library, which goes when real uploads exist.
//
// Acceptance test: delete this file and the app still compiles, with every
// screen falling back to its empty state.

import type { KbDoc } from "@/components/tiff/kb";

// Knowledge-base documents shown on the Tiff AI page and /dashboard/tiff/knowledge.
// Placeholder library until real uploads exist — empty array = KB empty states.
export const demoKbDocs: KbDoc[] = [
  { id: "kb-01", category: "install", title: "Ducted install & commissioning checklist", kind: "PDF", source: "HeyTiff standard", updated: "May 2026" },
  { id: "kb-02", category: "install", title: "VRF first-start procedure", kind: "Doc", source: "Mitsubishi City Multi", updated: "Apr 2026" },
  { id: "kb-03", category: "install", title: "Back-to-back hi-wall install guide", kind: "PDF", source: "HeyTiff standard", updated: "Feb 2026" },
  { id: "kb-04", category: "faults", title: "Mitsubishi City Multi fault codes", kind: "PDF", source: "Service handbook", updated: "Jun 2026" },
  { id: "kb-05", category: "faults", title: "Daikin VRV error code index", kind: "PDF", source: "Service manual", updated: "Mar 2026" },
  { id: "kb-06", category: "faults", title: "Fujitsu EE-series flash codes", kind: "Sheet", source: "Tech bulletin", updated: "Jan 2026" },
  { id: "kb-07", category: "specs", title: "PEAD-M ducted series datasheets", kind: "PDF", source: "Mitsubishi Electric", updated: "May 2026" },
  { id: "kb-08", category: "specs", title: "Daikin FXSQ capacity tables", kind: "PDF", source: "Daikin VRV", updated: "Apr 2026" },
  { id: "kb-09", category: "sops", title: "Warranty claim process", kind: "Doc", source: "Company SOP", updated: "Jun 2026" },
  { id: "kb-10", category: "sops", title: "Vehicle & tool sign-out policy", kind: "Doc", source: "Company SOP", updated: "Feb 2026" },
];

// Time & Pay — one demo pay week (29 Jun – 5 Jul 2026, "today" = Fri 3 Jul).
// Ported from the design handoff; historical periods reuse the same timesheets
// until real data exists.
