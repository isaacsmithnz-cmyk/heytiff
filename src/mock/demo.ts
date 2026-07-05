// DEMO DATA — remove before production. Every export here is placeholder.
// Acceptance test: delete this file and the app still compiles, with the Team
// directory falling back to its "No staff yet" empty state.

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
  vehicle: string;
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
    vehicle: "VRF-04",
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
    vehicle: "SRV-02",
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
    vehicle: "",
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
    vehicle: "",
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
    vehicle: "VRF-07",
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
    vehicle: "",
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
    vehicle: "",
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
