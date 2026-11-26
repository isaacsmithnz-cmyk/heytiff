import { render, screen, within } from "@testing-library/react";

/* The 3D stage is its own module and needs WebGL, which jsdom has none of;
   here it never starts, and the page shows its flat mark. */
jest.mock("../stage", () => ({ startStage: jest.fn(async () => null) }));

import { Landing } from "../landing";

/* THE FRONT PAGE: Sign in, and no way to make an account (Isaac, 26 November
   2026: "lock create account for now"). New businesses join by invitation,
   and an invitation's own link opens Auth0's sign-up tab (invite/accept),
   so nothing here may point at it. */
describe("the front page", () => {
  beforeAll(() => {
    window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
  });

  it("offers Sign in and never Create account", () => {
    const { container } = render(<Landing />);
    const signIns = screen.getAllByRole("link", { name: "Sign in" });
    expect(signIns.length).toBeGreaterThan(0);
    for (const a of signIns) expect(a.getAttribute("href")).toBe("/auth/login");
    expect(screen.queryByText(/create account/i)).toBeNull();
    expect(container.querySelector('a[href*="screen_hint=signup"]')).toBeNull();
    expect(screen.getAllByText("New businesses join by invitation for now.").length).toBeGreaterThan(0);
  });

  it("links its privacy, terms, support and staff door at the foot", () => {
    render(<Landing />);
    const foot = within(screen.getByRole("navigation", { name: "About HeyTiff" }));
    expect(foot.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
    expect(foot.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms");
    expect(foot.getByRole("link", { name: "Support" }).getAttribute("href")).toBe("/support");
    expect(foot.getByRole("link", { name: "Staff HQ" }).getAttribute("href")).toBe("/auth/login?returnTo=/hq");
  });
});
