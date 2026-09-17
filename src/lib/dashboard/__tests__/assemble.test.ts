import { assembleChips, type ChipSources } from "../assemble";
import { chipGroup } from "../chips";
import type { StaffCompliance } from "../query";
import type { Capability } from "@/lib/permissions";
import type { Vehicle } from "@/components/fleet/logic";

const TODAY = "2026-07-19";

const caps = (...list: Capability[]) => new Set<Capability>(list);

const expiredLicence = { id: "l1", typeName: "White Card", expiryDate: "2026-07-01" };

const person = (staffId: string, name: string): StaffCompliance => ({
  staffId,
  name,
  workRights: { status: null, visaType: null, visaExpiry: null, vevoCheckedAt: null },
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
  ctpDays: 200,
  serviceIntervalKm: 10_000,
  lastServiceOdo: 88_000,
  serviceIntervalMonths: null,
  serviceDays: null,
  motorised: true,
  assignedTo,
  value: 0,
  purchasePrice: 0,
  purchaseDateDays: 0,
  lastServiceDays: null,
});

// A fully-populated source set — every section has something actionable, so a
// missing chip proves the capability gate, not missing data.
const FULL: ChipSources = {
  // the company's own paper is an owner's chip — see the owner gate below
  isOwner: true,
  today: TODAY,
  warnDays: 30,
  viewerStaffId: "me",
  self: person("me", "Me Myself"),
  selfVehicle: { ...vehicle("mine", "me") },
  teamPeople: [person("me", "Me Myself"), person("s2", "Jordan Mills"), person("s3", "Sam Lee")],
  fleet: [vehicle("mine", "me"), vehicle("v2", "s2"), vehicle("v3", null)],
  orgCredentials: [
    { id: "pl", kind: "insurance", name: "Public liability", issuer: "CGU", expiryDate: "2026-07-05" },
    { id: "arc", kind: "licence", name: "ARC authorisation", issuer: null, expiryDate: "2026-07-20" },
  ],
  pendingClaims: 2,
  pendingLeave: 3,
  ownSheet: { status: "sent_back", periodStart: "2026-07-13", periodLabel: "13 – 19 Jul" },
  ownDeclinedLeave: [
    {
      id: "lv1",
      kind: "annual",
      startDate: "2026-08-10",
      endDate: "2026-08-12",
      decidedOn: `${TODAY}T02:00:00Z`,
    },
  ],
  ownDeclinedClaims: [
    { id: "c1", description: "Copper fittings", amount: 214.5, decidedOn: "2026-07-17T04:00:00Z" },
  ],
};

describe("assembleChips — self section (intrinsic)", () => {
  it("emits your own chips with no capability at all", () => {
    const { self, team } = assembleChips(FULL, caps());
    // your expired licence + your van's expired rego
    expect(self.some((c) => c.kind === "licence")).toBe(true);
    expect(self.some((c) => c.kind === "rego")).toBe(true);
    // and the two answers you are owed by a person rather than a calendar
    expect(self.some((c) => c.kind === "timesheet")).toBe(true);
    expect(self.some((c) => c.kind === "claim")).toBe(true);
    expect(
      self.every((c) => c.href.startsWith("/dashboard/profile")
        || c.href.startsWith("/dashboard/my-vehicle")
        || c.href.startsWith("/dashboard/my-timesheet")
        || c.href.startsWith("/dashboard/my-expenses")
        || c.href.startsWith("/dashboard/my-leave"))
    ).toBe(true);
    expect(team).toEqual([]);
  });
});

describe("assembleChips — team gate", () => {
  it("without `team`, no team-member or business-paper chips appear even with full data", () => {
    const { team } = assembleChips(FULL, caps());
    expect(team).toEqual([]);
  });

  it("with `team`, team-member licences and the org insurance appear", () => {
    const { team } = assembleChips(FULL, caps("team"));
    // every business paper inside the window, licences included — not just the soonest policy
    expect(team.filter((c) => c.kind === "org-insurance" || c.kind === "org-licence").map((c) => c.key).sort()).toEqual([
      "org-cred:arc",
      "org-cred:pl",
    ]);
    // Jordan + Sam, but not your own row (that's in `self`)
    const people = team.filter((c) => c.kind === "licence");
    expect(people.map((c) => c.subject).sort()).toEqual(["Jordan Mills", "Sam Lee"]);
    expect(team.every((c) => c.subject !== "Me Myself")).toBe(true);
  });

  /* THE COMPANY'S PAPER NEEDS BOTH: `team` to be in the section at all, and
     the owner's seat, because the Organisation screen it links to admits the
     owner alone. An admin was carrying a warning about the company's
     insurance with no door out of it — the chip opened the screen and the
     screen sent them back to Home. */
  it("keeps the business paper from anyone the Organisation screen won't admit", () => {
    const { team } = assembleChips({ ...FULL, isOwner: false }, caps("team"));
    expect(team.some((c) => c.kind === "org-insurance" || c.kind === "org-licence")).toBe(false);
    // the people chips are unaffected — the staff card admits anyone with `team`
    expect(team.some((c) => c.kind === "licence")).toBe(true);
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
    expect(team.some((c) => c.kind === "licence" || c.kind === "org-insurance" || c.kind === "org-licence")).toBe(false);
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

/* ---------------- leave, which this board used to ignore ---------------- */

describe("assembleChips — leave", () => {
  /* THE PRINCIPLE WAS ALREADY WRITTEN, one queue over: "a claim queue belongs
     to whoever can decide it, which is `approvals`, not `team`". It was only
     ever implemented for expenses, so an approver's "everything waiting on
     you" told them about money and not about time. */
  it("shows the pending queue to a decider, beside the expenses one", () => {
    const { team } = assembleChips(FULL, caps("approvals"));
    const labels = team.map((c) => c.label);
    expect(labels).toContain("3 leave requests waiting on a decision");
    expect(labels).toContain("2 expense claims waiting on a decision");
  });

  it("stays silent without approvals, and at a zero count", () => {
    expect(assembleChips(FULL, caps("team")).team.map((c) => c.kind)).not.toContain("leave-queue");
    expect(
      assembleChips({ ...FULL, pendingLeave: 0 }, caps("approvals")).team.map((c) => c.kind),
    ).not.toContain("leave-queue");
  });

  /* A declined EXPENSE claim chipped you and a declined LEAVE request chipped
     nobody, though the two are the same shape by design — the expense_claims
     migration says so out loud. The only way to learn your leave was refused
     was to open My leave and find it in the history list. */
  it("tells you your own leave was declined, with no capability at all", () => {
    const { self } = assembleChips(FULL, caps());
    const chip = self.find((c) => c.kind === "leave-declined");
    expect(chip).toBeDefined();
    expect(chip!.label).toBe("Leave request declined");
    expect(chip!.href).toBe("/dashboard/my-leave");
    // the span it was for, so you know which request without opening it
    expect(chip!.subject).toMatch(/Aug/);
  });

  it("files both under Pay, with the timesheet and the claim", () => {
    const { self, team } = assembleChips(FULL, caps("approvals"));
    for (const c of [...self, ...team].filter((x) => x.kind.startsWith("leave-"))) {
      expect(chipGroup(c.kind)).toBe("Pay");
    }
  });
});

/* THE REMINDER A SKIPPED FIRST RUN LEAVES BEHIND — your own details, while the
   business is short of one it must hold. It rides the same list as your
   expiring licence, so it counts in Home's one attention number and the bell,
   and clears itself when the details are in. */
describe("assembleChips — your own details", () => {
  it("reminds you, among your own chips, while a required detail is missing", () => {
    const { self, team } = assembleChips(
      { ...FULL, selfCompleteness: { requiredMissing: 2, firstLabel: "Last name" }, selfName: "luke" },
      caps("team"),
    );
    const chip = self.find((c) => c.kind === "profile");
    expect(chip).toMatchObject({
      state: "warn",
      label: "2 details missing",
      subject: "luke",
      href: "/dashboard/profile",
    });
    expect(chipGroup("profile")).toBe("People");
    // yours, never the team list — nobody else's reminder is yours to carry
    expect(team.some((c) => c.kind === "profile")).toBe(false);
  });

  it("goes quiet once the required details are in", () => {
    const { self } = assembleChips(
      { ...FULL, selfCompleteness: { requiredMissing: 0, firstLabel: null } },
      caps(),
    );
    expect(self.some((c) => c.kind === "profile")).toBe(false);
  });

  it("has nobody to remind without a staff record", () => {
    const { self } = assembleChips(
      {
        ...FULL,
        viewerStaffId: null,
        self: null,
        selfVehicle: null,
        selfCompleteness: { requiredMissing: 3, firstLabel: "Date of birth" },
      },
      caps(),
    );
    expect(self).toEqual([]);
  });
});

/* A SWMS THAT NAMES YOU — the in-app notification in place of a text. It is
   yours alone, needs no capability, and sits in the same list as everything
   else that needs you. */
describe("assembleChips — SWMS sign-on", () => {
  const signon = { versionId: "v-9", again: false, jobNumber: "2601", site: "14 Attunga Road, Miranda NSW 2228", issuedAt: "2026-09-16T07:42:00.000Z" };

  it("asks you to sign on, among your own chips, with no capability", () => {
    const { self, team } = assembleChips({ ...FULL, ownSwmsSignons: [signon] }, caps());
    expect(self.find((c) => c.kind === "swms")).toMatchObject({
      label: "Sign on to the SWMS",
      subject: "Job #2601, 14 Attunga Road",
      href: "/dashboard/swms/v-9",
    });
    expect(team.some((c) => c.kind === "swms")).toBe(false);
  });

  it("has nobody to ask without a staff record", () => {
    const { self } = assembleChips(
      { ...FULL, viewerStaffId: null, self: null, selfVehicle: null, ownSwmsSignons: [signon] },
      caps(),
    );
    expect(self.some((c) => c.kind === "swms")).toBe(false);
  });
});

/* THE TEMPLATE NOBODY COULD APPROVE ON SITE — it waits in the owner's own
   list until it's done, and nobody else is told to do what only the owner can. */
describe("assembleChips — the SWMS template", () => {
  it("asks the owner while it's waiting", () => {
    const { self } = assembleChips({ ...FULL, isOwner: true, swmsTemplatePending: true }, caps());
    expect(self.find((c) => c.kind === "swms-template")).toMatchObject({ label: "Approve the SWMS template" });
  });

  it("asks nobody else, and nobody once it's approved", () => {
    expect(assembleChips({ ...FULL, isOwner: false, swmsTemplatePending: true }, caps("team")).self.some((c) => c.kind === "swms-template")).toBe(false);
    expect(assembleChips({ ...FULL, isOwner: true, swmsTemplatePending: false }, caps()).self.some((c) => c.kind === "swms-template")).toBe(false);
  });
});
