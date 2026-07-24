import {
  GROUP_ICON,
  chipGroup,
  chipSummary,
  heroAction,
  summaryLine,
  insuranceChip,
  licenceChip,
  orgInsuranceChip,
  regoChip,
  serviceChip,
  sortChips,
  vehicleChips,
  vehicleLabel,
  workRightsChips,
  type ActionChip,
  type ChipKind,
} from "../chips";
import type { VehicleWithFacts } from "@/components/fleet/logic";
import { ICON_PATHS } from "@/components/shell/icon";

// Anchor day for every date-based case. daysUntil counts from this.
const TODAY = "2026-07-19";

const licCtx = { subject: "Jordan Mills", href: "/dashboard/profile", today: TODAY };
const vCtx = { subject: "Hiace VRF-04", href: "/dashboard/my-vehicle" };

/* Build a VehicleWithFacts with everything "fine" by default, so each test can
   move exactly one field into the danger zone. */
const vehicle = (over: Partial<VehicleWithFacts> = {}): VehicleWithFacts => ({
  id: "v1",
  name: "Hiace",
  make: "Toyota",
  model: "Hiace",
  year: 2022,
  plate: "ABC123",
  plateState: "NSW",
  status: "active",
  odometer: 90_000,
  regoDays: 200,
  insuranceDays: 200,
  serviceIntervalKm: 10_000,
  lastServiceOdo: 88_000, // due at 98,000 → 8,000 km left (well clear)
  ...over,
});

describe("licenceChip", () => {
  it("is null with no expiry recorded", () => {
    expect(licenceChip({ id: "l1", typeName: "White Card", expiryDate: null }, licCtx)).toBeNull();
  });

  it("is null when the licence is comfortably in date", () => {
    expect(
      licenceChip({ id: "l1", typeName: "White Card", expiryDate: "2027-01-01" }, licCtx),
    ).toBeNull();
  });

  it("warns inside the 30-day window", () => {
    const chip = licenceChip({ id: "l1", typeName: "White Card", expiryDate: "2026-08-01" }, licCtx);
    expect(chip).toMatchObject({
      kind: "licence",
      state: "warn",
      key: "licence:l1",
      subject: "Jordan Mills",
      href: "/dashboard/profile",
    });
    expect(chip?.label).toBe("White Card expires 13d");
  });

  it("is bad once expired, with a days-ago label", () => {
    const chip = licenceChip({ id: "l1", typeName: "White Card", expiryDate: "2026-07-15" }, licCtx);
    expect(chip?.state).toBe("bad");
    expect(chip?.label).toBe("White Card expired 4d ago");
  });

  it("treats the boundary day (exactly 30d) as a warn, not nothing", () => {
    const chip = licenceChip({ id: "l1", typeName: "White Card", expiryDate: "2026-08-18" }, licCtx);
    expect(chip?.state).toBe("warn");
    expect(chip?.label).toBe("White Card expires 30d");
  });
});

describe("workRightsChips", () => {
  const base = { staffId: "s1", status: null, visaType: null, visaExpiry: null, verifiedAt: null };

  it("is empty for a blank card — a new hire is 'not set up', not 'at risk'", () => {
    expect(workRightsChips(base, licCtx)).toEqual([]);
  });

  it("warns on an unverified recorded status", () => {
    const chips = workRightsChips({ ...base, status: "Visa holder" }, licCtx);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ state: "warn", label: "Work rights unverified", key: "work-rights-unverified:s1" });
  });

  it("does not warn unverified once verified", () => {
    const chips = workRightsChips({ ...base, status: "Visa holder", verifiedAt: "2026-01-01" }, licCtx);
    expect(chips).toEqual([]);
  });

  it("flags an expiring visa using its type in the label", () => {
    const chips = workRightsChips(
      { ...base, status: "Visa holder", visaType: "482 TSS", visaExpiry: "2026-08-01", verifiedAt: "2026-01-01" },
      licCtx,
    );
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ kind: "work-rights", state: "warn", key: "work-rights-visa:s1" });
    expect(chips[0].label).toBe("482 TSS expires 13d");
  });

  it("raises BOTH a visa-expiry and an unverified chip when both apply", () => {
    const chips = workRightsChips(
      { ...base, status: "Visa holder", visaType: "482 TSS", visaExpiry: "2026-07-10", verifiedAt: null },
      licCtx,
    );
    expect(chips.map((c) => c.key).sort()).toEqual(["work-rights-unverified:s1", "work-rights-visa:s1"]);
    expect(chips.find((c) => c.key === "work-rights-visa:s1")?.state).toBe("bad");
  });

  it("falls back to 'Visa' when no visa type is recorded", () => {
    const chips = workRightsChips({ ...base, visaExpiry: "2026-08-01" }, licCtx);
    expect(chips[0].label).toBe("Visa expires 13d");
  });
});

describe("vehicle chips", () => {
  it("produce nothing for a healthy vehicle", () => {
    expect(vehicleChips(vehicle(), vCtx)).toEqual([]);
  });

  it("never fire for a sold vehicle, even with an expired rego", () => {
    expect(regoChip(vehicle({ status: "sold", regoDays: -50 }), vCtx)).toBeNull();
    expect(insuranceChip(vehicle({ status: "sold", insuranceDays: -50 }), vCtx)).toBeNull();
    expect(serviceChip(vehicle({ status: "sold", odometer: 200_000 }), vCtx)).toBeNull();
  });

  it("warn on a soon rego and go bad once expired", () => {
    expect(regoChip(vehicle({ regoDays: 12 }), vCtx)).toMatchObject({ state: "warn", label: "Rego expires 12d" });
    expect(regoChip(vehicle({ regoDays: -4 }), vCtx)).toMatchObject({ state: "bad", label: "Rego expired 4d ago" });
  });

  it("warn on soon insurance and go bad once expired", () => {
    expect(insuranceChip(vehicle({ insuranceDays: 5 }), vCtx)).toMatchObject({ state: "warn", label: "Insurance expires 5d" });
    expect(insuranceChip(vehicle({ insuranceDays: -1 }), vCtx)).toMatchObject({ state: "bad", label: "Insurance expired 1d ago" });
  });

  it("warn inside the service window and go bad once overdue", () => {
    // due at 98,000; odo 97,000 → 1,000 km left (inside the 1,500 window)
    expect(serviceChip(vehicle({ odometer: 97_000 }), vCtx)).toMatchObject({ state: "warn", label: "Service in 1,000 km" });
    // odo 99,000 → 1,000 km overdue
    expect(serviceChip(vehicle({ odometer: 99_000 }), vCtx)).toMatchObject({ state: "bad", label: "Service overdue 1,000 km" });
  });

  it("sort worst-first across sources on one vehicle", () => {
    const chips = vehicleChips(vehicle({ regoDays: 20, insuranceDays: -3, odometer: 99_000 }), vCtx);
    // both bad chips (service 1,000 km overdue, insurance 3d expired) sort before
    // the rego warn; the km-overdue service normalises as the more urgent of the two
    expect(chips.map((c) => c.kind)).toEqual(["service", "insurance", "rego"]);
    expect(chips[chips.length - 1].state).toBe("warn");
  });
});

describe("chipSummary / summaryLine", () => {
  const c = (state: "bad" | "warn"): ActionChip => ({
    key: `k${Math.random()}`,
    kind: "rego",
    state,
    label: "l",
    subject: "s",
    href: "h",
    urgency: 0,
  });

  it("counts each urgency separately and totals them", () => {
    expect(chipSummary([c("bad"), c("warn"), c("warn")])).toEqual({ total: 3, bad: 1, warn: 2 });
  });

  it("is all zeros when nothing needs attention", () => {
    expect(chipSummary([])).toEqual({ total: 0, bad: 0, warn: 0 });
    expect(summaryLine({ total: 0, bad: 0, warn: 0 })).toBe("");
  });

  it("names only the buckets that have something in them", () => {
    expect(summaryLine({ total: 3, bad: 1, warn: 2 })).toBe("1 overdue · 2 due soon");
    expect(summaryLine({ total: 2, bad: 2, warn: 0 })).toBe("2 overdue");
    expect(summaryLine({ total: 1, bad: 0, warn: 1 })).toBe("1 due soon");
  });
});

describe("heroAction", () => {
  const chip = (over: Partial<ActionChip>): ActionChip => ({
    key: "k", kind: "rego", state: "warn", label: "Rego expires 10d",
    subject: "EVD72G", href: "h", urgency: 0, ...over,
  });

  it("reassures, rather than showing a zero, when nothing is due", () => {
    expect(heroAction([], "/x")).toEqual({
      state: "ok", title: "All clear", sub: "Nothing due in the next 30 days", href: "/x",
    });
  });

  it("names the worst item instead of only counting — a count moves the question along", () => {
    const a = heroAction([chip({ state: "bad", label: "Rego expired 14d ago", subject: "FRU397" })], "/x");
    expect(a).toMatchObject({ state: "bad", title: "1 thing needs your attention" });
    expect(a.sub).toBe("Rego expired 14d ago · FRU397");
  });

  it("counts the rest and takes its state from the worst (head of a sorted list)", () => {
    const a = heroAction(
      [chip({ state: "bad", label: "Rego expired 14d ago", subject: "FRU397" }), chip({}), chip({})],
      "/x",
    );
    expect(a).toMatchObject({ state: "bad", title: "3 things need your attention" });
    expect(a.sub).toBe("Rego expired 14d ago · FRU397 · +2 more");
  });
});

describe("chipGroup", () => {
  it("files every vehicle source under Fleet", () => {
    expect(chipGroup("rego")).toBe("Fleet");
    expect(chipGroup("insurance")).toBe("Fleet");
    expect(chipGroup("service")).toBe("Fleet");
  });

  it("files person-compliance under People and the business under Business", () => {
    expect(chipGroup("licence")).toBe("People");
    expect(chipGroup("work-rights")).toBe("People");
    expect(chipGroup("org-insurance")).toBe("Business");
  });

  it("gives every kind a group and every group a real icon", () => {
    const kinds: ChipKind[] = ["licence", "work-rights", "rego", "insurance", "service", "org-insurance"];
    for (const k of kinds) {
      const g = chipGroup(k);
      expect(g).toBeTruthy();
      expect(ICON_PATHS[GROUP_ICON[g]]).toBeTruthy();
    }
  });
});

describe("vehicleLabel", () => {
  it("uses the name when there is one", () => {
    expect(vehicleLabel({ name: "VRF-04", plate: "ABC123" })).toBe("VRF-04");
  });

  it("falls back to the plate — a chip with a blank subject names nothing", () => {
    // the register leaves `name` empty for vehicles only known by their plate
    expect(vehicleLabel({ name: "", plate: "EVD72G" })).toBe("EVD72G");
    expect(vehicleLabel({ name: "   ", plate: "EVD72G" })).toBe("EVD72G");
  });

  it("never renders empty, even with neither", () => {
    expect(vehicleLabel({ name: "", plate: "" })).toBe("Unnamed vehicle");
  });
});

describe("orgInsuranceChip", () => {
  const ctx = { href: "/dashboard/admin/organization", today: TODAY };

  it("is null with no expiry set", () => {
    expect(orgInsuranceChip({ insurer: "CGU", insuranceExpiry: null }, ctx)).toBeNull();
  });

  it("uses the insurer name as the subject when set", () => {
    const chip = orgInsuranceChip({ insurer: "CGU", insuranceExpiry: "2026-08-02" }, ctx);
    expect(chip).toMatchObject({ kind: "org-insurance", state: "warn", subject: "CGU" });
    expect(chip?.label).toBe("Public liability expires 14d");
  });

  it("falls back to a generic subject with no insurer", () => {
    const chip = orgInsuranceChip({ insurer: null, insuranceExpiry: "2026-07-01" }, ctx);
    expect(chip).toMatchObject({ state: "bad", subject: "Public liability insurance" });
  });
});

describe("sortChips", () => {
  const chip = (over: Partial<ActionChip>): ActionChip => ({
    key: "k",
    kind: "licence",
    state: "warn",
    label: "l",
    subject: "s",
    href: "h",
    urgency: 0,
    ...over,
  });

  it("orders every bad chip before every warn chip", () => {
    const sorted = sortChips([
      chip({ key: "warn-soon", state: "warn", urgency: 10_001 }),
      chip({ key: "bad-old", state: "bad", urgency: -50 }),
      chip({ key: "warn-later", state: "warn", urgency: 10_020 }),
      chip({ key: "bad-recent", state: "bad", urgency: -1 }),
    ]);
    expect(sorted.map((c) => c.key)).toEqual(["bad-old", "bad-recent", "warn-soon", "warn-later"]);
  });

  it("does not mutate its input", () => {
    const input = [chip({ urgency: 5 }), chip({ urgency: 1 })];
    const copy = [...input];
    sortChips(input);
    expect(input).toEqual(copy);
  });
});
