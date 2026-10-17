import { render, screen } from "@testing-library/react";
import { AdminIndex } from "../admin-index";

/* The index is the section's gate made visible: which rows a viewer gets is
   the same question as what they are allowed to open, so every case here is a
   role/capability case. The "no link" assertions matter as much as the
   positive ones — the two routes this page used to offer are gone.

   EVERY ROW IS A LINK. A planned tool was first a row wearing a "Planned"
   tag, then a name in a "Coming" line; on 2026-10-18 the seven planned tools
   went altogether, because they promised things that don't exist. */

const linkHrefs = () =>
  Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));

describe("AdminIndex", () => {
  it("gives an owner the organisation and the calculator", () => {
    render(<AdminIndex isOwner canFinancials kbQueueCount={0} />);

    expect(screen.getByText("Organisation").closest("a")).toHaveAttribute(
      "href",
      "/dashboard/admin/organization",
    );
    expect(screen.getByText("Rate Calculator").closest("a")).toHaveAttribute(
      "href",
      "/dashboard/admin/rate-calculator",
    );
  });

  it("keeps the owner's doors out of an admin's sight", () => {
    render(<AdminIndex isOwner={false} canFinancials kbQueueCount={0} />);

    // the one thing `financials` buys
    expect(screen.getByText("Rate Calculator").closest("a")).toHaveAttribute(
      "href",
      "/dashboard/admin/rate-calculator",
    );
    expect(screen.queryByText("Organisation")).not.toBeInTheDocument();
    expect(screen.queryByText("Integrations")).not.toBeInTheDocument();
  });

  it("gives an owner nine rows, all of them openable", () => {
    render(<AdminIndex isOwner canFinancials kbQueueCount={0} />);

    expect(linkHrefs()).toEqual([
      "/dashboard/admin/organization",
      "/dashboard/admin/integrations",
      /* every document and message the business sends from fixed wording */
      "/dashboard/admin/templates",
      /* anything somebody asks to have on company letterhead */
      "/dashboard/admin/letters",
      "/dashboard/admin/knowledge",
      "/dashboard/admin/rate-calculator",
      /* quoting's own settings, not the calculator's: markup and the
         preferred price-book items (financials, like the calculator) */
      "/dashboard/admin/quoting",
      /* the business's own price book: suppliers, prices, preferred items */
      "/dashboard/admin/price-book",
      "/dashboard/admin/tax",
    ]);
    expect(document.querySelectorAll(".adm-row")).toHaveLength(9);
    // no planned tools, as a row or as a line
    expect(screen.queryByText("Planned")).not.toBeInTheDocument();
    expect(screen.queryByText("Coming")).not.toBeInTheDocument();
  });

  /* Integrations is owner-INTRINSIC, not `financials`: one Xero grant reaches
     wages, bills and the P&L at once, which is a bigger decision than the
     calculator it feeds. An admin with financials must not see the door. */
  it("keeps integrations owner-only, even with financials", () => {
    const { unmount } = render(<AdminIndex isOwner canFinancials kbQueueCount={0} />);
    expect(screen.getByText("Integrations").closest("a")).toHaveAttribute(
      "href",
      "/dashboard/admin/integrations",
    );
    unmount();

    render(<AdminIndex isOwner={false} canFinancials kbQueueCount={0} />);
    expect(screen.queryByText("Integrations")).not.toBeInTheDocument();
  });

  /* This asserted an EMPTY page for an admin with neither gated item — and
     that page no longer exists, because the knowledge queue is editorial
     rather than gated and every admin holds it. What matters here is that
     this viewer still sees none of the doors they don't hold. */
  it("gives an ungranted admin the knowledge queue and nothing gated", () => {
    render(<AdminIndex isOwner={false} canFinancials={false} kbQueueCount={0} />);

    /* the business's own templates, readable by any admin */
    expect(linkHrefs()).toEqual(["/dashboard/admin/templates", "/dashboard/admin/letters", "/dashboard/admin/knowledge"]);
    expect(screen.queryByText("Rate Calculator")).not.toBeInTheDocument();
    expect(screen.queryByText("Organisation")).not.toBeInTheDocument();
  });

  it("wears the queue count as an 'N new' badge, and no badge at zero", () => {
    const { unmount } = render(
      <AdminIndex isOwner={false} canFinancials={false} kbQueueCount={4} />
    );
    expect(screen.getByText("4 new")).toBeInTheDocument();
    unmount();

    render(<AdminIndex isOwner={false} canFinancials={false} kbQueueCount={0} />);
    expect(screen.queryByText(/new$/)).not.toBeInTheDocument();
  });

  it("offers the Analytics settings only to someone who sees job money", () => {
    const { unmount } = render(<AdminIndex isOwner canFinancials canJobMoney kbQueueCount={0} />);
    expect(screen.getByText("Analytics").closest("a")).toHaveAttribute("href", "/dashboard/admin/analytics");
    unmount();
    render(<AdminIndex isOwner={false} canFinancials kbQueueCount={0} />);
    expect(linkHrefs()).not.toContain("/dashboard/admin/analytics");
  });

  it("offers neither invites nor the holiday calendar — both moved", () => {
    for (const viewer of [
      { isOwner: true, canFinancials: true, kbQueueCount: 0 },
      { isOwner: false, canFinancials: true, kbQueueCount: 0 },
      { isOwner: false, canFinancials: false, kbQueueCount: 0 },
    ]) {
      const { unmount } = render(<AdminIndex {...viewer} />);
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
