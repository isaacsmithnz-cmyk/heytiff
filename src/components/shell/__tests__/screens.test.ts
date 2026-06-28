import {
  homeHtml,
  toolboxHtml,
  timepayHtml,
  assetsHtml,
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

  it("toolbox drops the old eyebrow and shows the empty state", () => {
    const html = toolboxHtml();
    expect(html).toContain("<h1>Toolbox</h1>");
    expect(html).toContain("No tools yet");
    expect(html).not.toContain("Field Tools");
  });

  it("Time & Pay renders three tabs with their empty states", () => {
    const html = timepayHtml();
    expect(html.match(/data-ptab=/g)).toHaveLength(3);
    expect(html.match(/data-ppanel=/g)).toHaveLength(3);
    expect(html).toContain("No hours logged yet");
    expect(html).toContain("No leave requests");
    expect(html).toContain("No expense claims");
  });

  it("Assets renders two tabs with their empty states", () => {
    const html = assetsHtml();
    expect(html.match(/data-ptab=/g)).toHaveLength(2);
    expect(html).toContain("No vehicles yet");
    expect(html).toContain("No equipment registered");
  });

  it("admin invite card depends on the canInvite flag", () => {
    expect(adminHtml(true)).toContain("Invite your team");
    expect(adminHtml(true)).toContain("/dashboard/admin/invite");
    expect(adminHtml(false)).toContain("owners and admins");
    expect(adminHtml(false)).not.toContain("/dashboard/admin/invite");
  });

  it("blank screen renders its title and empty hint", () => {
    const html = blankHtml("Design Studio");
    expect(html).toContain("Design Studio");
    expect(html).toContain("Nothing here yet.");
  });
});
