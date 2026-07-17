import { render, screen } from "@testing-library/react";
import { OrgTable } from "../org-table";
import type { OrgRow } from "@/lib/hq/overview";

const rows: OrgRow[] = [
  {
    id: "o1",
    name: "Acme HVAC",
    createdAt: "2026-01-01T00:00:00Z",
    memberCount: 3,
    designCount: 5,
    lastActivity: "2026-06-01T00:00:00Z",
  },
  {
    id: "o2",
    name: "Globex",
    createdAt: "2026-03-01T00:00:00Z",
    memberCount: 1,
    designCount: 0,
    lastActivity: null,
  },
];

describe("OrgTable", () => {
  it("renders a row per org with counts and a drill-in link", () => {
    render(<OrgTable rows={rows} />);

    const acme = screen.getByText("Acme HVAC").closest("a");
    expect(acme).toHaveAttribute("href", "/hq/orgs/o1");

    expect(screen.getByText("Globex").closest("a")).toHaveAttribute(
      "href",
      "/hq/orgs/o2"
    );
    // counts present
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("shows an empty state with no orgs", () => {
    render(<OrgTable rows={[]} />);
    expect(screen.getByText(/no organisations yet/i)).toBeInTheDocument();
  });
});
