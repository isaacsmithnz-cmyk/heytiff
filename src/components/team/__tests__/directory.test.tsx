import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamDirectory } from "../directory";
import { demoPendingInvites, demoStaff, getDemoVehicleForStaff } from "@/mock/demo";
import { displayName } from "@/components/fleet/logic";

// mirror team/page.tsx: the Vehicle column derives from the Fleet register
const rows = demoStaff.map((s) => {
  const v = getDemoVehicleForStaff(s.id);
  return { ...s, vehicle: v ? displayName(v) : "" };
});

function setup() {
  render(<TeamDirectory staff={rows} pending={demoPendingInvites} />);
}

describe("TeamDirectory", () => {
  it("renders every staff member in the default view", () => {
    setup();
    for (const s of demoStaff) {
      expect(screen.getByText(s.name)).toBeInTheDocument();
    }
  });

  it("shows the three-state compliance chips", () => {
    setup();
    expect(screen.getByText("ARC expires 14d")).toBeInTheDocument();
    expect(screen.getByText("White Card expired")).toBeInTheDocument();
    expect(screen.getAllByText("Compliant")).toHaveLength(2);
  });

  it("marks inactive staff", () => {
    setup();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("filters to compliance issues on the Need attention tab", async () => {
    setup();
    await userEvent.click(screen.getByText("Need attention"));
    expect(screen.getByText("Jordan Mills")).toBeInTheDocument();
    expect(screen.getByText("Liam O’Brien")).toBeInTheDocument();
    expect(screen.queryByText("Sophie Tran")).not.toBeInTheDocument();
  });

  it("shows pending invites on the invites tab", async () => {
    setup();
    await userEvent.click(screen.getByText("Pending invites"));
    expect(screen.getByText("Ben Fletcher")).toBeInTheDocument();
    expect(screen.getByText("Expired 2 days ago")).toBeInTheDocument();
  });

  it("searches by name or role", async () => {
    setup();
    await userEvent.type(screen.getByPlaceholderText("Search name or role..."), "installer");
    expect(screen.getByText("Jordan Mills")).toBeInTheDocument();
    expect(screen.getByText("Marcus Webb")).toBeInTheDocument();
    expect(screen.queryByText("Hannah Cole")).not.toBeInTheDocument();
  });

  it("opens the row menu with a profile link", async () => {
    setup();
    const menuButtons = screen.getAllByLabelText("Actions");
    await userEvent.click(menuButtons[0]);
    const link = screen.getByText("View profile").closest("a");
    expect(link).toHaveAttribute("href", expect.stringContaining("/dashboard/team/"));
  });
});
