import { assembleChips, type ChipSources } from "../assemble";
import type { StaffCompliance } from "../query";
import type { Capability } from "@/lib/permissions";
import type { Vehicle } from "@/components/fleet/logic";

const TODAY = "2026-07-19";

const caps = (...list: Capability[]) => new Set<Capability>(list);

const expiredLicence = { id: "l1", typeName: "White Card", expiryDate: "2026-07-01" };

const person = (staffId: string, name: string): StaffCompliance => ({
  staffId,
  name,
  workRights: { status: null, visaType: null, visaExpiry: null, verifiedAt: null },
  licences: [{ ...expiredLicence, id: `${staffId}-lic` }],
});

const vehicle = (id: string, assignedTo: string | null): Vehicle => ({
  id,
  name: `Van ${id}`,
  make: "Toyota",
  model: "Hiace",
  year: 2022,
  plate: id,
  plateState: "NSW",
  status: "active",
  odometer: 90_000,
  regoDays: -10, // expired → a bad chip
  insuranceDays: 200,
  serviceIntervalKm: 10_000,
  lastServiceOdo: 88_000,
  assignedTo,
  value: 0,
  purchasePrice: 0,
  purchaseDateDays: 0,
});

// A fully-populated source set — every section has something actionable, so a
// missing chip proves the capability gate, not missing data.
const FULL: ChipSources = {
  today: TODAY,
  viewerStaffId: "me",
  self: person("me", "Me Myself"),
  selfVehicle: { ...vehicle("mine", "me") },
  teamPeople: [person("me", "Me Myself"), person("s2", "Jordan Mills"), person("s3", "Sam Lee")],
  fleet: [vehicle("mine", "me"), vehicle("v2", "s2"), vehicle("v3", null)],
  org: { insurer: "CGU", insuranceExpiry: "2026-07-05" },
  pendingClaims: 2,
};

describe("assembleChips — self section (intrinsic)", () => {
  it("emits your own chips with no capability at all", () => {
    const { self, team } = assembleChips(FULL, caps());
    // your expired licence + your van's expired rego
    expect(self.some((c) => c.kind === "licence")).toBe(true);
    expect(self.some((c) => c.kind === "rego")).toBe(true);
    expect(self.every((c) => c.href === "/dashboard/profile" || c.href === "/dashboard/my-vehicle")).toBe(true);
    expect(team).toEqual([]);
  });
});

describe("assembleChips — team gate", () => {
  it("without `team`, no team-member or org-insurance chips appear even with full data", () => {
    const { team } = assembleChips(FULL, caps());
    expect(team).toEqual([]);
  });

  it("with `team`, team-member licences and the org insurance appear", () => {
    const { team } = assembleChips(FULL, caps("team"));
    expect(team.some((c) => c.kind === "org-insurance")).toBe(true);
    // Jordan + Sam, but not your own row (that's in `self`)
    const people = team.filter((c) => c.kind === "licence");
    expect(people.map((c) => c.subject).sort()).toEqual(["Jordan Mills", "Sam Lee"]);
    expect(team.every((c) => c.subject !== "Me Myself")).toBe(true);
  });

  it("with `team` but not `assets_all`, no fleet chips leak in", () => {
    const { team } = assembleChips(FULL, caps("team"));
    expect(team.some((c) => c.kind === "rego" || c.kind === "insurance" || c.kind === "service")).toBe(false);
  });
});

describe("assembleChips — assets gate", () => {
  it("with `assets_all` but not `team`, only fleet chips appear in team", () => {
    const { team } = assembleChips(FULL, caps("assets_all"));
    expect(team.length).toBeGreaterThan(0);
    expect(team.every((c) => c.kind === "rego" || c.kind === "insurance" || c.kind === "service")).toBe(true);
    expect(team.some((c) => c.kind === "licence" || c.kind === "org-insurance")).toBe(false);
  });

  it("does not list your own assigned van twice — it stays in self, not team", () => {
    const { self, team } = assembleChips(FULL, caps("assets_all"));
    expect(self.some((c) => c.key === "rego:mine")).toBe(true);
    expect(team.some((c) => c.key === "rego:mine")).toBe(false);
    // the pool van (v3, unassigned) and s2's van do appear in team
    expect(team.some((c) => c.key === "rego:v3")).toBe(true);
    expect(team.some((c) => c.key === "rego:v2")).toBe(true);
  });
});

describe("assembleChips — no staff record", () => {
  it("emits nothing for a viewer with no staff profile", () => {
    const { self, team } = assembleChips(
      { ...FULL, viewerStaffId: null, self: null, selfVehicle: null },
      caps("team", "assets_all"),
    );
    expect(self).toEqual([]);
    // teamPeople still all appear (none is the viewer, since viewer has no id)
    expect(team.some((c) => c.subject === "Me Myself")).toBe(true);
  });
});

describe("assembleChips — the expenses queue rides on `approvals`", () => {
  /* A claim queue belongs to whoever can decide it — not to `team`, which is
     people-compliance, and not to everyone. */
  it("shows the queue to a decider", () => {
    const { team } = assembleChips(FULL, caps("approvals"));
    expect(team.some((c) => c.kind === "expenses")).toBe(true);
  });

  it("stays silent for team without approvals, and at a zero count", () => {
    const { team } = assembleChips(FULL, caps("team"));
    expect(team.some((c) => c.kind === "expenses")).toBe(false);
    const { team: none } = assembleChips({ ...FULL, pendingClaims: 0 }, caps("approvals"));
    expect(none.some((c) => c.kind === "expenses")).toBe(false);
  });
});
