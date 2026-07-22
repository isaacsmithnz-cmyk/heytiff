// DEMO DATA — remove before production. Every export here is placeholder.
//
// Team and Fleet no longer read from here: the directory and staff cards come
// from staff_profiles (lib/staff/query.ts), and the register, its logs and
// driver assignment come from vehicles / vehicle_logs (lib/fleet/query.ts).
// What remains is TIME & PAY's fixtures — they go in Stage 5 — and the Tiff
// knowledge-base placeholders.
//
// Acceptance test: delete this file and the app still compiles, with every
// screen falling back to its empty state.

import type { KbDoc } from "@/components/tiff/kb";
import type { DayEntry, StaffWeek, WeekDay } from "@/components/timepay/logic";

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
export const demoTimepayWeek: WeekDay[] = [
  ["MON", 29, "Jun"],
  ["TUE", 30, "Jun"],
  ["WED", 1, "Jul"],
  ["THU", 2, "Jul"],
  ["FRI", 3, "Jul"],
  ["SAT", 4, "Jul"],
  ["SUN", 5, "Jul"],
];
export const demoTimepayToday = 4;

export type DemoPayPeriod = { range: string; year: string; live: boolean; note: string };
export const demoTimepayPeriods: DemoPayPeriod[] = [
  { range: "29 Jun – 5 Jul", year: "2026", live: true, note: "" },
  { range: "22 – 28 Jun", year: "2026", live: false, note: "Closed · submitted 29 Jun" },
  { range: "15 – 21 Jun", year: "2026", live: false, note: "Closed · submitted 22 Jun" },
];

const W = (i: string, o: string, h: number): DayEntry => ({ t: "work", in: i, out: o, h });
const LV: DayEntry = { t: "leave", h: 8 };
const SK: DayEntry = { t: "sick", h: 8 };
const EM: DayEntry = { t: "empty" };

export const demoTimepayStaff: StaffWeek[] = [
  { name: "Boston Hayes", role: "Installer", rate: 44,
    days: [W("07:00", "16:00", 9), W("07:00", "15:00", 8), W("07:00", "16:00", 9), W("07:00", "15:00", 8), W("07:00", "15:00", 8), EM, EM] },
  { name: "Priya Nair", role: "Service Technician", rate: 46,
    days: [W("08:00", "16:00", 8), W("06:30", "19:30", 11.5), W("08:00", "16:00", 8), W("08:00", "16:00", 8), W("08:00", "16:00", 8), EM, EM] },
  { name: "Marcus Webb", role: "Installer", rate: 44,
    days: [W("07:00", "15:00", 8), W("07:00", "15:00", 8), W("07:00", "15:00", 8), W("07:00", "15:00", 8), W("07:00", "15:00", 8), EM, EM] },
  { name: "Jordan Mills", role: "Lead Installer", rate: 52,
    days: [W("06:30", "14:30", 8), W("06:30", "16:00", 9.5), W("06:30", "14:30", 8), W("06:30", "14:30", 8), W("06:30", "14:30", 8), W("07:00", "11:00", 4), EM] },
  { name: "Hannah Cole", role: "Estimator", rate: 48,
    days: [W("09:00", "17:00", 8), W("09:00", "17:00", 8), W("09:00", "17:00", 8), SK, W("09:00", "17:00", 8), EM, EM] },
  { name: "Sophie Tran", role: "Office Manager", rate: 45,
    days: [W("08:30", "16:30", 8), W("08:30", "16:30", 8), W("08:30", "16:30", 8), W("08:30", "16:30", 8), LV, EM, EM] },
  { name: "Dylan Reyes", role: "Installer", rate: 44,
    days: [W("07:00", "15:00", 8), W("07:00", "15:00", 8), W("07:00", "15:00", 8), W("07:00", "15:00", 8), W("07:00", "15:00", 8), EM, EM] },
];
