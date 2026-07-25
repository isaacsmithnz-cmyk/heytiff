import {
  homeHtml,
  adminHtml,
  blankHtml,
} from "../screens";

describe("screen builders", () => {
  it("home greeting includes the name and greeting", () => {
    const html = homeHtml({ greeting: "Good morning", firstName: "Isaac", date: "Monday" });
    expect(html).toContain("Good morning");
    expect(html).toContain("Isaac");
    expect(html).toContain("Monday");
  });

  it("admin cards gate per item", () => {
    const owner = adminHtml({ canFinancials: true, canOrgSettings: true, canHolidays: true });
    expect(owner).toContain("/dashboard/admin/rate-calculator");
    expect(owner).toContain("/dashboard/admin/organization");
    expect(owner).toContain("/dashboard/admin/holidays");

    // Admin reaches the section but none of the gated items.
    const admin = adminHtml({ canFinancials: false });
    expect(admin).toContain("Nothing here for you yet");
    expect(admin).not.toContain("/dashboard/admin/rate-calculator");
    expect(admin).not.toContain("/dashboard/admin/organization");

    // Admin granted `financials`: calculator appears, nothing else does.
    const money = adminHtml({ canFinancials: true });
    expect(money).toContain("/dashboard/admin/rate-calculator");
    expect(money).not.toContain("/dashboard/admin/organization");
    expect(money).not.toContain("Nothing here for you yet");
  });

  it("no longer offers invites — they live on the Team page", () => {
    for (const html of [
      adminHtml({ canFinancials: true, canOrgSettings: true, canHolidays: true }),
      adminHtml({ canFinancials: false }),
    ]) {
      expect(html).not.toContain("/dashboard/admin/invite");
      expect(html).not.toContain("Invite your team");
      expect(html).not.toContain("Invite someone");
    }
  });

  it("blank screen renders its title and empty hint", () => {
    const html = blankHtml("Design Studio");
    expect(html).toContain("Design Studio");
    expect(html).toContain("Nothing here yet.");
  });
});
