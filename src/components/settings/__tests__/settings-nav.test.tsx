import { render, screen } from "@testing-library/react";
import { SETTINGS_SECTIONS, sectionAt, sectionsFor } from "@/lib/settings/sections";

let path = "/dashboard/admin/organization";
jest.mock("next/navigation", () => ({ usePathname: () => path }));

import { SettingsNav } from "../settings-nav";

/* Settings is one page: six sections down the left (Isaac, 25 October 2026:
   "Build Settings as the mock shows: the six sections"), each gated as
   docs/roles-and-permissions.md has it, the one you're on lit. */
describe("the six sections", () => {
  it("are these, in this order", () => {
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
      "Business",
      "Integrations",
      "Quoting",
      "Price book",
      "Pay and holidays",
      "Reports",
    ]);
  });

  it("show an owner with every grant all six", () => {
    expect(sectionsFor({ isOwner: true, canFinancials: true, canJobMoney: true })).toHaveLength(6);
  });

  /* The business's details and its integrations are owner-intrinsic; the
     money is `financials`; Reports' settings are Reports' own grant. */
  it("show an admin only what their grants reach", () => {
    expect(sectionsFor({ isOwner: false, canFinancials: false, canJobMoney: false }).map((s) => s.key)).toEqual(["pay"]);
    expect(sectionsFor({ isOwner: false, canFinancials: true, canJobMoney: false }).map((s) => s.key)).toEqual([
      "quoting",
      "price-book",
      "pay",
    ]);
    expect(sectionsFor({ isOwner: false, canFinancials: false, canJobMoney: true }).map((s) => s.key)).toEqual(["pay", "reports"]);
  });

  it("light the section a page under it belongs to", () => {
    expect(sectionAt("/dashboard/admin/integrations/servicem8")).toBe("integrations");
    expect(sectionAt("/dashboard/admin/rate-calculator")).toBe("quoting");
    expect(sectionAt("/dashboard/admin/price-book")).toBe("price-book");
    expect(sectionAt("/dashboard/admin/templates")).toBeNull();
  });
});

describe("the side list", () => {
  const all = SETTINGS_SECTIONS.map(({ key, label, href, under }) => ({ key, label, href, under }));

  it("links each section and marks the one you're on", () => {
    path = "/dashboard/admin/integrations/xero";
    render(<SettingsNav sections={all} />);
    const nav = screen.getByRole("navigation", { name: "Settings" });
    expect(nav.querySelectorAll("a")).toHaveLength(6);
    const on = screen.getByRole("link", { name: "Integrations" });
    expect(on).toHaveAttribute("aria-current", "page");
    expect(on).toHaveClass("on");
    expect(screen.getByRole("link", { name: "Business" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Business" })).toHaveAttribute("href", "/dashboard/admin/organization");
  });
});
