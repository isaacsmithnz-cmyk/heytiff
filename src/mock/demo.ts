// DEMO DATA — remove before production. Every export here is placeholder.
// Acceptance test: delete this file and the app still compiles, with the Team
// directory falling back to its "No staff yet" empty state.

export type DemoStaff = {
  id: string;
  initials: string;
  name: string;
  nickname?: string;
  role: string;
  employmentType: string;
  started: string;
  years: string;
  licenceCount: number;
  status: "Active" | "Inactive";
  vehicle: string;
  compliance: { label: string; warn: boolean };
};

export const demoStaff: DemoStaff[] = [
  {
    id: "jordan-mills",
    initials: "JM",
    name: "Jordan Mills",
    nickname: "Jordy",
    role: "Lead Installer",
    employmentType: "Full-time",
    started: "Mar 2021",
    years: "3.2",
    licenceCount: 4,
    status: "Active",
    vehicle: "VRF-04",
    compliance: { label: "ARC expires 14d", warn: true },
  },
];

export function getDemoStaff(id: string): DemoStaff | null {
  return demoStaff.find((s) => s.id === id) ?? null;
}
