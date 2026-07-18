/* Fault Finder — data integrity + symptom flow: pick → causes in likelihood
   order → expand → rule out. */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { FaultFinder } from "../fault-finder";
import { LIKELIHOOD_ORDER, SYMPTOMS } from "@/lib/toolbox/fault-finder";
import { ICON_PATHS } from "@/components/shell/icon";

describe("fault-finder data", () => {
  it("every symptom has ≥3 causes, a known icon, and complete fields", () => {
    expect(SYMPTOMS.length).toBeGreaterThanOrEqual(8);
    for (const s of SYMPTOMS) {
      expect(s.causes.length).toBeGreaterThanOrEqual(3);
      expect(ICON_PATHS[s.icon]).toBeTruthy();
      for (const c of s.causes) {
        expect(c.title).toBeTruthy();
        expect(c.check).toBeTruthy();
        expect(c.fix).toBeTruthy();
        expect(LIKELIHOOD_ORDER[c.likelihood]).toBeDefined();
      }
    }
  });

  it("causes are authored most-likely-first", () => {
    for (const s of SYMPTOMS) {
      const weights = s.causes.map((c) => LIKELIHOOD_ORDER[c.likelihood]);
      expect([...weights].sort((a, b) => a - b)).toEqual(weights);
    }
  });

  it("no manufacturer fault codes are embedded (pack-data rule)", () => {
    const text = JSON.stringify(SYMPTOMS);
    // brand names / code tables must not appear in generic guidance
    for (const brand of ["Mitsubishi", "Daikin", "Fujitsu", "Panasonic", "E6", "U4"]) {
      expect(text).not.toContain(brand);
    }
  });
});

describe("FaultFinder UI", () => {
  it("renders the symptom grid with no detail until one is picked", () => {
    render(<FaultFinder />);
    expect(screen.getByText("What's it doing?")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(SYMPTOMS.length);
    expect(screen.queryByText(/Rule this out/)).not.toBeInTheDocument();
  });

  it("selecting a symptom shows its causes with the first expanded", () => {
    render(<FaultFinder />);
    fireEvent.click(screen.getByRole("button", { name: /Water leaking indoors/ }));
    expect(screen.getByText("Blocked condensate drain")).toBeInTheDocument();
    // first cause auto-expanded → its Check text is visible
    expect(screen.getByText(/Slow or no discharge at the drain outlet/)).toBeInTheDocument();
  });

  it("safety banner appears for symptoms that carry one", () => {
    render(<FaultFinder />);
    fireEvent.click(screen.getByRole("button", { name: /Trips the breaker/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(/licensed work/);
  });

  it("ruling a cause out strikes it and can be restored", () => {
    render(<FaultFinder />);
    fireEvent.click(screen.getByRole("button", { name: /Ice on pipes or coil/ }));
    const first = screen.getByText("Airflow starvation").closest(".ff-cause") as HTMLElement;
    fireEvent.click(within(first).getByRole("button", { name: /Rule this out/ }));
    expect(first.className).toContain("out");
    fireEvent.click(within(first).getByRole("button", { name: /restore/ }));
    expect(first.className).not.toContain("out");
  });

  it("specialist causes carry the escalation chip", () => {
    render(<FaultFinder />);
    fireEvent.click(screen.getByRole("button", { name: /Not cooling/ }));
    expect(screen.getAllByText("Specialist").length).toBeGreaterThanOrEqual(2);
  });

  it("links to the related tools", () => {
    render(<FaultFinder />);
    expect(screen.getByRole("link", { name: /Running Pressures/ })).toHaveAttribute(
      "href",
      "/dashboard/toolbox/running-pressures"
    );
    expect(screen.getByRole("link", { name: /Heat Load/ })).toHaveAttribute(
      "href",
      "/dashboard/toolbox/heat-load"
    );
  });
});
