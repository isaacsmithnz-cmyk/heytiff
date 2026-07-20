import { cleanup, render, screen } from "@testing-library/react";
import { Sidebar } from "../sidebar";

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

// auto-cleanup isn't wired in this jest setup; without this, earlier renders
// (owner rails containing "Admin") leak into later queryByText assertions
afterEach(cleanup);

describe("Sidebar — HeyTiff × org line", () => {
  it("shows the trading name under the logo when set", () => {
    const { container } = render(<Sidebar role="owner" orgName="Smith Air Conditioning" />);
    const line = container.querySelector(".ht-orgx");
    expect(line).not.toBeNull();
    expect(line?.textContent).toContain("×");
    expect(line?.textContent).toContain("Smith Air Conditioning");
    // full name on hover even when the line truncates
    expect(line?.getAttribute("title")).toBe("Smith Air Conditioning");
  });

  it("renders no line at all while the org has no trading name", () => {
    const { container } = render(<Sidebar role="owner" orgName={null} />);
    expect(container.querySelector(".ht-orgx")).toBeNull();
  });

  it("renders no line when the prop is omitted", () => {
    const { container } = render(<Sidebar role="owner" />);
    expect(container.querySelector(".ht-orgx")).toBeNull();
  });

  it("keeps the wordmark regardless", () => {
    render(<Sidebar role="owner" orgName={null} />);
    expect(screen.getByText("Hey")).toBeTruthy();
    expect(screen.getByText("Tiff")).toBeTruthy();
  });
});

describe("Sidebar — role-gated nav", () => {
  it("staff see no Operations entries beyond the ungated placeholder", () => {
    render(<Sidebar role="staff" orgName={null} />);
    expect(screen.queryByText("Team")).toBeNull();
    expect(screen.queryByText("Time & Pay")).toBeNull();
    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.getByText("Assets")).toBeTruthy();
    expect(screen.getByText("Toolbox")).toBeTruthy();
  });

  it("admins get Team, Time & Pay and the Admin section (its items gate inside)", () => {
    render(<Sidebar role="admin" orgName={null} />);
    expect(screen.getByText("Team")).toBeTruthy();
    expect(screen.getByText("Time & Pay")).toBeTruthy();
    expect(screen.getByText("Admin")).toBeTruthy();
  });

  it("owners get the full rail", () => {
    render(<Sidebar role="owner" orgName="Smith Air" />);
    for (const label of ["Dashboard", "Toolbox", "Design Studio", "Tiff AI", "Team", "Time & Pay", "Assets", "Admin"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });
});
