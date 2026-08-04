import type { StaffProfile } from "@/lib/staff/profile";
import type { ProfileHeader } from "../../types";

/* Shared fixtures for the staff-card component tests. Own fixtures, not the
   demo mock: these screens render real rows now. */

export const blankProfile: StaffProfile = {
  id: "p1",
  org_id: "o1",
  user_id: "auth0|1",
  first_name: null,
  last_name: null,
  full_name: null,
  preferred_name: null,
  phone: null,
  birthday: null,
  address: null,
  start_date: null,
  employment_type: null,
  job_title: null,
  status: "Active",
  state: null,
  photo_url: null,
  emergency_name: null,
  emergency_phone: null,
  emergency_relationship: null,
  emergency_alt_phone: null,
  work_rights_status: null,
  visa_type: null,
  visa_expiry: null,
  hours_condition: null,
  vevo_checked_at: null,
  work_rights_doc_url: null,
  work_rights_verified_at: null,
  qualifications: null,
};

export const jordan: StaffProfile = {
  ...blankProfile,
  first_name: "Jordan",
  last_name: "Mills",
  preferred_name: "Jordy",
  phone: "0400 000 000",
  birthday: "1990-12-25",
  address: "12 Smith St, Newtown NSW 2042",
  start_date: "2020-06-01",
  employment_type: "Full-time",
  job_title: "Lead Installer",
  emergency_name: "Sarah Mills",
  emergency_phone: "0411 111 111",
  emergency_relationship: "Partner",
};

export const header: ProfileHeader = {
  id: "p1",
  initials: "JM",
  name: "Jordan Mills",
  nickname: "Jordy",
  email: "jordan@heytiff.co",
  role: "Lead Installer",
  employmentType: "Full-time",
  started: "Jun 2020",
  years: "6.1",
  licenceCount: 2,
  status: "Active",
};

export const TODAY = "2026-07-24";

export const okActions = () => ({
  onSave: jest.fn().mockResolvedValue({ ok: true }),
  onAddLicence: jest.fn().mockResolvedValue({ ok: true }),
  onRemoveLicence: jest.fn().mockResolvedValue({ ok: true }),
  onSetPhoto: jest.fn().mockResolvedValue({ ok: true }),
  onClearPhoto: jest.fn().mockResolvedValue({ ok: true }),
});
