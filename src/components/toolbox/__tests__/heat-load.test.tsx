/* Heat Load calculator — helper math mirrors the studio engine and the UI
   computes per-room + total loads live. */

import { render, screen, fireEvent } from "@testing-library/react";
import { HeatLoadCalculator, hlRoomArea, hlRoomLoadKw, parseNum, type HlJob, type HlRoom } from "../heat-load";
import { roomHeatLoadKw } from "@/lib/studio/loads";

function room(patch: Partial<HlRoom> = {}): HlRoom {
  return {
    id: "r1",
    name: "Test",
    areaMode: "dims",
    lengthM: "5",
    widthM: "4",
    areaM2: "",
    glazing: "moderate",
    condition: "standard",
    ceilingHeightM: "2.4",
    orientation: "N",
    internal: false,
    ...patch,
  };
}
const job: HlJob = { climateZone: 5, buildingType: "residential", wm2Override: "" };

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
    expect(hlRoomArea(room())).toBe(20);
    expect(hlRoomArea(room({ areaMode: "area", areaM2: "36.5" }))).toBe(36.5);
    expect(hlRoomArea(room({ lengthM: "" }))).toBeNull();
  });

  it("load matches the studio engine exactly", () => {
    const r = room({ glazing: "high", condition: "poor", orientation: "W", ceilingHeightM: "3.0" });
    expect(hlRoomLoadKw(r, job)).toBe(
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
    const internal = hlRoomLoadKw(room({ internal: true, orientation: "W" }), job)!;
    const west = hlRoomLoadKw(room({ orientation: "W" }), job)!;
    const south = hlRoomLoadKw(room({ orientation: "S" }), job)!;
    expect(internal).toBeLessThan(west);
    expect(internal).toBe(south); // NO_SOLAR_MULT === S ×0.85
  });

  it("W/m² override replaces the zone table", () => {
    const kw = hlRoomLoadKw(room(), { ...job, wm2Override: "200" })!;
    expect(kw).toBe((20 * 200) / 1000);
  });
});

describe("HeatLoadCalculator UI", () => {
  it("computes a room load and the total from typed dimensions", () => {
    render(<HeatLoadCalculator />);
    fireEvent.change(screen.getByLabelText("Length in metres"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Width in metres"), { target: { value: "4" } });
    // Zone 5 residential: 20 m² × 145 = 2900 W → 2.9 kW
    expect(screen.getAllByText("2.9 kW").length).toBeGreaterThan(0);
    // dims note + summary meta both show the area
    expect(screen.getAllByText(/20 m²/).length).toBeGreaterThanOrEqual(2);
  });

  it("adds and removes rooms", () => {
    render(<HeatLoadCalculator />);
    fireEvent.click(screen.getByRole("button", { name: /Add room/ }));
    expect(screen.getAllByLabelText("Room name")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Remove Room 2" }));
    expect(screen.getAllByLabelText("Room name")).toHaveLength(1);
  });

  it("west-facing beats north-facing for the same room", () => {
    render(<HeatLoadCalculator />);
    fireEvent.change(screen.getByLabelText("Length in metres"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Width in metres"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "W" }));
    // 2900 × 1.3 = 3770 W → 3.8 kW
    expect(screen.getAllByText("3.8 kW").length).toBeGreaterThan(0);
  });

  it("buffers state to localStorage", async () => {
    jest.useFakeTimers();
    render(<HeatLoadCalculator />);
    fireEvent.change(screen.getByLabelText("Length in metres"), { target: { value: "6" } });
    jest.advanceTimersByTime(500);
    const saved = JSON.parse(localStorage.getItem("heytiff.toolbox.heat-load.v1")!);
    expect(saved.v).toBe(1);
    expect(saved.rooms[0].lengthM).toBe("6");
    jest.useRealTimers();
  });

  it("restores a buffered survey on mount", () => {
    localStorage.setItem(
      "heytiff.toolbox.heat-load.v1",
      JSON.stringify({
        v: 1,
        job: { climateZone: 6, buildingType: "commercial", wm2Override: "" },
        rooms: [room({ name: "Server Room", areaMode: "area", areaM2: "12" })],
      })
    );
    render(<HeatLoadCalculator />);
    expect(screen.getByDisplayValue("Server Room")).toBeInTheDocument();
    // Zone 6 commercial 160 W/m² × 12 m² = 1920 W → 1.9 kW
    expect(screen.getAllByText("1.9 kW").length).toBeGreaterThan(0);
  });
});
