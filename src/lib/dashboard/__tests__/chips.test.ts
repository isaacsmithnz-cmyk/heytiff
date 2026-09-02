import {
  CLAIM_NUDGE_DAYS,
  GROUP_ICON,
  chipGroup,
  chipSummary,
  declinedClaimChip,
  declinedLeaveChip,
  expensesChip,
  leaveQueueChip,
  timesheetChip,
  summaryLine,
  ctpChip,
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
  ctpDays: 200,
  serviceIntervalKm: 10_000,
  lastServiceOdo: 88_000,
  serviceIntervalMonths: null,
  serviceDays: null,
  motorised: true, // due at 98,000 → 8,000 km left (well clear)
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
    expect(chip?.label).toBe("White Card expires in 13 days");
  });

  it("is bad once expired, with a days-ago label", () => {
    const chip = licenceChip({ id: "l1", typeName: "White Card", expiryDate: "2026-07-15" }, licCtx);
    expect(chip?.state).toBe("bad");
    expect(chip?.label).toBe("White Card expired 4 days ago");
  });

  it("treats the boundary day (exactly 30d) as a warn, not nothing", () => {
    const chip = licenceChip({ id: "l1", typeName: "White Card", expiryDate: "2026-08-18" }, licCtx);
    expect(chip?.state).toBe("warn");
    expect(chip?.label).toBe("White Card expires in 4 weeks");
  });
});

describe("workRightsChips", () => {
  const base = { staffId: "s1", status: null, visaType: null, visaExpiry: null, vevoCheckedAt: null };

  it("is empty for a blank card — a new hire is 'not set up', not 'at risk'", () => {
    expect(workRightsChips(base, licCtx)).toEqual([]);
  });

  it("warns on an unverified recorded status", () => {
    const chips = workRightsChips({ ...base, status: "Visa holder" }, licCtx);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ state: "warn", label: "Work rights unverified", key: "work-rights-unverified:s1" });
  });

  it("does not warn unverified once verified", () => {
    const chips = workRightsChips({ ...base, status: "Visa holder", vevoCheckedAt: "2026-01-01" }, licCtx);
    expect(chips).toEqual([]);
  });

  it("flags an expiring visa using its type in the label", () => {
    const chips = workRightsChips(
      { ...base, status: "Visa holder", visaType: "482 TSS", visaExpiry: "2026-08-01", vevoCheckedAt: "2026-01-01" },
      licCtx,
    );
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ kind: "work-rights", state: "warn", key: "work-rights-visa:s1" });
    expect(chips[0].label).toBe("482 TSS expires in 13 days");
  });

  it("raises BOTH a visa-expiry and an unverified chip when both apply", () => {
    const chips = workRightsChips(
      { ...base, status: "Visa holder", visaType: "482 TSS", visaExpiry: "2026-07-10", vevoCheckedAt: null },
      licCtx,
    );
    expect(chips.map((c) => c.key).sort()).toEqual(["work-rights-unverified:s1", "work-rights-visa:s1"]);
    expect(chips.find((c) => c.key === "work-rights-visa:s1")?.state).toBe("bad");
  });

  it("falls back to 'Visa' when no visa type is recorded", () => {
    const chips = workRightsChips({ ...base, visaExpiry: "2026-08-01" }, licCtx);
    expect(chips[0].label).toBe("Visa expires in 13 days");
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
    expect(regoChip(vehicle({ regoDays: 12 }), vCtx)).toMatchObject({ state: "warn", label: "Rego expires in 12 days" });
    expect(regoChip(vehicle({ regoDays: -4 }), vCtx)).toMatchObject({ state: "bad", label: "Rego expired 4 days ago" });
  });

  it("warn on soon insurance and go bad once expired", () => {
    expect(insuranceChip(vehicle({ insuranceDays: 5 }), vCtx)).toMatchObject({ state: "warn", label: "Insurance expires in 5 days" });
    expect(insuranceChip(vehicle({ insuranceDays: -1 }), vCtx)).toMatchObject({ state: "bad", label: "Insurance expired yesterday" });
  });

  /* The green slip gets its own chip because the rego renewal DEPENDS on it:
     a lapsed one is why the rego cannot be renewed, and folding the two would
     have sent the rego warning and swallowed the reason for it. */
  it("warns on the green slip separately from rego and insurance", () => {
    const clear = { regoDays: 200, insuranceDays: 200 };
    expect(ctpChip(vehicle({ ...clear, ctpDays: 9 }), vCtx)).toMatchObject({
      kind: "ctp",
      state: "warn",
      label: "Green slip expires in 9 days",
    });
    expect(ctpChip(vehicle({ ...clear, ctpDays: -2 }), vCtx)).toMatchObject({ state: "bad" });
    expect(ctpChip(vehicle({ ...clear, ctpDays: 90 }), vCtx)).toBeNull();
    expect(ctpChip(vehicle({ status: "sold", ctpDays: -50 }), vCtx)).toBeNull();
  });

  it("puts the green slip in the Fleet group, beside the rego it gates", () => {
    expect(chipGroup("ctp")).toBe("Fleet");
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

  it("files money and hours under Pay", () => {
    // the approver's queue moved here with them: "10 claims waiting" and "your
    // claim was declined" are the same screen's work and were in two groups
    expect(chipGroup("timesheet")).toBe("Pay");
    expect(chipGroup("claim")).toBe("Pay");
    expect(chipGroup("expenses")).toBe("Pay");
  });

  it("gives every kind a group and every group a real icon", () => {
    /* Exhaustive by construction: a new ChipKind that nobody files fails to
       compile here rather than rendering with a blank tag and no glyph. */
    /* A Record, not an array: an array typed ChipKind[] compiles happily when
       a kind is MISSING, which is the only failure this test exists to catch —
       it was already short two kinds when a third was added. */
    const filed: Record<ChipKind, true> = {
      licence: true,
      "work-rights": true,
      rego: true,
      insurance: true,
      ctp: true,
      service: true,
      "org-insurance": true,
      expenses: true,
      timesheet: true,
      claim: true,
      "leave-queue": true,
      "leave-declined": true,
    };
    for (const k of Object.keys(filed) as ChipKind[]) {
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
    expect(chip?.label).toBe("Public liability expires in 2 weeks");
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

describe("expensesChip", () => {
  /* Money in limbo is an action. One chip for the queue — the decision
     surface is the expenses screen, and ten chips say less than "10 waiting". */
  it("is silent at zero and counts plainly above it", () => {
    expect(expensesChip(0)).toBeNull();
    expect(expensesChip(1)).toMatchObject({
      kind: "expenses",
      state: "warn",
      label: "1 expense claim waiting on a decision",
      href: "/dashboard/timepay/expenses",
    });
    expect(expensesChip(3)!.label).toBe("3 expense claims waiting on a decision");
  });
});

/* ── the two answers you are owed by a person ──────────────────────────────

   Both of these existed nowhere in the app before: a timesheet came back with
   a question and a claim was declined, and the only way to find out was to
   open the screen and look. */

describe("timesheetChip", () => {
  const sheet = { status: "sent_back", periodStart: "2026-07-13", periodLabel: "13 – 19 Jul" };

  it("says nothing until an approver has actually asked something", () => {
    expect(timesheetChip(null)).toBeNull();
    for (const status of ["draft", "submitted", "approved"]) {
      expect(timesheetChip({ ...sheet, status })).toBeNull();
    }
  });

  it("is always bad, names the period, and opens THAT period", () => {
    // never `warn`: either you have been asked a question or you haven't —
    // there is no getting-close for this one
    expect(timesheetChip(sheet)).toMatchObject({
      kind: "timesheet",
      state: "bad",
      label: "Timesheet sent back with a question",
      subject: "13 – 19 Jul",
      href: "/dashboard/my-timesheet?period=2026-07-13",
    });
  });

  it("survives the period rolling over", () => {
    /* The hole this closes: a question asked on the second-last day of a
       period is still unanswered the next morning. Keyed off the sheet's own
       period, so a chip for a period that is no longer current still points
       at the right one. */
    const old = timesheetChip({ ...sheet, periodStart: "2026-06-01", periodLabel: "1 – 7 Jun" });
    expect(old!.href).toBe("/dashboard/my-timesheet?period=2026-06-01");
  });
});

describe("declinedClaimChip", () => {
  const claim = { id: "c1", description: "Copper fittings", amount: 214.5, decidedOn: "2026-07-17T04:00:00Z" };
  const ctx = { today: TODAY }; // 2026-07-19

  it("names the receipt and the money, and opens your claims", () => {
    // the description is what tells you WHICH receipt — a queue count couldn't
    expect(declinedClaimChip(claim, ctx)).toMatchObject({
      kind: "claim",
      state: "bad",
      label: "Expense claim declined",
      subject: "Copper fittings · $214.50",
      href: "/dashboard/my-expenses",
    });
  });

  it("drops the cents when there are none", () => {
    expect(declinedClaimChip({ ...claim, amount: 340 }, ctx)!.subject).toBe("Copper fittings · $340");
  });

  it("stops nudging once the news is old", () => {
    /* Unlike a sent-back timesheet there is no state left to change — a
       declined claim stays declined forever — so without a window this chip
       would never clear and would teach people to read past the whole board. */
    const onTheEdge = { ...claim, decidedOn: "2026-07-05T00:00:00Z" }; // 14 days
    const pastIt = { ...claim, decidedOn: "2026-07-04T00:00:00Z" }; // 15
    expect(CLAIM_NUDGE_DAYS).toBe(14);
    expect(declinedClaimChip(onTheEdge, ctx)).not.toBeNull();
    expect(declinedClaimChip(pastIt, ctx)).toBeNull();
  });

  it("is silent on a claim with no recorded decision", () => {
    expect(declinedClaimChip({ ...claim, decidedOn: null }, ctx)).toBeNull();
  });

  it("ranks the freshest decision first", () => {
    // the newest is the one you can still most likely do something about
    const fresh = declinedClaimChip({ ...claim, id: "new", decidedOn: "2026-07-19T00:00:00Z" }, ctx)!;
    const stale = declinedClaimChip({ ...claim, id: "old", decidedOn: "2026-07-08T00:00:00Z" }, ctx)!;
    expect(sortChips([stale, fresh]).map((c) => c.key)).toEqual([
      "claim-declined:new",
      "claim-declined:old",
    ]);
  });
});

describe("leaveQueueChip", () => {
  it("counts the queue, and says nothing at zero", () => {
    expect(leaveQueueChip(0)).toBeNull();
    expect(leaveQueueChip(1)).toMatchObject({
      kind: "leave-queue",
      state: "warn",
      label: "1 leave request waiting on a decision",
      href: "/dashboard/timepay/leave",
    });
    expect(leaveQueueChip(4)!.label).toBe("4 leave requests waiting on a decision");
  });
});

describe("declinedLeaveChip", () => {
  const TODAY_ = "2026-08-10";
  const req = (over: Partial<Parameters<typeof declinedLeaveChip>[0]> = {}) => ({
    id: "lv1",
    kind: "annual",
    startDate: "2026-08-20",
    endDate: "2026-08-22",
    decidedOn: "2026-08-09T04:00:00Z",
    ...over,
  });

  it("names the span it was for, so you know which request", () => {
    const c = declinedLeaveChip(req(), { today: TODAY_ })!;
    expect(c.label).toBe("Leave request declined");
    expect(c.subject).toBe("20 Aug – 22 Aug");
    expect(c.state).toBe("bad");
    expect(c.href).toBe("/dashboard/my-leave");
  });

  it("says a single day once, not as a range", () => {
    const c = declinedLeaveChip(req({ endDate: "2026-08-20" }), { today: TODAY_ })!;
    expect(c.subject).toBe("20 Aug");
  });

  /* A declined request has no state left to change — it stays declined
     forever — so without a window the chip would never clear and would teach
     people to read past the whole board. Same window as a declined claim. */
  it("stops nudging after the window, and never fires without a decision date", () => {
    expect(declinedLeaveChip(req({ decidedOn: null }), { today: TODAY_ })).toBeNull();
    expect(
      declinedLeaveChip(req({ decidedOn: "2026-07-01T00:00:00Z" }), { today: TODAY_ }),
    ).toBeNull();
  });

  it("ranks the freshest decision first within the bad bucket", () => {
    const older = declinedLeaveChip(req({ decidedOn: "2026-08-01T00:00:00Z" }), { today: TODAY_ })!;
    const newer = declinedLeaveChip(req({ decidedOn: "2026-08-09T00:00:00Z" }), { today: TODAY_ })!;
    expect(newer.urgency).toBeLessThan(older.urgency);
  });
});
