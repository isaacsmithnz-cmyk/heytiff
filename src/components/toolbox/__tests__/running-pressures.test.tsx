/* Running Pressures — the merged tool. Estimate view tracks ambient; the
   Troubleshoot view turns measured pressures into a diagnosis + checklist. */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { RunningPressures } from "../running-pressures";
import { REFRIGERANT_KEYS, satPressureKpa } from "@/lib/toolbox/refrigerant";

const pick = (name: RegExp) =>
  within(screen.getByRole("group", { name: "Refrigerant" })).getByRole("button", { name });

describe("RunningPressures — estimate view", () => {
  it("renders all 7 refrigerant cards, R32 first and selected", () => {
    render(<RunningPressures />);
    const cards = [...screen.getByRole("group", { name: "Refrigerant" }).querySelectorAll("button")];
    expect(cards.map((c) => c.querySelector("b")?.textContent)).toEqual([...REFRIGERANT_KEYS]);
    expect(cards[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Low side")).toBeInTheDocument();
    expect(screen.getByText("High side")).toBeInTheDocument();
  });

  it("estimates from ambient: R32 cooling at 35°C", () => {
    render(<RunningPressures />);
    // cond 35+14=49°C, evap 24-17=7°C
    const suction = satPressureKpa("R32", 7, "vapor")!;
    const discharge = satPressureKpa("R32", 49, "liquid")!;
    expect(screen.getByText(String(Math.round(suction)))).toBeInTheDocument();
    expect(screen.getByText(String(Math.round(discharge)))).toBeInTheDocument();
    expect(screen.getByText(/saturation 49°C/)).toBeInTheDocument();
  });

  it("raising ambient raises the high side", () => {
    render(<RunningPressures />);
    const before = satPressureKpa("R32", 49, "liquid")!;
    fireEvent.change(screen.getByLabelText("Ambient temperature in °C"), { target: { value: "45" } });
    const after = satPressureKpa("R32", 59, "liquid")!;
    expect(after).toBeGreaterThan(before);
    expect(screen.getByText(String(Math.round(after)))).toBeInTheDocument();
    expect(screen.getByText(/ambient 45°C/)).toBeInTheDocument();
  });

  it("heating duty flips the model so ambient drives the low side", () => {
    render(<RunningPressures />);
    fireEvent.click(screen.getByRole("button", { name: "Heating" }));
    // defaults reset to 7°C ambient → evap -1°C, cond 20+20=40°C
    expect(screen.getByLabelText("Ambient temperature in °C")).toHaveValue("7");
    expect(screen.getByText(/saturation -1°C/)).toBeInTheDocument();
    expect(screen.getByText(/saturation 40°C/)).toBeInTheDocument();
  });

  it("R404A switches to refrigeration with a box temperature", () => {
    render(<RunningPressures />);
    fireEvent.click(pick(/R404A/));
    expect(screen.getByLabelText("Box temp temperature in °C")).toHaveValue("2");
    expect(screen.queryByRole("group", { name: "Duty" })).not.toBeInTheDocument();
    // freezer duty stays on-chart (extended R404A table)
    fireEvent.change(screen.getByLabelText("Box temp temperature in °C"), { target: { value: "-18" } });
    expect(screen.getByText(/saturation -26°C/)).toBeInTheDocument();
    expect(screen.queryByText(/outside the chart range/)).not.toBeInTheDocument();
  });

  it("R407C keeps its two-column chart", () => {
    render(<RunningPressures />);
    fireEvent.click(pick(/R407C/));
    expect(screen.getByText("Liquid (kPa)")).toBeInTheDocument();
    expect(screen.getByText("Vapor (kPa)")).toBeInTheDocument();
    expect(screen.getByText(/glide ~5.5 K/)).toBeInTheDocument();
  });
});

describe("RunningPressures — troubleshoot view", () => {
  const goTroubleshoot = () =>
    fireEvent.click(screen.getByRole("button", { name: "Troubleshoot my readings" }));

  it("the estimate view offers the troubleshoot hand-off", () => {
    render(<RunningPressures />);
    goTroubleshoot();
    expect(screen.getByText("Your readings")).toBeInTheDocument();
    expect(screen.getByLabelText("Measured suction pressure in kPa")).toBeInTheDocument();
  });

  it("waits for both pressures before diagnosing", () => {
    render(<RunningPressures />);
    goTroubleshoot();
    expect(screen.getByText(/Enter both pressures/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Measured suction pressure in kPa"), {
      target: { value: "700" },
    });
    expect(screen.getByText(/Enter both pressures/)).toBeInTheDocument();
  });

  it("both sides low → undercharge, with a checklist", () => {
    render(<RunningPressures />);
    goTroubleshoot();
    // R32 cooling @35°C expects ~850 / ~3040; feed it much lower
    fireEvent.change(screen.getByLabelText("Measured suction pressure in kPa"), {
      target: { value: "500" },
    });
    fireEvent.change(screen.getByLabelText("Measured discharge pressure in kPa"), {
      target: { value: "2000" },
    });
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(/undercharge or leak/i);
    expect(screen.getAllByText("LOW").length).toBe(2);
    expect(screen.getByText("What to check")).toBeInTheDocument();
    expect(screen.getByText(/Leak search/i)).toBeInTheDocument();
  });

  it("high head with a normal low side points at the condenser", () => {
    render(<RunningPressures />);
    goTroubleshoot();
    fireEvent.change(screen.getByLabelText("Measured suction pressure in kPa"), {
      target: { value: "850" },
    });
    fireEvent.change(screen.getByLabelText("Measured discharge pressure in kPa"), {
      target: { value: "3900" },
    });
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(/condenser/i);
    expect(screen.getByText("HIGH")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  it("on-target readings report normal", () => {
    render(<RunningPressures />);
    goTroubleshoot();
    fireEvent.change(screen.getByLabelText("Measured suction pressure in kPa"), {
      target: { value: String(Math.round(satPressureKpa("R32", 7, "vapor")!)) },
    });
    fireEvent.change(screen.getByLabelText("Measured discharge pressure in kPa"), {
      target: { value: String(Math.round(satPressureKpa("R32", 49, "liquid")!)) },
    });
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(/look normal/i);
    expect(screen.getAllByText("OK").length).toBe(2);
  });

  it("optional line temps add superheat / subcooling and a charge note", () => {
    render(<RunningPressures />);
    goTroubleshoot();
    fireEvent.change(screen.getByLabelText("Measured suction pressure in kPa"), {
      target: { value: "500" },
    });
    fireEvent.change(screen.getByLabelText("Measured discharge pressure in kPa"), {
      target: { value: "2000" },
    });
    const shsc = () => document.querySelector(".rp2-shsc");
    expect(shsc()).toBeNull();
    fireEvent.change(screen.getByLabelText("Suction line temperature in °C"), {
      target: { value: "20" },
    });
    fireEvent.change(screen.getByLabelText("Liquid line temperature in °C"), {
      target: { value: "44" },
    });
    expect(shsc()).toHaveTextContent(/Superheat/);
    expect(shsc()).toHaveTextContent(/Subcooling/);
    // high SH + low SC on a both-low pattern reads as undercharge
    expect(document.querySelector(".rp2-charge")).toHaveTextContent(/undercharge/i);
  });

  it("psi readings are converted before diagnosing", () => {
    render(<RunningPressures />);
    fireEvent.click(screen.getByRole("button", { name: "psi" }));
    goTroubleshoot();
    // 123 psi ≈ 848 kPa and 441 psi ≈ 3040 kPa — both on target
    fireEvent.change(screen.getByLabelText("Measured suction pressure in psi"), {
      target: { value: "123" },
    });
    fireEvent.change(screen.getByLabelText("Measured discharge pressure in psi"), {
      target: { value: "441" },
    });
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(/look normal/i);
  });

  it("can go back to the estimate", () => {
    render(<RunningPressures />);
    goTroubleshoot();
    fireEvent.click(screen.getByRole("button", { name: "Back to the estimate" }));
    expect(screen.getByText("Field notes")).toBeInTheDocument();
  });
});
