import { cleanup, render, screen } from "@testing-library/react";
import { Sidebar } from "../sidebar";
import { resolve } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";

/* Render as a real role would resolve — capabilities come from the same
   resolver the server uses, so these tests track the real defaults. */
const as = (role: Role, orgName: string | null = null) => (
  <Sidebar role={role} caps={[...resolve(role)]} orgName={orgName} />
);

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

// auto-cleanup isn't wired in this jest setup; without this, earlier renders
// (owner rails containing "Admin") leak into later queryByText assertions
afterEach(cleanup);

describe("Sidebar — HeyTiff × org line", () => {
  it("shows the trading name under the logo when set", () => {
    const { container } = render(as("owner", "Smith Air Conditioning"));
    const line = container.querySelector(".ht-orgx");
    expect(line).not.toBeNull();
    expect(line?.textContent).toContain("×");
    expect(line?.textContent).toContain("Smith Air Conditioning");
    // full name on hover even when the line truncates
    expect(line?.getAttribute("title")).toBe("Smith Air Conditioning");
  });

  it("renders no line at all while the org has no trading name", () => {
    const { container } = render(as("owner"));
    expect(container.querySelector(".ht-orgx")).toBeNull();
  });

  it("renders no line when the prop is omitted", () => {
    const { container } = render(as("owner"));
    expect(container.querySelector(".ht-orgx")).toBeNull();
  });

  it("keeps the wordmark regardless", () => {
    render(as("owner"));
    expect(screen.getByText("Hey")).toBeTruthy();
    expect(screen.getByText("Tiff")).toBeTruthy();
  });
});

describe("Sidebar — role-gated nav", () => {
  it("staff see no Operations entries, but keep their own vehicle", () => {
    render(as("staff"));
    expect(screen.queryByText("Team")).toBeNull();
    expect(screen.queryByText("Time & Pay")).toBeNull();
    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.queryByText("Assets")).toBeNull(); // the register is admin+
    expect(screen.getByText("Vehicle")).toBeTruthy(); // Personal group carries the "my"
    expect(screen.getByText("Toolbox")).toBeTruthy();
  });

  it("admins get Team, Time & Pay and the Admin section (its items gate inside)", () => {
    render(as("admin"));
    expect(screen.getByText("Team")).toBeTruthy();
    expect(screen.getByText("Time & Pay")).toBeTruthy();
    expect(screen.getByText("Admin")).toBeTruthy();
  });

  it("owners get the full rail", () => {
    render(as("owner", "Smith Air"));
    for (const label of ["Dashboard", "Toolbox", "Design Studio", "Tiff AI", "Team", "Time & Pay", "Assets", "Admin", "Vehicle"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });
});

describe("Sidebar — a granted capability shows its entry", () => {
  /* The gap this closes: during the signed-in walkthrough, granting an admin
     `financials` opened the Rate Calculator ROUTE but no nav entry appeared,
     because the sidebar still filtered by role. */
  it("reveals Team for a staff member granted `team`", () => {
    render(<Sidebar role="staff" caps={[...resolve("staff", { team: true })]} />);
    expect(screen.getByText("Team")).toBeTruthy();
    expect(screen.queryByText("Time & Pay")).toBeNull(); // nothing else leaked in
  });

  it("hides Toolbox when it is revoked, even though every role has it by default", () => {
    render(<Sidebar role="owner" caps={[...resolve("owner")]} />);
    expect(screen.getByText("Toolbox")).toBeTruthy();
    cleanup();
    // an explicit revoke is respected for non-owners
    render(<Sidebar role="admin" caps={[...resolve("admin", { toolbox: false })]} />);
    expect(screen.queryByText("Toolbox")).toBeNull();
    expect(screen.getByText("Design Studio")).toBeTruthy();
  });
});
