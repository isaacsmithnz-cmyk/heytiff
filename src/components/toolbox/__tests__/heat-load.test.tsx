/* Heat Load quick-check — helper math mirrors the studio engine, the class
   suggestion rounds up to the next split size, and the UI answers live from
   two typed numbers with factors collapsed behind Adjust. */

import { render, screen, fireEvent } from "@testing-library/react";
import {
  HeatLoadCalculator,
  HL_DEFAULTS,
  hlArea,
  hlLoadKw,
  parseNum,
  suggestClassKw,
  UNIT_CLASSES,
  type HlState,
} from "../heat-load";
import { roomHeatLoadKw } from "@/lib/studio/loads";

function state(patch: Partial<HlState> = {}): HlState {
  return { ...HL_DEFAULTS, lengthM: "5", widthM: "4", ...patch };
}

beforeEach(() => localStorage.clear());

describe("heat-load helpers", () => {
  it("parseNum accepts decimals and comma decimals, rejects junk", () => {
    expect(parseNum("3.5")).toBe(3.5);
    expect(parseNum("3,5")).toBe(3.5);
    expect(parseNum(" 12 ")).toBe(12);
    expect(parseNum("")).toBeNull();
    expect(parseNum("0")).toBeNull();
    expect(parseNum("-4")).toBeNull();
    expect(parseNum("abc")).toBeNull();
  });

  it("area from dims or direct entry", () => {
    expect(hlArea(state())).toBe(20);
    expect(hlArea(state({ areaMode: "area", areaM2: "36.5" }))).toBe(36.5);
    expect(hlArea(state({ lengthM: "" }))).toBeNull();
  });

  it("load matches the studio engine exactly", () => {
    const s = state({ glazing: "high", condition: "poor", orientation: "W", ceilingHeightM: "3.0" });
    expect(hlLoadKw(s)).toBe(
      roomHeatLoadKw({
        areaM2: 20,
        climateZone: 5,
        buildingType: "residential",
        baseWm2Override: null,
        glazing: "high",
        condition: "poor",
        ceilingHeightM: 3.0,
        orientation: "W",
        hasExternalWalls: true,
      })
    );
  });

  it("internal room floors the orientation multiplier", () => {
    const internal = hlLoadKw(state({ internal: true, orientation: "W" }))!;
    const west = hlLoadKw(state({ orientation: "W" }))!;
    const south = hlLoadKw(state({ orientation: "S" }))!;
    expect(internal).toBeLessThan(west);
    expect(internal).toBe(south); // NO_SOLAR_MULT === S ×0.85
  });

  it("W/m² override replaces the zone table", () => {
    expect(hlLoadKw(state({ wm2Override: "200" }))).toBe((20 * 200) / 1000);
  });

  it("suggestClassKw rounds up to the next class, null beyond the largest", () => {
    expect(suggestClassKw(1.4)).toBe(2.0);
    expect(suggestClassKw(2.5)).toBe(2.5); // exact match stays
    expect(suggestClassKw(2.9)).toBe(3.5);
    expect(suggestClassKw(5.01)).toBe(6.0);
    expect(suggestClassKw(8.0)).toBe(8.0);
    expect(suggestClassKw(8.4)).toBeNull();
    expect(UNIT_CLASSES.length).toBeGreaterThanOrEqual(6);
  });
});

describe("HeatLoadCalculator UI", () => {
  it("two typed numbers give the answer and the class suggestion", () => {
    render(<HeatLoadCalculator />);
    fireEvent.change(screen.getByLabelText("Length in metres"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Width in metres"), { target: { value: "4" } });
    // Zone 5 residential: 20 m² × 145 = 2900 W → 2.9 kW → 3.5 class
    expect(screen.getByText("2.9")).toBeInTheDocument();
    expect(screen.getByText("3.5 kW class")).toBeInTheDocument();
    expect(screen.getByText(/20 m² × 145 W\/m²/)).toBeInTheDocument();
  });

  it("prompts for size until both numbers are in, showing a dim 0.0 (not a dash)", () => {
    const { container } = render(<HeatLoadCalculator />);
    expect(screen.getByText(/Type the room size/)).toBeInTheDocument();
    expect(container.querySelector(".hl2-hero .big.empty")).toHaveTextContent("0.0");
    fireEvent.change(screen.getByLabelText("Length in metres"), { target: { value: "5" } });
    expect(screen.getByText(/Type the room size/)).toBeInTheDocument();
    // both numbers in → placeholder styling drops
    fireEvent.change(screen.getByLabelText("Width in metres"), { target: { value: "4" } });
    expect(container.querySelector(".hl2-hero .big.empty")).toBeNull();
  });

  it("height sits in the size card and feeds the graduated multiplier", () => {
    render(<HeatLoadCalculator />);
    // visible immediately — no Advanced needed
    const height = screen.getByLabelText("Ceiling height in metres");
    expect(height).toHaveValue("2.4");
    fireEvent.change(screen.getByLabelText("Length in metres"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Width in metres"), { target: { value: "4" } });
    fireEvent.change(height, { target: { value: "3" } });
    // 2900 W × 1.125 = 3262.5 → 3.3 kW, summary flags the multiplier
    expect(screen.getByText("3.3")).toBeInTheDocument();
    expect(screen.getByText(/high ceiling ×1.13/)).toBeInTheDocument();
    // 4 m ceiling: 2900 × 1.333 = 3867 → 3.9 kW — not the old flat 10%
    fireEvent.change(height, { target: { value: "4" } });
    expect(screen.getByText("3.9")).toBeInTheDocument();
    expect(screen.getByText(/high ceiling ×1.33/)).toBeInTheDocument();
  });

  it("area mode swaps to a single m² field", () => {
    render(<HeatLoadCalculator />);
    fireEvent.click(screen.getByRole("button", { name: /Enter m² instead/ }));
    fireEvent.change(screen.getByLabelText("Floor area in square metres"), { target: { value: "12" } });
    // 12 × 145 = 1740 W → 1.7 kW → 2.0 class
    expect(screen.getByText("1.7")).toBeInTheDocument();
    expect(screen.getByText("2.0 kW class")).toBeInTheDocument();
  });

  it("big loads point to the Studio instead of a class", () => {
    render(<HeatLoadCalculator />);
    fireEvent.click(screen.getByRole("button", { name: /Enter m² instead/ }));
    fireEvent.change(screen.getByLabelText("Floor area in square metres"), { target: { value: "80" } });
    // 80 × 145 = 11.6 kW → beyond single-split classes
    expect(screen.getByRole("link", { name: /design it in the Studio/ })).toHaveAttribute(
      "href",
      "/dashboard/studio"
    );
  });

  it("info markers explain every factor and its multiplier", () => {
    const { container } = render(<HeatLoadCalculator />);
    // height marker lives in the size card — visible without opening Advanced
    expect(container.querySelector('[data-tip*="4.0 m ×1.33"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    const tips = [...container.querySelectorAll(".htip")].map((t) => t.getAttribute("data-tip") ?? "");
    expect(tips.length).toBe(7); // height + zone, override, building, glazing, insulation, orientation
    expect(tips.some((t) => t.includes("NCC climate-zone table"))).toBe(true);
    expect(tips.some((t) => t.includes("double glazed) reduces load by 20%"))).toBe(true);
    expect(tips.some((t) => t.includes("Poor insulation increases it by 20%"))).toBe(true);
    expect(tips.some((t) => t.includes("West is worst (×1.30)"))).toBe(true);
    expect(tips.some((t) => t.includes("zone table (blank = table value)".slice(0, 10)))).toBe(true);
    expect(tips.some((t) => t.includes("higher base W/m²"))).toBe(true);
  });

  it("zone options name the areas serviced, not climate jargon", () => {
    render(<HeatLoadCalculator />);
    fireEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    expect(screen.getByRole("option", { name: "Zone 5 — Sydney, Perth, Adelaide" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Zone 6 — Melbourne, Geelong, Canberra" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Warm temperate/ })).not.toBeInTheDocument();
    // the climate descriptor moved into the info tip
    const zoneTip = document.querySelector('[data-tip*="Warm temperate"]');
    expect(zoneTip?.getAttribute("data-tip")).toContain("Sydney");
  });

  it("glazing and insulation options wear their multipliers; summary echoes non-default ones", () => {
    render(<HeatLoadCalculator />);
    fireEvent.change(screen.getByLabelText("Length in metres"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Width in metres"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    // multipliers visible on every option, selected or not
    expect(screen.getByRole("button", { name: "Low ×0.80" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "High ×1.24" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Good ×0.85" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Poor ×1.20" })).toBeInTheDocument();
    // picking non-defaults echoes the factor into the summary line
    fireEvent.click(screen.getByRole("button", { name: "High ×1.24" }));
    fireEvent.click(screen.getByRole("button", { name: "Poor ×1.20" }));
    expect(screen.getByText(/high glass ×1.24 · poor insulation ×1.20/)).toBeInTheDocument();
    // 2900 × 1.24 × 1.2 = 4315 W → 4.3 kW
    expect(screen.getByText("4.3")).toBeInTheDocument();
  });

  it("Advanced starts collapsed with a summary line; the header reveals the panel", () => {
    render(<HeatLoadCalculator />);
    expect(screen.getByText(/Zone 5 · Residential · moderate glass/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Glazing")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    expect(screen.getByLabelText("Glazing")).toBeInTheDocument();
    // west-facing bumps 2.9 → 3.8 live
    fireEvent.change(screen.getByLabelText("Length in metres"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Width in metres"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "W" }));
    expect(screen.getByText("3.8")).toBeInTheDocument();
    expect(screen.getByText(/W-facing/)).toBeInTheDocument();
  });

  it("remembers factors but never the size", async () => {
    jest.useFakeTimers();
    const first = render(<HeatLoadCalculator />);
    fireEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    fireEvent.click(screen.getByRole("button", { name: "Commercial" }));
    fireEvent.change(screen.getByLabelText("Length in metres"), { target: { value: "6" } });
    jest.advanceTimersByTime(500);
    const saved = JSON.parse(localStorage.getItem("heytiff.toolbox.heat-load.v2")!);
    expect(saved.v).toBe(2);
    expect(saved.s.buildingType).toBe("commercial");
    expect(saved.s.lengthM).toBeUndefined();
    jest.useRealTimers();

    first.unmount();
    render(<HeatLoadCalculator />);
    // factor restored, size blank
    expect(screen.getByText(/Commercial/)).toBeInTheDocument();
    expect(screen.getByLabelText("Length in metres")).toHaveValue("");
  });

  it("reset restores default factors but keeps the typed size and height", () => {
    render(<HeatLoadCalculator />);
    fireEvent.change(screen.getByLabelText("Length in metres"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Width in metres"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    fireEvent.click(screen.getByRole("button", { name: "W" }));
    expect(screen.getByText("3.8")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Reset factors/ }));
    expect(screen.getByText("2.9")).toBeInTheDocument();
    expect(screen.getByLabelText("Length in metres")).toHaveValue("5");
    expect(screen.getByLabelText("Ceiling height in metres")).toHaveValue("2.4");
  });
});
