import type { Capability } from "@/lib/permissions";
import type { Vehicle, VehicleWithFacts } from "@/components/fleet/logic";
import {
  expensesChip,
  licenceChip,
  orgInsuranceChip,
  sortChips,
  vehicleChips,
  vehicleLabel,
  workRightsChips,
  type ActionChip,
} from "./chips";
import type { StaffCompliance } from "./query";

/* Assembling the Dashboard's action-required chips, capability-scoped.

   Two sections:
     self — your own expiries. Intrinsic: everyone gets them, no capability.
            Your licences and work rights (→ your profile) and the vehicle
            assigned to you (→ My vehicle).
     team — everyone else's. Gated per source, not as a block:
            · people compliance + the org's own insurance ride on `team`
            · the fleet-wide register rides on `assets_all`
            so someone with `team` but not `assets_all` sees the roster's
            expiries but not the vans', and vice versa.

   This module is PURE and re-checks the capabilities itself: it is the provable
   boundary, exactly like the wage-column projection. The loader in ./page-data
   only bothers to FETCH team data when the viewer holds the capability, so the
   rows never leave the database otherwise — but even handed the full set, this
   would emit nothing a viewer may not see. Kept out of page-data so tests can
   import it without dragging in auth0/session I/O. */

export type DashboardChips = { self: ActionChip[]; team: ActionChip[] };

export type ChipSources = {
  today: string;
  viewerStaffId: string | null;
  /** Your own compliance record (licences + work rights). */
  self: StaffCompliance | null;
  /** The vehicle assigned to you, if any. */
  selfVehicle: VehicleWithFacts | null;
  /** The active roster (may include you — assembleChips skips your own row). */
  teamPeople: StaffCompliance[];
  /** The whole register. */
  fleet: Vehicle[];
  org: { insurer: string | null; insuranceExpiry: string | null };
  /** Expense claims waiting on a decision — 0 when the viewer can't decide
      them (the loader only counts for `approvals` holders). */
  pendingClaims: number;
};

const push = (arr: ActionChip[], chip: ActionChip | null) => {
  if (chip) arr.push(chip);
};

export function assembleChips(src: ChipSources, caps: ReadonlySet<Capability>): DashboardChips {
  const self: ActionChip[] = [];
  if (src.self && src.viewerStaffId) {
    const ctx = { subject: src.self.name, href: "/dashboard/profile", today: src.today };
    for (const lic of src.self.licences) push(self, licenceChip(lic, ctx));
    self.push(...workRightsChips({ staffId: src.viewerStaffId, ...src.self.workRights }, ctx));
  }
  if (src.selfVehicle) {
    self.push(...vehicleChips(src.selfVehicle, { subject: vehicleLabel(src.selfVehicle), href: "/dashboard/my-vehicle" }));
  }

  const team: ActionChip[] = [];
  if (caps.has("team")) {
    for (const s of src.teamPeople) {
      if (s.staffId === src.viewerStaffId) continue; // your own already in `self`
      const ctx = { subject: s.name, href: `/dashboard/team/${s.staffId}`, today: src.today };
      for (const lic of s.licences) push(team, licenceChip(lic, ctx));
      team.push(...workRightsChips({ staffId: s.staffId, ...s.workRights }, ctx));
    }
    push(team, orgInsuranceChip(src.org, { href: "/dashboard/admin/organization", today: src.today }));
  }
  // A claim queue belongs to whoever can decide it, which is `approvals`,
  // not `team` — same rule as the review screen itself.
  if (caps.has("approvals")) {
    push(team, expensesChip(src.pendingClaims));
  }
  if (caps.has("assets_all")) {
    for (const v of src.fleet) {
      // your own van's chips are already in `self` — don't list them twice
      if (v.assignedTo && v.assignedTo === src.viewerStaffId) continue;
      team.push(...vehicleChips(v, { subject: vehicleLabel(v), href: "/dashboard/assets" }));
    }
  }

  return { self: sortChips(self), team: sortChips(team) };
}
