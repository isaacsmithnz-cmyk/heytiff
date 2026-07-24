/* Outdoor Unit Placement — the list → answer flow, the drawing reacting to
   answers, and the folded-away job panel. */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { OutdoorUnit } from "../outdoor-unit";
import { RULES, DEFAULT_PLACEMENT, rulesFor } from "@/lib/toolbox/outdoor-unit";

const labelOf = (id: string) => RULES.find((r) => r.id === id)!.label;

function answer(label: string, choice: "Yes" | "No" | "Confirmed" | "Not sure") {
  const group = screen.getByRole("group", { name: label });
  fireEvent.click(within(group).getByRole("button", { name: choice }));
}

const passAll = () => {
  for (const r of rulesFor(DEFAULT_PLACEMENT)) {
    answer(r.label, r.answerLabels ? "Confirmed" : "Yes");
  }
};

describe("the list and the answer", () => {
  it("does not claim approval is needed before anything is answered", () => {
    render(<OutdoorUnit />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("Needed")).not.toBeInTheDocument();
    expect(screen.queryByText("Not needed")).not.toBeInTheDocument();
    expect(screen.getByText(/0 of 8 answered/)).toBeInTheDocument();
  });

  it("clears once every line passes", () => {
    render(<OutdoorUnit />);
    passAll();
    expect(screen.getByText("Not needed")).toBeInTheDocument();
    expect(screen.getByText(/8 of 8 answered/)).toBeInTheDocument();
  });

  it("one miss flips it to needing approval", () => {
    render(<OutdoorUnit />);
    passAll();
    answer(labelOf("street"), "No");
    expect(screen.getByText("Needed")).toBeInTheDocument();
    expect(screen.getByText(/1 to fix/)).toBeInTheDocument();
  });

  it("the noise line asks for a confirmation, not an observation", () => {
    render(<OutdoorUnit />);
    const group = screen.getByRole("group", { name: labelOf("noise-peak") });
    expect(within(group).getByRole("button", { name: "Confirmed" })).toBeInTheDocument();
    expect(within(group).queryByRole("button", { name: "Yes" })).not.toBeInTheDocument();
  });
});

describe("the job strip", () => {
  /* it sets which lines apply, so it must be visible above the list — not
     folded away below the answer, which is where it started */
  it("is on screen without opening anything", () => {
    render(<OutdoorUnit />);
    expect(screen.getByRole("button", { name: "Upper storey" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shop / office" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Heritage status" })).toBeInTheDocument();
  });

  /* the control asks where the UNIT sits, not which rooms it serves — read the
     other way it would wrongly lift the 1.8 m cap off a ground-mounted unit */
  it("labels the level control by where the unit sits", () => {
    render(<OutdoorUnit />);
    expect(screen.getByRole("group", { name: /which level the unit sits on/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upstairs" })).not.toBeInTheDocument();
  });

  it("an upper-storey unit drops the 1.8 m line and retitles the count", () => {
    render(<OutdoorUnit />);
    expect(screen.getByText(labelOf("height"))).toBeInTheDocument();
    expect(screen.getByText("8 to check")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Upper storey" }));
    expect(screen.queryByText(labelOf("height"))).not.toBeInTheDocument();
    expect(screen.getByText("7 to check")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ground floor" }));
    expect(screen.getByText(labelOf("height"))).toBeInTheDocument();
  });

  it("a shop swaps in the bigger setback", () => {
    render(<OutdoorUnit />);
    expect(screen.getByText(labelOf("boundary"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Shop / office" }));
    expect(screen.queryByText(labelOf("boundary"))).not.toBeInTheDocument();
    expect(screen.getByText(labelOf("business-setback"))).toBeInTheDocument();
  });

  /* a conservation area is not a heritage item — only the item has to be
     ground-mounted, and getting that wrong over-restricts every home in an HCA */
  it("distinguishes a conservation area from a listed item", () => {
    render(<OutdoorUnit />);
    const group = screen.getByRole("group", { name: "Heritage status" });

    fireEvent.click(within(group).getByRole("button", { name: "Conservation area" }));
    expect(screen.getByText(labelOf("heritage-rear"))).toBeInTheDocument();
    expect(screen.queryByText(labelOf("heritage-ground"))).not.toBeInTheDocument();

    fireEvent.click(within(group).getByRole("button", { name: "Heritage item" }));
    expect(screen.getByText(labelOf("heritage-ground"))).toBeInTheDocument();
  });
});

describe("the fine print", () => {
  it("shows the running hours and who to check with, unfolded", () => {
    render(<OutdoorUnit />);
    expect(screen.getByText("Weekdays")).toBeInTheDocument();
    expect(screen.getByText(/before 7 am/)).toBeInTheDocument();
    expect(screen.getByText(/check with them before you commit/)).toBeInTheDocument();
  });
});

describe("the drawing", () => {
  it("renders with an accessible name", () => {
    render(<OutdoorUnit />);
    expect(screen.getByRole("img", { name: /outdoor unit can sit/i })).toBeInTheDocument();
  });

  it("marks the fence gap red when that line is missed", () => {
    const { container } = render(<OutdoorUnit />);
    expect(container.querySelector(".dim.mk-bad")).toBeNull();
    answer(labelOf("boundary"), "No");
    expect(container.querySelector(".dim.mk-bad")).toBeTruthy();
    expect(container.querySelector(".bdy.mk-bad")).toBeTruthy();
  });

  it("renders as an elevation, not a plan", () => {
    render(<OutdoorUnit />);
    expect(screen.getByRole("img", { name: /outdoor unit can sit/i })).toBeInTheDocument();
    expect(screen.getByText(/Elevation through the side yard/)).toBeInTheDocument();
  });

  it("marks the bedroom clearance green when it passes", () => {
    const { container } = render(<OutdoorUnit />);
    answer(labelOf("bedroom"), "Yes");
    expect(container.querySelector(".win.mk-ok")).toBeTruthy();
    expect(container.querySelectorAll(".dim.mk-ok").length).toBeGreaterThan(0);
  });

  /* the elevation exists so the height rule can be drawn — a plan can't show it */
  it("marks the 1.8 m height dimension, and drops it upstairs", () => {
    const { container } = render(<OutdoorUnit />);
    answer(labelOf("height"), "No");
    expect(container.querySelectorAll(".dim.mk-bad").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Upper storey" }));
    expect(container.querySelectorAll(".dim.mk-bad").length).toBe(0);
  });
});
