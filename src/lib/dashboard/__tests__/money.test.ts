import { payRunItem, tallySheets } from "../money";

describe("tallySheets", () => {
  it("counts only submitted and approved, ignoring drafts and sent-back", () => {
    expect(tallySheets(["draft", "submitted", "approved", "approved", "sent_back"])).toEqual({
      submitted: 1,
      approved: 2,
    });
  });

  it("is all zeros for an empty period", () => {
    expect(tallySheets([])).toEqual({ submitted: 0, approved: 0 });
  });
});

describe("payRunItem", () => {
  const base = { periodLabel: "1–14 Jul", periodEnd: "2026-07-14", today: "2026-07-16" };

  it("returns nothing when no sheet is submitted or approved", () => {
    expect(payRunItem({ ...base, submitted: 0, approved: 0 })).toBeNull();
  });

  it("warns once the period has closed with work approved", () => {
    const item = payRunItem({ ...base, submitted: 0, approved: 3 });
    expect(item).toMatchObject({ key: "pay-run", label: "Pay run due", state: "warn", href: "/dashboard/timepay" });
    expect(item?.detail).toBe("1–14 Jul · 3 ready to pay");
  });

  it("lists both ready-to-pay and awaiting-approval counts", () => {
    const item = payRunItem({ ...base, submitted: 2, approved: 3 });
    expect(item?.detail).toBe("1–14 Jul · 3 ready to pay, 2 awaiting approval");
  });

  it("stays informational (ok) while the period is still open", () => {
    const item = payRunItem({ periodLabel: "15–28 Jul", periodEnd: "2026-07-28", today: "2026-07-20", submitted: 1, approved: 0 });
    expect(item).toMatchObject({ label: "Timesheets this period", state: "ok" });
    expect(item?.detail).toBe("15–28 Jul · 1 awaiting approval");
  });

  it("treats the end date itself as closed", () => {
    const item = payRunItem({ ...base, today: "2026-07-14", submitted: 0, approved: 1 });
    expect(item?.state).toBe("warn");
  });
});
