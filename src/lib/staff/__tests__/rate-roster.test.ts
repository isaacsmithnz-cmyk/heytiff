// the module imports the service-role client at load; stub it (toStaffMember is pure)
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { toStaffMember } from "../rate-roster";

const row = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  full_name: "Sam Carter",
  preferred_name: "Sammy",
  job_title: "Lead Installer",
  employment_type: "Full-time",
  status: "Active",
  hourly_wage: "58.00",
  contracted_hours: "38",
  utilisation: "85",
  cost_split: { install: 60, service: 30, admin: 10 },
  super_override: null,
  workers_comp_override: null,
  ...over,
});

describe("roster → StaffMember", () => {
  it("maps a complete profile to calculator inputs", () => {
    const m = toStaffMember(row());
    expect(m).toMatchObject({
      id: "11111111-1111-1111-1111-111111111111",
      name: "Sammy", // preferred name wins
      role: "Lead Installer",
      hourly_wage: 58,
      employment_type: "Full-time",
      contracted_hours_per_week: 38,
      install_pct: 60,
      service_pct: 30,
      admin_pct: 10,
      super_override: null,
      workers_comp_override: null,
      payroll_complete: true,
    });
  });

  it("carries the roster vocabulary straight through — the engine classifies it", () => {
    expect(toStaffMember(row({ employment_type: "Apprentice" })).employment_type).toBe("Apprentice");
    expect(toStaffMember(row({ employment_type: "Subcontractor" })).employment_type).toBe("Subcontractor");
  });

  it("passes per-person overrides through when set", () => {
    const m = toStaffMember(row({ super_override: "15", workers_comp_override: "3.5" }));
    expect(m.super_override).toBe(15);
    expect(m.workers_comp_override).toBe(3.5);
  });

  it("flags payroll_complete=false when the card has gaps", () => {
    expect(toStaffMember(row({ hourly_wage: 0 })).payroll_complete).toBe(false); // no wage
    expect(toStaffMember(row({ employment_type: "" })).payroll_complete).toBe(false); // no type
    // an allocation that doesn't add up isn't priceable
    expect(toStaffMember(row({ cost_split: { install: 50, service: 30, admin: 10 } })).payroll_complete).toBe(false);
    expect(toStaffMember(row({ cost_split: null })).payroll_complete).toBe(false);
  });

  it("falls back to the full name and zeroes a missing split", () => {
    const m = toStaffMember(row({ preferred_name: null, cost_split: null }));
    expect(m.name).toBe("Sam Carter");
    expect([m.install_pct, m.service_pct, m.admin_pct]).toEqual([0, 0, 0]);
  });
});
