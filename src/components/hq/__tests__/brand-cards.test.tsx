import { render, screen } from "@testing-library/react";
import { HqBrandCards, type BrandCardData } from "../brand-cards";

const card: BrandCardData = {
  brand: "mitsubishi-electric",
  name: "Mitsubishi Electric",
  packName: "City Multi (VRF) + P series",
  version: "2026.1",
  idu: 172,
  odu: 68,
  pairs: 108,
  readyPct: 62,
  blockingGaps: 120,
  validationErrors: 0,
  orphans: 0,
};

describe("HqBrandCards", () => {
  it("renders name, version, counts, ready % and the drill-down link", () => {
    render(<HqBrandCards brands={[card]} />);
    const a = screen.getByText("Mitsubishi Electric").closest("a")!;
    expect(a).toHaveAttribute("href", "/hq/data/mitsubishi-electric");
    expect(screen.getByText("2026.1")).toBeInTheDocument();
    expect(screen.getByText(/172 indoor · 68 outdoor · 108 pairs/)).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getByText(/120 blocking/)).toBeInTheDocument();
  });

  it("shows validation/stale badges only when non-zero", () => {
    const { rerender } = render(<HqBrandCards brands={[card]} />);
    expect(screen.queryByText(/validation/)).not.toBeInTheDocument();
    expect(screen.queryByText(/stale/)).not.toBeInTheDocument();

    rerender(
      <HqBrandCards brands={[{ ...card, validationErrors: 2, orphans: 1 }]} />
    );
    expect(screen.getByText("2 validation")).toBeInTheDocument();
    expect(screen.getByText("1 stale")).toBeInTheDocument();
  });

  it("shows an empty state with no packs", () => {
    render(<HqBrandCards brands={[]} />);
    expect(screen.getByText(/no data packs installed/i)).toBeInTheDocument();
  });
});
