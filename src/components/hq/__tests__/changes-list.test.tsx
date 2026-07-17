import { render, screen, within } from "@testing-library/react";
import { ChangesList, type ChangeEvent } from "../changes-list";

const events: ChangeEvent[] = [
  {
    id: "2",
    section: "indoor_units",
    rowKey: "PEFY-1",
    field: "airflow_ls",
    action: "set",
    oldValue: null,
    newValue: 210,
    enteredBy: "isaac@heytiff.com",
    enteredAt: "2026-07-16T02:30:00Z",
  },
  {
    id: "1",
    section: "outdoor_units",
    rowKey: "PUHY-9",
    field: "ports",
    action: "clear",
    oldValue: 8,
    newValue: null,
    enteredBy: "staff@heytiff.com",
    enteredAt: "2026-07-15T20:00:00Z",
  },
];

describe("ChangesList", () => {
  it("renders each event with staff member, field label and old → new", () => {
    render(<ChangesList events={events} />);

    const set = screen.getByText("PEFY-1").closest(".hq-change") as HTMLElement;
    expect(within(set).getByText("isaac@heytiff.com")).toBeInTheDocument();
    expect(within(set).getByText(/Airflow/)).toBeInTheDocument(); // field label, not raw key
    expect(within(set).getByText(/— → 210/)).toBeInTheDocument();

    const clear = screen.getByText("PUHY-9").closest(".hq-change") as HTMLElement;
    expect(within(clear).getByText(/8 → pack/)).toBeInTheDocument();
  });

  it("renders tag-list (array) values readably", () => {
    render(
      <ChangesList
        events={[
          {
            id: "3",
            section: "indoor_units",
            rowKey: "MSZ-AP25",
            field: "system_roles",
            action: "set",
            oldValue: ["split-pair"],
            newValue: ["split-pair", "vrf"],
            enteredBy: "isaac@heytiff.com",
            enteredAt: "2026-07-16T03:00:00Z",
          },
        ]}
      />
    );
    expect(
      screen.getByText(/\[split-pair\] → \[split-pair, vrf\]/)
    ).toBeInTheDocument();
  });

  it("shows an empty state with no changes", () => {
    render(<ChangesList events={[]} />);
    expect(screen.getByText(/no manual changes yet/i)).toBeInTheDocument();
  });
});
