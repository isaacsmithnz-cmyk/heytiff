// DEMO DATA — remove before production. Every export here is placeholder.
// Acceptance test: delete this file and the app still compiles, with the Team
// directory falling back to its "No staff yet" empty state.

import type { KbDoc } from "@/components/tiff/kb";
import type { Vehicle, VehicleLog } from "@/components/fleet/logic";
import type { DayEntry, StaffWeek, WeekDay } from "@/components/timepay/logic";

export type DemoStaff = {
  id: string;
  initials: string;
  name: string;
  nickname?: string;
  email: string;
  role: string;
  employmentType: string;
  started: string;
  years: string;
  licenceCount: number;
  status: "Active" | "Inactive";
  // state drives the chip colour; expiresDays drives the compliance-expiry sort
  compliance: { label: string; state: "ok" | "warn" | "bad"; expiresDays: number };
};

export type PendingInvite = {
  name: string;
  email: string;
  role: string;
  state: "live" | "expired";
  note: string;
};

export const demoStaff: DemoStaff[] = [
  {
    id: "jordan-mills",
    initials: "JM",
    name: "Jordan Mills",
    nickname: "Jordy",
    email: "jordan@heytiff.co",
    role: "Lead Installer",
    employmentType: "Full-time",
    started: "Mar 2021",
    years: "3.2",
    licenceCount: 4,
    status: "Active",
    compliance: { label: "ARC expires 14d", state: "warn", expiresDays: 14 },
  },
  {
    id: "priya-nair",
    initials: "PN",
    name: "Priya Nair",
    email: "priya@heytiff.co",
    role: "Service Technician",
    employmentType: "Full-time",
    started: "Aug 2022",
    years: "2.9",
    licenceCount: 3,
    status: "Active",
    compliance: { label: "Work rights unverified", state: "warn", expiresDays: 0 },
  },
  {
    id: "liam-obrien",
    initials: "LO",
    name: "Liam O’Brien",
    email: "liam@heytiff.co",
    role: "Apprentice",
    employmentType: "Full-time",
    started: "Jan 2024",
    years: "1.4",
    licenceCount: 1,
    status: "Active",
    compliance: { label: "White Card expired", state: "bad", expiresDays: -3 },
  },
  {
    id: "sophie-tran",
    initials: "ST",
    name: "Sophie Tran",
    email: "sophie@heytiff.co",
    role: "Office Manager",
    employmentType: "Full-time",
    started: "Jun 2020",
    years: "5.0",
    licenceCount: 1,
    status: "Active",
    compliance: { label: "Compliant", state: "ok", expiresDays: 9999 },
  },
  {
    id: "marcus-webb",
    initials: "MW",
    name: "Marcus Webb",
    email: "marcus@heytiff.co",
    role: "Installer",
    employmentType: "Full-time",
    started: "Nov 2021",
    years: "3.6",
    licenceCount: 3,
    status: "Active",
    compliance: { label: "Insurance 30d", state: "warn", expiresDays: 30 },
  },
  {
    id: "hannah-cole",
    initials: "HC",
    name: "Hannah Cole",
    email: "hannah@heytiff.co",
    role: "Estimator",
    employmentType: "Part-time",
    started: "Feb 2023",
    years: "2.4",
    licenceCount: 2,
    status: "Active",
    compliance: { label: "Compliant", state: "ok", expiresDays: 9999 },
  },
  {
    id: "dylan-reyes",
    initials: "DR",
    name: "Dylan Reyes",
    email: "dylan@heytiff.co",
    role: "Installer",
    employmentType: "Full-time",
    started: "Sep 2019",
    years: "4.1",
    licenceCount: 2,
    status: "Inactive",
    compliance: { label: "—", state: "ok", expiresDays: 9999 },
  },
];

export const demoPendingInvites: PendingInvite[] = [
  { name: "Ben Fletcher", email: "ben.fletcher@gmail.com", role: "Installer", state: "live", note: "Expires in 5 days" },
  { name: "Kim Santos", email: "k.santos@outlook.com", role: "Service Technician", state: "expired", note: "Expired 2 days ago" },
];

export function getDemoStaff(id: string): DemoStaff | null {
  return demoStaff.find((s) => s.id === id) ?? null;
}

// Fleet — demo vehicle register + activity history. Assignments live here
// (assignedTo → DemoStaff.id) and drive the directory column + profile card.
// Expiries/purchase age are day-counts (like compliance.expiresDays above) and
// log recency is `ago` days — both deterministic so SSR markup stays stable.

export const demoVehicles: Vehicle[] = [
  {
    id: "vrf-04",
    name: "VRF-04",
    make: "Toyota",
    model: "Hiace ZR",
    year: 2022,
    plate: "MKT482",
    status: "active",
    odometer: 84120,
    assignedTo: "jordan-mills",
    value: 52000,
    purchasePrice: 58900,
    purchaseDateDays: 1524,
    regoDays: 21,
    insuranceDays: 208,
    serviceIntervalKm: 10000,
    lastServiceOdo: 75500,
  },
  {
    id: "srv-02",
    name: "SRV-02",
    make: "Ford",
    model: "Transit Custom",
    year: 2021,
    plate: "PHD319",
    status: "active",
    odometer: 112640,
    assignedTo: "priya-nair",
    value: 46500,
    purchasePrice: 52000,
    purchaseDateDays: 1800,
    regoDays: 96,
    insuranceDays: 30,
    serviceIntervalKm: 10000,
    lastServiceOdo: 105000,
  },
  {
    id: "vrf-07",
    name: "VRF-07",
    make: "Toyota",
    model: "Hilux SR5",
    year: 2023,
    plate: "QCP211",
    status: "active",
    odometer: 41980,
    assignedTo: "marcus-webb",
    value: 58900,
    purchasePrice: 61500,
    purchaseDateDays: 1225,
    regoDays: 152,
    insuranceDays: 289,
    serviceIntervalKm: 10000,
    lastServiceOdo: 35000,
  },
  {
    id: "ute-01",
    name: "UTE-01",
    make: "Mitsubishi",
    model: "Triton GLX",
    year: 2019,
    plate: "LRT906",
    status: "offroad",
    odometer: 158300,
    assignedTo: null,
    value: 31500,
    purchasePrice: 42000,
    purchaseDateDays: 2470,
    regoDays: 44,
    insuranceDays: 118,
    serviceIntervalKm: 10000,
    lastServiceOdo: 147500,
    notes: "Pool ute — off road at Braeside Auto for service & tow-bar mount",
  },
  {
    id: "srv-05",
    name: "SRV-05",
    make: "Ford",
    model: "Transit 350L",
    year: 2018,
    plate: "KWD073",
    status: "active",
    odometer: 189450,
    assignedTo: null,
    value: 27000,
    purchasePrice: 49000,
    purchaseDateDays: 3080,
    regoDays: 7,
    insuranceDays: 61,
    serviceIntervalKm: 10000,
    lastServiceOdo: 183000,
  },
  {
    id: "van-03",
    name: "VAN-03",
    make: "Hyundai",
    model: "Staria Load",
    year: 2024,
    plate: "RJB558",
    status: "active",
    odometer: 12840,
    assignedTo: null,
    value: 54800,
    purchasePrice: 56500,
    purchaseDateDays: 620,
    regoDays: 233,
    insuranceDays: 175,
    serviceIntervalKm: 10000,
    lastServiceOdo: 10110,
    notes: "New spare — keep for install crews",
  },
  {
    id: "van-01",
    name: "VAN-01",
    make: "Toyota",
    model: "Hiace",
    year: 2016,
    plate: "JTB114",
    status: "sold",
    odometer: 248900,
    assignedTo: null,
    value: 14000,
    purchasePrice: 44000,
    purchaseDateDays: 3800,
    regoDays: 400,
    insuranceDays: 400,
    serviceIntervalKm: 10000,
    lastServiceOdo: 245000,
    notes: "Sold May 2026 — Pickles auction",
  },
];

export const demoVehicleLogs: VehicleLog[] = [
  {
    id: "vl-01",
    vehicleId: "vrf-04",
    staffId: "jordan-mills",
    staffName: "Jordan Mills",
    kind: "issue",
    when: "Wed 15 Jul",
    ago: 2,
    note: "Sliding door latch sticking — needs adjustment before it jams",
    status: "open",
  },
  {
    id: "vl-02",
    vehicleId: "vrf-04",
    staffId: "jordan-mills",
    staffName: "Jordan Mills",
    kind: "fuel",
    when: "Tue 14 Jul",
    ago: 3,
    litres: 62.4,
    cost: 158.4,
    odo: 84120,
  },
  {
    id: "vl-03",
    vehicleId: "vrf-04",
    staffId: "jordan-mills",
    staffName: "Jordan Mills",
    kind: "odo",
    when: "Thu 9 Jul",
    ago: 8,
    odo: 83610,
  },
  {
    id: "vl-04",
    vehicleId: "vrf-04",
    staffId: "jordan-mills",
    staffName: "Jordan Mills",
    kind: "fuel",
    when: "Tue 7 Jul",
    ago: 10,
    litres: 58.1,
    cost: 147.2,
    odo: 83540,
  },
  {
    id: "vl-05",
    vehicleId: "vrf-04",
    staffId: null,
    kind: "service",
    when: "Sat 6 Dec",
    ago: 223,
    note: "75,000 km service — Braeside Auto, brakes & filters",
    odo: 75500,
  },
  {
    id: "vl-06",
    vehicleId: "srv-02",
    staffId: "priya-nair",
    staffName: "Priya Nair",
    kind: "fuel",
    when: "Mon 13 Jul",
    ago: 4,
    litres: 61.8,
    cost: 151.9,
    odo: 112610,
  },
  {
    id: "vl-07",
    vehicleId: "srv-02",
    staffId: "priya-nair",
    staffName: "Priya Nair",
    kind: "odo",
    when: "Sun 5 Jul",
    ago: 12,
    odo: 112180,
  },
  {
    id: "vl-08",
    vehicleId: "vrf-07",
    staffId: "marcus-webb",
    staffName: "Marcus Webb",
    kind: "fuel",
    when: "Sun 12 Jul",
    ago: 5,
    litres: 74.9,
    cost: 164.3,
    odo: 41900,
  },
  {
    id: "vl-09",
    vehicleId: "ute-01",
    staffId: "marcus-webb",
    staffName: "Marcus Webb",
    kind: "fuel",
    when: "Sat 11 Jul",
    ago: 6,
    litres: 55.0,
    cost: 128.0,
    odo: 158260,
  },
  {
    id: "vl-13",
    vehicleId: "ute-01",
    staffId: "marcus-webb",
    staffName: "Marcus Webb",
    kind: "issue",
    when: "Mon 13 Jul",
    ago: 4,
    note: "Tow bar mount cracked — off road until welded",
    status: "open",
  },
  {
    id: "vl-10",
    vehicleId: "ute-01",
    staffId: "dylan-reyes",
    staffName: "Dylan Reyes",
    kind: "issue",
    when: "Sat 27 Jun",
    ago: 20,
    note: "Tow bar wiring fault — trailer lights dead",
    status: "resolved",
  },
  {
    id: "vl-11",
    vehicleId: "srv-05",
    staffId: "priya-nair",
    staffName: "Priya Nair",
    kind: "issue",
    when: "Thu 2 Jul",
    ago: 15,
    note: "Reverse camera intermittent",
    status: "resolved",
  },
  {
    id: "vl-12",
    vehicleId: "van-03",
    staffId: null,
    kind: "service",
    when: "Mon 8 Jun",
    ago: 39,
    note: "10,000 km first service — Hyundai Ringwood",
    odo: 10110,
  },
  {
    id: "vl-14",
    vehicleId: "van-01",
    staffId: null,
    kind: "service",
    when: "Tue 28 Apr",
    ago: 80,
    note: "245,000 km pre-sale check — Braeside Auto",
    odo: 245000,
  },
];

/** The vehicle a staff member drives (sold vehicles never count). */
export function getDemoVehicleForStaff(staffId: string): Vehicle | null {
  return demoVehicles.find((v) => v.assignedTo === staffId && v.status !== "sold") ?? null;
}

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
