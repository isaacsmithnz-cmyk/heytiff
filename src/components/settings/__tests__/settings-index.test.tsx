import { render, screen, within } from "@testing-library/react";
import { SettingsIndex } from "../settings-index";

/* The index is the section's gate made visible: which rows a viewer gets is
   the same question as what they are allowed to open, so every case here is a
   role/capability case. The "no link" assertions matter as much as the
   positive ones: the two routes this page used to offer are gone.

   EVERY ROW IS A LINK. A planned tool was first a row wearing a "Planned"
   tag, then a name in a "Coming" line; on 2026-10-18 the seven planned tools
   went altogether, because they promised things that don't exist.

   v2: Admin is Settings, the rows grouped by area under a v2 head. */

const linkHrefs = () => Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));

describe("SettingsIndex", () => {
  it("wears the v2 head: the title, the count, and no way back from itself", () => {
    render(<SettingsIndex isOwner canFinancials kbQueueCount={0} />);
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("9 settings")).toBeInTheDocument();
    expect(document.querySelector(".st2-back")).toBeNull();
    // no colour chips: a colour only where it means something
    expect(document.querySelector("[style]")).toBeNull();
  });

  it("groups the rows by area, each group a named list", () => {
    render(<SettingsIndex isOwner canFinancials canJobMoney kbQueueCount={0} />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "The business",
      "What you send",
      "Quoting and money",
      "Tiff",
    ]);
    const money = screen.getByRole("list", { name: "Quoting and money" });
    expect(within(money).getAllByRole("link").map((a) => a.textContent)).toEqual([
      expect.stringContaining("Quoting"),
      expect.stringContaining("Price book"),
      expect.stringContaining("Rate Calculator"),
      expect.stringContaining("Tax & EOFY"),
      expect.stringContaining("Reports"),
    ]);
  });

  it("gives an owner the organisation and the calculator", () => {
    render(<SettingsIndex isOwner canFinancials kbQueueCount={0} />);
    expect(screen.getByText("Organisation").closest("a")).toHaveAttribute("href", "/dashboard/admin/organization");
    expect(screen.getByText("Rate Calculator").closest("a")).toHaveAttribute("href", "/dashboard/admin/rate-calculator");
  });

  it("keeps the owner's doors out of an admin's sight", () => {
    render(<SettingsIndex isOwner={false} canFinancials kbQueueCount={0} />);
    // the one thing `financials` buys
    expect(screen.getByText("Rate Calculator").closest("a")).toHaveAttribute("href", "/dashboard/admin/rate-calculator");
    expect(screen.queryByText("Organisation")).not.toBeInTheDocument();
    expect(screen.queryByText("Integrations")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "The business" })).not.toBeInTheDocument();
  });

  it("gives an owner nine rows, all of them openable", () => {
    render(<SettingsIndex isOwner canFinancials kbQueueCount={0} />);
    expect(linkHrefs()).toEqual([
      "/dashboard/admin/organization",
      "/dashboard/admin/integrations",
      /* every document and message the business sends from fixed wording */
      "/dashboard/admin/templates",
      /* anything somebody asks to have on company letterhead: Documents' Letters view */
      "/dashboard/documents?view=letter",
      /* quoting's own settings, not the calculator's (financials, like the calculator) */
      "/dashboard/admin/quoting",
      /* the business's own price book: suppliers, prices, preferred items */
      "/dashboard/admin/price-book",
      "/dashboard/admin/rate-calculator",
      "/dashboard/admin/tax",
      "/dashboard/admin/knowledge",
    ]);
    expect(document.querySelectorAll(".pt-row")).toHaveLength(9);
    // no planned tools, as a row or as a line
    expect(screen.queryByText("Planned")).not.toBeInTheDocument();
    expect(screen.queryByText("Coming")).not.toBeInTheDocument();
  });

  /* Integrations is owner-INTRINSIC, not `financials`: one Xero grant reaches
     wages, bills and the P&L at once. An admin with financials must not see the door. */
  it("keeps integrations owner-only, even with financials", () => {
    const { unmount } = render(<SettingsIndex isOwner canFinancials kbQueueCount={0} />);
    expect(screen.getByText("Integrations").closest("a")).toHaveAttribute("href", "/dashboard/admin/integrations");
    unmount();
    render(<SettingsIndex isOwner={false} canFinancials kbQueueCount={0} />);
    expect(screen.queryByText("Integrations")).not.toBeInTheDocument();
  });

  it("gives an ungranted admin the knowledge queue and nothing gated", () => {
    render(<SettingsIndex isOwner={false} canFinancials={false} kbQueueCount={0} />);
    expect(linkHrefs()).toEqual(["/dashboard/admin/templates", "/dashboard/documents?view=letter", "/dashboard/admin/knowledge"]);
    expect(screen.queryByText("Rate Calculator")).not.toBeInTheDocument();
    expect(screen.queryByText("Organisation")).not.toBeInTheDocument();
    expect(screen.getByText("3 settings")).toBeInTheDocument();
  });

  it("says the queue's count as an orange 'N new', and nothing at zero", () => {
    const { unmount } = render(<SettingsIndex isOwner={false} canFinancials={false} kbQueueCount={4} />);
    expect(screen.getByText("4 new").closest(".pt-state")).toHaveClass("pt-state--look");
    unmount();
    render(<SettingsIndex isOwner={false} canFinancials={false} kbQueueCount={0} />);
    expect(screen.queryByText(/new$/)).not.toBeInTheDocument();
  });

  it("offers the Reports settings only to someone who sees job money", () => {
    const { unmount } = render(<SettingsIndex isOwner canFinancials canJobMoney kbQueueCount={0} />);
    expect(screen.getByText("Reports").closest("a")).toHaveAttribute("href", "/dashboard/admin/analytics");
    unmount();
    render(<SettingsIndex isOwner={false} canFinancials kbQueueCount={0} />);
    expect(linkHrefs()).not.toContain("/dashboard/admin/analytics");
  });

  it("offers neither invites nor the holiday calendar: both moved", () => {
    for (const viewer of [
      { isOwner: true, canFinancials: true, kbQueueCount: 0 },
      { isOwner: false, canFinancials: true, kbQueueCount: 0 },
      { isOwner: false, canFinancials: false, kbQueueCount: 0 },
    ]) {
      const { unmount } = render(<SettingsIndex {...viewer} />);
      for (const href of linkHrefs()) {
        expect(href).not.toContain("/dashboard/admin/invite");
        expect(href).not.toContain("/dashboard/admin/holidays");
      }
      expect(screen.queryByText("Public holidays")).not.toBeInTheDocument();
      expect(screen.queryByText(/Invite/)).not.toBeInTheDocument();
      unmount();
    }
  });
});
