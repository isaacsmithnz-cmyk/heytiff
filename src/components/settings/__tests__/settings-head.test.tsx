import { render, screen } from "@testing-library/react";
import { SettingsHead } from "../settings-head";

/* Every settings page wears the one head: the way back, the title, a fact
   line only when there is a fact, and its own button on the right. */
describe("SettingsHead", () => {
  it("leads back to Settings by default, then the title and the fact", () => {
    render(<SettingsHead heading="Quoting" facts="3 suppliers" />);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/dashboard/admin");
    expect(screen.getByRole("heading", { level: 1, name: "Quoting" })).toBeInTheDocument();
    expect(screen.getByText("3 suppliers")).toHaveClass("st2-facts");
  });

  it("goes back where the page was reached from, and says nothing it has no fact for", () => {
    render(<SettingsHead heading="Xero" back={{ href: "/dashboard/admin/integrations", label: "Integrations" }} facts={null} />);
    expect(screen.getByRole("link", { name: "Integrations" })).toHaveAttribute("href", "/dashboard/admin/integrations");
    expect(document.querySelector(".st2-facts")).toBeNull();
  });

  it("puts the page's own button on the right, and Settings itself has no way back", () => {
    render(<SettingsHead heading="Settings" back={null} tools={<button type="button">New letter</button>} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: "New letter" }).closest(".st2-tools")).not.toBeNull();
  });
});
