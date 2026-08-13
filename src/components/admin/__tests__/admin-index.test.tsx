import { render, screen } from "@testing-library/react";
import { AdminIndex } from "../admin-index";

/* The index is the section's gate made visible: which rows a viewer gets is
   the same question as what they are allowed to open, so every case here is a
   role/capability case. The "no link" assertions matter as much as the
   positive ones — a coming tool that quietly became clickable would take an
   admin to a 404, and the two routes this page used to offer are gone.

   EVERY ROW IS A LINK NOW. A planned tool used to be a full row wearing a
   "Planned" tag; measured on 2026-08-12 that was seven of an owner's twelve
   rows and 496px of 1060px — a settings index that was mostly doors which
   don't open. What is coming is one line per group instead (`.adm-coming`),
   so "is it a row?" and "can I open it?" are the same question again. */

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
    expect(screen.queryByText("Nothing here for you yet")).not.toBeInTheDocument();
  });

  it("names the owner-only tools that are coming, without offering rows", () => {
    render(<AdminIndex isOwner canFinancials kbQueueCount={0} />);

    const coming = document.querySelectorAll(".adm-coming");
    const text = Array.from(coming, (c) => c.textContent).join(" ");
    for (const title of ["Password vault", "Billing", "Usage analytics"]) {
      expect(text).toContain(title);
    }
    // named, but not as something you can click or mistake for a row
    expect(document.querySelectorAll(".adm-row")).toHaveLength(5);
  });

  it("keeps the owner's doors out of an admin's sight", () => {
    render(<AdminIndex isOwner={false} canFinancials kbQueueCount={0} />);

    // the one thing `financials` buys
    expect(screen.getByText("Rate Calculator").closest("a")).toHaveAttribute(
      "href",
      "/dashboard/admin/rate-calculator",
    );
    expect(screen.queryByText("Organisation")).not.toBeInTheDocument();
    expect(screen.queryByText("Password vault")).not.toBeInTheDocument();
    expect(screen.queryByText("Billing")).not.toBeInTheDocument();
    expect(screen.queryByText("Usage analytics")).not.toBeInTheDocument();
    expect(screen.queryByText("Owner")).not.toBeInTheDocument();
  });

  it("still lists the manager tools that are coming", () => {
    render(<AdminIndex isOwner={false} canFinancials kbQueueCount={0} />);

    const text = Array.from(document.querySelectorAll(".adm-coming"), (c) => c.textContent).join(" ");
    for (const title of [
      "Compliance",
      "Documents",
      "Licences & insurances",
      "Training & apprentices",
    ]) {
      expect(text).toContain(title);
    }
  });

  it("gives an owner five rows, all of them openable", () => {
    render(<AdminIndex isOwner canFinancials kbQueueCount={0} />);

    expect(linkHrefs()).toEqual([
      "/dashboard/admin/organization",
      "/dashboard/admin/integrations",
      "/dashboard/admin/knowledge",
      "/dashboard/admin/rate-calculator",
      "/dashboard/admin/tax",
    ]);
    // the seven that are coming are named in two lines, not seven rows
    expect(document.querySelectorAll(".adm-row")).toHaveLength(5);
    expect(document.querySelectorAll(".adm-coming")).toHaveLength(2);
    expect(screen.queryByText("Planned")).not.toBeInTheDocument();
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
     rather than gated and every admin holds it. The empty state's code path
     survives for a future where all rows are gated; what matters here is
     that this viewer still sees none of the doors they don't hold. */
  it("gives an ungranted admin the knowledge queue and nothing gated", () => {
    render(<AdminIndex isOwner={false} canFinancials={false} kbQueueCount={0} />);

    expect(linkHrefs()).toEqual(["/dashboard/admin/knowledge"]);
    expect(screen.queryByText("Nothing here for you yet")).not.toBeInTheDocument();
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
