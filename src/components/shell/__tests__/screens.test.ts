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

  it("admin invite card depends on the canInvite flag", () => {
    const owner = adminHtml({ canInvite: true, canFinancials: true, canOrgSettings: true });
    expect(owner).toContain("Invite your team");
    expect(owner).toContain("/dashboard/admin/invite");
    expect(owner).toContain("/dashboard/admin/rate-calculator");
    expect(owner).toContain("/dashboard/admin/organization");

    // Admin reaches the section but none of the gated items.
    const admin = adminHtml({ canInvite: false, canFinancials: false });
    expect(admin).toContain("Nothing here for you yet");
    expect(admin).not.toContain("/dashboard/admin/invite");
    expect(admin).not.toContain("/dashboard/admin/rate-calculator");
    expect(admin).not.toContain("/dashboard/admin/organization");

    // Admin granted `financials`: calculator appears, invites still don't.
    const money = adminHtml({ canInvite: false, canFinancials: true });
    expect(money).toContain("/dashboard/admin/rate-calculator");
    expect(money).not.toContain("/dashboard/admin/invite");
    expect(money).not.toContain("Nothing here for you yet");

    // Admin granted `invites` only: the office-manager case — invite card, no money.
    const onboarder = adminHtml({ canInvite: true, canFinancials: false });
    expect(onboarder).toContain("/dashboard/admin/invite");
    expect(onboarder).not.toContain("/dashboard/admin/rate-calculator");
    expect(onboarder).not.toContain("Nothing here for you yet");
  });

  it("blank screen renders its title and empty hint", () => {
    const html = blankHtml("Design Studio");
    expect(html).toContain("Design Studio");
    expect(html).toContain("Nothing here yet.");
  });
});
